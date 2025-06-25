import { Button, Input, Space, Typography, message } from 'antd'
import React, { useState, useCallback, useEffect } from 'react'
import { BlockDate } from './BlockDate'
import type { Api } from './types'

export type StorageKeyChangeFinderProps = {
  /** Polkadot API instance to query chain data */
  api?: Api
}

const StorageKeyChangeFinder: React.FC<StorageKeyChangeFinderProps> = ({ api }) => {
  const [storageKey, setStorageKey] = useState<string>('')
  const [finding, setFinding] = useState<boolean>(false)
  const [searchRange, setSearchRange] = useState<[number, number] | null>(null)
  const [lastChangeBlock, setLastChangeBlock] = useState<number | null>(null)

  // Reset state whenever the key changes
  useEffect(() => {
    // Use variable to make linter happy
    storageKey
    setSearchRange(null)
    setLastChangeBlock(null)
  }, [storageKey])

  const handleFindLastChange = useCallback(async () => {
    if (!api) {
      message.error('API not connected')
      return
    }
    if (!/^0x[0-9a-fA-F]+$/.test(storageKey)) {
      message.error('Please enter a valid hex storage key (starting with 0x)')
      return
    }

    setFinding(true)
    try {
      // Initial bounds
      let low = 0
      let high = (await api.query.system.number()).toNumber()

      // Fetch the “latest” value at head
      const headHash = await api.rpc.chain.getBlockHash(high)
      const latestRaw = await api.rpc.state.getStorage(storageKey, headHash)
      const latestHex = latestRaw?.toHex() ?? null

      // Binary search for transition point
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2)
        const midHash = await api.rpc.chain.getBlockHash(mid)
        const midRaw = await api.rpc.state.getStorage(storageKey, midHash)
        const midHex = midRaw?.toHex() ?? null

        if (midHex === latestHex) {
          // change happened at or before mid
          high = mid
        } else {
          // still in the “old” state
          low = mid
        }
        setSearchRange([low, high])
      }

      setLastChangeBlock(high)
    } catch (error: any) {
      message.error(`Error finding last change: ${error.message || error}`)
    } finally {
      setFinding(false)
    }
  }, [api, storageKey])

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Text>Storage Key (hex):</Typography.Text>
      <Input placeholder="0x..." value={storageKey} onChange={(e) => setStorageKey(e.target.value.trim())} />

      <Space>
        {searchRange && lastChangeBlock === null && (
          <Typography.Text>
            Searching blocks #{searchRange[0]} – #{searchRange[1]}
          </Typography.Text>
        )}

        {lastChangeBlock !== null && (
          <>
            <Typography.Text>
              Last change at block <Typography.Text strong>#{lastChangeBlock}</Typography.Text> on
            </Typography.Text>
            <BlockDate api={api} blockNumber={lastChangeBlock} />
          </>
        )}
      </Space>

      <Button type="primary" onClick={handleFindLastChange} loading={finding} disabled={!api || !storageKey}>
        Find Last Change
      </Button>
    </Space>
  )
}

export default React.memo(StorageKeyChangeFinder)
