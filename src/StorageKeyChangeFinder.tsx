import type { ApiPromise } from '@polkadot/api'
import { Alert, Button, Card, Col, Divider, Form, Input, InputNumber, Radio, Row, Select, Space, Tag, Typography, message } from 'antd'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BlockDate } from './BlockDate'
import { performBinarySearchAndSetState } from './storage_binary_search'

export type StorageKeyChangeFinderProps = {
  /** Polkadot API instance to query chain data */
  api: ApiPromise
}

// ========= Helper types & functions =========

type Mode = 'change' | 'first' | 'number' | 'all' | 'linear' | 'linear_bigint'

interface ValObj {
  block: number
  hex: string
}

type BigIntLinearChange = {
  block: number
  hex: string
  prevValue: bigint
  value: bigint
  diff: bigint
}

const assertNever = (x: never): never => {
  throw new Error(`Unhandled case: ${String(x)}`)
}

const validateHexKey = (key: string): boolean => /^0x[0-9a-fA-F]+$/.test(key)

const getHeadNumber = async (api: ApiPromise): Promise<number> => {
  return (await api.query.system.number()).toNumber()
}

const readStorageHexAt = async (api: ApiPromise, storageKey: string, block: number): Promise<string> => {
  const hash = await api.rpc.chain.getBlockHash(block)
  const hex = (await api.rpc.state.getStorage(storageKey, hash))?.toHex() || '0x'
  return hex
}

const readVal = async (api: ApiPromise, storageKey: string, block: number): Promise<ValObj> => {
  return { block, hex: await readStorageHexAt(api, storageKey, block) }
}

/**
 * Decode a storage hex value as an unsigned little-endian integer (BigInt).
 * This matches SCALE encoding for fixed-width primitive integers (u32/u64/u128/...),
 * which are stored little-endian. (If the value is compact-encoded, this won't match.)
 */
const decodeHexAsLeBigInt = (hex: string): bigint => {
  if (!hex || hex === '0x') return 0n
  let h = hex.startsWith('0x') ? hex.slice(2) : hex
  if (h.length === 0) return 0n
  if (h.length % 2 !== 0) h = `0${h}`

  let out = 0n
  // Little-endian: first byte is least-significant
  for (let i = 0; i < h.length; i += 2) {
    const byte = BigInt(Number.parseInt(h.slice(i, i + 2), 16))
    out += byte << (8n * BigInt(i / 2))
  }
  return out
}

// Suggested keys configuration
const SUGGESTED_KEYS: { label: string; deriveHex: (api: ApiPromise) => string }[] = [
  { label: 'session.currentIndex', deriveHex: (api) => api.query.session.currentIndex.key() },
  { label: 'externalValidators.currentEra', deriveHex: (api) => api.query.externalValidators.currentEra.key() },
  { label: 'externalValidators.externalIndex', deriveHex: (api) => api.query.externalValidators.externalIndex.key() },
  // add more as needed
]

// ===================== Component =====================

