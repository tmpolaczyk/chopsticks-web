import type { ApiPromise } from '@polkadot/api'
import { Card, Spin, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import React, { useState, useEffect } from 'react'

interface CollatorRow {
  key: string
  address: string
  paraId: number
  isInvulnerable: boolean
  isStaking: boolean
}

export interface CollatorTableProps {
  api: ApiPromise
}

const CollatorTable: React.FC<CollatorTableProps> = ({ api }) => {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<CollatorRow[]>([])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const sessionIndex = (await api.query.session.currentIndex()).toNumber()

        // Fetch raw data
        const collatorData: any = (await api.query.tanssiCollatorAssignment.collatorContainerChain()).toJSON()
        const authorityData: any = (await api.query.tanssiAuthorityAssignment.collatorContainerChain(sessionIndex)).toJSON()
        const authorityMapping: Record<string, string> = await api.query.tanssiAuthorityMapping.authorityIdMapping(sessionIndex).then((v: any) => v.toJSON())
        const invulnerables: string[] = (await api.query.tanssiInvulnerables.invulnerables()).map((v: any) => v.toString())
        const stakingCandidates: any[] = (await api.query.pooledStaking.sortedEligibleCandidates()).toJSON()
        const registeredParaIds: number[] = (await api.query.containerRegistrar.registeredParaIds()).map((v: any) => v.toNumber())

        // Extract containerChains
        const activeChains: Record<string, string[]> = collatorData.containerChains || {}
        const invSet = new Set(invulnerables)
        const stakingSet = new Set(stakingCandidates)

        // Build rows
        const dataRows: CollatorRow[] = []
        registeredParaIds.forEach((paraId) => {
          const key = paraId.toString()
          const addresses = activeChains[key] || []
          addresses.forEach((address: string) => {
            dataRows.push({
              key: `${paraId}-${address}`,
              paraId,
              address,
              isInvulnerable: invSet.has(address),
              isStaking: stakingSet.has(address),
            })
          })
        })

        setRows(dataRows)
      } catch (err: any) {
        message.error(`Failed to load collator table: ${err.message}`)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [api])

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
      {loading ? (
        <Spin />
      ) : (
        <Table<CollatorRow>
          columns={columns}
          dataSource={rows}
          rowKey="key"
          pagination={{ pageSize: 10 }}
          scroll={{ x: 'max-content' }}
        />
      )}
    </Card>
  )
}

export default React.memo(CollatorTable)
