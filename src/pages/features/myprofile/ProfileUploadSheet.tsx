// Upload and read into My Requirements: the paper is filed through the certificate door under its requirement id…
// A person is named only as the relay's `file_as` — the roster spelling the master's session files under (the…
import { useEffect, useRef, useState } from 'react'
import { Loader2, ScanText } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { fileToBase64, gasAction, inferMime } from '@/features/hiring/shared'
import { uploadRefusal } from '@/pages/features/mywork/UploadAssetSheet'
import { readResult, sentence, type RequirementRow, type VersionRow } from './myProfileModel'

export const UPLOAD_AND_READ = 'Upload and read into My Requirements'

/** The row to file for, and the day and window its status was classed by. */
export type ProfileUploadAsk = { row: RequirementRow; own: boolean; on?: string; window?: number }

type Filed = VersionRow & { shared?: boolean; read_state?: string }

/** The one filing call: the requirement id (an onboarding form: its label alone), the file, and a person only as the
 *  relay's file_as. */
export function fileOwnVersion(row: Pick<RequirementRow, 'req_id' | 'cert' | 'file_as'> & { upload?: RequirementRow['upload'] },
  file: { base64: string; filename: string; mime: string }): Promise<Filed> {
  return gasAction<Filed>('certDocUpload', {
    req_id: row.upload?.by_label ? '' : row.req_id, cert: row.cert, base64: file.base64, filename: file.filename,
    mime: file.mime,
    ...(row.file_as ? { person: row.file_as } : {}),
  }, { retry: false })
}

/** The decoder's reading of one filed paper, kept on its ledger row. */
export function readVersion(id: string): Promise<VersionRow> {
  return gasAction<VersionRow>('certDocRead', { id })
}

export type UploadStep = { phase: 'reading' | 'done'; line: string; tone: 'success' | 'warning' | 'muted' }

// Files the paper, reads it, then refreshes.
export async function fileAndRead(ask: ProfileUploadAsk, file: { base64: string; filename: string; mime: string },
  onStep: (step: UploadStep) => void, onFiled: () => void): Promise<void> {
  const filed = await fileOwnVersion(ask.row, file)
  const name = filed?.name || file.filename
  const whose = ask.own ? 'your' : 'the'
  const under = !ask.own && filed?.person ? ` under ${filed.person}` : ''
  if (!filed?.id || filed.read_state !== 'pending') {
    onStep({ phase: 'done', line: `${name} was filed${under}.`, tone: 'success' })
    onFiled()
    return
  }
  onStep({ phase: 'reading', line: `${name} was filed${under}. Reading the dates on ${whose} document…`, tone: 'muted' })
  try {
    const got = await readVersion(filed.id)
    const line = readResult(ask.row, got, ask.on, ask.window, ask.own)
    const tone = got?.read_state === 'read' ? 'success' : got?.read_state === 'unread' ? 'warning' : 'muted'
    onStep({ phase: 'done', line: `${name} was filed${under}. ${line}`, tone })
  } catch (err) {
    const why = sentence(err instanceof Error ? err.message : String(err)) || 'No answer came back.'
    onStep({ phase: 'done', tone: 'warning',
      line: `${name} was filed${under}, but its dates could not be read just now: ${why} It is read again within minutes.` })
  }
  onFiled()
}

export function ProfileUploadBody({ ask, busy, step, error, onPick }: {
  ask: ProfileUploadAsk
  busy: boolean
  step: UploadStep | null
  error: string
  onPick: () => void
}) {
  const where = ask.own ? 'against your own record' : `under ${ask.row.file_as || 'this person'}’s record`
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] leading-[1.55] text-text-2">
        A new version of <span className="font-semibold text-text-1">{ask.row.requirement}</span>, filed {where} in the
        compliance folder, then read for its dates. A photo or a PDF, up to 15MB.
      </p>
      <button type="button" onClick={onPick} disabled={busy}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-primary px-4 text-[12.5px] font-semibold text-primary hover:bg-primary/5 disabled:opacity-40">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <ScanText size={14} />} Choose a file
      </button>
      {error && <p role="alert" className="text-[12.5px] text-[var(--danger)]">{error}</p>}
      {step && (
        <p role="status" className={step.tone === 'success' ? 'text-[12.5px] text-[var(--success)]'
          : step.tone === 'warning' ? 'text-[12.5px] text-[var(--warning)]' : 'text-[12.5px] text-text-2'}>
          {step.phase === 'reading' && <Loader2 size={13} className="mr-1.5 inline animate-spin" />}
          {step.line}
        </p>
      )}
    </div>
  )
}

/** The panel's small-caps word and accessible name. */
export const UPLOAD_PANEL_LABEL = 'Upload'

export default function ProfileUploadSheet({ ask, onClose, onFiled }: {
  ask: ProfileUploadAsk | null
  onClose: () => void
  onFiled: () => void
}) {
  return (
    <SidePanel open={ask !== null} onClose={onClose} label={UPLOAD_PANEL_LABEL} title={UPLOAD_AND_READ}>
      {/* one flow per requirement: a filing still running for another row never speaks in this one */}
      {ask && <UploadFlow key={ask.row.id} ask={ask} onFiled={onFiled} />}
    </SidePanel>
  )
}

function UploadFlow({ ask, onFiled }: { ask: ProfileUploadAsk; onFiled: () => void }) {
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<UploadStep | null>(null)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setStep(null)
    setError('')
  }, [ask])

  const picked = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (!f) return
    const refused = uploadRefusal(f)
    if (refused) {
      setError(refused)
      return
    }
    setBusy(true)
    setError('')
    setStep(null)
    try {
      await fileAndRead(ask, { base64: await fileToBase64(f), filename: f.name, mime: inferMime(f) }, setStep, onFiled)
    } catch (e) {
      setError(e instanceof Error ? `The upload did not go through: ${e.message}` : 'The upload did not go through.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="mt-1 text-[12.5px] leading-[1.5] text-text-2" data-upload-for={ask.row.id}>{ask.row.requirement}</p>
      <div className="mt-4">
        <ProfileUploadBody ask={ask} busy={busy} step={step} error={error} onPick={() => input.current?.click()} />
      </div>
      <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={picked} />
    </>
  )
}
