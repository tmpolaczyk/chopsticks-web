import type { ApiPromise } from '@polkadot/api'
import { Card, Checkbox, Spin, Typography, message } from 'antd'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { JSONTree } from 'react-json-tree'
import ValidatorTable from './ValidatorTable'

export interface ValidatorQueriesProps {
  api: ApiPromise
}

const ValidatorQueries: React.FC<ValidatorQueriesProps> = ({ api }) => {
  const [loading, setLoading] = useState<boolean>(true)
  const [data, setData] = useState<Record<string, unknown>>({})
  const [autoUpdate, setAutoUpdate] = useState<boolean>(true)
  const refreshRef = useRef<() => void>(() => {})

  // Receive child refresh function
  const handleRefreshReady = useCallback((fn: () => void) => {
    refreshRef.current = fn
    // perform initial table load when child is ready
    fn()
  }, [])

  // Fetch all JSON data
  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const blockNumber = (await api.query.system.number()).toNumber()
      const validators: string[] = (await api.query.session.validators()).map((v: any) => v.toString())
      const externalValidators: string[] = (await api.query.externalValidators.externalValidators()).map((v: any) => v.toString())
      const whitelistedValidators: string[] = (await api.query.externalValidators.whitelistedValidators()).map((v: any) => v.toString())
      const skipExternalValidators = (await api.query.externalValidators.skipExternalValidators()).toJSON()

      const sessionsPerEra = api.consts.externalValidators.sessionsPerEra.toNumber()
      const maxExternalValidators = api.consts.externalValidators.maxExternalValidators.toNumber()
      const maxWhitelistedValidators = api.consts.externalValidators.maxWhitelistedValidators.toNumber()
      const historyDepth = api.consts.externalValidatorsRewards.historyDepth.toNumber()

      const currentIndex = (await api.query.session.currentIndex()).toNumber()
      const activeEraRaw = await api.query.externalValidators.activeEra()
      const activeEra = activeEraRaw.unwrap().index.toNumber()

      const eraRewardPoints = await api.query.externalValidatorsRewards.rewardPointsForEra(activeEra)

      setData({
        blockNumber,
        activeEra,
        validators,
        eraRewardPoints: eraRewardPoints.toJSON(),
        externalValidators,
        whitelistedValidators,
        skipExternalValidators,
        sessionsPerEra,
        historyDepth,
        currentIndex,
        maxExternalValidators,
        maxWhitelistedValidators,
      })
    } catch (err: any) {
      message.error(`Error fetching validator data: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    let intervalId: NodeJS.Timeout

    // initial JSON load
    if (autoUpdate) fetchAll()

    // polling JSON + table if autoUpdate
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
      <Typography.Title level={4}>Test Validator Queries</Typography.Title>

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

          <ValidatorTable api={api} onRefreshReady={handleRefreshReady} />
        </>
      )}
    </Card>
  )
}

export default React.memo(ValidatorQueries)
