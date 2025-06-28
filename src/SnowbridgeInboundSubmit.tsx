import type { ApiPromise } from '@polkadot/api'
import { hexToBn } from '@polkadot/util'
import { Button, Card, Col, Form, Input, InputNumber, List, Row, Select, Typography, message } from 'antd'
import { Interface } from 'ethers'
import React, { useState, useCallback, useEffect, useRef } from 'react'
import { JSONTree } from 'react-json-tree'
import { BlockDate } from './BlockDate'

export interface SnowbridgeInboundSubmitProps {
  /** Polkadot API instance */
  api: ApiPromise
}

interface ChangeItem {
  channel: string
  block: number
  nonce: number
  messageHex: string
  messageJson: any
}

// derive a color based on channel id
const getColor = (ch: string) => {
  // Grab last 4 chars (or fewer, if the string is shorter)
  const tail = ch.slice(-4)

  let val = 0
  for (let i = 0; i < tail.length; i++) {
    val = (val * 31 + tail.charCodeAt(i)) >>> 0
  }

  const hue = val % 360
  return `hsl(${hue}, 70%, 80%)`
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
  scheme: 'monokai',
  base00: '#272822',
  base01: '#383830',
  base02: '#49483e',
  base03: '#75715e',
  base04: '#a59f85',
  base05: '#f8f8f2',
  base06: '#f5f4f1',
  base07: '#f9f8f5',
  base08: '#f92672',
  base09: '#fd971f',
  base0A: '#f4bf75',
  base0B: '#a6e22e',
  base0C: '#a1efe4',
  base0D: '#66d9ef',
  base0E: '#ae81ff',
  base0F: '#cc6633',
}

