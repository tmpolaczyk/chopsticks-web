import type { ApiPromise } from '@polkadot/api'
import { hexToBn } from '@polkadot/util'
import { Button, Card, Col, Form, Input, InputNumber, List, Radio, Row, Select, Typography, message } from 'antd'
import { Interface } from 'ethers'
import React, { useState, useCallback, useEffect } from 'react'
import { JSONTree } from 'react-json-tree'
import { BlockDate } from './BlockDate'

export interface SnowbridgeInboundSubmitProps {
  /** Polkadot API instance */
  api: ApiPromise
}

interface ChangeItem {
  block: number
  nonce: number
  messageHex: string
  messageJson: any
}

const customTypes = {
  VersionedXcmMessage: {
    _enum: {
      V1: 'MessageV1',
    },
  },
  MessageV1: {
    chain_id: 'u64',
    command: 'Command',
  },
  Command: {
    _enum: {
      RegisterToken: 'RegisterToken',
      SendToken: 'SendToken',
      SendNativeToken: 'SendNativeToken',
    },
  },
  RegisterToken: {
    token: 'H160',
    fee: 'u128',
  },
  SendToken: {
    token: 'H160',
    destination: 'Destination',
    amount: 'u128',
    fee: 'u128',
  },
  SendNativeToken: {
    token_id: 'TokenId',
    destination: 'Destination',
    amount: 'u128',
    fee: 'u128',
  },
  Destination: {
    _enum: {
      AccountId32: 'AccountId',
    },
  },
  TokenId: 'H256',
  Payload: {
    magic_bytes: '[u8; 4]',
    message: 'Message',
  },
  Message: {
    _enum: {
      V1: 'InboundCommand',
    },
  },
  InboundCommand: {
    _enum: {
      ReceiveValidators: 'ReceiveValidators',
    },
  },
  ReceiveValidators: {
    validators: 'Vec<ValidatorId>',
    external_index: 'u64',
  },
  ValidatorId: 'AccountId',
}

const iface = new Interface([
  'event OutboundMessageAccepted(bytes32 indexed channel_id, uint64 nonce, bytes32 indexed message_id, bytes payload)',
])

const theme = {
  /* …monokai theme… */
}

// constants for your two windows
const BLOCK_WINDOW = 10_000
const NONCE_WINDOW = 5

