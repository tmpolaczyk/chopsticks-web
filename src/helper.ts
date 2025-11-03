import { type Block, decodeBlockStorageDiff } from '@acala-network/chopsticks-core'
import { create } from 'jsondiffpatch'
import _ from 'lodash'

export const callToHuman = (call: any) => {
  if (!call) return
  return JSON.stringify(Object.fromEntries((call.argsEntries as any).map(([k, v]: any) => [k, v.toHuman()])), null, 2)
}

const diffPatcher = create({
  arrays: { detectMove: false },
  textDiff: { minLength: Number.MAX_VALUE } as any, // skip text diff
})

export const decodeStorageDiff = async (block: Block, diff: [string, string | null][]) => {
  const [oldState, newState] = await decodeBlockStorageDiff(block, diff as any)
  const oldStateWithoutEvents = _.cloneDeep(oldState) as any
  if (oldStateWithoutEvents.system?.events) {
    oldStateWithoutEvents.system.events = []
  }
  return { oldState, newState, delta: diffPatcher.diff(oldStateWithoutEvents, newState) }
}

export const decodeStorageDiffWithOverlay = async (
  block: Block,
  oldDiff: [string, string | null][],
  newDiff: [string, string | null][],
) => {
  const [oldState, newState] = await decodeBlockStorageDiffWithOverlay(block, oldDiff, newDiff)
  const oldStateWithoutEvents = _.cloneDeep(oldState) as any
  if (oldStateWithoutEvents.system?.events) {
    oldStateWithoutEvents.system.events = []
  }
  return { oldState, newState, delta: diffPatcher.diff(oldStateWithoutEvents, newState) }
}

/**
 * Decode block storage diff with an overlay:
 * - If a key exists in `oldDiff`, use that value for the "old" side (even if it's `null`).
 * - Otherwise, fall back to `block.get(key)` for the "old" side.
 * - Always use `newDiff`’s value for the "new" side.
 */
/*
export const decodeBlockStorageDiffWithOverlay = async (
  block: Block,
  oldDiff: [string, string | null][],
  newDiff: [string, string | null][],
) => {
  const oldState: Record<string, any> = {}
  const newState: Record<string, any> = {}

  // O(1) lookups and correct presence vs null handling
  const oldDiffMap = new Map<string, string | null>(oldDiff)
  const meta = await block.meta

  const decodeInto = (acc: Record<string, any>, key: string, val: string | null) => {
    const decoded = toStorageObject(decodeKeyValue(meta, key, val)) ?? { [key]: val }
    _.merge(acc, decoded)
  }

  for (const [key, newVal] of newDiff) {
    // If oldDiff provided a value (including explicit null), use it; else fall back to chain state.
    const oldVal = oldDiffMap.has(key) ? oldDiffMap.get(key)! : await block.get(key)

    // TODO: not sure if needed
    if (oldVal === newVal) {
      continue
    }

    decodeInto(oldState, key, oldVal ?? null)
    decodeInto(newState, key, newVal ?? null)
  }

  return [oldState, newState] as const
}
  */

// less efficient function but keeps same behavior as the original one
export const decodeBlockStorageDiffWithOverlay = async (
  block: Block,
  oldDiff: [string, string | null][],
  newDiff: [string, string | null][],
) => {
  const oldMap = new Map<string, string | null>(oldDiff)

  // Build explicit entry lists for old/new (relative to parent),
  // but let chopsticks' decodeBlockStorageDiff do the humanization.
  const oldEntries: [string, string | null][] = []
  const newEntries: [string, string | null][] = []

  for (const [key, newVal] of newDiff) {
    const oldVal = oldMap.has(key) ? oldMap.get(key)! : await block.get(key)
    if (oldVal === newVal) continue // unchanged in this step
    oldEntries.push([key, oldVal ?? null])
    newEntries.push([key, newVal ?? null])
  }

  // Decode each side with the SAME pipeline as the working path.
  const [, oldState] = await decodeBlockStorageDiff(block, oldEntries as any)
  const [, newState] = await decodeBlockStorageDiff(block, newEntries as any)

  return [oldState, newState] as const
}
