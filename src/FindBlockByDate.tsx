import { ExclamationCircleOutlined, InfoCircleOutlined } from '@ant-design/icons'
import type { ApiPromise } from '@polkadot/api'
import { Button, DatePicker, Input, Radio, Space, Tooltip, Typography, message } from 'antd'
import moment, { type Moment } from 'moment'
import React, { useState, useCallback, useEffect } from 'react'
import { BlockDate } from './BlockDate'

export type FindBlockByDateProps = {
  /** Polkadot API instance to query chain data */
  api: ApiPromise
}

const FindBlockByDate: React.FC<FindBlockByDateProps> = ({ api }) => {
  const [mode, setMode] = useState<'date' | 'timestamp'>('date')
  const [targetMoment, setTargetMoment] = useState<Moment | null>(null)
  const [inputTs, setInputTs] = useState<string>('')
  const [targetTs, setTargetTs] = useState<number | null>(null)
  const [finding, setFinding] = useState<boolean>(false)
  const [searchRange, setSearchRange] = useState<[number, number] | null>(null)
  const [foundBlock, setFoundBlock] = useState<number | null>(null)
  const [foundTs, setFoundTs] = useState<number | null>(null)

  // Reset results when target changes
  useEffect(() => {
    // TODO: use variable to fix linter error
    targetTs
    setSearchRange(null)
    setFoundBlock(null)
    setFoundTs(null)
  }, [targetTs])

  // Handle mode switch
  const onModeChange = (e: any) => {
    const m = e.target.value as 'date' | 'timestamp'
    setMode(m)
    // keep existing inputs so users can switch back without losing data
  }

  // Handle date picker change
  const onDateChange = (value: Moment | null) => {
    if (value && mode === 'date') {
      const utc = moment(value.toDate()).utc()
      const ms = utc.valueOf()
      setTargetMoment(utc)
      setInputTs('')
      setTargetTs(ms)
    } else if (mode === 'date') {
      setTargetMoment(null)
      setInputTs('')
      setTargetTs(null)
    }
  }

  // Handle timestamp input change
  const onInputChange = (raw: string) => {
    if (mode === 'timestamp') {
      setInputTs(raw)
      const n = Number(raw)
      if (!Number.isNaN(n)) {
        const ms = n < 1e11 ? n * 1000 : n
        setTargetMoment(null)
        setTargetTs(ms)
      } else {
        setTargetTs(null)
      }
    }
  }

  const handleFindBlock = useCallback(async () => {
    if (targetTs === null) {
      message.error('Please select a date/time or enter a Unix timestamp')
      return
    }
    setFinding(true)
    try {
      // Fetch head block number and timestamp
      const headNumber = (await api.query.system.number()).toNumber()
      const headHash = await api.rpc.chain.getBlockHash(headNumber)
      const headTs = (await (await api.at(headHash)).query.timestamp.now()).toNumber()

      // Sanity checks
      if (targetTs >= headTs) {
        setFoundBlock(headNumber)
        setFoundTs(headTs)
        setSearchRange(null)
        return
      }
      // Check genesis (block 0)
      const genesisHash = await api.rpc.chain.getBlockHash(0)
      const genesisTs = (await (await api.at(genesisHash)).query.timestamp.now()).toNumber()
      if (targetTs <= genesisTs) {
        setFoundBlock(0)
        setFoundTs(genesisTs)
        setSearchRange(null)
        return
      }
      // Binary search between 0 and head
      let low = 0
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

  // Compute diff warning with days/hours/minutes
  let warning: React.ReactNode = null
  if (foundTs !== null && targetTs !== null) {
    const diffMs = foundTs - targetTs
    const absMs = Math.abs(diffMs)
    if (absMs > 60000) {
      const days = Math.floor(absMs / 86400000)
      const hours = Math.floor((absMs % 86400000) / 3600000)
      const minutes = Math.floor((absMs % 3600000) / 60000)
      const parts = []
      if (days) parts.push(`${days}d`)
      if (hours) parts.push(`${hours}h`)
      if (minutes) parts.push(`${minutes}m`)
      const diffStr = parts.join(' ')
      const direction = diffMs > 0 ? 'after' : 'before'
      warning = (
        <Typography.Text type="warning">
          <ExclamationCircleOutlined />
          &nbsp;Block timestamp is {diffStr} {direction} target
        </Typography.Text>
      )
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Radio.Group onChange={onModeChange} value={mode}>
        <Radio.Button value="date">By Date</Radio.Button>
        <Radio.Button value="timestamp">By Timestamp</Radio.Button>
      </Radio.Group>

      {mode === 'date' && (
        <>
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
            onChange={onDateChange}
          />
        </>
      )}

      {mode === 'timestamp' && (
        <>
          <Typography.Text>Enter Unix timestamp (seconds or ms):</Typography.Text>
          <Input placeholder="e.g. 1625097600 or 1625097600000" value={inputTs} onChange={(e) => onInputChange(e.target.value.trim())} />
        </>
      )}

      {targetTs !== null && (
        <>
          <Typography.Text>
            Target Unix timestamp: <Typography.Text code>{targetTs}</Typography.Text>
          </Typography.Text>
          <Typography.Text>
            Target date (UTC): <Typography.Text code>{moment.utc(targetTs).format('YYYY-MM-DD HH:mm')} UTC</Typography.Text>
          </Typography.Text>
        </>
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
            <>
              <Typography.Text>
                Block Unix timestamp: <Typography.Text code>{foundTs}</Typography.Text>
              </Typography.Text>
              {warning}
            </>
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
