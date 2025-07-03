import type { ApiPromise } from '@polkadot/api'
import { Card, Spin, Typography, message } from 'antd'
import React, { useState, useEffect } from 'react'
import { JSONTree } from 'react-json-tree'
import CollatorTable from './CollatorTable'

export interface CollatorQueriesProps {
  api: ApiPromise
}

const CollatorQueries: React.FC<CollatorQueriesProps> = ({ api }) => {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>({})

  useEffect(() => {
    const fetchAll = async () => {
      try {
        // current session index / era
        const sessionIndex = (await api.query.session.currentIndex()).toNumber()

        // fetch collator assignments and mappings
        const collatorContainerChain: any[] = (await api.query.tanssiCollatorAssignment.collatorContainerChain()).toJSON()
        const pendingCollatorContainerChain: any[] = (await api.query.tanssiCollatorAssignment.pendingCollatorContainerChain()).toJSON()
        const authoritiesCollatorContainerChain: any[] = (await api.query.tanssiAuthorityAssignment.collatorContainerChain(sessionIndex)).toJSON()
        const authorityMapping: any[] = (await api.query.tanssiAuthorityMapping.authorityIdMapping(sessionIndex)).toJSON()
        const invulnerables: any[] = (await api.query.tanssiInvulnerables.invulnerables()).toJSON()
        const stakingCandidates: any[] = (await api.query.pooledStaking.sortedEligibleCandidates()).toJSON()
        const registeredParaIds: any[] = (await api.query.containerRegistrar.registeredParaIds()).toJSON()

        setData({
          sessionIndex,
          collatorContainerChain,
          pendingCollatorContainerChain,
          authoritiesCollatorContainerChain,
          authorityMapping,
          invulnerables,
          stakingCandidates,
          registeredParaIds,
        })

      } catch (err: any) {
        message.error(`Error fetching collator data: ${err.message}`)
      } finally {
        setLoading(false)
      }
    }

    fetchAll()
  }, [api])

  useEffect(() => {
    console.log(data)
  }, [data])

  return (
    <Card>
      <Typography.Title level={4}>Test Collator Queries</Typography.Title>
      {loading ? (
        <Spin />
      ) : (
        <>
          <div style={{ maxHeight: 600, overflow: 'auto' }}>
            <JSONTree data={data} hideRoot={false} shouldExpandNodeInitially={() => true} theme="monokai" invertTheme={true} />
          </div>
          <CollatorTable api={api} />
        </>
      )}
    </Card>
  )
}

export default React.memo(CollatorQueries)
