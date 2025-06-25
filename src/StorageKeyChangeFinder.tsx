import type { ApiPromise } from '@polkadot/api'
import { hexToBn } from '@polkadot/util'
import { Button, Card, Col, Form, Input, Radio, Row, Select, Space, Typography, message } from 'antd'
import React, { useState, useCallback, useEffect } from 'react'
import { BlockDate } from './BlockDate'

export type StorageKeyChangeFinderProps = {
  /** Polkadot API instance to query chain data */
  api: ApiPromise
}

// Suggested keys configuration
const SUGGESTED_KEYS: { label: string; deriveHex: (api: ApiPromise) => string }[] = [
  { label: 'session.currentIndex', deriveHex: (api) => api.query.session.currentIndex.key() },
  { label: 'externalValidators.currentEra', deriveHex: (api) => api.query.externalValidators.currentEra.key() },
  { label: 'externalValidators.externalIndex', deriveHex: (api) => api.query.externalValidators.externalIndex.key() },
  // add more as needed
]

const StorageKeyChangeFinder: React.FC<StorageKeyChangeFinderProps> = ({ api }) => {
  const [mode, setMode] = useState<'change' | 'number'>('change')
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
  }, [mode, storageKey, targetNumber])

  const findChange = useCallback(async () => {
    const validateKey = () => /^0x[0-9a-fA-F]+$/.test(storageKey)
    if (!validateKey()) return message.error('Enter a valid hex storage key')
    setFinding(true)

    try {
      const head = (await api.query.system.number()).toNumber()
      let low = 0
      let high = head

      interface ValObj {
        block: number
        hash: string
        hex: string
      }

      const readVal = async (block: number): Promise<ValObj> => {
        const hash = (await api.rpc.chain.getBlockHash(block)).toHex()
        const hex = (await api.rpc.state.getStorage(storageKey, hash))?.toHex() || '0x'
        return { block, hash, hex }
      }

      // Fetch genesis (low) and head (high) once
      let lowVal = await readVal(0)
      let highVal = await readVal(high)

      // If nothing has ever changed since genesis:
      if (lowVal.hex === highVal.hex) {
        setPrevBlock(null)
        setPrevValueHex(null)
        setFoundBlock(0)
        setFoundValueHex(lowVal.hex)
        return
      }

      // initialize UI
      setLowValueHex(lowVal.hex)
      setHighValueHex(highVal.hex)

      // binary search:
      while (high - low > 1) {
        const mid = (low + high) >> 1
        const midVal = await readVal(mid)

        if (midVal.hex === highVal.hex) {
          // the change must be at or before mid
          high = mid
          highVal = midVal
        } else {
          // the change is after mid
          low = mid
          lowVal = midVal
        }

        setSearchRange([low, high])
        setLowValueHex(lowVal.hex)
        setHighValueHex(highVal.hex)
      }

      // final results are in lowVal / highVal
      setPrevBlock(lowVal.block)
      setPrevValueHex(lowVal.hex)
      setFoundBlock(highVal.block)
      setFoundValueHex(highVal.hex)
    } catch (err: any) {
      message.error(err.message || err.toString())
    } finally {
      setFinding(false)
    }
  }, [api, storageKey])

  const findNumber = useCallback(async () => {
    const validateKey = () => /^0x[0-9a-fA-F]+$/.test(storageKey)
    if (!validateKey()) return message.error('Enter a valid hex storage key')
    const num = Number(targetNumber)
    if (Number.isNaN(num)) return message.error('Enter a valid integer target')
    const targetBn = BigInt(num)

    setFinding(true)
    try {
      const head = (await api.query.system.number()).toNumber()
      let low = 0
      let high = head

      const readVal = async (block: number) => {
        const hex = (await api.rpc.state.getStorage(storageKey, await api.rpc.chain.getBlockHash(block)))?.toHex() || '0x'
        const bn = BigInt(hexToBn(hex, { isLe: true, isNegative: false }).toString())
        return { hex, bn }
      }

      const headVal = await readVal(high)
      if (targetBn >= headVal.bn) {
        setPrevBlock(null)
        setPrevValueHex(null)
        setFoundBlock(high)
        setFoundValueHex(headVal.hex)
        return
      }

      const genVal = await readVal(0)
      if (targetBn <= genVal.bn) {
        setPrevBlock(null)
        setPrevValueHex(null)
        setFoundBlock(0)
        setFoundValueHex(genVal.hex)
        return
      }

      while (high - low > 1) {
        const mid = (low + high) >> 1
        const midVal = await readVal(mid)
        if (midVal.bn < targetBn) {
          low = mid
        } else {
          high = mid
        }
        setSearchRange([low, high])

        const lowData = await readVal(low)
        const highData = await readVal(high)
        setLowValueHex(lowData.hex)
        setHighValueHex(highData.hex)
      }

      const lowData = await readVal(low)
      const highData2 = await readVal(high)
      const diffL = targetBn - lowData.bn
      const diffH = highData2.bn - targetBn
      const chosen = diffL <= diffH ? low : high
      const prev = chosen === low ? null : low

      setPrevBlock(prev)
      setPrevValueHex(prev != null ? lowData.hex : null)
      setFoundBlock(chosen)
      setFoundValueHex((chosen === low ? highData2 : highData2).hex)
    } catch (err: any) {
      message.error(err.message || err.toString())
    } finally {
      setFinding(false)
    }
  }, [api, storageKey, targetNumber])

  return (
    <Card>
      <Space direction="vertical" style={{ width: '100%' }}>
        {/* Suggested storage keys collapsed in a dropdown */}
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
        </Radio.Group>

        <Form layout="vertical">
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

          {searchRange && !foundBlock && (
            <>
              <Form.Item label={`Searching low #${searchRange[0]}`}>
                <Input value={lowValueHex || ''} readOnly />
              </Form.Item>
              <Form.Item label={`Searching high #${searchRange[1]}`}>
                <Input value={highValueHex || ''} readOnly />
              </Form.Item>
            </>
          )}

          {prevBlock != null && prevValueHex && (
            <Form.Item label={`Previous at #${prevBlock}`}>
              <Input value={prevValueHex} readOnly />
            </Form.Item>
          )}

          {foundBlock != null && foundValueHex && (
            <Form.Item label={`Found at #${foundBlock}`}>
              <Input value={foundValueHex} readOnly />
              <Typography.Text>Block date:</Typography.Text>

              <BlockDate api={api} blockNumber={foundBlock} />
            </Form.Item>
          )}

          <Form.Item>
            <Button
              type="primary"
              onClick={mode === 'change' ? findChange : findNumber}
              loading={finding}
              block
              disabled={!api || !storageKey || (mode === 'number' && !targetNumber)}
            >
              {mode === 'change' ? 'Find Last Change' : 'Find Closest Value'}
            </Button>
          </Form.Item>
        </Form>
      </Space>
    </Card>
  )
}

export default React.memo(StorageKeyChangeFinder)
