import { describe, expect, it, mock } from 'bun:test'
// ---- 1) Mock antd BEFORE importing your module under test ----
const messageCalls: string[] = []

mock.module('antd', () => {
  return {
    // Only what's used by your code; everything else can be noop
    message: {
      error: (m: unknown) => messageCalls.push(String(m)),
      info: () => {},
      success: () => {},
      warning: () => {},
    },
  }
})

import type React from 'react'
import { performBinarySearchAndSetState } from '../src/storage_binary_search'

// import your function normally (no DI version)
// import { performBinarySearchAndSetState } from "../src/wherever/your/file";

type SetState<T> = React.Dispatch<React.SetStateAction<T>>
function makeState<T>(initial: T) {
  let current = initial
  const set: SetState<T> = (v) => {
    current = typeof v === 'function' ? (v as any)(current) : v
  }
  return { get: () => current, set }
}

// --- Build a minimal fake ApiPromise compatible with your helpers ---
// - query.system.number() -> { toNumber: () => head }
// - rpc.chain.getBlockHash(block) -> { toHex: () => `0x${block.toString(16)}` }
// - rpc.state.getStorage(key, hash) -> { toHex: () => hexByBlock[block] ?? "0x" }
function makeFakeApi(head: number, hexByBlock: Record<number, string>) {
  return {
    query: {
      system: {
        number: async () => ({ toNumber: () => head }),
      },
    },
    rpc: {
      chain: {
        getBlockHash: async (block: number) => ({
          toHex: () => `0x${block.toString(16)}`,
        }),
      },
      state: {
        getStorage: async (_key: string, hash: { toHex: () => string }) => {
          const hex = hash.toHex()
          const block = Number.parseInt(hex.slice(2), 16) // decode our fake hash
          return { toHex: () => hexByBlock[block] ?? '0x' }
        },
      },
    },
  } as any
}

describe('performBinarySearchAndSetState (no DI) with fake ApiPromise', () => {
  it('mode=change: finds first change boundary', async () => {
    // Blocks 0..6 => 0xAA, 7..10 => 0xBB
    const hexByBlock: Record<number, string> = {}
    for (let i = 0; i <= 10; i++) hexByBlock[i] = i >= 7 ? '0xBB' : '0xAA'

    const api = makeFakeApi(10, hexByBlock)

    const finding = makeState(false)
    const searchRange = makeState<[number, number] | null>(null)
    const lowHex = makeState<string | null>(null)
    const highHex = makeState<string | null>(null)
    const prevBlock = makeState<number | null>(null)
    const prevHex = makeState<string | null>(null)
    const foundBlock = makeState<number | null>(null)
    const foundHex = makeState<string | null>(null)
    const changes = makeState<{ block: number; hex: string }[]>([])

    await performBinarySearchAndSetState({
      mode: 'change',
      api,
      storageKey: '0xdeadbeef',
      rangeStart: 0,
      rangeEnd: 10,
      setFinding: finding.set,
      setSearchRange: searchRange.set,
      setLowValueHex: lowHex.set,
      setHighValueHex: highHex.set,
      setPrevBlock: prevBlock.set,
      setPrevValueHex: prevHex.set,
      setFoundBlock: foundBlock.set,
      setFoundValueHex: foundHex.set,
      setChanges: changes.set,
    })

    expect(finding.get()).toBe(false)
    expect(prevBlock.get()).toBe(6)
    expect(prevHex.get()).toBe('0xAA')
    expect(foundBlock.get()).toBe(7)
    expect(foundHex.get()).toBe('0xBB')
    expect(searchRange.get()).toEqual([6, 7])
    expect(changes.get()).toEqual([])
  })

  it('mode=number: chooses nearest block; found hex mirrors current logic', async () => {
    // For readHexAndBnLe: provide LE-friendly single-byte hex = block number
    const hexByBlock: Record<number, string> = {}
    for (let i = 0; i <= 10; i++) hexByBlock[i] = `0x${i.toString(16).padStart(2, '0')}`

    const api = makeFakeApi(10, hexByBlock)

    const finding = makeState(false)
    const searchRange = makeState<[number, number] | null>(null)
    const lowHex = makeState<string | null>(null)
    const highHex = makeState<string | null>(null)
    const prevBlock = makeState<number | null>(null)
    const prevHex = makeState<string | null>(null)
    const foundBlock = makeState<number | null>(null)
    const foundHex = makeState<string | null>(null)
    const changes = makeState<{ block: number; hex: string }[]>([])

    await performBinarySearchAndSetState({
      mode: 'number',
      api,
      storageKey: '0xdeadbeef',
      rangeStart: 0,
      rangeEnd: 10,
      targetNumber: '6',
      setFinding: finding.set,
      setSearchRange: searchRange.set,
      setLowValueHex: lowHex.set,
      setHighValueHex: highHex.set,
      setPrevBlock: prevBlock.set,
      setPrevValueHex: prevHex.set,
      setFoundBlock: foundBlock.set,
      setFoundValueHex: foundHex.set,
      setChanges: changes.set,
    })

    expect(finding.get()).toBe(false)
    expect(foundBlock.get()).toBe(6)
    expect(prevBlock.get()).toBe(5)
    expect(prevHex.get()).toBe(hexByBlock[5])
    // Current suspicious line always uses "high" hex; when you fix it, update this assertion.
    expect(foundHex.get()).toBe(hexByBlock[6])
  })
})
