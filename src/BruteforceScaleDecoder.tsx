import type { ApiPromise } from '@polkadot/api'
import { hexToU8a } from '@polkadot/util'
import { Button, Card, Divider, Input, Spin, Typography, message } from 'antd'
import React, { useState } from 'react'
import { JSONTree } from 'react-json-tree'

export interface BruteforceScaleDecoderProps {
  api: ApiPromise
}

const BruteforceScaleDecoder: React.FC<BruteforceScaleDecoderProps> = ({ api }) => {
  const [hexInput, setHexInput] = useState<string>('')
  const [results, setResults] = useState<Map<number, { type: string; value: any }>>(new Map())
  const [loading, setLoading] = useState<boolean>(false)

  const decodeAll = async () => {
    if (!hexInput.match(/^0x[0-9a-fA-F]*$/)) {
      return message.error('Please enter a valid hex string (prefix with 0x).')
    }

    setLoading(true)
    setResults(new Map())

    try {
      const u8a = hexToU8a(hexInput)
      const lookup = api.registry.lookup
      const maxId = lookup.getSiType.length
        ? // some versions expose types array
          (lookup as any).types.length
        : // fallback: scan upward until exception
          0

      const successes: Map<number, { type: string; value: any }> = new Map()

      // If we have types[], use its length; otherwise guess up to 1024
      const upper = maxId || 9999999

      for (let id = 0; id < upper; id++) {
        let siType: any
        try {
          siType = lookup.getSiType(id)
        } catch {
          // ran past the end
          break
        }
        // only named types (skip anonymous internals)
        // TODO: I would like to try anonymous types as well, but what do I need to pass to `createType` ?
        const typeName = lookup.getName(id)
        if (typeName === undefined) {
          continue
        }
        try {
          // Decode type from hex input
          const decoded = api.registry.createType(typeName, hexInput)

          // The problem with createType is that 0x (empty) decodes as valid type for all types, there is no equivalent to
          // DecodeAll trait. So we decode, encode again and check if hex is equal.
          const encodedAgain = decoded.toHex()
          // Some types encoding is defined as Wrapper(Vec<u8>). These types can decode any hex input, and they
          // encode to themselves (SpRuntimeOpaqueValue, SpCoreOpaqueMetadata, PolkadotParachainPrimitivesPrimitivesHeadData, etc).
          // We skip those since all hex values can be decoded as that, and the decoded value does not give any info.
          if (encodedAgain === hexInput) {
            const humanDecoded = decoded.toHuman()
            if (humanDecoded !== hexInput) {
              successes.set(id, { type: typeName, value: humanDecoded })
            }
          }
        } catch {
          // not decodable as this type
        }
      }

      setResults(successes)
      if (successes.size === 0) {
        message.info('No registered type could decode that payload.')
      }
    } catch (err: any) {
      message.error(`Unexpected error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <Typography.Title level={4}>Bruteforce SCALE Decoder</Typography.Title>

      <Input.TextArea
        rows={3}
        placeholder="0x…"
        value={hexInput}
        onChange={(e) => setHexInput(e.target.value.trim())}
        disabled={loading}
        style={{ fontFamily: 'monospace', marginBottom: 12 }}
      />

      <Button type="primary" onClick={decodeAll} disabled={loading || hexInput.length < 2}>
        {loading ? <Spin size="small" /> : 'Decode All'}
      </Button>

      <Divider />

      <Typography.Text>
        {loading ? 'Decoding…' : `Found ${results.size} successful decoding${results.size !== 1 ? 's' : ''}.`}
      </Typography.Text>

      <div style={{ maxHeight: 500, overflow: 'auto', marginTop: 12 }}>
        <JSONTree data={results} hideRoot={true} shouldExpandNodeInitially={() => true} theme="monokai" invertTheme={true} />
      </div>
    </Card>
  )
}

export default React.memo(BruteforceScaleDecoder)
