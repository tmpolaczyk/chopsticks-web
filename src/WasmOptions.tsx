import { setup } from '@acala-network/chopsticks-core'
import { IdbDatabase } from '@acala-network/chopsticks-db/browser'
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { Button, Divider, Space, Typography, Upload, message } from 'antd'
import React, { useCallback, useState, useEffect } from 'react'

import type { Api } from './types'

export type WasmOptionsProps = {
  /** Called when the user selects a valid .wasm file */
  onFileSelect: (file: File) => void
  /** Polkadot API instance to fetch on-chain WASM */
  api?: Api
  endpoint: string
}

// Override info: either { valid: false } or { valid: true, specName, specVersion }
type OverrideInfo = { valid: false } | { valid: true; specName: string; specVersion: number }

const WasmOptions: React.FC<WasmOptionsProps> = ({ onFileSelect, api, endpoint }) => {
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileObj, setFileObj] = useState<File | null>(null)
  const [overrideInfo, setOverrideInfo] = useState<OverrideInfo | null>(null)
  const [downloading, setDownloading] = useState<boolean>(false)
  const [runtimeName, setRuntimeName] = useState<string | null>(null)
  const [specVersion, setSpecVersion] = useState<number | null>(null)
  const [findingLastUpdate, setFindingLastUpdate] = useState<boolean>(false)
  const [lastUpdateBlock, setLastUpdateBlock] = useState<number | null>(null)

  // Initialize runtime name and version from API
  useEffect(() => {
    if (api) {
      const version = api.consts.system.version.toJSON()
      setRuntimeName(version.specName.toString())
      setSpecVersion(Number(version.specVersion))
    }
  }, [api])

  // Handle new override file
  useEffect(() => {
    if (!api) {
      message.error('API not connected')
      return
    }
    if (fileObj) {
      // Stub validator (to be implemented)
      const parseWasmOverride = async (file: File): OverrideInfo => {
        const blockNumber = ((await api.query.system.number()) as any).toNumber()
        const chain = await setup({
          endpoint,
          block: blockNumber,
          mockSignatureHost: true,
          db: new IdbDatabase('cache'),
          runtimeLogLevel: 5,
        })

        const wasmOverride = file
        if (wasmOverride) {
          // Helper: convert Uint8Array to hex string
          function u8aToHex(u8a: Uint8Array): string {
            return `0x${Array.from(u8a)
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('')}`
          }
          console.log('Installing wasm override', wasmOverride)
          const buffer = new Uint8Array(await wasmOverride.arrayBuffer())
          console.log('buffer[0..10]:', JSON.stringify(buffer.slice(0, 10)))
          const wasmHex = u8aToHex(buffer)
          console.log('wasmHex[0..10]:', JSON.stringify(wasmHex.slice(0, 10)))
          const at = null
          if (at) {
            const block = await chain.getBlock(at)
            if (!block) throw new Error(`Cannot find block ${at}`)
            block.setWasm(wasmHex as HexString)
          } else {
            chain.head.setWasm(wasmHex as HexString)
          }
        }

        const block = await chain.head
        // Dry run empty block
        /*
          const block = await chain.newBlock({
          })
          */

        const ve = await block.runtimeVersion
        console.log('RUNTIME VERSION', ve)

        const valid = true
        return valid ? { valid: true, specName: ve.specName, specVersion: ve.specVersion } : { valid: false }
      }

      const fetchOverride = async () => {
        const info = await parseWasmOverride(fileObj)
        setOverrideInfo(info)
      }
      fetchOverride()
    } else {
      setOverrideInfo(null)
    }
  }, [api, fileObj, endpoint, api.query.system])

  const beforeUpload = useCallback((file: File) => {
    const isWasm = file.name.toLowerCase().endsWith('.wasm')
    if (!isWasm) {
      message.error(`${file.name} is not a .wasm file`)
    }
    return isWasm ? true : Upload.LIST_IGNORE
  }, [])

  const handleChange = useCallback(
    (info) => {
      const file = info.file.originFileObj as File
      if (file) {
        setFileName(file.name)
        setFileObj(file)
        onFileSelect(file)
      }
    },
    [onFileSelect],
  )

  const handleDownloadWasm = useCallback(async () => {
    if (!api) {
      message.error('API not connected')
      return
    }
    setDownloading(true)
    try {
      const version = api.consts.system.version.toJSON()
      const code = await api.rpc.state.getStorage(':code')
      // Important, unwrap because :code is an Option<Vec<u8>>, so it will have a leading 0x01 byte
      const u8a = code.unwrap().toU8a()
      const blob = new Blob([u8a], { type: 'application/wasm' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `runtime-${version.specName}-${version.specVersion}.compact.compressed.wasm`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      message.success('On-chain WASM downloaded')
    } catch (error: any) {
      message.error(`Error downloading WASM: ${error.message || error}`)
    } finally {
      setDownloading(false)
    }
  }, [api])

  const handleFindLastUpdate = useCallback(async () => {
    if (!api) {
      message.error('API not connected')
      return
    }
    setFindingLastUpdate(true)
    try {
      const header = await api.rpc.chain.getHeader()
      setLastUpdateBlock((header.number as any).toNumber())
    } catch (error: any) {
      message.error(`Error fetching last runtime update: ${error.message || error}`)
    } finally {
      setFindingLastUpdate(false)
    }
  }, [api])

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Typography.Text>
        Runtime Name: <Typography.Text strong>{runtimeName ?? '-'}</Typography.Text>
      </Typography.Text>
      <Typography.Text>
        Runtime Version: <Typography.Text strong>{specVersion ?? '-'}</Typography.Text>
      </Typography.Text>
      <Space>
        <Button onClick={handleFindLastUpdate} loading={findingLastUpdate} disabled={!api}>
          Find Last Runtime Update Date
        </Button>
        {lastUpdateBlock !== null && <Typography.Text>Block #{lastUpdateBlock}</Typography.Text>}
      </Space>
      <Button icon={<DownloadOutlined />} onClick={handleDownloadWasm} disabled={!api} loading={downloading}>
        Download On-Chain WASM
      </Button>

      <Divider style={{ margin: '8px 0' }} />

      <Typography.Title level={5} style={{ margin: 0 }}>
        WASM Override
      </Typography.Title>
      <Space>
        <Upload accept=".wasm" showUploadList={false} beforeUpload={beforeUpload} onChange={handleChange}>
          <Button icon={<UploadOutlined />}>Select WASM File</Button>
        </Upload>
        {fileName ? <Typography.Text>{fileName}</Typography.Text> : <Typography.Text type="secondary">None</Typography.Text>}
      </Space>

      {overrideInfo && (
        <>
          <Typography.Text type={overrideInfo.valid ? 'success' : 'danger'}>
            {overrideInfo.valid ? 'WASM is valid' : 'WASM is invalid'}
          </Typography.Text>

          {overrideInfo.valid && (
            <>
              <Typography.Text>
                Override Runtime Name: <Typography.Text strong>{overrideInfo.specName}</Typography.Text>
              </Typography.Text>
              <Typography.Text>
                Override Runtime Version: <Typography.Text strong>{overrideInfo.specVersion}</Typography.Text>
              </Typography.Text>
            </>
          )}
        </>
      )}
    </Space>
  )
}

const WasmOptionsFC = React.memo(WasmOptions)
export default WasmOptionsFC
