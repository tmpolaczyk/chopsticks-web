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
}

// Hardcoded mapping for well-known collators
// TODO: change key type to validators
const HARDCODED_ALIASES: Record<string, string> = {
  '5EjzvFifcxVujMJcxMSHtyEjx5KqtYgERb8j2pHVdvjFi2rL': 'Collator-01',
  '5EZNgegN2yBWBNoNW7t83wZLErxCsSXVWAEV6WDJzTcUyQhr': 'Collator-02',
  '5HdoWyvRhxYAu2i9uxQYgrSSAsTx8BST18JzJoFZ8RX1sLv7': 'Collator-03',
  '5EXHZEiY6a28dwN1j1W1Etvw3EjA1vwYuPqLADjxy2gMinJX': 'Collator-04',
  '5GmpT57ZJ3M8LsRYY4R55UTM5Upj9LgcNBietpMmtQssjubm': 'Collator-05',
  '5DJRiJNo1aAu2VGMeF58NCB4Tk8bbnGSsY7zDGDNthoo2rU4': 'Collator-06',
}

const ValidatorTable: React.FC<ValidatorTableProps> = ({ api }) => {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ValidatorRow[]>([])

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch current active era
        const activeEraOpt = await api.query.externalValidators.activeEra()
        const activeEra = activeEraOpt.unwrap().index.toNumber()

        // Fetch validator sets
        const validators: string[] = (await api.query.session.validators()).map((v: any) => v.toString())
        const externalValidators: string[] = (await api.query.externalValidators.externalValidators()).map((v: any) => v.toString())
        const whitelistedValidators: string[] = (await api.query.externalValidators.whitelistedValidators()).map((v: any) => v.toString())

        // Fetch reward points for this era
        const eraRewardData = await api.query.externalValidatorsRewards.rewardPointsForEra(activeEra)
        const rewardJson: any = eraRewardData.toJSON()
        const individualPoints: Record<string, number> = rewardJson.individual || {}

        // Combine into table rows
        const dataRows: ValidatorRow[] = validators.map((addr) => ({
          key: addr,
          address: addr,
          alias: '',
          isExternal: externalValidators.includes(addr),
          isWhitelisted: whitelistedValidators.includes(addr),
          rewardPoints: individualPoints[addr] || 0,
        }))

        // enrich rows with alias: from hardcoded or on-chain identity
        const enriched: ValidatorRow[] = await Promise.all(
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
        message.error(`Failed to load validator table: ${err.message}`)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [api])

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
