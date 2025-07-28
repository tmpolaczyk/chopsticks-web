import { ApiPromise, WsProvider } from '@polkadot/api'
import useLocalStorage from '@rehooks/local-storage'
import { AutoComplete, Button, Form, List, Progress, Space, Typography, message } from 'antd'
import _ from 'lodash'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

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
  onConnect: (api?: ApiPromise, endpoint?: string) => void
}

const Settings: React.FC<SettingsProps> = ({ onConnect }) => {
  const [form] = Form.useForm()
  const [endpoint, setEndpoint] = useLocalStorage('endpoint')
  const [searchParams, setSearchParams] = useSearchParams()
  const [api, setApi] = useState<ApiPromise>()
  const [connectionStatus, setConnectionStatus] = useState<string>()
  const [scanning, setScanning] = useState(false)
  const [foundEndpoints, setFoundEndpoints] = useState<string[]>([])
  const [scannedCount, setScannedCount] = useState(0)

  const totalPorts = 65535
  const endpointOptions = useMemo(() => {
    const opts = new Set<string>([...endpoints, ...(endpoint ? [endpoint] : []), ...foundEndpoints])
    return Array.from(opts).map((e) => ({ value: e }))
  }, [endpoint, foundEndpoints])

  const checkPort = useCallback((port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      const timeout = window.setTimeout(() => {
        ws.close()
        resolve(false)
      }, 1000)
      ws.onopen = () => {
        clearTimeout(timeout)
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'system_health', params: [] }))
      }
      ws.onmessage = (event) => {
        clearTimeout(timeout)
        ws.close()
        try {
          const data = JSON.parse(event.data)
          if (data.jsonrpc === '2.0') resolve(true)
          else resolve(false)
        } catch {
          resolve(false)
        }
      }
      ws.onerror = () => {
        clearTimeout(timeout)
        resolve(false)
      }
    })
  }, [])

  const scanLocalPorts = useCallback(async () => {
    setScanning(true)
    setFoundEndpoints([])
    setScannedCount(0)
    const found: string[] = []
    // TODO: this is slow and the list is not lazy, it waits until the scan is complete to show the list
    //const ports = Array.from({ length: totalPorts }, (_, i) => i + 1);
    const ports = Array.from({ length: 100 }, (_, i) => i + 9900)
    const concurrency = 100
    for (let i = 0; i < ports.length; i += concurrency) {
      const slice = ports.slice(i, i + concurrency)
      const results = await Promise.all(slice.map(checkPort))
      results.forEach((isRpc, idx) => {
        if (isRpc) found.push(`ws://127.0.0.1:${slice[idx]}`)
      })
      setScannedCount((prev) => prev + slice.length)
    }
    setFoundEndpoints(found)
    setScanning(false)
    if (found.length > 0) {
      message.success(`Found ${found.length} JSON-RPC endpoints`)
    } else {
      message.warning('No JSON-RPC endpoints found on localhost')
    }
  }, [checkPort])

  const onFinish = useCallback(
    async (values: any) => {
      const { endpoint: newEndpoint } = values
      const updateApi = api === undefined || endpoint !== newEndpoint

      if (!updateApi) {
        return
      }

      setEndpoint(newEndpoint)

      if (updateApi && api !== undefined) {
        api.disconnect()
        setApi(undefined)
      }
      setConnectionStatus('Connecting...')

      // TODO: figure why this is called multiple times and ensure we don't create extra connections
      const wsProvider = new WsProvider(newEndpoint)
      const newApi = await ApiPromise.create({ provider: wsProvider })
      setApi(newApi)
    },
    [endpoint, api, setEndpoint],
  )

  useEffect(() => {
    const name = _.capitalize(api?.runtimeVersion.specName.toString())
    const unsub: any = api?.query.system.number((val: any) => setConnectionStatus(`Connected: ${name} @ ${val}`))
    return () => {
      const f = async () => {
        const u = await unsub
        u?.()
      }
      f()
    }
  }, [api])

  useEffect(() => {
    if (api) {
      onConnect(api, endpoint || undefined)
    } else {
      onConnect(undefined, undefined)
    }
  }, [api, endpoint, onConnect])

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once only
  useEffect(() => {
    let initialEndpoint = endpoint ?? endpoints[0]
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
  const progress = Math.min(100, Math.round((scannedCount / totalPorts) * 100))

  return (
    <>
      <Form form={form} layout="inline" onFinish={onFinish}>
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

      {/* Scan section on new line */}
      <Space direction="vertical" style={{ width: '100%', marginTop: 16 }}>
        <Button type="default" onClick={scanLocalPorts} loading={scanning} block>
          {scanning ? 'Scanning...' : 'Scan Local RPC'}
        </Button>
        {scanning && <Progress percent={progress} />}
        {foundEndpoints.length > 0 && (
          <List
            header={<Typography.Text>Found Endpoints</Typography.Text>}
            bordered
            dataSource={foundEndpoints}
            renderItem={(ep) => (
              <List.Item>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Typography.Text ellipsis style={{ maxWidth: 400 }}>
                    {ep}
                  </Typography.Text>
                  <Button type="link" onClick={() => onFinish({ endpoint: ep })}>
                    Connect
                  </Button>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Space>
    </>
  )
}

const SettingsFC = React.memo(Settings)
export default SettingsFC
