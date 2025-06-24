import { decodeKey } from '@acala-network/chopsticks-core'
import { setup } from '@acala-network/chopsticks-core'
import { IdbDatabase } from '@acala-network/chopsticks-db/browser'
import type { ApiPromise } from '@polkadot/api'
import type { StorageEntryMetadataLatest, StorageHasher } from '@polkadot/types/metadata'
import { hexToU8a } from '@polkadot/util'
import { blake2AsU8a, xxhashAsU8a } from '@polkadot/util-crypto'
import type { HexString } from '@polkadot/util/types'
import { Button, Form, Input, Spin, Tooltip, Typography } from 'antd'
import { nanoid } from 'nanoid'
import React, { useState } from 'react'

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
    keyHex: string
    args: any[]
    argsIds: any[]
    meta: StorageEntryMetadataLatest
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onFinish = async (values: { key: string }) => {
    setIsLoading(true)
    setError(null)
    setStorageInfo(null)
    try {
      const keyHex = values.key as HexString
      const blockNumber = ((await api.query.system.number()) as any).toNumber()
      const chain = await setup({ endpoint, block: blockNumber, mockSignatureHost: true, db: new IdbDatabase('cache'), runtimeLogLevel: 5 })
      const meta = await chain.head.meta
      const { storage, decodedKey } = decodeKey(meta, keyHex)

      if (storage && decodedKey) {
        setStorageInfo({
          section: storage.section,
          method: storage.method,
          keyHex,
          args: decodedKey.args,
          argsIds: decodedKey.args.map((arg) => nanoid()),
          meta: storage.meta,
        })
      } else {
        setError('Unknown storage key')
      }
    } catch (e: any) {
      console.error(e)
      setError(`Error decoding key: ${e.message}`)
    }
    setIsLoading(false)
  }

  const u8aToHex = (u8a: Uint8Array): string =>
    Array.from(u8a)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

  // Split key into prefix, args, suffix
  const getKeySegments = (keyHex: string, meta: StorageEntryMetadataLatest, args: any[]): { label: string; hex: string }[] => {
    const raw = hexToU8a(keyHex)
    const segments: { label: string; hex: string }[] = []
    let offset = 0

    // 1) Pallet prefix (Twox128)
    segments.push({
      label: 'Pallet prefix (Twox128)',
      hex: u8aToHex(raw.subarray(offset, offset + 16)),
    })
    offset += 16

    // 2) Storage prefix (Twox128)
    segments.push({
      label: 'Storage prefix (Twox128)',
      hex: u8aToHex(raw.subarray(offset, offset + 16)),
    })
    offset += 16

    // 3) Pick out the hashers array explicitly
    const { type } = meta
    let hashers: StorageHasher[] = []

    if (type.isPlain) {
      // no hashers, just a raw key
      hashers = []
    } else if (type.isMap) {
      hashers = type.asMap.hashers
    } else if (type.isDoubleMap) {
      const { key1Hasher, key2Hasher } = type.asDoubleMap
      hashers = [key1Hasher, key2Hasher]
    } else if (type.isNMap) {
      hashers = type.asNMap.hashers
    } else {
      throw new Error(`Unsupported storage entry type: ${type.toString()}`)
    }

    // 4) For each argument, apply its hasher
    hashers.forEach((hasher, i) => {
      const encoded = (args[i] as any)?.toU8a?.() ?? new Uint8Array()

      switch (hasher.toString()) {
        case 'Blake2_128Concat': {
          const hash = blake2AsU8a(encoded, 128)
          segments.push({ label: `Arg ${i} hash (Blake2_128)`, hex: u8aToHex(hash) })
          offset += hash.length

          segments.push({ label: `Arg ${i} raw (Identity)`, hex: u8aToHex(encoded) })
          offset += encoded.length
          break
        }
        case 'Blake2_128': {
          const hash = blake2AsU8a(encoded, 128)
          segments.push({ label: `Arg ${i} hash (Blake2_128)`, hex: u8aToHex(hash) })
          offset += hash.length
          break
        }
        case 'Twox64Concat': {
          const hash = xxhashAsU8a(encoded, 64)
          segments.push({ label: `Arg ${i} hash (Twox64)`, hex: u8aToHex(hash) })
          offset += hash.length

          segments.push({ label: `Arg ${i} raw (Identity)`, hex: u8aToHex(encoded) })
          offset += encoded.length
          break
        }
        case 'Twox64': {
          const hash = xxhashAsU8a(encoded, 64)
          segments.push({ label: `Arg ${i} hash (Twox64)`, hex: u8aToHex(hash) })
          offset += hash.length
          break
        }
        case 'Twox128': {
          const hash = xxhashAsU8a(encoded, 128)
          segments.push({ label: `Arg ${i} hash (Twox128)`, hex: u8aToHex(hash) })
          offset += hash.length
          break
        }
        case 'Twox256': {
          const hash = xxhashAsU8a(encoded, 256)
          segments.push({ label: `Arg ${i} hash (Twox256)`, hex: u8aToHex(hash) })
          offset += hash.length
          break
        }
        case 'Identity': {
          segments.push({ label: `Arg ${i} raw (Identity)`, hex: u8aToHex(encoded) })
          offset += encoded.length
          break
        }
        default: {
          throw new Error(`Unknown hasher ${hasher.toString()}`)
        }
      }
    })

    // 5) Any remaining bytes (e.g. child-storage suffix)
    if (offset < raw.length) {
      const suffix = raw.subarray(offset)
      segments.push({ label: 'Suffix', hex: u8aToHex(suffix) })
    }

    return segments
  }

  return (
    <div>
      <Form form={form} onFinish={onFinish} layout="vertical" disabled={isLoading}>
        <Form.Item label="Storage Key" name="key" rules={[{ required: true, message: 'Please input a hex-encoded key' }]}>
          <Input placeholder="0x..." allowClear />
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

      {error && <Typography.Text type="danger">{error}</Typography.Text>}

      {storageInfo && (
        <div style={{ marginTop: 16 }}>
          <Typography.Title level={4}>Decoded Storage Key</Typography.Title>
          <Typography.Paragraph>
            <strong>Storage:</strong> {storageInfo.section}.{storageInfo.method}
          </Typography.Paragraph>
          <Typography.Paragraph>
            <strong>Key Segments:</strong>
            <div style={{ wordBreak: 'break-all' }}>
              {(() => {
                const segments = getKeySegments(storageInfo.keyHex, storageInfo.meta, storageInfo.args)
                return segments.map((segment, idx) => {
                  const hue = Math.round((idx * 360) / segments.length)
                  const color = `hsl(${hue}, 70%, 80%)`
                  return (
                    <Tooltip key={nanoid()} title={segment.label}>
                      <Typography.Text
                        style={{
                          backgroundColor: color,
                          padding: '2px 4px',
                          borderRadius: 4,
                          marginRight: 2,
                          display: 'inline-block',
                        }}
                      >
                        {segment.hex}
                      </Typography.Text>
                    </Tooltip>
                  )
                })
              })()}
            </div>
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
    </div>
  )
}

const DecodeKeyFC = React.memo(DecodeKey)

export default DecodeKeyFC
