import type { ApiPromise } from '@polkadot/api'
import { hexToBn } from '@polkadot/util'
import { message } from 'antd'
import type React from 'react'

export type StorageKeyChangeFinderProps = {
  /** Polkadot API instance to query chain data */
  api: ApiPromise
}

// ========= Helper types & functions =========

interface ValObjWithHash {
  block: number
  hash: string
  hex: string
}

interface ValObj {
  block: number
  hex: string
}

const validateHexKey = (key: string): boolean => /^0x[0-9a-fA-F]+$/.test(key)

const getHeadNumber = async (api: ApiPromise): Promise<number> => {
  return (await api.query.system.number()).toNumber()
}

const getBlockHashHex = async (api: ApiPromise, block: number): Promise<string> => {
  return (await api.rpc.chain.getBlockHash(block)).toHex()
}

const readStorageHexAt = async (api: ApiPromise, storageKey: string, block: number): Promise<string> => {
  const hash = await api.rpc.chain.getBlockHash(block)
  const hex = (await api.rpc.state.getStorage(storageKey, hash))?.toHex() || '0x'
  return hex
}

const readValWithHash = async (api: ApiPromise, storageKey: string, block: number): Promise<ValObjWithHash> => {
  const hash = await getBlockHashHex(api, block)
  const hex = (await api.rpc.state.getStorage(storageKey, hash))?.toHex() || '0x'
  return { block, hash, hex }
}

const readVal = async (api: ApiPromise, storageKey: string, block: number): Promise<ValObj> => {
  return { block, hex: await readStorageHexAt(api, storageKey, block) }
}

const readHexAndBnLe = async (api: ApiPromise, storageKey: string, block: number): Promise<{ hex: string; bn: bigint }> => {
  const hex = await readStorageHexAt(api, storageKey, block)
  // Keep exact conversion: little-endian, non-negative, then to BigInt via string
  const bn = BigInt(hexToBn(hex, { isLe: true, isNegative: false }).toString())
  return { hex, bn }
}