const SnowbridgeInboundSubmit: React.FC<SnowbridgeInboundSubmitProps> = ({ api }) => {
  // === STATE ===
  const [channels, setChannels] = useState<string[]>([])
  const [channelId, setChannelId] = useState<string>('*')
  const [currentNonce, setCurrentNonce] = useState<number | null>(null)
  const [searching, setSearching] = useState(false)
  const [changes, setChanges] = useState<ChangeItem[]>([])
  const didRegisterRef = useRef(false)
  const [rangeStart, setRangeStart] = useState<number | undefined>()
  const [rangeEnd, setRangeEnd] = useState<number | undefined>()
  const [nonceStart, setNonceStart] = useState<number | undefined>(0)
  const [nonceEnd, setNonceEnd] = useState<number | undefined>()

  // === LOAD CHANNELS & REGISTER TYPES ===
  useEffect(() => {
    if (didRegisterRef.current) {
      return
    }
    didRegisterRef.current = true
    api.registry.register(customTypes)
    ;(async () => {
      try {
        const entries = await api.query.ethereumInboundQueue.nonce.entries()
        const ids = entries.map(([key]) => (key.args[0] as any).toHex()).sort()
        setChannels(ids)
      } catch (err: any) {
        message.error(err.message || 'Failed to load channels')
      }
    })()
    ;(async () => {
      const h = (await api.query.system.number()).toNumber()
      setRangeStart(h - 10_000)
    })()
  }, [api])

  // fetch head and nonce
  useEffect(() => {
    if (channelId && channelId !== '*') {
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
  }, [api, channelId])

  // === HELPERS ===
  const readStorageAt = useCallback(
    async (ch: string, block: number): Promise<string> => {
      const hash = await api.rpc.chain.getBlockHash(block)
      const key = api.query.ethereumInboundQueue.nonce.key(ch)
      const raw = await api.rpc.state.getStorage(key, hash)
      return raw?.toHex() ?? '0x'
    },
    [api],
  )

  const decodeAt = useCallback(
    async (ch: string, block: number, packedHex: string): Promise<ChangeItem> => {
      const raw = packedHex.startsWith('0x') ? packedHex.slice(2) : packedHex
      const nonce = Number(hexToBn(`0x${raw.slice(0, 16)}`, { isLe: true }).toString())
      const hash = await api.rpc.chain.getBlockHash(block)
      const blockE = await api.rpc.chain.getBlock(hash)
      for (const extrinsic of blockE.block.extrinsics) {
        const { section, method } = extrinsic.method
        if (section === 'ethereumInboundQueue' && method === 'submit') {
          const msg = extrinsic.args[0]
          const { eventLog } = (msg as any).toJSON()
          const decoded = iface.decodeEventLog('OutboundMessageAccepted', eventLog.data, eventLog.topics)
          const MAGIC = '0x70150038'
          let messageType: any
          if (decoded.payload.startsWith(MAGIC)) {
            messageType = api.registry.createType('Payload', decoded.payload)
          } else {
            messageType = api.registry.createType('VersionedXcmMessage', decoded.payload)
          }
          return {
            channel: ch,
            block,
            nonce,
            messageHex: messageType.toHex(),
            messageJson: messageType.toJSON(),
          }
        }
      }
      return { channel: ch, block, nonce, messageHex: '0x', messageJson: {} }
    },
    [api],
  )

  // === SEARCHER ===
  const findAllChanges = useCallback(async () => {
    if (!channelId) {
      return message.error('Select a channel')
    }
    if (channelId !== '*' && currentNonce === null) {
      return message.error('Waiting on current nonce…')
    }

    setSearching(true)
    setChanges([])

    try {
      const headNum = (await api.query.system.number()).toNumber()
      const results: ChangeItem[] = []
      const targets = channelId === '*' ? channels : [channelId]

      for (const ch of targets) {
        // ignore nonce when searching all channels
        if (channelId === '*') {
          const from = rangeStart || 0
          const to = rangeEnd === undefined ? headNum : rangeEnd
          const lowHex = await readStorageAt(ch, from)
          const highHex = await readStorageAt(ch, to)

          const walk = async (low: number, high: number, lowHexVal: string, highHexVal: string): Promise<void> => {
            if (lowHexVal === highHexVal) return
            if (high - low <= 1) {
              const itm = await decodeAt(ch, high, highHexVal)
              results.push(itm)
              setChanges([...results].sort((a, b) => b.block - a.block))
              return
            }
            const mid = Math.floor((low + high) / 2)
            const midHex = await readStorageAt(ch, mid)
            await walk(mid, high, midHex, highHexVal)
            await walk(low, mid, lowHexVal, midHex)
          }

          await walk(from, to, lowHex, highHex)
        } else {
          // nonce-based search only for specific channel
          const lowNonceBound = nonceStart || 0
          const highNonceBound = nonceEnd || currentNonce
          const from = rangeStart || 0
          const to = rangeEnd === undefined ? headNum : rangeEnd
          const lowHex = await readStorageAt(ch, from)
          const highHex = await readStorageAt(ch, to)

          const walkNonce = async (low: number, high: number, lowHexVal: string, highHexVal: string): Promise<void> => {
            const strip = (h: string) => (h.startsWith('0x') ? h.slice(2) : h)
            const lowNonce = Number(hexToBn(`0x${strip(lowHexVal).slice(0, 16)}`, { isLe: true }).toString())
            const highNonce = Number(hexToBn(`0x${strip(highHexVal).slice(0, 16)}`, { isLe: true }).toString())
            if (highNonce < lowNonceBound || lowNonce > highNonceBound) return
            if (lowHexVal === highHexVal) return
            if (high - low <= 1) {
              const itm = await decodeAt(ch, high, highHexVal)
              if (itm.nonce > lowNonceBound) {
                results.push(itm)
                setChanges([...results].sort((a, b) => b.block - a.block))
              }
              return
            }
            const mid = Math.floor((low + high) / 2)
            const midHex = await readStorageAt(ch, mid)
            await walkNonce(mid, high, midHex, highHexVal)
            await walkNonce(low, mid, lowHexVal, midHex)
          }

          console.log('Starting walkNonce. Bounds: ', lowNonceBound, highNonceBound)

          await walkNonce(from, to, lowHex, highHex)
        }
      }

      setChanges(results.sort((a, b) => b.block - a.block))
    } catch (err: any) {
      message.error(err.message || 'Error fetching changes')
    } finally {
      setSearching(false)
    }
  }, [api, channelId, currentNonce, channels, readStorageAt, decodeAt, nonceStart, nonceEnd, rangeStart, rangeEnd])

  // === RENDER ===
  return (
    <Card>
      <Typography.Title level={4}>Snowbridge Inbound Changes</Typography.Title>
      <Form layout="vertical">
        <Row gutter={16} align="bottom">
          <Col span={8}>
            <Form.Item label="Channel">
              <Select value={channelId} onChange={setChannelId} style={{ width: '100%' }} loading={!channels.length}>
                <Select.Option value="*">All Channels</Select.Option>
                {channels.map((id) => (
                  <Select.Option key={id} value={id}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        backgroundColor: getColor(id),
                        marginRight: 8,
                        borderRadius: 2,
                        verticalAlign: 'middle',
                      }}
                    />
                    {id}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>

          <Col span={8}>
            <Form.Item>
              <Button type="primary" onClick={findAllChanges} loading={searching} disabled={!channelId} block>
                Find Messages
              </Button>
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label={'Block Range'}>
              <div style={{ maxWidth: 400 }}>
                <Input.Group compact>
                  <InputNumber style={{ width: '45%' }} value={rangeStart} onChange={setRangeStart} />
                  <Input
                    style={{ width: '45%', marginLeft: '10%' }}
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value.trim())}
                  />
                </Input.Group>
              </div>
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label={'Nonce Range'}>
              <div style={{ maxWidth: 400 }}>
                <Input.Group compact>
                  <InputNumber style={{ width: '45%' }} value={nonceStart} onChange={setNonceStart} />
                  <Input
                    style={{ width: '45%', marginLeft: '10%' }}
                    value={nonceEnd}
                    onChange={(e) => setNonceEnd(e.target.value.trim())}
                  />
                </Input.Group>
              </div>
            </Form.Item>
          </Col>
        </Row>
      </Form>

      {currentNonce != null && channelId !== '*' && (
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
            <List.Item style={{ borderLeft: `4px solid ${getColor(item.channel)}` }}>
              <List.Item.Meta
                title={`Block #${item.block} — Channel ${item.channel}`}
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
