import type { ApiPromise } from '@polkadot/api'
import { hexToBn } from '@polkadot/util'
import { Button, Card, Col, Form, Input, InputNumber, List, Row, Select, Typography, message } from 'antd'
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
  ValidatorId: {
    x: 'AccountId',
  },
}

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
  const [channels, setChannels] = useState<string[]>([])
  const [channelId, setChannelId] = useState<string>('')
  const [range, setRange] = useState<number>(10000)
  const [searching, setSearching] = useState<boolean>(false)
  const [changes, setChanges] = useState<ChangeItem[]>([])
  const [currentNonce, setCurrentNonce] = useState<number | null>(null)

  // Load available channels on mount
  useEffect(() => {
    api.registry.register(customTypes)
    const loadChannels = async () => {
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
    }
    loadChannels()
  }, [api, channelId])

  // Whenever channelId changes, fetch its current nonce
  useEffect(() => {
    if (!channelId) {
      setCurrentNonce(null)
      return
    }

    // async wrapper so we can use await
    const fetchCurrentNonce = async () => {
      try {
        // 1) Get the latest block number
        const head = (await api.query.system.number()).toNumber()
        // 2) Grab its hash
        const hash = await api.rpc.chain.getBlockHash(head)
        // 3) Compute the storage key for this channel’s nonce
        const keyHex = api.query.ethereumInboundQueue.nonce.key(channelId)
        // 4) Read raw bytes from storage
        const raw = await api.rpc.state.getStorage(keyHex, hash)
        const hex = raw?.toHex() || '0x'
        // 5) Decode exactly as you do in your scan routine:
        const nonceHex = hex.slice(0, 18)
        const nonce = Number(hexToBn(nonceHex, { isLe: true }).toString())
        setCurrentNonce(nonce)
      } catch (err: any) {
        message.error(err.message || 'Failed to load current nonce')
        setCurrentNonce(null)
      }
    }

    fetchCurrentNonce()
  }, [api, channelId])

  const findAllChanges = useCallback(async () => {
    if (!channelId) {
      return message.error('Select a channel')
    }
    setSearching(true)
    setChanges([])

    try {
      // 1) figure out your window
      const head = (await api.query.system.number()).toNumber()
      const from = Math.max(0, head - range)

      // 2) give me back the raw hex at any block
      const keyHex = api.query.ethereumInboundQueue.nonce.key(channelId)
      const read = async (block: number): Promise<string> => {
        const hash = await api.rpc.chain.getBlockHash(block)
        const raw = await api.rpc.state.getStorage(keyHex, hash)
        return raw?.toHex() ?? '0x'
      }

      // helper to read any storage key at a given block
      const findEthOutboundSubmit = async (block: number, nonce: number): Promise<any> => {
        const hash = await api.rpc.chain.getBlockHash(block)
        const blockE = await api.rpc.chain.getBlock(hash)
        const extrs = await blockE.block.extrinsics

        const iface = new Interface([
          'event OutboundMessageAccepted(bytes32 indexed channel_id, uint64 nonce, bytes32 indexed message_id, bytes payload)',
        ])

        // TODO: assuming there is only 1 submit per block, may be more
        for (const [index, extrinsic] of extrs.entries()) {
          const { section, method } = extrinsic.method
          if (section === 'ethereumInboundQueue' && method === 'submit') {
            const message = extrinsic.args[0]
            const { eventLog } = message.toJSON()
            const decodedEvent = iface.decodeEventLog('OutboundMessageAccepted', eventLog.data, eventLog.topics)

            //https://github.com/moondance-labs/tanssi-bridge-relayer/blob/247bc96365c5f8a9cdbcf3fae09a8ede79ac4c91/overridden_contracts/src/libraries/OSubstrateTypes.sol#L41
            const MAGIC_BYTES = '0x70150038'

            if (decodedEvent.payload.startsWith(MAGIC_BYTES)) {
              // A bit hard to decode since the type is not part of metadata
              const payload = api.registry.createType('Payload', decodedEvent.payload)
              return { messageHex: payload.toHex(), messageJson: payload.toJSON() }
            }

            const versioned = api.registry.createType('VersionedXcmMessage', decodedEvent.payload)
            return { messageHex: versioned.toHex(), messageJson: versioned.toJSON() }
          }
        }

        return { messageHex: '0x', messageJson: {} }
      }

      // 3) correctly split nonce vs. message, now async
      const decode = async (block: number, packedHex: string): Promise<ChangeItem> => {
        // strip 0x and pull off the first 16 chars → 8-byte LE nonce
        const raw = packedHex.startsWith('0x') ? packedHex.slice(2) : packedHex
        const nonceHex = raw.slice(0, 16)
        const nonce = Number(hexToBn(`0x${nonceHex}`, { isLe: true }).toString())

        // fetch the message at exactly this block
        const { messageHex, messageJson } = await findEthOutboundSubmit(block, nonce)

        return { block, nonce, messageHex, messageJson }
      }

      // 4) binary-search only the ranges that actually changed
      const results: ChangeItem[] = []
      const walk = async (low: number, high: number, lowHex: string, highHex: string) => {
        // no change at all → skip
        if (lowHex === highHex) return

        // adjacent blocks with a change → record it
        if (high - low <= 1) {
          results.push(await decode(high, highHex))
          results.sort((a, b) => -(a.block - b.block))
          setChanges(results)
          return
        }

        const mid = Math.floor((low + high) / 2)
        const midHex = await read(mid)

        // if [mid,high] saw any change, recurse there
        await walk(mid, high, midHex, highHex)
        // if [low,mid] saw any change, recurse there
        await walk(low, mid, lowHex, midHex)
      }

      // kick off with the endpoints
      const lowHex = await read(from)
      const highHex = await read(head)
      await walk(from, head, lowHex, highHex)

      // 5) sort and render (redundant)
      results.sort((a, b) => -(a.block - b.block))
      setChanges(results)
    } catch (err: any) {
      message.error(err.message || 'Error fetching changes')
    } finally {
      setSearching(false)
    }
  }, [api, channelId, range])

  return (
    <Card>
      <Typography.Title level={4}>Snowbridge Inbound Changes</Typography.Title>
      <Form layout="vertical">
        <Row gutter={16} align="bottom">
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
          <Col span={8}>
            <Form.Item label="Blocks Range">
              <InputNumber value={range} onChange={(value) => setRange(value || 0)} min={1} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item>
              <Button type="primary" onClick={findAllChanges} loading={searching} disabled={!api || !channelId} block>
                Find Recent Changes
              </Button>
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
                      <Input.TextArea value={item.messageHex} autoSize={{ minRows: 1, maxRows: 4 }} readOnly />
                      <div style={{ marginTop: 16, maxHeight: 400, overflow: 'auto' }}>
                        <JSONTree
                          data={item.messageJson}
                          hideRoot={true}
                          shouldExpandNodeInitially={() => true}
                          theme={theme}
                          invertTheme={false}
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
