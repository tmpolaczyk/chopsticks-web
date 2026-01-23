import type { ApiPromise } from '@polkadot/api'
import { Button, Card, Col, Form, Input, InputNumber, Radio, Row, Select, Space, Typography, message } from 'antd'
import React, { useState, useCallback, useEffect } from 'react'
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
  const [rangeStart, setRangeStart] = useState<number>(0)
  const [rangeEnd, setRangeEnd] = useState<number | null>(null)

  const [lowValueHex, setLowValueHex] = useState<string | null>(null)
  const [highValueHex, setHighValueHex] = useState<string | null>(null)
  const [prevBlock, setPrevBlock] = useState<number | null>(null)
  const [prevValueHex, setPrevValueHex] = useState<string | null>(null)
  const [foundBlock, setFoundBlock] = useState<number | null>(null)
  const [foundValueHex, setFoundValueHex] = useState<string | null>(null)
  const [changes, setChanges] = useState<{ block: number; hex: string }[]>([])
  const [bigIntChanges, setBigIntChanges] = useState<BigIntLinearChange[]>([])

  const [latestBlockNumber, setLatestBlockNumber] = useState<number | null>(null)
  const [latestBlockLoading, setLatestBlockLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!api) return
      setLatestBlockLoading(true)
      try {
        const head = await getHeadNumber(api)
        if (!cancelled) setLatestBlockNumber(head)
      } catch {
        if (!cancelled) setLatestBlockNumber(null)
      } finally {
        if (!cancelled) setLatestBlockLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [api])

  useEffect(() => {
    // TODO: fix linter
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
    setRangeStart(0)
    setRangeEnd(null)
  }, [mode, storageKey, targetNumber])

  const findLatestChange = useCallback(async () => {
    return performBinarySearchAndSetState({
      mode: 'change',
      api,
      storageKey,
      rangeStart,
      rangeEnd,
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
  }, [api, storageKey, rangeStart, rangeEnd])

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
      const start = rangeStart
      const end = rangeEnd !== null ? rangeEnd : head

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
  }, [api, storageKey, rangeStart, rangeEnd])

  const findNumber = useCallback(async () => {
    return performBinarySearchAndSetState({
      mode: 'number',
      api,
      storageKey,
      rangeStart,
      rangeEnd,
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
  }, [api, storageKey, targetNumber, rangeStart, rangeEnd])

  // find all changes using recursive binary-walk
  const findAllChanges = useCallback(async () => {
    return performBinarySearchAndSetState({
      mode: 'all',
      api,
      storageKey,
      rangeStart,
      rangeEnd,
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
  }, [api, storageKey, rangeStart, rangeEnd])

  // Linear scan (sequential)
  const findLinearScan = useCallback(async () => {
    if (!validateHexKey(storageKey)) {
      return message.error('Enter a valid hex storage key')
    }
    setFinding(true)
    setChanges([])
    setBigIntChanges([])
    try {
      const head = await getHeadNumber(api)
      const start = rangeStart
      const end = rangeEnd !== null ? rangeEnd : head

      let prev = await readVal(api, storageKey, start)
      const results: { block: number; hex: string }[] = []
      for (let b = start + 1; b <= end; b++) {
        const curr = await readVal(api, storageKey, b)
        if (curr.hex !== prev.hex) {
          results.push(curr)
          setChanges([...results].sort((a, b) => b.block - a.block))
          prev = curr
        }
      }
      setChanges(results)
    } catch (err: any) {
      message.error(err.message || err.toString())
    } finally {
      setFinding(false)
    }
  }, [api, storageKey, rangeStart, rangeEnd])

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
      const start = rangeStart
      const end = rangeEnd !== null ? rangeEnd : head

      const first = await readVal(api, storageKey, start)
      let prevVal = decodeHexAsLeBigInt(first.hex)

      const results: BigIntLinearChange[] = []
      for (let b = start + 1; b <= end; b++) {
        const curr = await readVal(api, storageKey, b)
        const currVal = decodeHexAsLeBigInt(curr.hex)

        if (currVal !== prevVal) {
          const entry: BigIntLinearChange = {
            block: curr.block,
            hex: curr.hex,
            prevValue: prevVal,
            value: currVal,
            diff: currVal - prevVal,
          }
          results.push(entry)
          setBigIntChanges([...results].sort((a, b) => b.block - a.block))
          prevVal = currVal
        }
      }
      setBigIntChanges(results)
    } catch (err: any) {
      message.error(err.message || err.toString())
    } finally {
      setFinding(false)
    }
  }, [api, storageKey, rangeStart, rangeEnd])

  return (
    <Card>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Form.Item label="Suggested Keys">
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

        <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
          <Radio.Button value="change">Latest Change</Radio.Button>
          <Radio.Button value="first">First Change</Radio.Button>
          <Radio.Button value="number">By Number</Radio.Button>
          <Radio.Button value="all">All Changes</Radio.Button>
          <Radio.Button value="linear">Linear Scan</Radio.Button>
          <Radio.Button value="linear_bigint">Linear Scan (bigint)</Radio.Button>
        </Radio.Group>

        {/* Compact block range */}
        <Form layout="vertical">
          <Form.Item label="Block Range">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <Space.Compact style={{ width: '100%' }}>
                  <InputNumber min={0} value={rangeStart} onChange={(v) => setRangeStart(v ?? 0)} style={{ width: '50%' }} />
                  <InputNumber
                    min={0}
                    value={rangeEnd ?? undefined}
                    onChange={(v) => setRangeEnd(v !== undefined ? v : null)}
                    placeholder="latest"
                    style={{ width: '50%' }}
                  />
                </Space.Compact>
              </div>

              <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                Latest: {latestBlockLoading ? '…' : latestBlockNumber != null ? `#${latestBlockNumber}` : '—'}
              </Typography.Text>
            </div>
          </Form.Item>

          <Row gutter={16}>
            <Col span={24}>
              <Form.Item label="Storage Key (hex)">
                <Input value={storageKey} onChange={(e) => setStorageKey(e.target.value.trim())} />
              </Form.Item>
            </Col>
          </Row>

          {mode === 'number' && (
            <Row gutter={16}>
              <Col span={24}>
                <Form.Item label="Target Value">
                  <Input value={targetNumber} onChange={(e) => setTargetNumber(e.target.value.trim())} />
                </Form.Item>
              </Col>
            </Row>
          )}

          {searchRange && !foundBlock && mode !== 'all' && mode !== 'linear' && mode !== 'linear_bigint' && (
            <>
              <Form.Item label={`Searching low #${searchRange[0]}`}>
                <Input value={lowValueHex || ''} readOnly />
              </Form.Item>
              <Form.Item label={`Searching high #${searchRange[1]}`}>
                <Input value={highValueHex || ''} readOnly />
              </Form.Item>
            </>
          )}

          {mode !== 'all' && mode !== 'linear' && mode !== 'linear_bigint' && prevBlock != null && prevValueHex && (
            <Form.Item label={`Previous at #${prevBlock}`}>
              <Input value={prevValueHex} readOnly />
            </Form.Item>
          )}

          {mode !== 'all' && mode !== 'linear' && mode !== 'linear_bigint' && foundBlock != null && foundValueHex && (
            <Form.Item label={`Found at #${foundBlock}`}>
              <Input value={foundValueHex} readOnly />
              <Typography.Text>Block date:</Typography.Text>
              <BlockDate api={api} blockNumber={foundBlock} />
            </Form.Item>
          )}

          {mode === 'all' &&
            changes.length > 0 &&
            changes.map((c) => (
              <Form.Item label={`Change at #${c.block}`} key={c.block}>
                <Input value={c.hex} readOnly />
                <Typography.Text>Block date:</Typography.Text>
                <BlockDate api={api} blockNumber={c.block} />
              </Form.Item>
            ))}

          {mode === 'linear' &&
            changes.length > 0 &&
            changes.map((c) => (
              <Form.Item label={`Change at #${c.block}`} key={c.block}>
                <Input value={c.hex} readOnly />
                <Typography.Text>Block date:</Typography.Text>
                <BlockDate api={api} blockNumber={c.block} />
              </Form.Item>
            ))}

          {mode === 'linear_bigint' &&
            bigIntChanges.length > 0 &&
            bigIntChanges.map((c) => (
              <Form.Item label={`Change at #${c.block}`} key={c.block}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Input value={c.hex} readOnly />
                  <Input addonBefore="Prev" value={c.prevValue.toString()} readOnly />
                  <Input addonBefore="Next" value={c.value.toString()} readOnly />
                  <Input addonBefore="Δ" value={c.diff.toString()} readOnly />
                  <Typography.Text>Block date:</Typography.Text>
                  <BlockDate api={api} blockNumber={c.block} />
                </Space>
              </Form.Item>
            ))}

          <Form.Item>
            <Button
              type="primary"
              onClick={
                mode === 'change'
                  ? findLatestChange
                  : mode === 'first'
                    ? findFirstChange
                    : mode === 'number'
                      ? findNumber
                      : mode === 'all'
                        ? findAllChanges
                        : mode === 'linear'
                          ? findLinearScan
                          : findLinearScanBigInt
              }
              loading={finding}
              block
              disabled={!api || !storageKey || (mode === 'number' && !targetNumber)}
            >
              {mode === 'change'
                ? 'Find Latest Change'
                : mode === 'first'
                  ? 'Find First Change'
                  : mode === 'number'
                    ? 'Find Closest Value'
                    : mode === 'all'
                      ? 'Find All Changes'
                      : mode === 'linear'
                        ? 'Linear Scan'
                        : 'Linear Scan (bigint)'}
            </Button>
          </Form.Item>
        </Form>
      </Space>
    </Card>
  )
}

export default React.memo(StorageKeyChangeFinder)
