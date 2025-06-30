import type { ApiPromise } from '@polkadot/api'
import { Card, Spin, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import React, { useState, useEffect } from 'react'

interface ValidatorRow {
  key: string
  address: string
  isExternal: boolean
  isWhitelisted: boolean
  rewardPoints: number
}

export interface ValidatorTableProps {
  api: ApiPromise
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
          isExternal: externalValidators.includes(addr),
          isWhitelisted: whitelistedValidators.includes(addr),
          rewardPoints: individualPoints[addr] || 0,
        }))

        setRows(dataRows)
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
