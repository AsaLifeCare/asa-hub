/** The referrals, read and analysed once; a failed read is `failed`, never an empty file. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { analyseReferrals, type Lead, type ReferralAnalysis } from '@/lib/referralAnalysis'

export type ReferralRead =
  | { state: 'loading' }
  | { state: 'failed'; reason: string }
  | { state: 'ready'; analysis: ReferralAnalysis }

export function useReferralAnalysis() {
  const [rows, setRows] = useState<Lead[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    api.list<Lead>('potentialClients')
      .then((r) => { if (live) setRows(Array.isArray(r) ? r : []) })
      .catch((err) => {
        if (live) setFailure(String((err as Error)?.message ?? err ?? '') || 'The read did not answer.')
      })
    return () => { live = false }
  }, [attempt])

  const analysis = useMemo(() => (rows ? analyseReferrals(rows) : null), [rows])
  const read: ReferralRead = analysis
    ? { state: 'ready', analysis }
    : failure !== null
      ? { state: 'failed', reason: failure }
      : { state: 'loading' }

  /** A write that landed, folded into the rows on screen so every figure follows it. */
  const patch = useCallback((id: string, fields: Lead) => {
    setRows((cur) => cur && cur.map((r) => (String(r.id ?? '') === id ? { ...r, ...fields } : r)))
  }, [])
  const retry = useCallback(() => {
    setFailure(null)
    setAttempt((n) => n + 1)
  }, [])

  return { read, patch, retry }
}
