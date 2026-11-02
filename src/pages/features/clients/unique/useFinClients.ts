/** `finClients`, read once when the Finances section is first drawn: the form's vocabulary and the names the ledger is keyed by. */
import { useEffect, useState } from 'react'
import { gasAction } from '@/features/hiring/shared'

export type FinBoot = {
  clients: { id?: string; name: string; house?: string }[]
  fundTypes: string[]; categories: string[]; txnTypes: string[]; exemptReasons?: string[]
}

export type FinRead = { boot: FinBoot | null; error: string }

export function useFinClients(): FinRead {
  const [read, setRead] = useState<FinRead>({ boot: null, error: '' })
  useEffect(() => {
    let alive = true
    gasAction<FinBoot>('finClients', {})
      .then((boot) => { if (alive) setRead({ boot, error: '' }) })
      .catch((e) => { if (alive) setRead({ boot: null, error: e instanceof Error && e.message ? e.message : 'try again.' }) })
    return () => { alive = false }
  }, [])
  return read
}
