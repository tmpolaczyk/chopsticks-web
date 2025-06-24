import type { ApiPromise } from '@polkadot/api'
import { useEffect, useState } from 'react'

export interface BlockDateProps {
  api: ApiPromise
  blockNumber: number
}

/**
 * Formats a Date object into a local ISO-like string (YYYY-MM-DDTHH:MM:SS)
 */
function formatLocalIso(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
}

/**
 * Renders the timestamp for a given block number in local ISO format,
 * with UTC ISO and raw timestamp shown on hover.
 */
export function BlockDate({ api, blockNumber }: BlockDateProps) {
  const [ts, setTs] = useState<number | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const hash = await api.rpc.chain.getBlockHash(blockNumber)
        const at = await api.at(hash)
        const timestampBn = await at.query.timestamp.now()
        const timestamp = timestampBn.toNumber()
        if (!cancelled) {
          setTs(timestamp)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching block timestamp', err)
          setError(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [api, blockNumber])

  if (error) {
    return <span>Error fetching date</span>
  }
  if (ts === null) {
    return <span>Loading...</span>
  }

  const date = new Date(ts)
  const localIso = formatLocalIso(date)
  const utcIso = date.toISOString()

  return (
    <time dateTime={localIso} title={`Timestamp: ${ts}\nUTC: ${utcIso}`}>
      {localIso}
    </time>
  )
}
