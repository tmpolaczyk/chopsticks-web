import type { ApiPromise } from '@polkadot/api'
import { Card, Spin, Typography, message } from 'antd'
import React, { useState, useEffect } from 'react'
import { JSONTree } from 'react-json-tree'
import ValidatorTable from './ValidatorTable'

export interface ValidatorQueriesProps {
  api: ApiPromise
}

const ValidatorQueries: React.FC<ValidatorQueriesProps> = ({ api }) => {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>({})

  useEffect(() => {
    const fetchAll = async () => {
      try {
        // block number
        const blockNumber = (await api.query.system.number()).toNumber()

        // active validators
        const validators: string[] = (await api.query.session.validators()).map((v: any) => v.toString())

        // external validators
        const externalValidators: string[] = (await api.query.externalValidators.externalValidators()).map((v: any) => v.toString())
        const whitelistedValidators: string[] = (await api.query.externalValidators.whitelistedValidators()).map((v: any) => v.toString())
        const skipExternalValidators = (await api.query.externalValidators.skipExternalValidators()).toJSON()

        const sessionsPerEra = api.consts.externalValidators.sessionsPerEra.toNumber()
        const maxExternalValidators = api.consts.externalValidators.maxExternalValidators.toNumber()
        const maxWhitelistedValidators = api.consts.externalValidators.maxWhitelistedValidators.toNumber()
        const historyDepth = api.consts.externalValidatorsRewards.historyDepth.toNumber()

        const currentIndex = (await api.query.session.currentIndex()).toNumber()

        // staking constants & active era
        const activeEraRaw = await api.query.externalValidators.activeEra()
        const activeEra = activeEraRaw.unwrap().index.toNumber()

        // era reward points
        const eraRewardPoints = await api.query.externalValidatorsRewards.rewardPointsForEra(activeEra)

        // collect everything
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
    }

    fetchAll()
  }, [api])

  return (
    <Card>
      <Typography.Title level={4}>Test Validator Queries</Typography.Title>
      {loading ? (
        <Spin />
      ) : (
        <>
          <div style={{ maxHeight: 600, overflow: 'auto' }}>
            <JSONTree data={data} hideRoot={false} shouldExpandNodeInitially={() => true} theme="monokai" invertTheme={true} />
          </div>
          <ValidatorTable api={api} />
        </>
      )}
    </Card>
  )
}

export default React.memo(ValidatorQueries)
