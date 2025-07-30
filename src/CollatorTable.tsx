import type { ApiPromise } from '@polkadot/api'
import { hexToString } from '@polkadot/util'
import { Card, Spin, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import React, { useState, useEffect, useCallback } from 'react'

interface CollatorRow {
  key: string
  address: string
  alias: string
  authorityKey: string
  paraId: number
  isInvulnerable: boolean
  isStaking: boolean
}

export interface CollatorTableProps {
  api: ApiPromise
  /**
   * Called once with the internal reload function so the parent
   * can trigger table refresh whenever desired.
   */
  onRefreshReady?: (refresh: () => void) => void
}

const HARDCODED_ALIASES: Record<string, string> = {
  '5EjzvFifcxVujMJcxMSHtyEjx5KqtYgERb8j2pHVdvjFi2rL': 'Collator-01',
  '5EZNgegN2yBWBNoNW7t83wZLErxCsSXVWAEV6WDJzTcUyQhr': 'Collator-02',
  '5HdoWyvRhxYAu2i9uxQYgrSSAsTx8BST18JzJoFZ8RX1sLv7': 'Collator-03',
  '5EXHZEiY6a28dwN1j1W1Etvw3EjA1vwYuPqLADjxy2gMinJX': 'Collator-04',
  '5GmpT57ZJ3M8LsRYY4R55UTM5Upj9LgcNBietpMmtQssjubm': 'Collator-05',
  '5DJRiJNo1aAu2VGMeF58NCB4Tk8bbnGSsY7zDGDNthoo2rU4': 'Collator-06',
}

const CollatorTable: React.FC<CollatorTableProps> = ({ api, onRefreshReady }) => {
  const [loading, setLoading] = useState<boolean>(true)
  const [rows, setRows] = useState<CollatorRow[]>([])
  const [sessionIndex, setSessionIndex] = useState<number | null>(null)
  const [blockNumber, setBlockNumber] = useState<number | null>(null)

  // Fetch and build table data
  const load = useCallback(async () => {
    setLoading(true)
    try {
      // get latest block number
      const header = await api.rpc.chain.getHeader()
      setBlockNumber(header.number.toNumber())

      // get current session index
      const idx = (await api.query.session.currentIndex()).toNumber()
      setSessionIndex(idx)

      // Fetch raw data
      const collatorData: any = (await api.query.tanssiCollatorAssignment.collatorContainerChain()).toJSON()
      const authorityData: any = (await api.query.tanssiAuthorityAssignment.collatorContainerChain(idx)).toJSON()
      const authorityMapping: Record<string, string> = (await api.query.tanssiAuthorityMapping.authorityIdMapping(idx)).toJSON() as Record<
        string,
        string
      >
      const invulnerables: string[] = (await api.query.tanssiInvulnerables.invulnerables()).map((v: any) => v.toString())
      const stakingCandidates: any[] = (await api.query.pooledStaking.sortedEligibleCandidates()).toJSON()
      const registeredParaIds: number[] = (await api.query.containerRegistrar.registeredParaIds()).map((v: any) => v.toNumber())

      // Build authority lookup
      const addressToAuthKey: Record<string, string> = {}

      for (const [authKey, addr] of Object.entries(authorityMapping)) {
        addressToAuthKey[addr] = authKey
      }

      // Extract containerChains
      const activeChains: Record<string, string[]> = collatorData.containerChains || {}
      const invSet = new Set(invulnerables)
      const stakeSet = new Set(stakingCandidates)

      // Build rows
      const dataRows: CollatorRow[] = []
      for (const paraId of registeredParaIds) {
        const key = paraId.toString()
        const addresses = activeChains[key] || []
        for (const address of addresses) {
          dataRows.push({
            key: `${paraId}-${address}`,
            paraId,
            address,
            alias: '',
            authorityKey: addressToAuthKey[address] || '',
            isInvulnerable: invSet.has(address),
            isStaking: stakeSet.has(address),
          })
        }
      }

      // Enrich alias
      const enriched = await Promise.all(
        dataRows.map(async (r) => {
          let alias = HARDCODED_ALIASES[r.address] || ''
          if (!alias) {
            try {
              const identity = await api.query.identity.identityOf(r.address)
              const hex = identity.toJSON()?.info?.display?.raw
              if (hex) alias = hexToString(hex) || ''
            } catch {
              // ignore
            }
          }
          return { ...r, alias }
        }),
      )

      setRows(enriched)
    } catch (err: any) {
      message.error(`Failed to load collator table: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [api])

  // Expose load to parent and run initial load
  useEffect(() => {
    onRefreshReady?.(load)
    load()
  }, [load, onRefreshReady])

  // Subscribe to session index changes
  useEffect(() => {
    let active = true
    const unsubPromise = api.query.session
      .currentIndex(() => {
        if (active) load()
      })
      .catch(console.error)
    return () => {
      active = false
      unsubPromise.then((u) => u()).catch(console.error)
    }
  }, [api, load])

  const columns: ColumnsType<CollatorRow> = [
    { title: 'Parachain ID', dataIndex: 'paraId', key: 'paraId', sorter: (a, b) => a.paraId - b.paraId },
    {
      title: 'Collator Address',
      dataIndex: 'address',
      key: 'address',
      render: (t) => <Typography.Text code>{t}</Typography.Text>,
      ellipsis: true,
    },
    { title: 'Alias', dataIndex: 'alias', key: 'alias', render: (t) => t || '-', ellipsis: true },
    {
      title: 'Authority Key',
      dataIndex: 'authorityKey',
      key: 'authorityKey',
      render: (t) => <Typography.Text code>{t}</Typography.Text>,
      ellipsis: true,
    },
    {
      title: 'Invulnerable',
      dataIndex: 'isInvulnerable',
      key: 'isInvulnerable',
      render: (v) => (v ? <Tag color="purple">Yes</Tag> : <Tag>No</Tag>),
      filters: [
        { text: 'Invulnerable', value: true },
        { text: 'Not Invulnerable', value: false },
      ],
      onFilter: (val, rec) => rec.isInvulnerable === val,
    },
    {
      title: 'Staking',
      dataIndex: 'isStaking',
      key: 'isStaking',
      render: (v) => (v ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>),
      filters: [
        { text: 'Staking', value: true },
        { text: 'Not Staking', value: false },
      ],
      onFilter: (val, rec) => rec.isStaking === val,
    },
  ]

  return (
    <Card>
      <Typography.Title level={4}>Current Collator Overview</Typography.Title>
      <Typography.Paragraph>
        <b>Session:</b> {sessionIndex ?? <Spin size="small" />} | <b>Block:</b> {blockNumber ?? <Spin size="small" />}
      </Typography.Paragraph>
      {loading ? (
        <Spin />
      ) : (
        <Table<CollatorRow> columns={columns} dataSource={rows} rowKey="key" pagination={{ pageSize: 10 }} scroll={{ x: 'max-content' }} />
      )}
    </Card>
  )
}

export default React.memo(CollatorTable)
