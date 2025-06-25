import { hexToBn } from '@polkadot/util'
import { Button, Input, Radio, Space, Typography, message } from 'antd'
import React, { useState, useCallback, useEffect } from 'react'
import { BlockDate } from './BlockDate'
import type { Api } from './types'

export type StorageKeyChangeFinderProps = {
  /** Polkadot API instance to query chain data */
  api?: Api
}

const StorageKeyChangeFinder: React.FC<StorageKeyChangeFinderProps> = ({ api }) => {
  const [mode, setMode] = useState<'change' | 'number'>('change')
  const [storageKey, setStorageKey] = useState<string>('')
  const [targetNumber, setTargetNumber] = useState<string>('')

  const [finding, setFinding] = useState<boolean>(false)
  const [searchRange, setSearchRange] = useState<[number, number] | null>(null)
  const [foundBlock, setFoundBlock] = useState<number | null>(null)
  const [foundValue, setFoundValue] = useState<number | null>(null)

  // Reset on key, mode, or target change
  useEffect(() => {
    mode
    storageKey
    targetNumber
    setSearchRange(null)
    setFoundBlock(null)
    setFoundValue(null)
  }, [mode, storageKey, targetNumber])

  const handleFindLastChange = useCallback(async () => {
    if (!api) return message.error('API not connected')
    if (!/^0x[0-9a-fA-F]+$/.test(storageKey)) {
      return message.error('Please enter a valid hex storage key (starting with 0x)')
    }
    setFinding(true)
    try {
      let low = 0
      let high = (await api.query.system.number()).toNumber()
      const headHash = await api.rpc.chain.getBlockHash(high)
      const latestRaw = await api.rpc.state.getStorage(storageKey, headHash)
      const latestHex = latestRaw?.toHex() ?? null
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2)
        const midHash = await api.rpc.chain.getBlockHash(mid)
        const midRaw = await api.rpc.state.getStorage(storageKey, midHash)
        const midHex = midRaw?.toHex() ?? null
        if (midHex === latestHex) high = mid
        else low = mid
        setSearchRange([low, high])
      }
      setFoundBlock(high)
    } catch (err: any) {
      message.error(`Error finding last change: ${err.message || err}`)
    } finally {
      setFinding(false)
    }
  }, [api, storageKey])

  const handleFindByNumber = useCallback(async () => {
    if (!api) return message.error('API not connected')
    if (!/^0x[0-9a-fA-F]+$/.test(storageKey)) {
      return message.error('Please enter a valid hex storage key (starting with 0x)')
    }
    const target = Number(targetNumber)
    if (Number.isNaN(target)) {
      return message.error('Please enter a valid integer target value')
    }

    setFinding(true)
    try {
      const head = (await api.query.system.number()).toNumber()
      let low = 0
      let high = head
      const targetBn = BigInt(target)

      // decode little-endian u128 via hexToBn
      const headHex = (await api.rpc.state.getStorage(storageKey, await api.rpc.chain.getBlockHash(head)))?.toHex() ?? '0x'
      const headBn = hexToBn(headHex, { isLe: true, isNegative: false })
      const headVal = BigInt(headBn.toString())
      if (targetBn >= headVal) {
        setFoundBlock(head)
        setFoundValue(Number(headVal))
        return
      }

      const genHex = (await api.rpc.state.getStorage(storageKey, await api.rpc.chain.getBlockHash(0)))?.toHex() ?? '0x'
      const genBn = hexToBn(genHex, { isLe: true, isNegative: false })
      const genVal = BigInt(genBn.toString())
      if (targetBn <= genVal) {
        setFoundBlock(0)
        setFoundValue(Number(genVal))
        return
      }

      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2)
        const midHex = (await api.rpc.state.getStorage(storageKey, await api.rpc.chain.getBlockHash(mid)))?.toHex() ?? '0x'
        const midBn = hexToBn(midHex, { isLe: true, isNegative: false })
        const midVal = BigInt(midBn.toString())
        if (midVal < targetBn) low = mid
        else high = mid
        setSearchRange([low, high])
      }

      const lowHex = (await api.rpc.state.getStorage(storageKey, await api.rpc.chain.getBlockHash(low)))?.toHex() ?? '0x'
      const lowVal = BigInt(hexToBn(lowHex, { isLe: true, isNegative: false }).toString())
      const highHex2 = (await api.rpc.state.getStorage(storageKey, await api.rpc.chain.getBlockHash(high)))?.toHex() ?? '0x'
      const highVal = BigInt(hexToBn(highHex2, { isLe: true, isNegative: false }).toString())
      const diffLow = targetBn - lowVal
      const diffHigh = highVal - targetBn
      const chosen = diffLow <= diffHigh ? low : high
      const chosenVal = diffLow <= diffHigh ? lowVal : highVal

      setFoundBlock(chosen)
      setFoundValue(Number(chosenVal))
    } catch (err: any) {
      message.error(`Error finding by number: ${err.message || err}`)
    } finally {
      setFinding(false)
    }
  }, [api, storageKey, targetNumber])

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
        <Radio.Button value="change">Find Last Change</Radio.Button>
        <Radio.Button value="number">Find By Number</Radio.Button>
      </Radio.Group>

      <Typography.Text>Storage Key (hex):</Typography.Text>
      <Input placeholder="0x..." value={storageKey} onChange={(e) => setStorageKey(e.target.value.trim())} />

      {mode === 'number' && (
        <>
          <Typography.Text>Target integer value:</Typography.Text>
          <Input placeholder="e.g. 42" value={targetNumber} onChange={(e) => setTargetNumber(e.target.value.trim())} />
        </>
      )}

      <Space>
        {searchRange && foundBlock === null && (
          <Typography.Text>
            Searching blocks #{searchRange[0]} – #{searchRange[1]}
          </Typography.Text>
        )}
      </Space>

      {foundBlock !== null && (
        <>
          <Typography.Text>
            Found block <Typography.Text strong>#{foundBlock}</Typography.Text> on
          </Typography.Text>
          <BlockDate api={api} blockNumber={foundBlock} />
          {mode === 'number' && foundValue !== null && (
            <Typography.Text>
              Value at block: <Typography.Text code>{foundValue}</Typography.Text>
            </Typography.Text>
          )}
        </>
      )}

      <Button
        type="primary"
        onClick={mode === 'change' ? handleFindLastChange : handleFindByNumber}
        loading={finding}
        disabled={!api || !storageKey || (mode === 'number' && !targetNumber)}
      >
        {mode === 'change' ? 'Find Last Change' : 'Find Closest Value'}
      </Button>
    </Space>
  )
}

export default React.memo(StorageKeyChangeFinder)
