import { InfoCircleOutlined } from '@ant-design/icons'
import { Button, DatePicker, Input, Space, Tooltip, Typography, message } from 'antd'
import moment, { type Moment } from 'moment'
import React, { useState, useCallback, useEffect } from 'react'
import { BlockDate } from './BlockDate'
import type { Api } from './types'

export type FindBlockByDateProps = {
  /** Polkadot API instance to query chain data */
  api?: Api
}

const FindBlockByDate: React.FC<FindBlockByDateProps> = ({ api }) => {
  // moment-based UTC timestamp target and raw input
  const [targetMoment, setTargetMoment] = useState<Moment | null>(null)
  const [inputTs, setInputTs] = useState<string>('')
  const [targetTs, setTargetTs] = useState<number | null>(null)

  const [finding, setFinding] = useState<boolean>(false)
  const [searchRange, setSearchRange] = useState<[number, number] | null>(null)
  const [foundBlock, setFoundBlock] = useState<number | null>(null)
  const [foundTs, setFoundTs] = useState<number | null>(null)

  // compute targetTs from targetMoment OR inputTs
  useEffect(() => {
    setSearchRange(null)
    setFoundBlock(null)
    setFoundTs(null)

    // raw timestamp input takes precedence
    if (inputTs) {
      const n = Number(inputTs)
      if (!Number.isNaN(n)) {
        const ts = n < 1e11 ? n * 1000 : n
        setTargetTs(ts)
        setTargetMoment(null)
        return
      }
    }

    if (targetMoment) {
      // convert moment (local) to utc
      const utcMoment: Moment = moment(targetMoment.toDate()).utc()
      setTargetTs(utcMoment.valueOf())
    } else {
      setTargetTs(null)
    }
  }, [targetMoment, inputTs])

  const handleFindBlock = useCallback(async () => {
    if (!api) {
      message.error('API not connected')
      return
    }
    if (targetTs === null) {
      message.error('Please select a date/time or enter a Unix timestamp')
      return
    }

    setFinding(true)
    try {
      const headNumber = (await api.query.system.number()).toNumber()
      let low = 1
      let high = headNumber

      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2)
        const hash = await api.rpc.chain.getBlockHash(mid)
        const at = await api.at(hash)
        const ts = (await at.query.timestamp.now()).toNumber()
        if (ts < targetTs) low = mid
        else high = mid
        setSearchRange([low, high])
      }

      const highHash = await api.rpc.chain.getBlockHash(high)
      const highTs = (await (await api.at(highHash)).query.timestamp.now()).toNumber()
      const chosen = highTs >= targetTs ? high : low

      setFoundBlock(chosen)
      const chosenHash = await api.rpc.chain.getBlockHash(chosen)
      const chosenTs = (await (await api.at(chosenHash)).query.timestamp.now()).toNumber()
      setFoundTs(chosenTs)
    } catch (error: any) {
      message.error(`Error finding block: ${error.message || error}`)
    } finally {
      setFinding(false)
    }
  }, [api, targetTs])

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space>
        <Typography.Text>Select UTC date/time:</Typography.Text>
        <Tooltip title="Chain timestamps are in UTC; picker uses local timezone to select equivalent UTC moment">
          <InfoCircleOutlined />
        </Tooltip>
      </Space>
      <DatePicker
        showTime={{ format: 'HH:mm' }}
        format="YYYY-MM-DD HH:mm [UTC]"
        style={{ width: '100%' }}
        value={targetMoment}
        onChange={(value) => setTargetMoment(value ? moment(value.toDate()) : null)}
      />

      <Typography.Text>Or enter Unix timestamp (seconds or ms):</Typography.Text>
      <Input placeholder="e.g. 1625097600 or 1625097600000" value={inputTs} onChange={(e) => setInputTs(e.target.value.trim())} />

      {targetTs !== null && (
        <Typography.Text>
          Target Unix timestamp: <Typography.Text code>{targetTs}</Typography.Text>
        </Typography.Text>
      )}

      {searchRange && foundBlock === null && (
        <Typography.Text>
          Searching blocks #{searchRange[0]} – #{searchRange[1]}
        </Typography.Text>
      )}

      {foundBlock !== null && (
        <Space direction="vertical" size="small">
          <Space>
            <Typography.Text>
              Block found: <Typography.Text strong>#{foundBlock}</Typography.Text> at
            </Typography.Text>
            <BlockDate api={api} blockNumber={foundBlock} />
          </Space>
          {foundTs !== null && (
            <Typography.Text>
              Block Unix timestamp: <Typography.Text code>{foundTs}</Typography.Text>
            </Typography.Text>
          )}
        </Space>
      )}

      <Button type="primary" onClick={handleFindBlock} loading={finding} disabled={!api || targetTs === null}>
        Find Block
      </Button>
    </Space>
  )
}

export default React.memo(FindBlockByDate)
