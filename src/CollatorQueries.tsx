import type { ApiPromise } from '@polkadot/api'
import { Card, Checkbox, Spin, Typography, message } from 'antd'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { JSONTree } from 'react-json-tree'
import CollatorTable from './CollatorTable'

export interface CollatorQueriesProps {
  api: ApiPromise
}

const CollatorQueries: React.FC<CollatorQueriesProps> = ({ api }) => {
  const [loading, setLoading] = useState<boolean>(true)
  const [data, setData] = useState<Record<string, unknown>>({})
  const [autoUpdate, setAutoUpdate] = useState<boolean>(true)
  const refreshRef = useRef<() => void>(() => {})

  // Receive child refresh function and trigger initial refresh
  const handleRefreshReady = useCallback((fn: () => void) => {
    refreshRef.current = fn
    fn()
  }, [])

  // Fetch JSON data
  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const sessionIndex = (await api.query.session.currentIndex()).toNumber()
      const collatorContainerChain: any[] = (await api.query.tanssiCollatorAssignment.collatorContainerChain()).toJSON()
      const pendingCollatorContainerChain: any[] = (await api.query.tanssiCollatorAssignment.pendingCollatorContainerChain()).toJSON()
      const authoritiesCollatorContainerChain: any[] = (
        await api.query.tanssiAuthorityAssignment.collatorContainerChain(sessionIndex)
      ).toJSON()
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
  }, [api])

  useEffect(() => {
    let intervalId: NodeJS.Timeout

    // initial JSON load
    if (autoUpdate) fetchAll()

    // poll if autoUpdate enabled
    if (autoUpdate) {
      intervalId = setInterval(() => {
        fetchAll()
        refreshRef.current()
      }, 30_000)
    }

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [fetchAll, autoUpdate])

  return (
    <Card>
      <Typography.Title level={4}>Test Collator Queries</Typography.Title>

      <Checkbox checked={autoUpdate} onChange={(e) => setAutoUpdate(e.target.checked)} style={{ marginBottom: 16 }}>
        Auto update every 30 s
      </Checkbox>

      {loading ? (
        <Spin />
      ) : (
        <>
          <div style={{ maxHeight: 600, overflow: 'auto' }}>
            <JSONTree data={data} hideRoot={false} shouldExpandNodeInitially={() => true} theme="monokai" invertTheme={true} />
          </div>
          <CollatorTable api={api} onRefreshReady={handleRefreshReady} />
        </>
      )}
    </Card>
  )
}

export default React.memo(CollatorQueries)
