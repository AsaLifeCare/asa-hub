// The new hire's six steps, as the SERVER sees them.
// Progress used to live only in this browser's localStorage, which is why the same person could see "1 of 6" and…
import { useCallback, useEffect, useState } from 'react'
import { gasAction } from '@/features/hiring/shared'

export type ObDocStatus = 'missing' | 'claimed' | 'uploaded' | 'on_file'

export type ObDoc = {
  id: string
  label: string
  status: ObDocStatus
  /** where it came from, in words — "already on file" / "you sent this here" */
  source: string
  file_url?: string
  /** the Drive id of a copy the server keeps — opened from there (obDocFile) */
  kept_id?: string
  submitted?: string
  expires?: string
  certified?: string
}

export type ObFlow = {
  found: boolean
  // false = the seat is CLOSED: nobody is at the onboarding stage of the pipeline, so there is nobody this visit…
  stage_open?: boolean
  full_name: string
  // The signed New Hire packet, as Dropbox Sign (or a hand-attached copy) has it — resolved from the NAME typed in…
  packet_state?: 'signed' | 'waived' | 'unsigned' | 'ambiguous' | 'unknown'
  packet_on_file?: boolean
  packet_acknowledged: boolean
  background_done: boolean
  documents_done: boolean
  training_done: boolean
  questionnaire_done: boolean
  tutorials_done: boolean
  docs: ObDoc[]
  docs_done: number
  docs_total: number
  /** how many document types this person had already sent through the old form */
  prior_count: number
  // The name we actually searched under.
  matched_name: string
  /** two people are too close to tell apart — we matched neither, on purpose */
  name_ambiguous: string[] | null
}

export type ObStep = 'packet' | 'background' | 'documents' | 'training' | 'questionnaire' | 'tutorials'

export function useObFlow() {
  const [flow, setFlow] = useState<ObFlow | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const fresh = await gasAction<ObFlow>('obFlow', {})
      setFlow(fresh)
      setError('')
      return fresh
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your steps.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Every action answers with the whole flow — no guessing what changed. */
  const run = useCallback(async <T,>(action: string, payload: Record<string, unknown>) => {
    setBusy(true)
    try {
      const next = await gasAction<ObFlow>(action, payload)
      // The relay's write ledger can answer {accepted: true} instead of the flow — the save IS guaranteed (queued…
      const accepted = (d: any) => d && typeof d === 'object' && d.accepted === true
      if (accepted(next)) return ((await load()) ?? next) as T
      setFlow(next)
      return next as T
    } finally {
      setBusy(false)
    }
  }, [load])

  const setName = useCallback((full_name: string) => run<ObFlow>('obSetName', { full_name }), [run])
  // Returns the flow AFTER the step is recorded — that is how the caller knows the sixth one closed the visit…
  const markStep = useCallback((step: ObStep) => run<ObFlow>('obStepDone', { step }), [run])
  const uploadDoc = useCallback(
    (doc_id: string, base64: string, filename: string, mime_type: string, expires?: string) =>
      run('obDocUpload', { doc_id, base64, filename, mime_type, expires }),
    [run],
  )

  /** Undo an attachment we filed (goes to the bin, never erased). */
  // `trash` asks the relay to put the filed copy in Drive's bin (obDocTrash) before the row is cleared
  const removeDoc = useCallback((doc_id: string) => run('obDocRemove', { doc_id, trash: true }), [run])

  // Hand in the signed New Hire packet from here: this exception has to be open — uploading an already-signed…
  const uploadPacket = useCallback(
    async (base64: string, filename: string, mime_type: string) => {
      setBusy(true)
      try {
        const res = await gasAction<{ state?: string; released?: boolean; message?: string }>(
          'obPacketUpload',
          { base64, filename, mime_type },
        )
        await load()
        return res
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  return { flow, error, busy, reload: load, setName, markStep, uploadDoc, removeDoc, uploadPacket }
}