const StorageKeyChangeFinder: React.FC<StorageKeyChangeFinderProps> = ({ api }) => {
  const [mode, setMode] = useState<Mode>('change')
  const [storageKey, setStorageKey] = useState('')
  const [targetNumber, setTargetNumber] = useState('')
  const [finding, setFinding] = useState(false)

  const [searchRange, setSearchRange] = useState<[number, number] | null>(null)
  const [lowValueHex, setLowValueHex] = useState<string | null>(null)
  const [highValueHex, setHighValueHex] = useState<string | null>(null)
  const [prevBlock, setPrevBlock] = useState<number | null>(null)
  const [prevValueHex, setPrevValueHex] = useState<string | null>(null)
  const [foundBlock, setFoundBlock] = useState<number | null>(null)
  const [foundValueHex, setFoundValueHex] = useState<string | null>(null)

  const [changes, setChanges] = useState<{ block: number; hex: string }[]>([])
  const [bigIntChanges, setBigIntChanges] = useState<BigIntLinearChange[]>([])

  const [binaryWarnExpanded, setBinaryWarnExpanded] = useState(false)

  // Binary-search ranges: default 0..latest (end=null means latest)
  const [rangeStartBinary, setRangeStartBinary] = useState<number>(0)
  const [rangeEndBinary, setRangeEndBinary] = useState<number | null>(null)

  // Linear-scan ranges: default latest-100..latest (filled once when entering linear modes)
  // Allow clearing -> null means "default" (start->0, end->latest at run time)
  const [rangeStartLinear, setRangeStartLinear] = useState<number | null>(null)
  const [rangeEndLinear, setRangeEndLinear] = useState<number | null>(null)

  // Binary-search "latest" (auto-updating)
  const [latestBlockNumber, setLatestBlockNumber] = useState<number | null>(null)
  const [latestBlockLoading, setLatestBlockLoading] = useState(false)

  // Linear "latest snapshot" (does NOT auto-update; used for initial autofill + UI reference)
  const [linearLatestSnapshot, setLinearLatestSnapshot] = useState<number | null>(null)
  const [linearLatestLoading, setLinearLatestLoading] = useState(false)

  const didAutofillLinearRef = useRef(false)
  const linearTouchedRef = useRef(false)

  const isBinarySearchMode = mode === 'change' || mode === 'first' || mode === 'number' || mode === 'all'
  const isLinearMode = mode === 'linear' || mode === 'linear_bigint'

  // Reset only result state when switching mode/key/target
  useEffect(() => {
    // TODO: fix linter
    // Need to reference the variables here or it tells me that
    // "This dependency can be removed from the list."
    mode
    storageKey
    targetNumber
    setSearchRange(null)
    setLowValueHex(null)
    setHighValueHex(null)
    setPrevBlock(null)
    setPrevValueHex(null)
    setFoundBlock(null)
    setFoundValueHex(null)
    setChanges([])
    setBigIntChanges([])
  }, [mode, storageKey, targetNumber])

  // ===== Binary: subscribe to latest (auto-update) ONLY in binary modes =====
  useEffect(() => {
    if (!api || !isBinarySearchMode) return

    let cancelled = false
    let unsub: undefined | (() => void)

    const start = async () => {
      setLatestBlockLoading(true)
      try {
        const head = await getHeadNumber(api)
        if (!cancelled) setLatestBlockNumber(head)

        unsub = await api.rpc.chain.subscribeNewHeads((header: any) => {
          if (cancelled) return
          const n = header?.number?.toNumber?.()
          if (typeof n === 'number') setLatestBlockNumber(n)
        })
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLatestBlockLoading(false)
      }
    }

    start()

    return () => {
      cancelled = true
      try {
        unsub?.()
      } catch {
        // ignore
      }
    }
  }, [api, isBinarySearchMode])

  // ===== Linear: fetch latest snapshot ONCE when entering linear modes (no auto-update) =====
  useEffect(() => {
    if (!api || !isLinearMode) return
    if (linearLatestSnapshot != null) return

    let cancelled = false
    const run = async () => {
      setLinearLatestLoading(true)
      try {
        const head = await getHeadNumber(api)
        if (!cancelled) setLinearLatestSnapshot(head)
      } catch {
        if (!cancelled) setLinearLatestSnapshot(null)
      } finally {
        if (!cancelled) setLinearLatestLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [api, isLinearMode, linearLatestSnapshot])

  // Autofill linear range to [latest-100, latest] once, based on snapshot, unless user touched it
  useEffect(() => {
    if (!isLinearMode) return
    if (linearLatestSnapshot == null) return
    if (didAutofillLinearRef.current) return
    if (linearTouchedRef.current) return

    const end = linearLatestSnapshot
    const start = Math.max(0, end - 100)
    setRangeStartLinear(start)
    setRangeEndLinear(end)
    didAutofillLinearRef.current = true
  }, [isLinearMode, linearLatestSnapshot])

  const linearTooBigMaxBlocks = 1000

  // Effective end for linear warnings/UI: end input if set, otherwise snapshot if available
  const linearEffectiveEndForUI = useMemo(() => {
    return rangeEndLinear !== null ? rangeEndLinear : linearLatestSnapshot
  }, [rangeEndLinear, linearLatestSnapshot])

  const linearRangeStats = useMemo(() => {
    const maxBlocks = linearTooBigMaxBlocks

    if (!isLinearMode) {
      return {
        canCompute: false,
        span: null as number | null,
        blocks: null as number | null,
        tooBig: false,
        negative: false,
        maxBlocks,
      }
    }

    const end = linearEffectiveEndForUI
    if (end == null) {
      return {
        canCompute: false,
        span: null as number | null,
        blocks: null as number | null,
        tooBig: false,
        negative: false,
        maxBlocks,
      }
    }

    const start = rangeStartLinear ?? 0
    const span = end - start
    const blocks = span + 1
    const negative = span < 0
    const tooBig = blocks >= maxBlocks

    return { canCompute: true, span, blocks, tooBig, negative, maxBlocks }
  }, [isLinearMode, linearEffectiveEndForUI, rangeStartLinear])

  const modeDetails = useMemo(() => {
    const commonWarn = (
      <Alert
        type="warning"
        showIcon
        message={
          <Space size={8} wrap>
            <Typography.Text strong>Binary-search limitation</Typography.Text>
            <Typography.Text type="secondary">May miss changes if values repeat or oscillate.</Typography.Text>
            <Typography.Link onClick={() => setBinaryWarnExpanded((v) => !v)}>
              {binaryWarnExpanded ? 'Hide details' : 'Show details'}
            </Typography.Link>
          </Space>
        }
        description={
          binaryWarnExpanded ? (
            <div>
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                Binary search can <b>miss change points</b> when values can repeat or oscillate (e.g. <code>A → B → A</code>). It’s only
                reliable when the value is:
              </Typography.Paragraph>

              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>
                  <b>Unique / non-repeating</b>: every block has a different value (injective across the range).
                </li>
                <li style={{ marginTop: 8 }}>
                  <b>Monotonic non-decreasing</b>: only goes up or stays the same (never decreases).
                </li>
                <li style={{ marginTop: 8 }}>
                  <b>Monotonic non-increasing</b>: only goes down or stays the same (never increases).
                </li>
              </ul>

              <Divider style={{ margin: '12px 0' }} />

              <Typography.Text strong>Good examples (safe for binary search)</Typography.Text>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                <li>
                  <b>Session index</b>: increasing — <code>0, 0, 1, 1, 2...</code>
                </li>
                <li>
                  <b>Block hash / state root</b>: unique — <code>0xaaa…, 0xbbb…, 0xccc…</code>
                </li>
                <li>
                  <b>Account nonce</b>: non-decreasing — <code>5, 6, 7, 7, 8...</code>
                </li>
                <li>
                  <b>Block number</b>: increasing — <code>100, 101, 102, ...</code>
                </li>
              </ul>

              <Typography.Text strong style={{ display: 'block', marginTop: 10 }}>
                Bad examples (can fool binary search)
              </Typography.Text>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                <li>
                  <b>Account balance</b>: can go up/down — <code>100, 90, 110...</code>
                </li>
                <li>
                  <b>Block weight / gas used</b>: can repeat — <code>80%, 75%, 80%...</code>
                </li>
                <li>
                  <b>Total issuance</b>: can decrease (burns/slashes) — <code>1_000, 995, 1_005...</code>
                </li>
                <li>
                  <b>List of validators / inactive validators</b>: can change back and forth — <code>[A, B], [A], [A, B]...</code> (won't
                  find the change to [A])
                </li>
                <li>
                  <b>Parachain manager account / sudo key</b>: can change back and forth — <code>0xaa, 0xbb, 0xaa...</code>
                </li>
              </ul>

              <Divider style={{ margin: '12px 0' }} />
              <Typography.Text type="secondary">
                If you’re unsure the value is unique/monotonic, prefer <b>Linear Scan</b> for correctness. But make sure to specify a small
                block range (~100 blocks) or the search will be very slow.
              </Typography.Text>
            </div>
          ) : undefined
        }
      />
    )

    switch (mode) {
      case 'change':
        return {
          title: 'Latest Change',
          tag: <Tag color="gold">Binary search</Tag>,
          description: (
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              Finds the <b>last</b> block in the range where the storage value changed (fast).
            </Typography.Paragraph>
          ),
          warning: commonWarn,
        }
      case 'first':
        return {
          title: 'First Change',
          tag: <Tag color="gold">Binary search</Tag>,
          description: (
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              Finds the <b>first</b> block in the range where the storage value changed from the value at <code>rangeStart</code>.
            </Typography.Paragraph>
          ),
          warning: commonWarn,
        }
      case 'number':
        return {
          title: 'By Number',
          tag: <Tag color="gold">Binary search</Tag>,
          description: (
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              Uses a numeric comparator to search for a block matching the provided target value (fast). (Assumes fixed-width SCALE integer
              encoding, won’t work for Compact encoding)
            </Typography.Paragraph>
          ),
          warning: commonWarn,
        }
      case 'all':
        return {
          title: 'All Changes',
          tag: <Tag color="gold">Binary search</Tag>,
          description: (
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              Recursively splits the range to find <b>change points</b>. Much faster than linear scan on large ranges, but has the same
              binary-search assumptions.
            </Typography.Paragraph>
          ),
          warning: commonWarn,
        }
      case 'linear':
        return {
          title: 'Linear Scan',
          tag: <Tag color="green">Accurate</Tag>,
          description: (
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              Scans blocks sequentially and records every time the raw storage hex changes. <b>Always correct</b>, but <b>very slow</b> and{' '}
              <b>expensive</b> on the RPC.
            </Typography.Paragraph>
          ),
          warning: null,
        }
      case 'linear_bigint':
        return {
          title: 'Linear Scan (bigint)',
          tag: <Tag color="green">Accurate</Tag>,
          description: (
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              Same as Linear Scan, but also decodes the value as a <b>bigint</b> (unsigned little-endian integer) and shows the <b>delta</b>{' '}
              (next − prev) for each change. (Assumes fixed-width SCALE integer encoding, won’t work for Compact encoding) <b>Very slow</b>{' '}
              and <b>expensive</b> on the RPC.
            </Typography.Paragraph>
          ),
          warning: null,
        }
      default:
        assertNever(mode)
    }
  }, [mode, binaryWarnExpanded])

  // ===== Derived ranges for current mode =====
  const binaryStart = rangeStartBinary
  const binaryEnd = rangeEndBinary // null means latest

  const findLatestChange = useCallback(async () => {
    return performBinarySearchAndSetState({
      mode: 'change',
      api,
      storageKey,
      rangeStart: binaryStart,
      rangeEnd: binaryEnd,
      setFinding,
      setSearchRange,
      setLowValueHex,
      setHighValueHex,
      setPrevBlock,
      setPrevValueHex,
      setFoundBlock,
      setFoundValueHex,
      setChanges,
    })
  }, [api, storageKey, binaryStart, binaryEnd])

  const findFirstChange = useCallback(async () => {
    if (!validateHexKey(storageKey)) {
      return message.error('Enter a valid hex storage key')
    }

    setFinding(true)
    setSearchRange(null)
    setLowValueHex(null)
    setHighValueHex(null)
    setPrevBlock(null)
    setPrevValueHex(null)
    setFoundBlock(null)
    setFoundValueHex(null)
    setChanges([])
    setBigIntChanges([])

    try {
      const head = await getHeadNumber(api)
      const start = binaryStart
      const end = binaryEnd !== null ? binaryEnd : head

      if (end <= start) {
        return message.error('Range end must be greater than range start')
      }

      // We assume the value stays at "low" until the first change, like the latest-change binary search does.
      // (If the value changes and later returns to the initial value, this mode may miss the earlier change.)
      let low = start
      let high = end

      let lowHex = await readStorageHexAt(api, storageKey, low)
      let highHex = await readStorageHexAt(api, storageKey, high)

      setSearchRange([low, high])
      setLowValueHex(lowHex)
      setHighValueHex(highHex)

      if (lowHex === highHex) {
        message.info('No change found in the selected range')
        return
      }

      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2)
        const midHex = await readStorageHexAt(api, storageKey, mid)

        // Update UI to show the narrowing bounds
        setSearchRange([low, high])
        setLowValueHex(lowHex)
        setHighValueHex(highHex)

        if (midHex === lowHex) {
          low = mid
          lowHex = midHex
        } else {
          high = mid
          highHex = midHex
        }
      }

      setPrevBlock(low)
      setPrevValueHex(lowHex)
      setFoundBlock(high)
      setFoundValueHex(highHex)
    } catch (err: any) {
      message.error(err.message || err.toString())
    } finally {
      setFinding(false)
    }
  }, [api, storageKey, binaryStart, binaryEnd])

  const findNumber = useCallback(async () => {
    return performBinarySearchAndSetState({
      mode: 'number',
      api,
      storageKey,
      rangeStart: binaryStart,
      rangeEnd: binaryEnd,
      targetNumber,
      setFinding,
      setSearchRange,
      setLowValueHex,
      setHighValueHex,
      setPrevBlock,
      setPrevValueHex,
      setFoundBlock,
      setFoundValueHex,
      setChanges,
    })
  }, [api, storageKey, targetNumber, binaryStart, binaryEnd])

  // find all changes using recursive binary-walk
  const findAllChanges = useCallback(async () => {
    return performBinarySearchAndSetState({
      mode: 'all',
      api,
      storageKey,
      rangeStart: binaryStart,
      rangeEnd: binaryEnd,
      setFinding,
      setSearchRange,
      setLowValueHex,
      setHighValueHex,
      setPrevBlock,
      setPrevValueHex,
      setFoundBlock,
      setFoundValueHex,
      setChanges,
    })
  }, [api, storageKey, binaryStart, binaryEnd])

  // Linear scan (sequential)
  const findLinearScan = useCallback(async () => {
    if (!validateHexKey(storageKey)) {
      return message.error('Enter a valid hex storage key')
    }
    setFinding(true)
    setChanges([])
    setBigIntChanges([])
    try {
      // Actual latest at run-time
      const head = await getHeadNumber(api)

      const start = rangeStartLinear ?? 0
      const end = rangeEndLinear ?? head

      // Keep snapshot fresh when you run linear, but do NOT change input values.
      setLinearLatestSnapshot(head)

      let prev = await readVal(api, storageKey, start)
      const results: { block: number; hex: string }[] = []

      for (let b = start + 1; b <= end; b++) {
        const curr = await readVal(api, storageKey, b)
        if (curr.hex !== prev.hex) {
          results.push(curr)
          prev = curr
        }
      }

      setChanges([...results].sort((a, b2) => b2.block - a.block))
    } catch (err: any) {
      message.error(err.message || err.toString())
    } finally {
      setFinding(false)
    }
  }, [api, storageKey, rangeStartLinear, rangeEndLinear])

  // Linear scan (bigint, sequential)
  const findLinearScanBigInt = useCallback(async () => {
    if (!validateHexKey(storageKey)) {
      return message.error('Enter a valid hex storage key')
    }
    setFinding(true)
    setChanges([])
    setBigIntChanges([])
    try {
      const head = await getHeadNumber(api)

      const start = rangeStartLinear ?? 0
      const end = rangeEndLinear ?? head

      setLinearLatestSnapshot(head)

      const first = await readVal(api, storageKey, start)
      let prevVal = decodeHexAsLeBigInt(first.hex)

      const results: BigIntLinearChange[] = []
      for (let b = start + 1; b <= end; b++) {
        const curr = await readVal(api, storageKey, b)
        const currVal = decodeHexAsLeBigInt(curr.hex)

        if (currVal !== prevVal) {
          results.push({
            block: curr.block,
            hex: curr.hex,
            prevValue: prevVal,
            value: currVal,
            diff: currVal - prevVal,
          })
          prevVal = currVal
        }
      }

      // Always sort because this is actually our way to clone the array.
      // Removing the sort will break react because pushing to an array doesn't update the component.
      setBigIntChanges([...results].sort((a, b2) => b2.block - a.block))
    } catch (err: any) {
      message.error(err.message || err.toString())
    } finally {
      setFinding(false)
    }
  }, [api, storageKey, rangeStartLinear, rangeEndLinear])

  const onRun = useCallback(() => {
    switch (mode) {
      case 'change':
        return findLatestChange()
      case 'first':
        return findFirstChange()
      case 'number':
        return findNumber()
      case 'all':
        return findAllChanges()
      case 'linear':
        return findLinearScan()
      case 'linear_bigint':
        return findLinearScanBigInt()
      default:
        return assertNever(mode)
    }
  }, [mode, findLatestChange, findFirstChange, findNumber, findAllChanges, findLinearScan, findLinearScanBigInt])

  const runLabel =
    mode === 'change'
      ? 'Find Latest Change'
      : mode === 'first'
        ? 'Find First Change'
        : mode === 'number'
          ? 'Find Closest Value'
          : mode === 'all'
            ? 'Find All Changes'
            : mode === 'linear'
              ? 'Linear Scan'
              : 'Linear Scan (bigint)'

  const rangeStartValue = isLinearMode ? (rangeStartLinear ?? undefined) : rangeStartBinary
  const rangeEndValue = isLinearMode ? (rangeEndLinear ?? undefined) : (rangeEndBinary ?? undefined)

  const onChangeStart = (v: number | null) => {
    if (isLinearMode) {
      linearTouchedRef.current = true
      setRangeStartLinear(v)
      return
    }
    setRangeStartBinary(typeof v === 'number' ? v : 0)
  }

  const onChangeEnd = (v: number | null) => {
    if (isLinearMode) {
      linearTouchedRef.current = true
      setRangeEndLinear(v)
      return
    }
    setRangeEndBinary(typeof v === 'number' ? v : null)
  }

  return (
    <Card>
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Storage Key Change Finder
        </Typography.Title>

        <Form.Item label="Suggested Keys" style={{ marginBottom: 0 }}>
          <Select
            placeholder="Select a key"
            showSearch
            optionFilterProp="children"
            style={{ width: '100%' }}
            onChange={(label: string) => {
              if (!api) return message.error('API not connected')
              const item = SUGGESTED_KEYS.find((k) => k.label === label)
              if (item) setStorageKey(item.deriveHex(api))
            }}
          >
            {SUGGESTED_KEYS.map((k) => (
              <Select.Option key={k.label} value={k.label}>
                {k.label}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            Mode
          </Typography.Text>
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
            <Radio.Button value="change">Latest Change</Radio.Button>
            <Radio.Button value="first">First Change</Radio.Button>
            <Radio.Button value="number">By Number</Radio.Button>
            <Radio.Button value="all">All Changes</Radio.Button>
            <Radio.Button value="linear">Linear Scan</Radio.Button>
            <Radio.Button value="linear_bigint">Linear Scan (bigint)</Radio.Button>
          </Radio.Group>

          <div style={{ marginTop: 12 }}>
            <Card size="small" style={{ background: '#fafafa' }}>
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Space size={8} wrap>
                  <Typography.Text strong>{modeDetails.title}</Typography.Text>
                  {modeDetails.tag}
                  {isBinarySearchMode ? <Tag color="orange">May miss changes</Tag> : <Tag color="green">No missed changes</Tag>}
                </Space>
                {modeDetails.description}
                {modeDetails.warning}
              </Space>
            </Card>
          </div>
        </div>

        <Divider style={{ margin: '8px 0' }} />

        <Form layout="vertical">
          <Form.Item
            label={
              <Space size={8} wrap>
                <span>Block Range</span>
                <Typography.Text type="secondary">(start defaults to 0 if empty; end defaults to latest if empty)</Typography.Text>
              </Space>
            }
          >
            <Space.Compact style={{ width: '100%' }}>
              <InputNumber
                min={0}
                value={rangeStartValue as any}
                onChange={onChangeStart as any}
                style={{ width: '50%' }}
                placeholder={isLinearMode ? 'start (0)' : '0'}
              />
              <InputNumber
                min={0}
                value={rangeEndValue as any}
                onChange={onChangeEnd as any}
                style={{ width: '50%' }}
                placeholder="end (latest)"
              />
            </Space.Compact>

            {isBinarySearchMode ? (
              <Space size={8} style={{ whiteSpace: 'nowrap', marginTop: 8 }}>
                <Typography.Text type="secondary">
                  Latest (live): {latestBlockLoading ? '…' : latestBlockNumber != null ? `#${latestBlockNumber}` : '—'}
                </Typography.Text>
              </Space>
            ) : (
              <Space size={8} style={{ whiteSpace: 'nowrap', marginTop: 8 }}>
                <Typography.Text type="secondary">
                  Latest (snapshot): {linearLatestLoading ? '…' : linearLatestSnapshot != null ? `#${linearLatestSnapshot}` : '—'}
                </Typography.Text>
              </Space>
            )}

            {isLinearMode && linearRangeStats.canCompute && linearRangeStats.negative && (
              <div style={{ marginTop: 10 }}>
                <Alert
                  type="error"
                  showIcon
                  message="Invalid block range"
                  description={<span>Range end must be ≥ range start. (Computed span: {linearRangeStats.span})</span>}
                />
              </div>
            )}

            {isLinearMode && linearRangeStats.canCompute && !linearRangeStats.negative && linearRangeStats.tooBig && (
              <div style={{ marginTop: 10 }}>
                <Alert
                  type="warning"
                  showIcon
                  message="Large linear scan range"
                  description={
                    <span>
                      You’re about to scan <b>{linearRangeStats.blocks?.toLocaleString()}</b> blocks (more than {linearRangeStats.maxBlocks}
                      ). This can be slow and may put load on the node/RPC.
                    </span>
                  }
                />
              </div>
            )}
          </Form.Item>

          <Row gutter={16}>
            <Col span={24}>
              <Form.Item label="Storage Key (hex)">
                <Input
                  value={storageKey}
                  onChange={(e) => setStorageKey(e.target.value.trim())}
                  placeholder="0x..."
                  style={{ fontFamily: 'monospace' }}
                />
              </Form.Item>
            </Col>
          </Row>

          {mode === 'number' && (
            <Row gutter={16}>
              <Col span={24}>
                <Form.Item label="Target Value">
                  <Input
                    value={targetNumber}
                    onChange={(e) => setTargetNumber(e.target.value.trim())}
                    placeholder="e.g. 12345 (format depends on comparator in your binary search helper)"
                    style={{ fontFamily: 'monospace' }}
                  />
                </Form.Item>
              </Col>
            </Row>
          )}

          {searchRange && !foundBlock && mode !== 'all' && mode !== 'linear' && mode !== 'linear_bigint' && (
            <>
              <Form.Item label={`Searching low #${searchRange[0]}`}>
                <Input value={lowValueHex || ''} readOnly style={{ fontFamily: 'monospace' }} />
              </Form.Item>
              <Form.Item label={`Searching high #${searchRange[1]}`}>
                <Input value={highValueHex || ''} readOnly style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            </>
          )}

          {mode !== 'all' && mode !== 'linear' && mode !== 'linear_bigint' && prevBlock != null && prevValueHex && (
            <Card size="small" style={{ marginBottom: 12 }}>
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Typography.Text strong>Previous</Typography.Text>
                <Typography.Text type="secondary">Block #{prevBlock}</Typography.Text>
                <Input value={prevValueHex} readOnly style={{ fontFamily: 'monospace' }} />
              </Space>
            </Card>
          )}

          {mode !== 'all' && mode !== 'linear' && mode !== 'linear_bigint' && foundBlock != null && foundValueHex && (
            <Card size="small" style={{ marginBottom: 12 }}>
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Typography.Text strong>Found</Typography.Text>
                <Typography.Text type="secondary">Block #{foundBlock}</Typography.Text>
                <Input value={foundValueHex} readOnly style={{ fontFamily: 'monospace' }} />
                <Typography.Text>Block date:</Typography.Text>
                <BlockDate api={api} blockNumber={foundBlock} />
              </Space>
            </Card>
          )}

          {(mode === 'all' || mode === 'linear') && changes.length > 0 && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                Changes ({changes.length})
              </Typography.Text>

              {changes.map((c) => (
                <Card key={c.block} size="small" style={{ marginBottom: 10 }}>
                  <Space direction="vertical" style={{ width: '100%' }} size={8}>
                    <Typography.Text strong>Change at #{c.block}</Typography.Text>
                    <Input value={c.hex} readOnly style={{ fontFamily: 'monospace' }} />
                    <Typography.Text>Block date:</Typography.Text>
                    <BlockDate api={api} blockNumber={c.block} />
                  </Space>
                </Card>
              ))}
            </>
          )}

          {mode === 'linear_bigint' && bigIntChanges.length > 0 && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                Changes ({bigIntChanges.length})
              </Typography.Text>

              {bigIntChanges.map((c) => (
                <Card key={c.block} size="small" style={{ marginBottom: 10 }}>
                  <Space direction="vertical" style={{ width: '100%' }} size={8}>
                    <Typography.Text strong>Change at #{c.block}</Typography.Text>
                    <Input value={c.hex} readOnly style={{ fontFamily: 'monospace' }} />
                    <Space direction="vertical" style={{ width: '100%' }} size={6}>
                      <Input addonBefore="Prev" value={c.prevValue.toString()} readOnly style={{ fontFamily: 'monospace' }} />
                      <Input addonBefore="Next" value={c.value.toString()} readOnly style={{ fontFamily: 'monospace' }} />
                      <Input addonBefore="Δ" value={c.diff.toString()} readOnly style={{ fontFamily: 'monospace' }} />
                    </Space>
                    <Typography.Text>Block date:</Typography.Text>
                    <BlockDate api={api} blockNumber={c.block} />
                  </Space>
                </Card>
              ))}
            </>
          )}

          <Form.Item style={{ marginTop: 12 }}>
            <Button
              type="primary"
              onClick={onRun}
              loading={finding}
              block
              disabled={!api || !storageKey || (mode === 'number' && !targetNumber)}
            >
              {runLabel}
            </Button>
          </Form.Item>
        </Form>
      </Space>
    </Card>
  )
}

export default React.memo(StorageKeyChangeFinder)
