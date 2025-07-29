import type { ApiPromise } from '@polkadot/api'
import { Button, Card, Divider, InputNumber, Spin, Tag, Typography, message } from 'antd'
import React, { useState, useEffect } from 'react'
import { JSONTree, type KeyPath } from 'react-json-tree'

export interface ViewMetadataProps {
  api: ApiPromise
  endpoint: string
}

const ViewMetadata: React.FC<ViewMetadataProps> = ({ api, endpoint }) => {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>({})

  // Lookup URL state
  const [lookupUrl, setLookupUrl] = useState<string>('')

  // Type Explorer state
  const [typeId, setTypeId] = useState<number | null>(0)
  const [loadingType, setLoadingType] = useState(false)
  const [typeInfo, setTypeInfo] = useState<any>(null)

  // Build lookup URL based on current API
  useEffect(() => {
    try {
      // Runtime chain name as network identifier
      //let networkId = api.runtimeChain.toString() || ''
      // This works
      const networkId = 'localhost'
      const url = `https://dev.papi.how/metadata/lookup#networkId=${encodeURIComponent(networkId)}&endpoint=${encodeURIComponent(endpoint)}`
      setLookupUrl(url)
    } catch (err) {
      console.warn('Could not build lookup URL:', err)
    }
  }, [endpoint])

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const metadata = (await api.runtimeMetadata).toJSON()
        setData({ metadata })
      } catch (err: any) {
        message.error(`Error fetching metadata: ${err.message}`)
      } finally {
        setLoading(false)
      }
    }

    fetchAll()
  }, [api])

  useEffect(() => {
    // Automatically load type when typeId changes
    if (typeId !== null) {
      loadType(typeId)
    } else {
      setTypeInfo(null)
    }
  }, [typeId])

  // Recursively derive a friendly name for anonymous types
  const deriveAnonTypeName = (defJson: any, seenIds = new Set<number>()): string => {
    // composite record
    if (defJson.composite) {
      return `{ ${defJson.composite.fields.map((f: any) => `${f.name || '_'}: ${deriveTypeName(f.type, seenIds)}`).join('; ')} }`
    }
    // enum / variant
    if (defJson.variant) {
      return `enum { ${defJson.variant.variants
        .map((v: any) => v.name + (v.fields.length ? `(${v.fields.map((f: any) => deriveTypeName(f.type, seenIds)).join(',')})` : ''))
        .join(' | ')} }`
    }
    // vector
    if (defJson.sequence) {
      return `Vec<${deriveTypeName(defJson.sequence.type, seenIds)}>`
    }
    // array
    if (defJson.array) {
      return `[ ${deriveTypeName(defJson.array.type, seenIds)}; ${defJson.array.len} ]`
    }
    // tuple
    if (defJson.tuple) {
      return `(${defJson.tuple.map((t: number) => deriveTypeName(t, seenIds)).join(', ')})`
    }
    // compact
    if (defJson.compact) {
      return `Compact<${deriveTypeName(defJson.compact.type, seenIds)}>`
    }
    if (defJson.primitive) {
      return defJson.primitive
    }
    // fallback
    return JSON.stringify(defJson)
  }

  // Get a name for a type ID, using path or anon derivation
  const deriveTypeName = (id: number, seen = new Set<number>()): string => {
    if (seen.has(id)) return `Recursive#${id}`
    seen.add(id)
    const siType = api.registry.lookup.getSiType(id)
    const name = api.registry.lookup.getName(id)
    if (name) {
      return name
    }
    const path = siType.path.map((p) => p.toString())
    if (path.length) {
      return path.join('.')
    }
    // anonymous; derive from definition
    const defJson = siType.def.toJSON()
    return deriveAnonTypeName(defJson, seen)
  }
  // Recursively resolve a type structure
  const resolveType = (id: number, seen = new Set<number>()): ResolvedType => {
    if (seen.has(id)) {
      return { id, name: `Recursive#${id}`, path: [], def: {} }
    }
    seen.add(id)

    const siType = api.registry.lookup.getSiType(id)
    const path = siType.path.map((p) => p.toString())
    const defJson = siType.def.toJSON()
    const name = path.length ? path.join('.') : deriveAnonTypeName(defJson)

    // Resolve nested definitions recursively
    const resolveDef = (def: any): any => {
      if (def.composite) {
        return {
          composite: {
            fields: def.composite.fields.map((f: any) => ({
              name: f.name,
              type: resolveType(f.type, new Set(seen)),
            })),
          },
        }
      }
      if (def.variant) {
        return {
          variant: {
            variants: def.variant.variants.map((v: any) => ({
              name: v.name,
              fields: v.fields.map((f: any) => resolveType(f.type, new Set(seen))),
            })),
          },
        }
      }
      if (def.sequence) {
        return { sequence: resolveType(def.sequence.type, new Set(seen)) }
      }
      if (def.array) {
        return {
          array: {
            type: resolveType(def.array.type, new Set(seen)),
            len: def.array.len,
          },
        }
      }
      if (def.tuple) {
        return { tuple: def.tuple.map((t: number) => resolveType(t, new Set(seen))) }
      }
      if (def.compact) {
        return { compact: resolveType(def.compact.type, new Set(seen)) }
      }
      return def
    }

    return {
      id,
      name,
      path,
      def: resolveDef(defJson),
    }
  }

  const loadType = (id: number) => {
    try {
      setLoadingType(true)
      const siType = api.registry.lookup.getSiType(id)
      const siName = api.registry.lookup.getName(id)
      // Derive a friendly type name from the path
      const typeName = siType.path.length > 0 ? siType.path.map((p) => p.toString()).join('.') : `#anon ${deriveTypeName(id)}`
      const json = {
        id,
        siName,
        name: typeName,
        type: siType.toJSON(),
        def: resolveType(id).def,
      }
      setTypeInfo(json)
    } catch (err: any) {
      message.error(`Error loading type ${id}: ${err.message}`)
      setTypeInfo(null)
    } finally {
      setLoadingType(false)
    }
  }

  return (
    <Card>
      <Typography.Title level={4}>Test Metadata</Typography.Title>

      {/* Styled WIP notice */}
      <div
        style={{
          background: '#fffbe6',
          border: '1px solid #ffe58f',
          borderRadius: 4,
          padding: 12,
          marginBottom: 24,
        }}
      >
        <Tag color="orange">WIP</Tag> <Typography.Text strong>Use the metadata lookup tool instead:</Typography.Text>
        <br />
        {lookupUrl && (
          <Typography.Text copyable>
            <a href={lookupUrl} target="_blank" rel="noopener noreferrer">
              {lookupUrl}
            </a>
          </Typography.Text>
        )}
      </div>

      {loading ? (
        <Spin />
      ) : (
        <>
          <div style={{ maxHeight: 600, overflow: 'auto' }}>
            <JSONTree
              data={data}
              hideRoot={false}
              shouldExpandNodeInitially={(x: KeyPath) => x.length <= 4}
              theme="monokai"
              invertTheme={true}
            />
          </div>
          <Divider />
          <Typography.Title level={5}>Type Explorer</Typography.Title>
          <div style={{ marginBottom: 16 }}>
            <InputNumber
              min={0}
              placeholder="Type ID"
              value={typeId ?? undefined}
              onChange={(value) => setTypeId(value ?? null)}
              disabled={loadingType}
            />
            {loadingType && <Spin size="small" style={{ marginLeft: 8 }} />}
          </div>
          {typeInfo && (
            <>
              {/* Render a human-readable typedef with clickable inner types */}
              <div style={{ fontFamily: 'monospace', marginBottom: 16 }}>
                {typeInfo.def.composite ? (
                  <>
                    <div>
                      struct {typeInfo.name} {'{'}
                    </div>
                    {typeInfo.def.composite.fields.map((field: any) => (
                      <div key={field.name} style={{ paddingLeft: 16 }}>
                        {field.name}:&nbsp;
                        <Button style={{ cursor: 'pointer' }} onClick={() => setTypeId(field.type.id)}>
                          {field.type.name}
                        </Button>
                      </div>
                    ))}
                    <div>{'}'}</div>
                  </>
                ) : null}
              </div>
              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                <JSONTree
                  data={typeInfo}
                  hideRoot={true}
                  shouldExpandNodeInitially={(x: KeyPath) => true}
                  theme="monokai"
                  invertTheme={true}
                />
              </div>
            </>
          )}
        </>
      )}
    </Card>
  )
}

export default React.memo(ViewMetadata)
