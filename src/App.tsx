import { Collapse, type CollapseProps, Spin } from 'antd'
import { useCallback, useState } from 'react'

import type { ApiPromise } from '@polkadot/api'
import BruteforceScaleDecoder from './BruteforceScaleDecoder'
import CollatorQueries from './CollatorQueries'
import Collectives from './Collectives'
import ConsoleTerminal from './ConsoleTerminal'
import DecodeKey from './DecodeKey'
import Democracy from './Democracy'
import DryRun from './DryRun'
import DryRunBlock from './DryRunBlock'
import FindBlockByDate from './FindBlockByDate'
import Preimages from './Preimages'
import Referenda from './Referenda'
import ReplayBlock from './ReplayBlock'
import Settings from './Settings'
import SnowbridgeInboundSubmit from './SnowbridgeInboundSubmit'
import StateCall from './StateCall'
import StorageKeyChangeFinder from './StorageKeyChangeFinder'
import ValidatorQueries from './ValidatorQueries'
import TestMetadata from './ViewMetadata'
import WasmOptions from './WasmOptions'

function App() {
  const [api, setApi] = useState<ApiPromise>()
  const [wasmOverride, setWasmOverride] = useState<File>()
  const [endpoint, setEndpoint] = useState<string>()
  const [activeKey, setActiveKey] = useState<string[]>(['settings'])
  const [preimage, setPreimage] = useState<{ hex: string; origin: any }>()

  const onConnect = useCallback((api?: ApiPromise, endpoint?: string) => {
    setApi(api)
    setEndpoint(endpoint)
  }, [])

  const onDryRunPreimage = useCallback(
    (hex: string, origin?: any) => {
      const newKeys = [...activeKey].filter((key) => key === 'settings' || key === 'dryrun-preimage')
      if (newKeys.indexOf('dryrun-preimage') < 0) {
        newKeys.push('dryrun-preimage')
      }
      setActiveKey(newKeys)
      setPreimage({ hex, origin })
    },
    [activeKey],
  )

  const onFileSelect = useCallback((file: File) => {
    setWasmOverride(file)
  }, [])

  const onChangeActiveKey = useCallback((activeKey: string | string[]) => {
    setActiveKey(Array.isArray(activeKey) ? activeKey : [activeKey])
  }, [])

  const items: CollapseProps['items'] = [
    {
      key: 'settings',
      label: 'Settings',
      children: <Settings onConnect={onConnect} />,
    },
    {
      key: 'wasm-override',
      label: 'WasmOptions',
      children: api && endpoint ? <WasmOptions onFileSelect={onFileSelect} api={api} endpoint={endpoint} /> : <Spin spinning={true} />,
    },
    {
      key: 'preimages',
      label: 'Preimages',
      children: api ? <Preimages api={api} onDryRunPreimage={onDryRunPreimage} /> : <Spin spinning={true} />,
    },
    {
      key: 'referenda',
      label: 'Referenda',
      children: api ? <Referenda api={api} onDryRunPreimage={onDryRunPreimage} referendaPallet="referenda" /> : <Spin spinning={true} />,
    },
    {
      key: 'fellowship-referenda',
      label: 'Fellowship Referenda',
      children: api?.query.fellowshipReferenda ? (
        <Referenda api={api} onDryRunPreimage={onDryRunPreimage} referendaPallet="fellowshipReferenda" />
      ) : (
        <Spin spinning={true} />
      ),
    },
    {
      key: 'democracy',
      label: 'Democracy',
      children: api ? <Democracy api={api} onDryRunPreimage={onDryRunPreimage} /> : <Spin spinning={true} />,
    },
    {
      key: 'general-council',
      label: 'Council',
      children: api ? (
        <Collectives api={api} onDryRunPreimage={onDryRunPreimage} collectivesPallet="generalCouncil" />
      ) : (
        <Spin spinning={true} />
      ),
    },
    {
      key: 'council',
      label: 'Council',
      children: api ? <Collectives api={api} onDryRunPreimage={onDryRunPreimage} collectivesPallet="council" /> : <Spin spinning={true} />,
    },
    {
      key: 'technical-committee',
      label: 'TechnicalCommittee',
      children: api ? (
        <Collectives api={api} onDryRunPreimage={onDryRunPreimage} collectivesPallet="technicalCommittee" />
      ) : (
        <Spin spinning={true} />
      ),
    },
    {
      key: 'dryrun-preimage',
      label: 'Dry Run Preimage',
      children: api && endpoint ? <DryRun api={api} endpoint={endpoint} preimage={preimage} /> : <Spin spinning={true} />,
    },
    {
      key: 'dryrun-extrinsic',
      label: 'Dry Run Extrinsic',
      children: api && endpoint ? <DryRun api={api} endpoint={endpoint} extrinsicMode={true} /> : <Spin spinning={true} />,
    },
    {
      key: 'dryrun-block',
      label: 'Dry Run Block',
      children: api && endpoint ? <DryRunBlock api={api} endpoint={endpoint} wasmOverride={wasmOverride} /> : <Spin spinning={true} />,
    },
    {
      key: 'replay-block',
      label: 'Replay Block',
      children: api && endpoint ? <ReplayBlock api={api} endpoint={endpoint} wasmOverride={wasmOverride} /> : <Spin spinning={true} />,
    },
    {
      key: 'state-call',
      label: 'State Call',
      children: api && endpoint ? <StateCall api={api} endpoint={endpoint} /> : <Spin spinning={true} />,
    },
    {
      key: 'decode-key',
      label: 'Decode Key',
      children: api && endpoint ? <DecodeKey api={api} endpoint={endpoint} /> : <Spin spinning={true} />,
    },
    {
      key: 'storage-key-change-finder',
      label: 'Binary search storage key',
      children: api ? <StorageKeyChangeFinder api={api} /> : <Spin spinning={true} />,
    },
    {
      key: 'find-block-by-date',
      label: 'Find block by date',
      children: api ? <FindBlockByDate api={api} /> : <Spin spinning={true} />,
    },
    {
      key: 'snowbridge-inbound-submit',
      label: 'Snowbridge inbound messages (from ethereum)',
      children: api ? <SnowbridgeInboundSubmit api={api} /> : <Spin spinning={true} />,
    },
    {
      key: 'test-validator-queries',
      label: 'Test Validator Queries',
      children: api ? <ValidatorQueries api={api} /> : <Spin spinning={true} />,
    },
    {
      key: 'test-collator-queries',
      label: 'Test Collator Queries',
      children: api ? <CollatorQueries api={api} /> : <Spin spinning={true} />,
    },
    {
      key: 'test-metadata',
      label: 'Test Metadata',
      children: api ? <TestMetadata api={api} /> : <Spin spinning={true} />,
    },
    {
      key: 'bruteforce-scale-decoder',
      label: 'Bruteforce SCALE Decoder',
      children: api ? <BruteforceScaleDecoder api={api} /> : <Spin spinning={true} />,
    },
    {
      key: 'console',
      label: 'Console',
      children: <ConsoleTerminal />,
    },
  ]

  return (
    <div>
      <Collapse items={items} activeKey={activeKey} onChange={onChangeActiveKey} />
    </div>
  )
}
export default App
