import { decodeKey } from '@acala-network/chopsticks-core'
import { setup } from '@acala-network/chopsticks-core'
import { IdbDatabase } from '@acala-network/chopsticks-db/browser'
import type { ApiPromise } from '@polkadot/api'
import type { HexString } from '@polkadot/util/types'
import { Button, Form, Input, Spin, Typography } from 'antd'
import { nanoid } from 'nanoid'
import React, { useCallback, useState } from 'react'

export type DecodeKeyProps = {
  api: ApiPromise
  endpoint: string
}

export const DecodeKey: React.FC<DecodeKeyProps> = ({ api, endpoint }) => {
  const [form] = Form.useForm()
  const [isLoading, setIsLoading] = useState(false)
  const [storageInfo, setStorageInfo] = useState<{
    section: string
    method: string
    args: any[]
    argsIds: any[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onFinish = useCallback(
    async (values: { key: string }) => {
      setIsLoading(true)
      setError(null)
      setStorageInfo(null)

      try {
        const keyHex = values.key as HexString
        // Use the metadata from the Polkadot API registry
        const blockNumber = ((await api.query.system.number()) as any).toNumber()
        const chain = await setup({
          endpoint,
          block: blockNumber,
          mockSignatureHost: true,
          db: new IdbDatabase('cache'),
          runtimeLogLevel: 5,
        })
        const meta = await chain.head.meta
        const { storage, decodedKey } = decodeKey(meta, keyHex)

        if (storage && decodedKey) {
          const args = decodedKey.args.map((arg) => arg.toJSON())
          const argsIds = args.map((arg) => nanoid())
          setStorageInfo({
            section: storage.section,
            method: storage.method,
            args,
            argsIds,
          })
        } else {
          setError('Unknown storage key')
        }
      } catch (e: any) {
        console.error(e)
        setError(`Error decoding key: ${e.message}`)
      }

      setIsLoading(false)
    },
    [api.query.system, endpoint],
  )

  return (
    <div>
      <Form form={form} onFinish={onFinish} layout="vertical" disabled={isLoading}>
        <Form.Item label="Storage Key" name="key" rules={[{ required: true, message: 'Please input a hex-encoded key' }]}>
          <Input placeholder="0x..." />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit">
            Decode Key
          </Button>
        </Form.Item>

        <Form.Item>
          <Spin spinning={isLoading} />
        </Form.Item>
      </Form>

      {storageInfo && (
        <div style={{ marginTop: 16 }}>
          <Typography.Title level={4}>Decoded Storage Key</Typography.Title>
          <Typography.Paragraph>
            <strong>Storage:</strong> {storageInfo.section}.{storageInfo.method}
          </Typography.Paragraph>
          <Typography.Paragraph>
            <strong>Arguments:</strong>
            <ul>
              {storageInfo.args.map((arg, idx) => (
                <li key={storageInfo.argsIds[idx]}>
                  <pre style={{ margin: 0 }}>{JSON.stringify(arg, null, 2)}</pre>
                </li>
              ))}
            </ul>
          </Typography.Paragraph>
        </div>
      )}

      {error && (
        <Typography.Text type="danger" style={{ marginTop: 16, display: 'block' }}>
          {error}
        </Typography.Text>
      )}
    </div>
  )
}

const DecodeKeyFC = React.memo(DecodeKey)

export default DecodeKeyFC
