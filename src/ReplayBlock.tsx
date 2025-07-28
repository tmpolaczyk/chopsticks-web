import { ChopsticksProvider, setup } from '@acala-network/chopsticks-core'
import { runTask, taskHandler } from '@acala-network/chopsticks-core'
import { IdbDatabase } from '@acala-network/chopsticks-db/browser'
import { ApiPromise } from '@polkadot/api'
import {
  Button,
  Card,
  Divider,
  Form,
  Input,
  Space,
  Spin,
  Typography,
} from 'antd'
import React, { useCallback, useState } from 'react'
import type { HexString } from '@polkadot/util/types'
import { assert, isHex, u8aConcat, u8aEq, compactToU8a } from '@polkadot/util'
import type { Call, ExtrinsicPayload } from '@polkadot/types/interfaces'
import type { SubmittableExtrinsic } from '@polkadot/api/types'
import { nanoid } from 'nanoid'
import { JSONTree } from 'react-json-tree'
import DiffViewer from './DiffViewer'
import { decodeStorageDiff } from './helper'

export type ReplayBlockProps = {
  api: ApiPromise
  endpoint: string
  wasmOverride: File | undefined
}

type ExtrinsicInfo = {
  hex: string
  id: string
}

// Extrinsic decoder from polkadot-js
// https://github.com/polkadot-js/apps/blob/76ca1dbe9d07a47d4dfd49807620e8b7412cb680/packages/page-extrinsics/src/Decoder.tsx#L58
/**
 * Decode a hex‐encoded extrinsic (or call/payload) into a SubmittableExtrinsic
 * using the API’s metadata.
 */
function decodeExtrinsic(
  api: ApiPromise,
  hex: string
): SubmittableExtrinsic<'promise'> {
  assert(isHex(hex), 'Expected a hex‑encoded call')

  let extrinsicCall: Call
  let extrinsicPayload: ExtrinsicPayload | null = null
  let decoded: SubmittableExtrinsic<'promise'> | null = null

  try {
    // 1) Try as full signed/unsigned extrinsic
    const tx = api.tx(hex)
    assert(tx.toHex() === hex, 'Length mismatch when decoding as Extrinsic')
    decoded = tx
    extrinsicCall = api.createType('Call', decoded.method)
  } catch {
    // 2) Try as bare Call or as un‑prefixed payload
    try {
      extrinsicCall = api.createType('Call', hex)
      const callHex = extrinsicCall.toHex()

      if (callHex === hex) {
        // plain Call
      } else if (hex.startsWith(callHex)) {
        // un‑prefixed payload: compact length + method + args
        const prefixed = u8aConcat(
          compactToU8a(extrinsicCall.encodedLength),
          hex
        )
        extrinsicPayload = api.createType('ExtrinsicPayload', prefixed)
        assert(
          u8aEq(extrinsicPayload.toU8a(), prefixed),
          'Mismatch decoding un‑prefixed payload'
        )
        extrinsicCall = api.createType(
          'Call',
          extrinsicPayload.method.toHex()
        )
      } else {
        throw new Error('Call length mismatch')
      }
    } catch {
      // 3) Fallback: treat as fully‑prefixed payload
      extrinsicPayload = api.createType('ExtrinsicPayload', hex)
      assert(
        extrinsicPayload.toHex() === hex,
        'Cannot decode as Call or ExtrinsicPayload'
      )
      extrinsicCall = api.createType(
        'Call',
        extrinsicPayload.method.toHex()
      )
    }
  }

  // Find the corresponding method on api.tx
  const { method, section } = api.registry.findMetaCall(
    extrinsicCall.callIndex
  )
  const extrinsicFn = (api.tx as any)[section][method]

  // If we haven’t yet built a SubmittableExtrinsic, do so now
  if (!decoded) {
    decoded = extrinsicFn(...extrinsicCall.args)
  }

  return decoded
}

