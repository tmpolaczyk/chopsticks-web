import { ChopsticksProvider, setup } from '@acala-network/chopsticks-core'
import { runTask, taskHandler } from '@acala-network/chopsticks-core'
import { IdbDatabase } from '@acala-network/chopsticks-db/browser'
import { ApiPromise } from '@polkadot/api'
import { Button, Divider, Form, Input, Space, Spin, Typography } from 'antd'
import React, { useCallback, useState } from 'react'

import { nanoid } from 'nanoid'
import DiffViewer from './DiffViewer'
import { decodeStorageDiff } from './helper'
import type { Api } from './types'

export type ReplayBlockProps = {
  api: Api
  endpoint: string
  wasmOverride: File
}

type ExtrinsicInfo = {
  hex: string
  id: string
}

const ReplayBlock: React.FC<ReplayBlockProps> = ({ api, endpoint, wasmOverride }) => {
  const [form] = Form.useForm()
  const [message, setMessage] = useState<string>()
  const [isLoading, setIsLoading] = useState(false)
  const [storageDiff, setStorageDiff] = useState<Awaited<ReturnType<typeof decodeStorageDiff>>>()
  const [blockInfo, setBlockInfo] = useState<{ number: number; hash: string } | null>(null)
  const [blockExtrinsics, setBlockExtrinsics] = useState<ExtrinsicInfo[] | null>(null)

  const onFinish = useCallback(
    async (values: any) => {
      const { extrinsics, dmp, ump, hrmp, blockNumber } = values

      setIsLoading(true)
      setStorageDiff(undefined)
      setMessage('Starting')
      setBlockInfo(null)
      setBlockExtrinsics(null)

      // Use user-provided block number or fallback to latest
      let targetBlock: any
      if (blockNumber === 'latest') {
        const bn = ((await api.query.system.number()) as any).toNumber()
        targetBlock = bn
      } else {
        targetBlock = blockNumber
      }

      const chain = await setup({
        endpoint,
        block: targetBlock,
        mockSignatureHost: true,
        db: new IdbDatabase('cache'),
        runtimeLogLevel: 5,
      })

      setMessage('Chopsticks instance created')

      const header = await chain.head.header
      const block = chain.head

      // set number & hash
      setBlockInfo({
        number: header.number.toNumber(),
        hash: header.hash.toHex(),
      })

      // fetch and stringify extrinsics
      const rawExts = await block.extrinsics
      setBlockExtrinsics(
        rawExts.map((ext) => {
          // each ext may already be hex-string or offer toHex()
          const hex = typeof ext === 'string' ? ext : ext.toHex()
          const id = nanoid()

          return { id, hex }
        }),
      )

      const dryRun = async () => {
        try {
          // Copy the run-block logic from cli code:
          // https://github.com/AcalaNetwork/chopsticks/blob/5fb31092a879c1a1ac712b7b24bd9fa91f0bee53/packages/chopsticks/src/plugins/run-block/cli.ts
          // We cannot use buildBlock because that will automatically add inherents, so we will have 2x each inherent

          const header = await chain.head.header
          const block = chain.head
          const parent = await block.parentBlock
          if (!parent) throw Error('cant find parent block')

          if (wasmOverride) {
            // Helper: convert Uint8Array to hex string
            function u8aToHex(u8a: Uint8Array): string {
              return `0x${Array.from(u8a)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('')}`
            }
            console.log('Installing wasm override', wasmOverride)
            const buffer = new Uint8Array(await wasmOverride.arrayBuffer())
            console.log('buffer[0..10]:', JSON.stringify(buffer.slice(0, 10)))
            const wasmHex = u8aToHex(buffer)
            console.log('wasmHex[0..10]:', JSON.stringify(wasmHex.slice(0, 10)))
            const block = parent
            if (!block) throw new Error(`Cannot find block ${at}`)
            block.setWasm(wasmHex as HexString)
          }

          const wasm = await parent.wasm

          const calls: [string, HexString[]][] = [['Core_initialize_block', [header.toHex()]]]

          for (const extrinsic of await block.extrinsics) {
            calls.push(['BlockBuilder_apply_extrinsic', [extrinsic]])
          }

          calls.push(['BlockBuilder_finalize_block', []])

          const result = await runTask(
            {
              wasm,
              calls,
              mockSignatureHost: false,
              allowUnresolvedImports: false,
              runtimeLogLevel: 5,
            },
            taskHandler(parent),
          )

          if ('Error' in result) {
            throw new Error(result.Error)
          }

          /*
          const umpMessages: Record<number, any> = {}
          for (const item of ump ?? []) {
            umpMessages[item.paraId] = umpMessages[item.paraId] ?? []
            umpMessages[item.paraId].push(item.message)
          }
          const hrmpMessages: Record<number, any> = {}
          for (const item of hrmp ?? []) {
            hrmpMessages[item.paraId] = hrmpMessages[item.paraId] ?? []
            hrmpMessages[item.paraId].push({
              sendAt: item.sendAt,
              data: item.message,
            })
          }
          */

          setMessage('Dry run completed. Preparing diff...')

          const diff = result.Call.storageDiff

          return await decodeStorageDiff(parent, diff)
        } catch (e: any) {
          console.error(e)
          return undefined
        }
      }

      const dryRunDiff = await dryRun()
      if (dryRunDiff) {
        setStorageDiff(dryRunDiff)

        const provider = new ChopsticksProvider(chain)
        const chopsticksApi = new ApiPromise({ provider, noInitWarn: true })

        console.log('Chopsticks chain', chain)
        console.log('Last head', chain.head)
        console.log('Chopsticks api', chopsticksApi)

        setMessage('')
      } else {
        setMessage('Invalid parameters')
      }

      setIsLoading(false)
    },
    [api.query.system, endpoint, wasmOverride],
  )

  return (
    <div>
      <Form form={form} onFinish={onFinish} disabled={isLoading} initialValues={{ blockNumber: 'latest' }}>
        <Form.Item label="Block Number" name="blockNumber" tooltip="Enter block to replay (defaults to latest)">
          <Input style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item label="Extrinsics">
          <Form.List name="extrinsics">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field, index) => (
                  <Form.Item key={field.key} required>
                    <Input style={{ width: '85%' }} placeholder="Encoded extrinsic" required />
                    <Button type="link" onClick={() => remove(index)}>
                      Remove
                    </Button>
                  </Form.Item>
                ))}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block>
                    Add Extrinsic
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>
        </Form.Item>
        <Form.Item label="DMP">
          <Form.List name="dmp">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field, index) => (
                  <Form.Item key={field.key} required>
                    <Space.Compact block>
                      <Form.Item name={[field.name, 'sendAt']} noStyle required>
                        <Input type="number" style={{ width: '15%' }} placeholder="SendAt" required />
                      </Form.Item>
                      <Form.Item name={[field.name, 'message']} noStyle required>
                        <Input style={{ width: '85%' }} placeholder="Encoded message" required />
                      </Form.Item>
                    </Space.Compact>
                    <Button type="link" onClick={() => remove(index)}>
                      Remove
                    </Button>
                  </Form.Item>
                ))}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block>
                    Add DMP Item
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>
        </Form.Item>
        <Form.Item label="UMP">
          <Form.List name="ump">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field, index) => (
                  <Form.Item key={field.key} required>
                    <Space.Compact block>
                      <Form.Item name={[field.name, 'paraId']} noStyle required>
                        <Input type="number" style={{ width: '15%' }} placeholder="ParaId" required />
                      </Form.Item>
                      <Form.Item name={[field.name, 'message']} noStyle required>
                        <Input style={{ width: '85%' }} placeholder="Encoded message" required />
                      </Form.Item>
                    </Space.Compact>
                    <Button type="link" onClick={() => remove(index)}>
                      Remove
                    </Button>
                  </Form.Item>
                ))}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block>
                    Add UMP Item
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>
        </Form.Item>
        <Form.Item label="HRMP">
          <Form.List name="hrmp">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field, index) => (
                  <Form.Item key={field.key} required>
                    <Space.Compact block>
                      <Form.Item name={[field.name, 'paraId']} noStyle required>
                        <Input type="number" style={{ width: '15%' }} placeholder="ParaId" required />
                      </Form.Item>
                      <Form.Item name={[field.name, 'sendAt']} noStyle required>
                        <Input type="number" style={{ width: '15%' }} placeholder="SendAt" required />
                      </Form.Item>
                      <Form.Item name={[field.name, 'message']} noStyle required>
                        <Input style={{ width: '70%' }} placeholder="Encoded message" required />
                      </Form.Item>
                    </Space.Compact>
                    <Button type="link" onClick={() => remove(index)}>
                      Remove
                    </Button>
                  </Form.Item>
                ))}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block>
                    Add HRMP Item
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">
            Run
          </Button>
        </Form.Item>
        <Form.Item>
          <Spin spinning={isLoading} />
          &nbsp;&nbsp;
          <Typography.Text>{message}</Typography.Text>
        </Form.Item>
        {blockInfo && (
          <Form.Item>
            <Space direction="vertical">
              <Typography.Text strong>Block #:</Typography.Text>
              <Typography.Text>{blockInfo.number}</Typography.Text>
              <Typography.Text strong>Block hash:</Typography.Text>
              <Typography.Text code>{blockInfo.hash}</Typography.Text>
            </Space>
          </Form.Item>
        )}
        {blockExtrinsics && (
          <Form.Item label="Extrinsics">
            {blockExtrinsics.map((ext) => (
              <Form.Item key={ext.id} required style={{ marginBottom: 8 }}>
                <Input style={{ width: '85%' }} value={ext.hex} readOnly />
              </Form.Item>
            ))}
          </Form.Item>
        )}
      </Form>
      <Divider />
      {storageDiff && <DiffViewer {...storageDiff} />}
    </div>
  )
}

const ReplayBlockFC = React.memo(ReplayBlock)

export default ReplayBlockFC
