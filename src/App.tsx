import { Collapse, type CollapseProps, Spin } from 'antd'
import { useCallback, useState } from 'react'

import type { Api } from './types'

import Collectives from './Collectives'
import ConsoleTerminal from './ConsoleTerminal'
import Democracy from './Democracy'
import DryRun from './DryRun'
import DryRunBlock from './DryRunBlock'
import Preimages from './Preimages'
import Referenda from './Referenda'
import Settings from './Settings'
import StateCall from './StateCall'
import WasmOptions from './WasmOptions'

function App() {
  const [api, setApi] = useState<Api>()
  const [wasmOverride, setWasmOverride] = useState<File>()
  const [endpoint, setEndpoint] = useState<string>()
  const [activeKey, setActiveKey] = useState<string[]>(['settings'])
  const [preimage, setPreimage] = useState<{ hex: string; origin: any }>()

  const onConnect = useCallback((api?: Api, endpoint?: string) => {
    setApi(api)
    setEndpoint(endpoint)
  }, [])

  // This is an attempt to create the chopsticks wasm worker once the api is available
  // Very buggy so avoid using if possible.
  /*
  const didRunRef = useRef(false);
  const asyncAlive = useRef(null);
  const startApi = useEffect(() => {
  console.log("startApi", api, "endpoint", endpoint)
    if (didRunRef.current) { return; }
    // init wasm worker once
    if (api && api?.query.system) {
          didRunRef.current = true;
          console.log("api and system truthy");
    asyncAlive.current = (async () => { 
          console.log("inside async func");
	    const blockNumber = ((await api.query.system.number()) as any).toNumber()
	    const chain = await setup({
		endpoint,
		block: blockNumber,
		mockSignatureHost: true,
		db: new IdbDatabase('cache'),
		runtimeLogLevel: 5,
	    })
	    const rootOrigin = { system: 'Root' }
	    const preimage = 0x0101
	    const res = await chain.dryRunExtrinsic({
          	call: preimage,
          	address: rootOrigin,
        	})
	});
	(asyncAlive.current)();
    }
  }, [api, endpoint, api?.query.system])
  */

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
      children: <WasmOptions onFileSelect={onFileSelect} api={api} />,
    },
    {
      key: 'preimages',
      label: 'Preimages',
      children: api ? <Preimages api={api} onDryRunPreimage={onDryRunPreimage} /> : <Spin spinning={true} />,
    },
    ...(api?.query.referenda
      ? [
          {
            key: 'referenda',
            label: 'Referenda',
            children: api ? (
              <Referenda api={api} onDryRunPreimage={onDryRunPreimage} referendaPallet="referenda" />
            ) : (
              <Spin spinning={true} />
            ),
          },
        ]
      : []),
    ...(api?.query.fellowshipReferenda
      ? [
          {
            key: 'fellowship-referenda',
            label: 'Fellowship Referenda',
            children: api?.query.fellowshipReferenda ? (
              <Referenda api={api} onDryRunPreimage={onDryRunPreimage} referendaPallet="fellowshipReferenda" />
            ) : (
              <Spin spinning={true} />
            ),
          },
        ]
      : []),
    ...(api?.query.democracy
      ? [
          {
            key: 'democracy',
            label: 'Democracy',
            children: api ? <Democracy api={api} onDryRunPreimage={onDryRunPreimage} /> : <Spin spinning={true} />,
          },
        ]
      : []),
    ...(api?.query.generalCouncil
      ? [
          {
            key: 'general-council',
            label: 'Council',
            children: api ? (
              <Collectives api={api} onDryRunPreimage={onDryRunPreimage} collectivesPallet="generalCouncil" />
            ) : (
              <Spin spinning={true} />
            ),
          },
        ]
      : []),
    ...(api?.query.council
      ? [
          {
            key: 'council',
            label: 'Council',
            children: api ? (
              <Collectives api={api} onDryRunPreimage={onDryRunPreimage} collectivesPallet="council" />
            ) : (
              <Spin spinning={true} />
            ),
          },
        ]
      : []),
    ...(api?.query.technicalCommittee
      ? [
          {
            key: 'technical-committee',
            label: 'TechnicalCommittee',
            children: api ? (
              <Collectives api={api} onDryRunPreimage={onDryRunPreimage} collectivesPallet="technicalCommittee" />
            ) : (
              <Spin spinning={true} />
            ),
          },
        ]
      : []),
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
      key: 'state-call',
      label: 'State Call',
      children: api && endpoint ? <StateCall api={api} endpoint={endpoint} /> : <Spin spinning={true} />,
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
