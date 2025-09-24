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

type Mode = 'change' | 'number' | 'all' | 'linear'

interface ValObj {
  block: number
  hex: string
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
    setRangeStart(0)
    setRangeEnd(null)
  }, [mode, storageKey, targetNumber])

  const findChange = useCallback(async () => {
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
          <Radio.Button value="change">Last Change</Radio.Button>
          <Radio.Button value="number">By Number</Radio.Button>
          <Radio.Button value="all">All Changes</Radio.Button>
          <Radio.Button value="linear">Linear Scan</Radio.Button>
        </Radio.Group>

        {/* Compact block range */}
        <Form layout="vertical">
          <Form.Item label="Block Range">
            <Space.Compact>
              <InputNumber min={0} value={rangeStart} onChange={(v) => setRangeStart(v ?? 0)} style={{ width: '50%' }} />
              <InputNumber
                min={0}
                value={rangeEnd ?? undefined}
                onChange={(v) => setRangeEnd(v !== undefined ? v : null)}
                placeholder="latest"
                style={{ width: '50%' }}
              />
            </Space.Compact>
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

          {searchRange && !foundBlock && mode !== 'all' && (
            <>
              <Form.Item label={`Searching low #${searchRange[0]}`}>
                <Input value={lowValueHex || ''} readOnly />
              </Form.Item>
              <Form.Item label={`Searching high #${searchRange[1]}`}>
                <Input value={highValueHex || ''} readOnly />
              </Form.Item>
            </>
          )}

          {mode !== 'all' && prevBlock != null && prevValueHex && (
            <Form.Item label={`Previous at #${prevBlock}`}>
              <Input value={prevValueHex} readOnly />
            </Form.Item>
          )}

          {mode !== 'all' && foundBlock != null && foundValueHex && (
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

          <Form.Item>
            <Button
              type="primary"
              onClick={mode === 'change' ? findChange : mode === 'number' ? findNumber : mode === 'all' ? findAllChanges : findLinearScan}
              loading={finding}
              block
              disabled={!api || !storageKey || (mode === 'number' && !targetNumber)}
            >
              {mode === 'change'
                ? 'Find Last Change'
                : mode === 'number'
                  ? 'Find Closest Value'
                  : mode === 'all'
                    ? 'Find All Changes'
                    : 'Linear Scan'}
            </Button>
          </Form.Item>
        </Form>
      </Space>
    </Card>
  )
}

export default React.memo(StorageKeyChangeFinder)
