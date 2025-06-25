import { ApiPromise, WsProvider } from '@polkadot/api'
import useLocalStorage from '@rehooks/local-storage'
import { AutoComplete, Button, Form, Typography } from 'antd'
import _ from 'lodash'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { Api } from './types'

const endpoints = [
  'wss://rpc.polkadot.io',
  'wss://polkadot-collectives-rpc.polkadot.io',
  'wss://kusama-rpc.polkadot.io',
  'wss://acala-rpc.aca-api.network',
  'wss://karura-rpc.aca-api.network',
]

// Tanssi endpoints from
// https://github.com/moondance-labs/tanssi-chain-visualization/blob/main/src/components/Dashboard.tsx
const parachainUrls = [
  'https://stagebox.tanssi-dev.network',
  'https://fraa-flashbox-rpc.a.stagenet.tanssi.network',
  'https://dancebox.tanssi-api.network',
]

const relaychainUrls = [
  'https://stagelight.tanssi-dev.network',
  'https://dancelight.tanssi-api.network',
  'https://moonlight.tanssi-dev.network',
  'https://tanssi.tanssi-mainnet.network',
]

// 1. combine both arrays
// 2. map each "https://" → "wss://"
// 3. splice into `endpoints` at position 0
endpoints.splice(0, 0, ...[...relaychainUrls, ...parachainUrls].map((url) => url.replace(/^https?:\/\//, 'wss://')))

export type SettingsProps = {
  onConnect: (api?: Api, endpoint?: string) => void
}

const Settings: React.FC<SettingsProps> = ({ onConnect }) => {
  const [endpoint, setEndpoint] = useLocalStorage('endpoint')
  const [searchParams, setSearchParams] = useSearchParams()
  const [api, setApi] = useState<ApiPromise>()
  const [apiAt, setApiAt] = useState<Api>()
  const [connectionStatus, setConnectionStatus] = useState<string>()

  const endpointOptions = useMemo(() => {
    const endpointOptions = new Set(endpoints)
    if (endpoint != null) {
      endpointOptions.add(endpoint)
    }
    return Array.from(endpointOptions).map((endpoint) => ({ value: endpoint }))
  }, [endpoint])

  const onFinish = useCallback(
    async (values: any) => {
      const { endpoint: newEndpoint } = values
      const updateApi = api === undefined || endpoint !== newEndpoint
      const updateApiAt = apiAt === undefined || updateApi

      if (!updateApi && !updateApiAt) {
        return
      }

      setEndpoint(newEndpoint)

      if (updateApi && api !== undefined) {
        api.disconnect()
        setApi(undefined)
      }
      if (updateApiAt && apiAt !== undefined) {
        setApiAt(undefined)
      }
      setConnectionStatus('Connecting...')

      // TODO: figure why this is called multiple times and ensure we don't create extra connections
      const wsProvider = new WsProvider(newEndpoint)
      const newApi = await ApiPromise.create({ provider: wsProvider })
      setApi(newApi)
      const newBlockHeight = 'latest'

      if (newBlockHeight === 'latest') {
        setApiAt(newApi)
      } else {
        if (newBlockHeight === 'last') {
          const blockHash = await newApi.rpc.chain.getBlockHash()
          const newApiAt = await newApi.at(blockHash)
          setApiAt(newApiAt)
        } else {
          setConnectionStatus('Block height not found')
        }
      }
    },
    [endpoint, api, apiAt, setEndpoint],
  )

  useEffect(() => {
    const name = _.capitalize(apiAt?.runtimeVersion.specName.toString())
    const unsub: any = apiAt?.query.system.number((val: any) => setConnectionStatus(`Connected: ${name} @ ${val}`))
    return () => {
      const f = async () => {
        const u = await unsub
        u?.()
      }
      f()
    }
  }, [apiAt])

  useEffect(() => {
    if (apiAt) {
      onConnect(apiAt, endpoint || undefined)
    } else {
      onConnect(undefined, undefined)
    }
  }, [apiAt, endpoint, onConnect])

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once only
  useEffect(() => {
    let initialEndpoint = endpoint ?? endpoints[0]
    const initialBlockHeight = 'latest'
    if (searchParams.has('endpoint')) {
      initialEndpoint = searchParams.get('endpoint')!
      setEndpoint(initialEndpoint)
    } else {
      searchParams.set('endpoint', initialEndpoint)
      setSearchParams(searchParams)
    }
    onFinish({
      endpoint: initialEndpoint,
    })
  }, [])

  useEffect(() => {
    searchParams.set('endpoint', endpoint!)
    setSearchParams(searchParams)
  }, [endpoint, searchParams, setSearchParams])

  return (
    <Form layout="inline" onFinish={onFinish}>
      <Form.Item
        label="endpoint"
        name="endpoint"
        required
        initialValue={endpoint ?? endpoints[0]}
        rules={[{ pattern: /^wss?:\/\//, message: 'Not a valid WebSocket endpoint' }]}
      >
        <AutoComplete style={{ minWidth: 300 }} options={endpointOptions} />
      </Form.Item>
      <Form.Item>
        <Button type="primary" htmlType="submit">
          Connect
        </Button>
      </Form.Item>
      <Form.Item>
        <Typography.Text>{connectionStatus}</Typography.Text>
      </Form.Item>
    </Form>
  )
}

const SettingsFC = React.memo(Settings)
export default SettingsFC
