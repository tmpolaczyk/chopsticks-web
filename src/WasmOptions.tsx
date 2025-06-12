import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { Button, Typography } from 'antd'
import { Space, Upload, message } from 'antd'
import React, { useCallback, useState } from 'react'

import type { Api } from './types'

const endpoints = [
  'wss://rpc.polkadot.io',
  'wss://polkadot-collectives-rpc.polkadot.io',
  'wss://kusama-rpc.polkadot.io',
  'wss://acala-rpc.aca-api.network',
  'wss://karura-rpc.aca-api.network',
]

const blockHeightOptions = [
  {
    value: 'latest',
  },
  {
    value: 'last',
  },
]

export type WasmOptionsProps = {
  /** Called when the user selects a valid .wasm file */
  onFileSelect: (file: File) => void
  /** Polkadot API instance to fetch on-chain WASM */
  api?: Api
}

const WasmOptions: React.FC<WasmOptionsProps> = ({ onFileSelect, api }) => {
  const [fileName, setFileName] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<boolean>(false)

  const beforeUpload = useCallback((file: File) => {
    const isWasm = file.name.toLowerCase().endsWith('.wasm')
    if (!isWasm) {
      message.error(`${file.name} is not a .wasm file`)
    }
    // Prevent auto upload by Upload component
    return isWasm ? true : Upload.LIST_IGNORE
  }, [])

  const handleChange = useCallback(
    (info) => {
      const file = info.file.originFileObj as File
      if (file) {
        setFileName(file.name)
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
      const u8a = code.toU8a()
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

  return (
    <Space align="center">
      <Upload accept=".wasm" showUploadList={false} beforeUpload={beforeUpload} onChange={handleChange}>
        <Button icon={<UploadOutlined />}>Select WASM File</Button>
      </Upload>

      <Button icon={<DownloadOutlined />} onClick={handleDownloadWasm} disabled={!api} loading={downloading}>
        Download On-Chain WASM
      </Button>

      {fileName && <Typography.Text>Selected: {fileName}</Typography.Text>}
    </Space>
  )
}

const WasmOptionsFC = React.memo(WasmOptions)
export default WasmOptionsFC
