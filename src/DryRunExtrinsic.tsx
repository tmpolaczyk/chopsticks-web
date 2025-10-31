import { type Blockchain, setStorage, setup } from '@acala-network/chopsticks-core'
import { runTask, taskHandler } from '@acala-network/chopsticks-core'
import { IdbDatabase } from '@acala-network/chopsticks-db/browser'
import type { ApiPromise } from '@polkadot/api'
import type { GenericExtrinsic } from '@polkadot/types'
import type { IExtrinsicEra, Registry } from '@polkadot/types/types'
import { assert, isHex } from '@polkadot/util'
import { decodeAddress, encodeAddress, isEthereumAddress } from '@polkadot/util-crypto'
import type { HexString } from '@polkadot/util/types'
import { Alert, Button, Card, Collapse, Divider, Form, Input, Popconfirm, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { nanoid } from 'nanoid'
import React, { useCallback, useMemo, useState } from 'react'
import { JSONTree } from 'react-json-tree'
import DiffViewer from './DiffViewer'
import { decodeStorageDiff } from './helper'

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const { Panel } = Collapse

export type DryRunExtrinsicProps = {
  api: ApiPromise
  endpoint: string
  wasmOverride: File | undefined
}

/* ----------------------------- decode helpers ----------------------------- */
function decodeExtrinsicAt(registry: Registry, hex: string) {
  assert(isHex(hex), 'Expected a hex-encoded extrinsic')
  const ex: any = registry.createType('Extrinsic', ensure0x(hex))
  const call = ex.method
  const { section, method } = registry.findMetaCall(call.callIndex)
  return { ex, section, method, human: ex.toHuman() }
}

type RawStorageValues = [string, string | null][]

/** Persist the "after" state from Phase A into Chopsticks storage. */
async function applyDecodedDiffToState(chain: Blockchain, storageDiff: RawStorageValues): Promise<HexString> {
  // If you ever want to skip events, uncomment:
  // if (env.newState.system?.events) env.newState.system.events = []

  return await setStorage(chain, storageDiff)
}

// --- types ---
type OriginMode = 'unsigned' | 'signed'

type UIExtrinsic = {
  id: string
  source: 'block' | 'extra'
  hex: string
  originalHex?: string
  edited?: boolean
  human?: any
  methodName?: string
  error?: string

  originMode: OriginMode
  originAddress?: string // ss58
}

type SignCtx = {
  genesisHash: HexString
  blockHash: HexString
  runtimeVersion: any // RpcRuntimeVersion
  signedExtensions: string[]
  era?: IExtrinsicEra
  nonce?: number // default 0
  tip?: number // default 0
}

function ensure0x(hex: string) {
  const h = hex.trim()
  return h.startsWith('0x') ? h : `0x${h}`
}

function isValidSs58(addr?: string) {
  if (!addr) return false
  try {
    const u8 = decodeAddress(addr)
    encodeAddress(u8)
    return true
  } catch {
    return false
  }
}

function deriveOriginFromHex(registry: Registry, hex: string): { mode: 'unsigned' | 'signed'; address?: string } {
  try {
    const ex: any = registry.createType('Extrinsic', ensure0x(hex))
    if (ex.isSigned) return { mode: 'signed', address: ex.signer.toString() }
  } catch {}
  return { mode: 'unsigned' }
}

async function makeSignCtxAt(api: ApiPromise, blockHash: HexString, registry: Registry): Promise<SignCtx> {
  const runtimeVersion = await api.rpc.state.getRuntimeVersion(blockHash)
  const genesisHash = api.genesisHash.toHex() as HexString
  const signedExtensions = registry.signedExtensions
  return { genesisHash, blockHash, runtimeVersion, signedExtensions, nonce: 0, tip: 0 }
}

function buildUIExtrinsic(registry: Registry, hexIn: string, source: UIExtrinsic['source'], originalHex?: string): UIExtrinsic {
  const hex = ensure0x(hexIn)
  const id = nanoid()
  let human: any | undefined
  let methodName: string | undefined
  let error: string | undefined

  try {
    const { section, method, human: h } = decodeExtrinsicAt(registry, hex)
    human = h
    methodName = `${section}.${method}`
  } catch (e: any) {
    error = e?.message || 'Decode failed'
  }

  // Default extras → Signed(ALICE) (sr25519)
  const origin = source === 'block' ? deriveOriginFromHex(registry, hex) : { mode: 'signed' as const, address: ALICE }

  return {
    id,
    source,
    hex,
    originalHex,
    edited: !!(originalHex && originalHex !== hex),
    human: human ? { ...human, hex } : undefined,
    methodName,
    error,
    originMode: origin.mode,
    originAddress: origin.address,
  }
}

function materializeExtrinsicHex(registry: Registry, item: UIExtrinsic, ctx?: SignCtx): HexString {
  const hex = ensure0x(item.hex)

  // If unchanged block extrinsic and origin didn’t change, reuse hex.
  const originUnchanged = item.source === 'block' && !item.edited && item.originMode === (item.originAddress ? 'signed' : 'unsigned')
  if (originUnchanged) return hex as HexString

  // Decode once with the block registry
  const { ex: baseEx } = decodeExtrinsicAt(registry, hex)

  // Rebuild from the call so we can switch between unsigned/signed deterministically
  const rebuilt: GenericExtrinsic = registry.createType('Extrinsic', { method: baseEx.method }) as unknown as GenericExtrinsic

  if (item.originMode === 'unsigned') {
    return (rebuilt as any).toHex() as HexString
  }

  const addr = item.originAddress?.trim()
  assert(addr, 'Signed origin requires an address')
  assert(!isEthereumAddress(addr) && isValidSs58(addr), 'Runtime expects sr25519/ss58 (e.g. ALICE), not 0x…')
  assert(ctx, 'signFake requires a runtime context')

  rebuilt.signFake(addr, {
    ...ctx,
    era: ctx.era,
    nonce: ctx.nonce ?? 0,
    tip: ctx.tip ?? 0,
  })

  return (rebuilt as any).toHex() as HexString
}

/* --------------------------------- component -------------------------------- */

const DryRunExtrinsic: React.FC<DryRunExtrinsicProps> = ({ api, endpoint, wasmOverride }) => {
  const [form] = Form.useForm()
  const [messageText, setMessageText] = useState<string>()
  const [isLoading, setIsLoading] = useState(false)
  const [storageDiff, setStorageDiff] = useState<Awaited<ReturnType<typeof decodeStorageDiff>>>()
  const [blockInfo, setBlockInfo] = useState<{ number: number; hash: string } | null>(null)

  const [blockRegistry, setBlockRegistry] = useState<Registry | null>(null)
  // Stage extras before first Run; persist across runs
  const [stagedExtras, setStagedExtras] = useState<UIExtrinsic[]>([])
  // Last fetched block extrinsics (editable/removable in the UI after Run)
  const [blockItems, setBlockItems] = useState<UIExtrinsic[]>([])
  // Textarea for staging extras
  const [pasteInput, setPasteInput] = useState<string>('')

  const combinedList: UIExtrinsic[] = useMemo(() => {
    // Order: block first (as in the chain), then extras appended
    return [...blockItems, ...stagedExtras]
  }, [blockItems, stagedExtras])

  /* --------------------- staging extras (pre-Run and later) --------------------- */

  const addPastedExtras = useCallback(() => {
    const tokens = pasteInput
      .split(/[\s,;\n\r]+/)
      .map((x) => x.trim())
      .filter(Boolean)

    if (tokens.length === 0) return

    const registry = blockRegistry ?? api.registry
    const built = tokens.map((hex) => buildUIExtrinsic(registry, hex, 'extra'))
    setStagedExtras((prev) => [...prev, ...built])
    setPasteInput('')
  }, [api, pasteInput, blockRegistry])

  const clearExtras = useCallback(() => {
    setStagedExtras([])
  }, [])

  const removeItem = useCallback((id: string) => {
    setBlockItems((prev) => prev.filter((x) => x.id !== id))
    setStagedExtras((prev) => prev.filter((x) => x.id !== id))
  }, [])

  const updateItemHex = useCallback(
    (id: string, newHex: string) => {
      const registry = blockRegistry ?? api.registry
      setBlockItems((prev) =>
        prev.map((x) => (x.id === id ? { ...buildUIExtrinsic(registry, newHex, 'block', x.originalHex ?? x.hex), id } : x)),
      )
      setStagedExtras((prev) => prev.map((x) => (x.id === id ? { ...buildUIExtrinsic(registry, newHex, 'extra'), id } : x)))
    },
    [api, blockRegistry],
  )

  const forceDecode = useCallback(
    (id: string) => {
      // Use current hex to rebuild/refresh decode
      const all = [...blockItems, ...stagedExtras]
      const cur = all.find((x) => x.id === id)
      if (!cur) return
      updateItemHex(id, cur.hex)
    },
    [blockItems, stagedExtras, updateItemHex],
  )

  const setItemOriginMode = useCallback((id: string, mode: OriginMode) => {
    setBlockItems((prev) => prev.map((x) => (x.id === id ? { ...x, originMode: mode } : x)))
    setStagedExtras((prev) => prev.map((x) => (x.id === id ? { ...x, originMode: mode } : x)))
  }, [])

  const setItemOriginAddress = useCallback((id: string, address: string) => {
    setBlockItems((prev) => prev.map((x) => (x.id === id ? { ...x, originAddress: address } : x)))
    setStagedExtras((prev) => prev.map((x) => (x.id === id ? { ...x, originAddress: address } : x)))
  }, [])

  /* ------------------------------------ Run ----------------------------------- */

  const fetchBlockAndAppendExtras = useCallback(
    async (values: any) => {
      // Reset UI
      setIsLoading(true)
      setMessageText('Initializing…')
      setStorageDiff(undefined)
      setBlockInfo(null)
      setBlockItems([])
      setBlockRegistry(null)

      // 1) pick block
      const targetBlock =
        values.blockNumber === 'latest' ? ((await api.query.system.number()) as any).toNumber() : Number(values.blockNumber)

      // 2) start Chopsticks
      const chain = await setup({
        endpoint,
        block: targetBlock,
        mockSignatureHost: true,
        db: new IdbDatabase('cache'),
        runtimeLogLevel: 5,
      })
      setMessageText('Chopsticks ready')

      // 3) header
      const head = await chain.head.header
      const blockNumber = head.number.toNumber()
      const blockHash = head.hash.toHex()
      setBlockInfo({ number: blockNumber, hash: blockHash })

      const apiAt = await api.at(head.hash)
      const registryAt = apiAt.registry
      setBlockRegistry(registryAt)

      // 4) get block extrinsics and map to UI (source=block)
      const rawExts = await chain.head.extrinsics
      const blockUI = rawExts.map((ext) => {
        const hex = typeof ext === 'string' ? ext : ext.toHex()
        return buildUIExtrinsic(registryAt, hex, 'block', hex)
      })
      setBlockItems(blockUI)
      // 5) do dry run with combined list (block + current staged extras)
      const signCtx = await makeSignCtxAt(api, blockHash, registryAt)

      const runDryRun = async () => {
        try {
          const header = await chain.head.header
          const parent = await chain.head.parentBlock
          if (!parent) throw new Error('No parent block')

          if (wasmOverride) {
            const buf = new Uint8Array(await wasmOverride.arrayBuffer())
            const wasmHex = `0x${Array.from(buf)
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('')}`
            parent.setWasm(wasmHex as HexString)
          }

          // Seed ALICE once on base state so both phases see it
          try {
            await setStorage(chain, {
              system: {
                account: [[[ALICE], { providers: 1, data: { free: '1000000000000' } }]],
              },
            })
          } catch (e) {
            console.error('Unable to seed Alice balances', e)
          }

          const blockHexes = blockItems.map((x) => materializeExtrinsicHex(registryAt, x, signCtx))
          const extraHexes = stagedExtras.map((x) => materializeExtrinsicHex(registryAt, x, signCtx))
          const wasm = await parent.wasm

          // Phase A — init + block extrinsics (NO finalize)
          const callsA: [string, HexString[]][] = [
            ['Core_initialize_block', [header.toHex()]],
            ...blockHexes.map((hex) => ['BlockBuilder_apply_extrinsic', [hex]] as [string, HexString[]]),
            // (intentionally NO finalize here)
          ]
          console.log('callsA', callsA)
          const resA = await runTask(
            { wasm, calls: callsA, mockSignatureHost: true, allowUnresolvedImports: false, runtimeLogLevel: 5 },
            taskHandler(parent),
          )
          if ('Error' in resA) throw new Error(resA.Error)
          // TODO: we cannot decode the diff because then trying to apply it fails, as toHuman is no reversible it seems
          //const [oldStateA, newStateA] = await decodeBlockStorageDiff(parent, resA.Call.storageDiff)

          // commit Phase-A effects so Phase B starts from post-block state
          // Without this the next calls will complain that the block has not been initialized properly, as it will be
          // missing timestamp inherent for example.
          //const newBlockHashMaybe = await applyDecodedDiffToState(chain, resA.Call.storageDiff)
          //console.log("parent hash: ", parent.hash)
          //console.log("new hash maybe: ", newBlockHashMaybe)

          chain.head.pushStorageLayer().setAll(resA.Call.storageDiff)

          // Phase B — ONLY extras + finalize
          const callsB: [string, HexString[]][] = [
            ...extraHexes.map((hex) => ['BlockBuilder_apply_extrinsic', [hex]] as [string, HexString[]]),
            ['BlockBuilder_finalize_block', []],
          ]
          console.log('callsB', callsB)
          const resB = await runTask(
            { wasm, calls: callsB, mockSignatureHost: true, allowUnresolvedImports: false, runtimeLogLevel: 5 },
            taskHandler(parent),
          )
          if ('Error' in resB) throw new Error(resB.Error)

          const extrasOnly = await decodeStorageDiff(parent, resB.Call.storageDiff)
          return extrasOnly
        } catch (e: any) {
          console.error(e)
          return undefined
        }
      }

      setMessageText('Running dry-run…')
      const diff = await runDryRun()
      if (diff) {
        setStorageDiff(diff)
        setMessageText('')
      } else {
        setMessageText('Dry-run failed')
      }

      setIsLoading(false)
    },
    [api, endpoint, stagedExtras, wasmOverride, blockItems],
  )

  // Run-without-refetch button (keeps current edits/removals)
  const dryRunCurrentList = useCallback(async () => {
    throw new Error('unimplemented')
    if (!blockInfo) return
    setIsLoading(true)
    setMessageText('Running dry-run (current list)…')
    setStorageDiff(undefined)

    const chain = await setup({
      endpoint,
      block: blockInfo.number,
      mockSignatureHost: true,
      db: new IdbDatabase('cache'),
      runtimeLogLevel: 5,
    })

    try {
      const header = await chain.head.header
      const parent = await chain.head.parentBlock
      if (!parent) throw new Error('No parent block')

      const apiAt = await api.at(header.hash)
      const registryAt = apiAt.registry
      const signCtx = await makeSignCtxAt(api, header.hash.toHex() as HexString, registryAt)

      if (wasmOverride) {
        const buf = new Uint8Array(await wasmOverride.arrayBuffer())
        const wasmHex = `0x${Array.from(buf)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')}`
        parent.setWasm(wasmHex as HexString)
      }

      const wasm = await parent.wasm
      const allHex = combinedList.map((x) => materializeExtrinsicHex(registryAt, x, signCtx))
      const calls: [string, HexString[]][] = [
        ['Core_initialize_block', [header.toHex()]],
        ...allHex.map((hex) => ['BlockBuilder_apply_extrinsic', [hex]] as [string, HexString[]]),
        ['BlockBuilder_finalize_block', []],
      ]

      const result = await runTask(
        { wasm, calls, mockSignatureHost: true, allowUnresolvedImports: false, runtimeLogLevel: 5 },
        taskHandler(parent),
      )

      if ('Error' in result) throw new Error(result.Error)
      const diff = await decodeStorageDiff(parent, result.Call.storageDiff)
      setStorageDiff(diff)
      setMessageText('')
    } catch (e: any) {
      console.error(e)
      setMessageText('Dry-run failed')
    } finally {
      setIsLoading(false)
    }
  }, [api, blockInfo, endpoint, wasmOverride, combinedList])

  /* --------------------------------- render --------------------------------- */

  return (
    <div>
      <Form
        form={form}
        onFinish={fetchBlockAndAppendExtras}
        initialValues={{ blockNumber: 'latest' }}
        disabled={isLoading}
        layout="vertical"
      >
        <Space align="end" wrap>
          <Form.Item label="Block Number" name="blockNumber" tooltip="Use 'latest' or specify a block number">
            <Input style={{ width: 220 }} placeholder="latest or a number" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                Run (fetch & dry-run)
              </Button>
              <Tooltip title="Re-run using the current list (no refetch)">
                <Button onClick={dryRunCurrentList} disabled={!blockInfo}>
                  Dry-run current list
                </Button>
              </Tooltip>
            </Space>
          </Form.Item>

          <Form.Item>
            <Space>
              <Spin spinning={isLoading} />
              <Typography.Text>{messageText}</Typography.Text>
            </Space>
          </Form.Item>
        </Space>

        {blockInfo && (
          <Form.Item>
            <Space direction="vertical" size={0}>
              <Typography.Text strong>Block #</Typography.Text>
              <Typography.Text>{blockInfo.number}</Typography.Text>
              <Typography.Text strong>Hash</Typography.Text>
              <Typography.Text code>{blockInfo.hash}</Typography.Text>
            </Space>
          </Form.Item>
        )}
      </Form>

      {/* ---------- Stage extras before the first Run (and anytime) ---------- */}
      <Card size="small" title="Add extra hex extrinsics (one per line)">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input.TextArea rows={3} value={pasteInput} placeholder="0x....\n0x...." onChange={(e) => setPasteInput(e.target.value)} />
          <Space>
            <Button onClick={addPastedExtras} disabled={!pasteInput.trim()}>
              Add
            </Button>
            <Popconfirm title="Clear all staged extras?" onConfirm={clearExtras} okButtonProps={{ danger: true }}>
              <Button danger>Clear extras</Button>
            </Popconfirm>
          </Space>
        </Space>
      </Card>

      <Divider />

      {/* -------------------------- Editable decoded list -------------------------- */}
      <Card size="small" title="Extrinsics (block + extras)">
        <div style={{ maxHeight: 460, overflow: 'auto' }}>
          <Collapse accordion bordered={false} expandIconPosition="right">
            {combinedList.map((item, idx) => {
              const headerLeft = `${idx}: ${item.methodName ?? (item.error ? 'Decode error' : 'Unknown method')}`
              const isExtra = item.source === 'extra'
              const header = (
                <Space>
                  <span>{headerLeft}</span>
                  {isExtra ? <Tag color="green">extra</Tag> : <Tag color="blue">block</Tag>}
                  {item.edited && <Tag color="gold">edited</Tag>}
                  {item.error && <Tag color="red">error</Tag>}
                </Space>
              )
              return (
                <Panel
                  key={item.id}
                  header={header}
                  style={{
                    padding: 0,
                    background: isExtra ? 'rgba(0,128,0,0.06)' : undefined,
                    borderRadius: 8,
                    border: isExtra ? '1px solid rgba(0,128,0,0.15)' : '1px solid rgba(0,0,0,0.06)',
                    marginBottom: 8,
                  }}
                  extra={
                    <Space>
                      <Tooltip title="Re-decode">
                        <Button
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation()
                            forceDecode(item.id)
                          }}
                        >
                          Decode
                        </Button>
                      </Tooltip>
                      <Popconfirm
                        title="Remove this extrinsic?"
                        onConfirm={(e) => {
                          e?.stopPropagation()
                          removeItem(item.id)
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                      >
                        <Button size="small" danger onClick={(e) => e.stopPropagation()}>
                          Remove
                        </Button>
                      </Popconfirm>
                    </Space>
                  }
                >
                  <div style={{ padding: 12 }}>
                    <Typography.Text type="secondary">Hex</Typography.Text>
                    <Input.TextArea
                      rows={3}
                      value={item.hex}
                      onChange={(e) => updateItemHex(item.id, e.target.value)}
                      onBlur={(e) => updateItemHex(item.id, e.target.value)}
                    />
                    {item.error ? (
                      <Alert style={{ marginTop: 8 }} type="error" message={item.error} showIcon />
                    ) : (
                      <div style={{ marginTop: 12 }}>
                        <Typography.Text type="secondary">Decoded</Typography.Text>
                        <JSONTree
                          data={{ ...(item.human ?? {}), hex: item.hex }}
                          hideRoot={true}
                          shouldExpandNodeInitially={(keyPath) => keyPath.length <= 1 && keyPath[0] !== 'hex'}
                          theme="monokai"
                          invertTheme={true}
                        />
                      </div>
                    )}
                    <Space style={{ marginTop: 8 }} wrap>
                      <Typography.Text type="secondary">Origin</Typography.Text>
                      <select
                        value={item.originMode}
                        onChange={(e) => setItemOriginMode(item.id, e.target.value as OriginMode)}
                        style={{ padding: 4 }}
                      >
                        <option value="unsigned">Unsigned</option>
                        <option value="signed">Signed</option>
                      </select>

                      {item.originMode === 'signed' && (
                        <Input
                          style={{ width: 360 }}
                          placeholder="ss58 address"
                          value={item.originAddress}
                          onChange={(e) => setItemOriginAddress(item.id, e.target.value)}
                        />
                      )}

                      {item.source === 'block' && item.originAddress && <Tag>derived: {item.originAddress.slice(0, 10)}…</Tag>}
                    </Space>
                  </div>
                </Panel>
              )
            })}
          </Collapse>
        </div>
      </Card>

      <Divider />

      {storageDiff && <DiffViewer {...storageDiff} />}
    </div>
  )
}

export default React.memo(DryRunExtrinsic)
