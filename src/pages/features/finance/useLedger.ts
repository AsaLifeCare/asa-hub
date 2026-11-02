/** The ledger pane's read and its one role rule — shared by Client Finances and the client record's Finances tab. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { gasAction } from '@/features/hiring/shared'
import { useEffectiveRole } from '@/lib/effectiveUser'

export type Fund = {
  fundType: string; opening: number; deposits: number; spending: number
  closing: number; count: number; openingKnown: boolean
}
export type Txn = {
  id: string; date: string; vendor: string; type: string; amount: number
  fundType: string; category: string; description: string; staffMember: string
  receiptName: string; receiptVerdict: string; receiptNote: string; needsReceipt: boolean
}
export type Ledger = {
  client: string; month: string; funds: Fund[]; transactions: Txn[]
  closed: boolean; missingReceipts: number
}

// One client's month from `finLedger`.
export function useLedger(client: string, month: string): {
  ledger: Ledger | null; loading: boolean; error: string; reload: () => void
} {
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [loading, setLoading] = useState(!!client)
  const [error, setError] = useState('')
  const asked = useRef(0)
  const wanted = useRef({ client, month })

  const read = useCallback(async (who: string, mo: string) => {
    const mine = ++asked.current
    setLoading(true)
    try {
      const got = await gasAction<Ledger>('finLedger', { client: who, month: mo })
      if (mine !== asked.current) return
      setLedger(got)
      setError('')
    } catch (e) {
      if (mine !== asked.current) return
      setLedger(null)
      setError(e instanceof Error && e.message ? e.message : 'Try again.')
    } finally {
      if (mine === asked.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    wanted.current = { client, month }
    setLedger(null)
    setError('')
    if (!client) {
      asked.current++
      setLoading(false)
      return
    }
    void read(client, month)
  }, [client, month, read])

  // after a write: the month on screen NOW, never the one the write started from
  const reload = useCallback(() => {
    const w = wanted.current
    if (w.client) void read(w.client, w.month)
  }, [read])

  return { ledger, loading, error, reload }
}

/** Closing a month is the admin's alone, asked of the EFFECTIVE person: the server clamps a visit to the visited role. */
export function useMayCloseMonth(): boolean {
  return useEffectiveRole() === 'admin'
}
