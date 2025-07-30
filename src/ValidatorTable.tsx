import type { ApiPromise } from '@polkadot/api'
import { hexToString } from '@polkadot/util'
import { Card, Spin, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import React, { useState, useEffect } from 'react'

interface ValidatorRow {
  key: string
  address: string
  alias: string
  isExternal: boolean
  isWhitelisted: boolean
  rewardPoints: number
}

export interface ValidatorTableProps {
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

const ValidatorTable: React.FC<ValidatorTableProps> = ({ api, onRefreshReady }) => {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ValidatorRow[]>([])

  useEffect(() => {
    let isActive = true

    async function load() {
      setLoading(true)
      try {
        // 1) Active era
        const activeEraOpt = await api.query.externalValidators.activeEra()
        const activeEra = activeEraOpt.unwrap().index.toNumber()

        // 2) Validator sets
        const validators = (await api.query.session.validators()).map((v: any) => v.toString())
        const external = (await api.query.externalValidators.externalValidators()).map((v: any) => v.toString())
        const whitelisted = (await api.query.externalValidators.whitelistedValidators()).map((v: any) => v.toString())

        // 3) Reward points
        const eraRewards = await api.query.externalValidatorsRewards.rewardPointsForEra(activeEra)
        const { individual = {} } = eraRewards.toJSON() as any

        // 4) Combine base rows
        const base: ValidatorRow[] = validators.map((addr) => ({
          key: addr,
          address: addr,
          alias: '',
          isExternal: external.includes(addr),
          isWhitelisted: whitelisted.includes(addr),
          rewardPoints: individual[addr] || 0,
        }))

        // 5) Enrich with alias
        const enriched = await Promise.all(
          base.map(async (r) => {
            let alias = HARDCODED_ALIASES[r.address] || ''
            if (!alias) {
              try {
                const identity = await api.query.identity.identityOf(r.address)
                const hex = identity.toJSON()?.info?.display?.raw
                if (hex) {
                  alias = hexToString(hex) || ''
                }
              } catch {
                // ignore lookup failures
              }
            }
            return { ...r, alias }
          }),
        )

        if (isActive) {
          setRows(enriched)
        }
      } catch (err: any) {
        message.error(`Failed to load validator table: ${err.message}`)
      } finally {
        if (isActive) setLoading(false)
      }
    }

    // expose reload function to parent
    onRefreshReady?.(load)
    // initial load
    load()

    return () => {
      isActive = false
    }
  }, [api, onRefreshReady])

  const columns: ColumnsType<ValidatorRow> = [
    {
      title: 'Validator Address',
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
      title: 'External',
      dataIndex: 'isExternal',
      key: 'isExternal',
      render: (val) => (val ? <Tag color="green">Yes</Tag> : <Tag color="default">No</Tag>),
      filters: [
        { text: 'External', value: true },
        { text: 'Internal', value: false },
      ],
      onFilter: (value, record) => record.isExternal === value,
    },
    {
      title: 'Whitelisted',
      dataIndex: 'isWhitelisted',
      key: 'isWhitelisted',
      render: (val) => (val ? <Tag color="blue">Yes</Tag> : <Tag color="default">No</Tag>),
      filters: [
        { text: 'Whitelisted', value: true },
        { text: 'Not Whitelisted', value: false },
      ],
      onFilter: (value, record) => record.isWhitelisted === value,
    },
    {
      title: 'Reward Points',
      dataIndex: 'rewardPoints',
      key: 'rewardPoints',
      sorter: (a, b) => a.rewardPoints - b.rewardPoints,
      defaultSortOrder: 'descend',
    },
  ]

  return (
    <Card>
      <Typography.Title level={4}>Current Validator Overview</Typography.Title>
      {loading ? (
        <Spin />
      ) : (
        <Table<ValidatorRow> columns={columns} dataSource={rows} rowKey="key" pagination={{ pageSize: 10 }} scroll={{ x: 'max-content' }} />
      )}
    </Card>
  )
}

export default React.memo(ValidatorTable)