const SnowbridgeInboundSubmit: React.FC<SnowbridgeInboundSubmitProps> = ({ api }) => {
  // === STATE ===
  const [mode, setMode] = useState<'change' | 'number'>('change')
  const [channels, setChannels] = useState<string[]>([])
  const [channelId, setChannelId] = useState<string>('')
  const [currentNonce, setCurrentNonce] = useState<number | null>(null)
  const [head, setHead] = useState<number>(0)
  const [searching, setSearching] = useState(false)
  const [changes, setChanges] = useState<ChangeItem[]>([])

  // === LOAD CHANNELS & REGISTER TYPES ===
  useEffect(() => {
    api.registry.register(customTypes)
    ;(async () => {
      try {
        const entries = await api.query.ethereumInboundQueue.nonce.entries()
        const ids = entries.map(([key]) => (key.args[0] as any).toHex())
        ids.sort()
        setChannels(ids)
        if (ids.length && !channelId) {
          setChannelId(ids[0])
        }
      } catch (err: any) {
        message.error(err.message || 'Failed to load channels')
      }
    })()
  }, [api, channelId])

  // === SUBSCRIBE HEAD & FETCH CURRENT NONCE ===
  useEffect(() => {
    let unsubHeads: any
    ;(async () => {
      // initial
      const h = (await api.query.system.number()).toNumber()
      setHead(h)
      // subscribe
      unsubHeads = await api.rpc.chain.subscribeNewHeads((header) => {
        setHead(header.number.toNumber())
      })
    })()

    // current nonce
    if (channelId) {
      ;(async () => {
        try {
          const headNum = (await api.query.system.number()).toNumber()
          const hash = await api.rpc.chain.getBlockHash(headNum)
          const key = api.query.ethereumInboundQueue.nonce.key(channelId)
          const raw = await api.rpc.state.getStorage(key, hash)
          const hex = raw?.toHex() || '0x'
          const nonce = Number(hexToBn(hex.slice(0, 18), { isLe: true }).toString())
          setCurrentNonce(nonce)
        } catch (err: any) {
          message.error(err.message || 'Failed to load current nonce')
          setCurrentNonce(null)
        }
      })()
    } else {
      setCurrentNonce(null)
    }

    return () => {
      unsubHeads?.()
    }
  }, [api, channelId])

  // === HELPERS ===
  const readStorageAt = useCallback(
    async (block: number): Promise<string> => {
      const hash = await api.rpc.chain.getBlockHash(block)
      const key = api.query.ethereumInboundQueue.nonce.key(channelId)
      const raw = await api.rpc.state.getStorage(key, hash)
      return raw?.toHex() ?? '0x'
    },
    [api, channelId],
  )

  const decodeAt = useCallback(
    async (block: number, packedHex: string): Promise<ChangeItem> => {
      // strip off the 8-byte LE nonce
      const raw = packedHex.startsWith('0x') ? packedHex.slice(2) : packedHex
      const nonce = Number(hexToBn(`0x${raw.slice(0, 16)}`, { isLe: true }).toString())

      // now find the actual submit extrinsic in that block
      const hash = await api.rpc.chain.getBlockHash(block)
      const blockE = await api.rpc.chain.getBlock(hash)
      for (const extrinsic of blockE.block.extrinsics) {
        const { section, method } = extrinsic.method
        if (section === 'ethereumInboundQueue' && method === 'submit') {
          const msg = extrinsic.args[0]
          const { eventLog } = (msg as any).toJSON()
          const decoded = iface.decodeEventLog('OutboundMessageAccepted', eventLog.data, eventLog.topics)
          const MAGIC = '0x70150038'
          if (decoded.payload.startsWith(MAGIC)) {
            const payload = api.registry.createType('Payload', decoded.payload)
            return {
              block,
              nonce,
              messageHex: payload.toHex(),
              messageJson: payload.toJSON(),
            }
          }
          const ver = api.registry.createType('VersionedXcmMessage', decoded.payload)
          return {
            block,
            nonce,
            messageHex: ver.toHex(),
            messageJson: ver.toJSON(),
          }
        }
      }
      // no submit here
      return { block, nonce, messageHex: '0x', messageJson: {} }
    },
    [api],
  )

  // === SEARCHER ===
  const findAllChanges = useCallback(async () => {
    if (!channelId) {
      return message.error('Select a channel')
    }
    if (mode === 'number' && currentNonce === null) {
      return message.error('Waiting on current nonce…')
    }

    setSearching(true)
    setChanges([])

    try {
      const headNum = (await api.query.system.number()).toNumber()

      if (mode === 'change') {
        // ───── block‐range mode ─────
        const from = Math.max(0, headNum - BLOCK_WINDOW)
        // binary‐search existing logic…
        const results: ChangeItem[] = []
        const lowHex = await readStorageAt(from)
        const highHex = await readStorageAt(headNum)

        const walk = async (low: number, high: number, lowHex: string, highHex: string): Promise<void> => {
          if (lowHex === highHex) return
          if (high - low <= 1) {
            const itm = await decodeAt(high, highHex)
            results.push(itm)
            results.sort((a, b) => b.block - a.block)
            setChanges([...results])
            return
          }
          const mid = Math.floor((low + high) / 2)
          const midHex = await readStorageAt(mid)
          await walk(mid, high, midHex, highHex)
          await walk(low, mid, lowHex, midHex)
        }

        await walk(from, headNum, lowHex, highHex)
        results.sort((a, b) => b.block - a.block)
        setChanges(results)
      } else {
        // ───── nonce-range mode (binary search) ─────
        const lowNonceBound = Math.max(0, currentNonce! - NONCE_WINDOW)
        const highNonceBound = Math.max(0, currentNonce!)
        const results: ChangeItem[] = []

        // we search [0 … headNum], just like blocks
        const from = 0
        const lowHex = await readStorageAt(from)
        const highHex = await readStorageAt(headNum)

        const walkNonce = async (low: number, high: number, lowHex: string, highHex: string): Promise<void> => {
          // decode the LE-nonce from each endpoint
          const strip = (h: string) => (h.startsWith('0x') ? h.slice(2) : h)
          const lowNonce = Number(hexToBn(`0x${strip(lowHex).slice(0, 16)}`, { isLe: true }).toString())
          const highNonce = Number(hexToBn(`0x${strip(highHex).slice(0, 16)}`, { isLe: true }).toString())

          // if even the HIGH end is ≤ our lower-nonce bound, nothing here can qualify
          if (highNonce < lowNonceBound) {
            return
          }
          if (lowNonce > highNonceBound) {
            return
          }

          // no change at all → skip
          if (lowHex === highHex) {
            return
          }

          // adjacent → check it
          if (high - low <= 1) {
            const itm = await decodeAt(high, highHex)
            if (itm.nonce > lowNonceBound) {
              results.push(itm)
              results.sort((a, b) => b.block - a.block)
              setChanges([...results])
            }
            return
          }

          // otherwise split in two
          const mid = Math.floor((low + high) / 2)
          const midHex = await readStorageAt(mid)
          await walkNonce(mid, high, midHex, highHex)
          await walkNonce(low, mid, lowHex, midHex)
        }

        await walkNonce(from, headNum, lowHex, highHex)

        // final sort & render
        results.sort((a, b) => b.block - a.block)
        setChanges(results)
      }
    } catch (err: any) {
      message.error(err.message || 'Error fetching changes')
    } finally {
      setSearching(false)
    }
  }, [api, channelId, mode, currentNonce, decodeAt, readStorageAt])

  // === RENDER ===
  return (
    <Card>
      <Typography.Title level={4}>Snowbridge Inbound Changes</Typography.Title>
      <Form layout="vertical">
        <Row gutter={16} align="bottom">
          {/* --- CHANNEL --- */}
          <Col span={8}>
            <Form.Item label="Channel">
              <Select
                value={channelId}
                onChange={setChannelId}
                placeholder="Select channel"
                loading={!channels.length}
                disabled={!channels.length}
                style={{ width: '100%' }}
              >
                {channels.map((id) => (
                  <Select.Option key={id} value={id}>
                    {id}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>

          {/* --- MODE --- */}
          <Col span={8}>
            <Form.Item label="Search Mode">
              <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
                <Radio.Button value="change">Last Change</Radio.Button>
                <Radio.Button value="number">By Number</Radio.Button>
              </Radio.Group>
            </Form.Item>
          </Col>

          {/* --- FIND BUTTON --- */}
          <Col span={8}>
            <Form.Item>
              <Button type="primary" onClick={findAllChanges} loading={searching} disabled={!api || !channelId} block>
                Find Recent Changes
              </Button>
            </Form.Item>
          </Col>
        </Row>
        {/* range display, constrained to max-width so it doesn’t span 100% */}
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label={mode === 'change' ? 'Block Range' : 'Nonce Range'}>
              <div style={{ maxWidth: 400 }}>
                <Input.Group compact>
                  <InputNumber
                    style={{ width: '45%' }}
                    value={
                      mode === 'change'
                        ? Math.max(0, head - BLOCK_WINDOW)
                        : currentNonce !== null
                          ? Math.max(0, currentNonce - NONCE_WINDOW)
                          : undefined
                    }
                    readOnly
                  />
                  <Input style={{ width: '45%', marginLeft: '10%' }} value="latest" readOnly />
                </Input.Group>
              </div>
            </Form.Item>
          </Col>
        </Row>
      </Form>

      {/* If no changes found (yet) show the current nonce */}
      {currentNonce != null && (
        <Typography.Paragraph style={{ marginTop: 16 }}>
          <strong>Current Nonce:</strong> {currentNonce}
        </Typography.Paragraph>
      )}

      {changes.length > 0 && (
        <List
          header={<strong>Changes Found ({changes.length})</strong>}
          bordered
          dataSource={changes}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                title={`Block #${item.block}`}
                description={
                  <>
                    <Typography.Text>Nonce: {item.nonce}</Typography.Text>
                    <Form.Item label="Encoded Message" style={{ marginTop: 8 }}>
                      <Input style={{ width: '85%' }} value={item.messageHex} readOnly />
                      <div style={{ marginTop: 16, maxHeight: 400, overflow: 'auto' }}>
                        <JSONTree
                          data={item.messageJson}
                          hideRoot={true}
                          shouldExpandNodeInitially={() => true}
                          theme={theme}
                          invertTheme={true}
                        />
                      </div>
                    </Form.Item>
                    <Typography.Text type="secondary">
                      <BlockDate api={api} blockNumber={item.block} />
                    </Typography.Text>
                  </>
                }
              />
            </List.Item>
          )}
          style={{ marginTop: 16 }}
        />
      )}
    </Card>
  )
}

export default React.memo(SnowbridgeInboundSubmit)
