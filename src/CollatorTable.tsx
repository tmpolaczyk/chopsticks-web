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

// Hardcoded mapping for well-known collators
const HARDCODED_ALIASES: Record<string, string> = {
  '5EjzvFifcxVujMJcxMSHtyEjx5KqtYgERb8j2pHVdvjFi2rL': 'Collator-01',
  '5EZNgegN2yBWBNoNW7t83wZLErxCsSXVWAEV6WDJzTcUyQhr': 'Collator-02',
  '5HdoWyvRhxYAu2i9uxQYgrSSAsTx8BST18JzJoFZ8RX1sLv7': 'Collator-03',
  '5EXHZEiY6a28dwN1j1W1Etvw3EjA1vwYuPqLADjxy2gMinJX': 'Collator-04',
  '5GmpT57ZJ3M8LsRYY4R55UTM5Upj9LgcNBietpMmtQssjubm': 'Collator-05',
  '5DJRiJNo1aAu2VGMeF58NCB4Tk8bbnGSsY7zDGDNthoo2rU4': 'Collator-06',
}

const CollatorTable: React.FC<CollatorTableProps> = ({ api }) => {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<CollatorRow[]>([])
  const [sessionIndex, setSessionIndex] = useState<number | null>(null)
  const [blockNumber, setBlockNumber] = useState<number | null>(null)

  // 1) our actual fetch, parameterized by the sessionIndex
  const fetchData = useCallback(async (idx: number) => {
    setLoading(true)
    try {
      // get latest block number
      const header = await api.rpc.chain.getHeader()
      setBlockNumber(header.number.toNumber())

      const sessionIndex = (await api.query.session.currentIndex()).toNumber()

      // Fetch raw data
      const collatorData: any = (await api.query.tanssiCollatorAssignment.collatorContainerChain()).toJSON()
      const authorityData: any = (await api.query.tanssiAuthorityAssignment.collatorContainerChain(sessionIndex)).toJSON()
      const authorityMapping: Record<string, string> = await api.query.tanssiAuthorityMapping
        .authorityIdMapping(sessionIndex)
        .then((v: any) => v.toJSON())
      const invulnerables: string[] = (await api.query.tanssiInvulnerables.invulnerables()).map((v: any) => v.toString())
      const stakingCandidates: any[] = (await api.query.pooledStaking.sortedEligibleCandidates()).toJSON()
      const registeredParaIds: number[] = (await api.query.containerRegistrar.registeredParaIds()).map((v: any) => v.toNumber())

      // Build a reverse map: address → authorityKey
      const addressToAuthKey: Record<string, string> = {}

      for (const [authKey, addr] of Object.entries(authorityMapping)) {
        addressToAuthKey[addr] = authKey
      }

      // Extract containerChains
      const activeChains: Record<string, string[]> = collatorData.containerChains || {}
      const invSet = new Set(invulnerables)
      const stakingSet = new Set(stakingCandidates)

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
            alias: '', // computed below because it needs async
            authorityKey: addressToAuthKey[address] || '',
            isInvulnerable: invSet.has(address),
            isStaking: stakingSet.has(address),
          })
        }
      }

      // enrich rows with alias: from hardcoded or on-chain identity
      const enriched: CollatorRow[] = await Promise.all(
        dataRows.map(async (r) => {
          let alias = ''
          // check hardcoded first
          if (HARDCODED_ALIASES[r.address]) {
            alias = HARDCODED_ALIASES[r.address]
          } else {
            // fetch on-chain Identity
            try {
              const identity = await api.query.identity.identityOf(r.address)
              const displayHex = identity.toJSON()?.info?.display?.raw
              if (displayHex) {
                const display = hexToString(displayHex)
                alias = display || ''
              }
            } catch {
              alias = ''
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
  })

  useEffect(() => {
    // Kick off the subscription; currentIndex() returns a Promise<() => void>
    const unsubPromise = api.query.session
      .currentIndex((idx) => {
        const next = idx.toNumber()
        if (next === sessionIndex) return
        setSessionIndex(next)
        fetchData(next)
      })
      .catch(console.error)

    // Cleanup: when the effect tears down, wait for that promise and then call the unsubscribe
    return () => {
      unsubPromise
        .then((unsub) => unsub())
        .catch((err) => {
          // If we never got a valid unsubscribe fn, or it errors, swallow it
          console.error('Failed to unsubscribe session index listener', err)
        })
    }
  }, [api, sessionIndex, fetchData])

  const columns: ColumnsType<CollatorRow> = [
    {
      title: 'Parachain ID',
      dataIndex: 'paraId',
      key: 'paraId',
      sorter: (a, b) => a.paraId - b.paraId,
    },
    {
      title: 'Collator Address',
      dataIndex: 'address',
      key: 'address',
      render: (text) => <Typography.Text code>{text}</Typography.Text>,
      ellipsis: true,
    },
    {
      title: 'Alias',
      dataIndex: 'alias',
      key: 'alias',
      render: (text) => text || '-',
      ellipsis: true,
    },
    {
      title: 'Authority Key',
      dataIndex: 'authorityKey',
      key: 'authorityKey',
      render: (text) => <Typography.Text code>{text}</Typography.Text>,
      ellipsis: true,
    },
    {
      title: 'Invulnerable',
      dataIndex: 'isInvulnerable',
      key: 'isInvulnerable',
      render: (val) => (val ? <Tag color="purple">Yes</Tag> : <Tag color="default">No</Tag>),
      filters: [
        { text: 'Invulnerable', value: true },
        { text: 'Not Invulnerable', value: false },
      ],
      onFilter: (value, record) => record.isInvulnerable === value,
    },
    {
      title: 'Staking',
      dataIndex: 'isStaking',
      key: 'isStaking',
      render: (val) => (val ? <Tag color="green">Yes</Tag> : <Tag color="default">No</Tag>),
      filters: [
        { text: 'Staking', value: true },
        { text: 'Not Staking', value: false },
      ],
      onFilter: (value, record) => record.isStaking === value,
    },
  ]

  return (
    <Card>
      <Typography.Title level={4}>Current Collator Overview</Typography.Title>
      {/* session + block info up top */}
      <Typography.Paragraph>
        <b>Session:</b> {sessionIndex !== null ? sessionIndex : <Spin size="small" />} | <b>Block:</b>{' '}
        {blockNumber !== null ? blockNumber : <Spin size="small" />}
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