const ReplayBlock: React.FC<ReplayBlockProps> = ({
  api,
  endpoint,
  wasmOverride,
}) => {
  const [form] = Form.useForm()
  const [messageText, setMessageText] = useState<string>()
  const [isLoading, setIsLoading] = useState(false)
  const [storageDiff, setStorageDiff] = useState<
    Awaited<ReturnType<typeof decodeStorageDiff>>
  >()
  const [blockInfo, setBlockInfo] = useState<{ number: number; hash: string } | null>(
    null
  )
  const [blockExtrinsics, setBlockExtrinsics] = useState<ExtrinsicInfo[] | null>(
    null
  )
  const [decodedExtrinsics, setDecodedExtrinsics] = useState<any[] | null>(
    null
  )

  const onFinish = useCallback(
    async (values: any) => {
      setIsLoading(true)
      setMessageText('Initializing…')
      setStorageDiff(undefined)
      setBlockInfo(null)
      setBlockExtrinsics(null)
      setDecodedExtrinsics(null)

      // 1) pick block
      const targetBlock =
        values.blockNumber === 'latest'
          ? ((await api.query.system.number()) as any).toNumber()
          : Number(values.blockNumber)

      // 2) start Chopsticks
      const chain = await setup({
        endpoint,
        block: targetBlock,
        mockSignatureHost: true,
        db: new IdbDatabase('cache'),
        runtimeLogLevel: 5,
      })
      setMessageText('Chopsticks ready')

      // 3) fetch header & set info
      const head = await chain.head.header
      setBlockInfo({ number: head.number.toNumber(), hash: head.hash.toHex() })

      // 4) get raw hex extrinsics
      const rawExts = await chain.head.extrinsics
      const infos = rawExts.map((ext) => {
        const hex = typeof ext === 'string' ? ext : ext.toHex()
        return { id: nanoid(), hex }
      })
      setBlockExtrinsics(infos)

      // 5) decode each via our helper
      const decoded = infos.map(({ hex }) =>
        decodeExtrinsic(api, hex).toHuman()
      )
      setDecodedExtrinsics(decoded)

      // 6) run dry‑run & diff (unchanged)
      const dryRun = async () => {
        try {
          const header = await chain.head.header
          const block = chain.head
          const parent = await block.parentBlock
          if (!parent) throw new Error('No parent block')

          if (wasmOverride) {
            const buf = new Uint8Array(await wasmOverride.arrayBuffer())
            const wasmHex =
              '0x' +
              Array.from(buf)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('')
            parent.setWasm(wasmHex as HexString)
          }

          const wasm = await parent.wasm
          const calls: [string, HexString[]][] = [
            ['Core_initialize_block', [header.toHex()]],
            ...rawExts.map((ext) => [
              'BlockBuilder_apply_extrinsic',
              [typeof ext === 'string' ? ext : ext.toHex()],
            ] as [string, HexString[]]),
            ['BlockBuilder_finalize_block', []],
          ]

          const result = await runTask(
            { wasm, calls, mockSignatureHost: false, allowUnresolvedImports: false, runtimeLogLevel: 5 },
            taskHandler(parent)
          )
          if ('Error' in result) throw new Error(result.Error)
          return await decodeStorageDiff(parent, result.Call.storageDiff)
        } catch (e: any) {
          console.error(e)
          return undefined
        }
      }

      setMessageText('Running dry‑run…')
      const diff = await dryRun()
      if (diff) {
        setStorageDiff(diff)
        setMessageText('')
      } else {
        setMessageText('Dry‑run failed')
      }

      setIsLoading(false)
    },
    [api, endpoint, wasmOverride]
  )

  return (
    <div>
      <Form
        form={form}
        onFinish={onFinish}
        initialValues={{ blockNumber: 'latest' }}
        disabled={isLoading}
      >
        <Form.Item
          label="Block Number"
          name="blockNumber"
          tooltip="Use 'latest' or specify a block number"
        >
          <Input style={{ width: 200 }} />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit">
            Run
          </Button>
        </Form.Item>

        <Form.Item>
          <Space>
            <Spin spinning={isLoading} />
            <Typography.Text>{messageText}</Typography.Text>
          </Space>
        </Form.Item>

        {blockInfo && (
          <Form.Item>
            <Space direction="vertical">
              <Typography.Text strong>Block #:</Typography.Text>
              <Typography.Text>{blockInfo.number}</Typography.Text>
              <Typography.Text strong>Hash:</Typography.Text>
              <Typography.Text code>{blockInfo.hash}</Typography.Text>
            </Space>
          </Form.Item>
        )}

        {blockExtrinsics && (
          <Form.Item label="Extrinsics (hex)" style={{ marginBottom: 0 }}>
            {blockExtrinsics.map((ext) => (
              <Form.Item key={ext.id} style={{ marginBottom: 8 }}>
                <Input value={ext.hex} readOnly style={{ width: '100%' }} />
              </Form.Item>
            ))}
          </Form.Item>
        )}
      </Form>

      <Divider />

      {decodedExtrinsics && (
        <Card size="small" title="Decoded Extrinsics">
          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            <JSONTree
              data={decodedExtrinsics}
              hideRoot={false}
              shouldExpandNodeInitially={(keyPath) => keyPath.length <= 2}
              theme="monokai"
              invertTheme={true}
            />
          </div>
        </Card>
      )}

      <Divider />

      {storageDiff && <DiffViewer {...storageDiff} />}
    </div>
  )
}

export default React.memo(ReplayBlock)
