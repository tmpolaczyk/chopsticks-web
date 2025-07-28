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
        const typeName = lookup.getName(id)
        if (typeName === undefined) {
          continue
        }
        try {
          // TODO: this doesnt work, and I want to also create types with no names.
          // Try to use the typedef as type name, since you can do createType("struct A { s: AccountId }")
          // The problem with createType is that 0x (empty) decodes as valid type for all types, there is no equivalent to
          // DecodeAll trait. Maybe decode, encode again and check if hex is equal?
          const decoded = api.registry.createType(typeName, hexInput)
          const encodedAgain = decoded.toHex()
          if (encodedAgain === hexInput) {
            successes.set(id, { type: typeName, value: decoded.toHuman() })
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

      <Button type="primary" onClick={decodeAll} disabled={loading || hexInput.length < 3}>
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