/** ===== Unified binary-search / binary-walk engine (sets state internally) ===== */
type SetState<T> = React.Dispatch<React.SetStateAction<T>>
export async function performBinarySearchAndSetState(params: {
  mode: 'change' | 'number' | 'all'
  api: ApiPromise
  storageKey: string
  rangeStart: number
  rangeEnd: number | null
  targetNumber?: string

  setFinding: SetState<boolean>
  setSearchRange: SetState<[number, number] | null>
  setLowValueHex: SetState<string | null>
  setHighValueHex: SetState<string | null>
  setPrevBlock: SetState<number | null>
  setPrevValueHex: SetState<string | null>
  setFoundBlock: SetState<number | null>
  setFoundValueHex: SetState<string | null>
  setChanges: SetState<{ block: number; hex: string }[]>
}) {
  const {
    mode,
    api,
    storageKey,
    rangeStart,
    rangeEnd,
    targetNumber,

    setFinding,
    setSearchRange,
    setLowValueHex,
    setHighValueHex,
    setPrevBlock,
    setPrevValueHex,
    setFoundBlock,
    setFoundValueHex,
    setChanges,
  } = params

  if (!validateHexKey(storageKey)) {
    return message.error('Enter a valid hex storage key')
  }

  let targetBn: bigint | undefined
  if (mode === 'number') {
    const num = Number(targetNumber)
    if (Number.isNaN(num)) {
      return message.error('Enter a valid integer target')
    }
    targetBn = BigInt(num)
  }

  setFinding(true)

  try {
    const head = await getHeadNumber(api)
    const start = rangeStart
    const end = rangeEnd !== null ? rangeEnd : head

    if (mode === 'change') {
      let low = start
      let high = end

      // NOTE: Keep exact original behavior: lowVal read at block 0 (not rangeStart)
      let lowVal = await readValWithHash(api, storageKey, 0)
      let highVal = await readValWithHash(api, storageKey, high)

      // If nothing has ever changed since genesis:
      if (lowVal.hex === highVal.hex) {
        setPrevBlock(null)
        setPrevValueHex(null)
        setFoundBlock(0)
        setFoundValueHex(lowVal.hex)
        return
      }

      // initialize UI
      setLowValueHex(lowVal.hex)
      setHighValueHex(highVal.hex)

      // binary search:
      while (high - low > 1) {
        const mid = (low + high) >> 1
        const midVal = await readValWithHash(api, storageKey, mid)

        if (midVal.hex === highVal.hex) {
          // the change must be at or before mid
          high = mid
          highVal = midVal
        } else {
          // the change is after mid
          low = mid
          lowVal = midVal
        }

        setSearchRange([low, high])
        setLowValueHex(lowVal.hex)
        setHighValueHex(highVal.hex)
      }

      // final results are in lowVal / highVal
      setPrevBlock(lowVal.block)
      setPrevValueHex(lowVal.hex)
      setFoundBlock(highVal.block)
      setFoundValueHex(highVal.hex)
      return
    }

    if (mode === 'number') {
      // targetBn is guaranteed
      const t = targetBn as bigint

      let low = start
      let high = end

      const headVal = await readHexAndBnLe(api, storageKey, high)
      if (t >= headVal.bn) {
        setPrevBlock(null)
        setPrevValueHex(null)
        setFoundBlock(high)
        setFoundValueHex(headVal.hex)
        return
      }

      const genVal = await readHexAndBnLe(api, storageKey, 0)
      if (t <= genVal.bn) {
        setPrevBlock(null)
        setPrevValueHex(null)
        setFoundBlock(0)
        setFoundValueHex(genVal.hex)
        return
      }

      while (high - low > 1) {
        const mid = (low + high) >> 1
        const midVal = await readHexAndBnLe(api, storageKey, mid)
        if (midVal.bn < t) {
          low = mid
        } else {
          high = mid
        }
        setSearchRange([low, high])

        // Keep the extra reads to mirror original UI updates:
        const lowData = await readHexAndBnLe(api, storageKey, low)
        const highData = await readHexAndBnLe(api, storageKey, high)
        setLowValueHex(lowData.hex)
        setHighValueHex(highData.hex)
      }

      const lowData = await readHexAndBnLe(api, storageKey, low)
      const highData2 = await readHexAndBnLe(api, storageKey, high)
      const diffL = t - lowData.bn
      const diffH = highData2.bn - t
      const chosen = diffL <= diffH ? low : high
      const prev = chosen === low ? null : low

      setPrevBlock(prev)
      setPrevValueHex(prev != null ? lowData.hex : null)
      setFoundBlock(chosen)
      // NOTE: This mirrors the original logic exactly, even though it looks suspicious.
      // TODO: Consider whether this should be `chosen === low ? lowData.hex : highData2.hex`
      setFoundValueHex((chosen === low ? highData2 : highData2).hex)
      return
    }

    if (mode === 'all') {
      setChanges([])

      const lowVal = await readVal(api, storageKey, start)
      const highVal = await readVal(api, storageKey, end)
      const results: { block: number; hex: string }[] = []

      const walk = async (low: number, high: number, lowData: ValObj, highData: ValObj): Promise<void> => {
        if (lowData.hex === highData.hex) {
          return
        }
        if (high - low <= 1) {
          results.push(highData)
          setChanges([...results].sort((a, b) => b.block - a.block))
          return
        }
        const mid = Math.floor((low + high) / 2)
        const midData = await readVal(api, storageKey, mid)
        await walk(mid, high, midData, highData)
        await walk(low, mid, lowData, midData)
      }

      await walk(start, end, lowVal, highVal)
      setChanges(results.sort((a, b) => b.block - a.block))
      return
    }
  } catch (err: any) {
    message.error(err.message || err.toString())
  } finally {
    setFinding(false)
  }
}
