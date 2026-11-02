// A training paper's flow, as File training document drives it: the paper is filed against the person's record…
import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_UPLOAD_BYTES, extOf, humanSize } from '@/features/hiring/shared'
import type { PlatformDocMeta, PlatformDocOpener } from '@/lib/platformDoc'
import { docShapeOf } from '@/pages/features/myprofile/certDocFile'
import { sentence } from '@/pages/features/myprofile/myProfileModel'
import { paperOf, paperRecordOf, readRefusal, type PaperRecord, type PaperRow, type RosterRow } from './staffModel'
import { confirmPaperDate, filePaper, readPaper, readPaperFile, readPaperRecord, staffWritten, staffWrote } from './useStaffRead'

/* ---------- the paper ---------- */

const PAPER_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif'])

export const PAPER_TYPES = 'A PDF, or a JPG, PNG, GIF, WebP or HEIC picture'

/** Why this file is not filed, or '' — ComplianceDocs.gs CERT_DOC_TYPES; the door decides again. */
export function paperRefusal(file: { name: string; size: number; type: string }): string {
  const type = String(file.type || '').toLowerCase()
  const loose = !type || type === 'application/octet-stream'
  const ok = loose ? PAPER_EXTS.has(extOf(file.name)) : !!docShapeOf(type === 'image/jpg' ? 'image/jpeg' : type)
  if (!ok) return `${PAPER_TYPES} — nothing else is filed.`
  if (!file.size) return 'The file is empty.'
  if (file.size > MAX_UPLOAD_BYTES) return `${humanSize(file.size)} — up to 15MB.`
  return ''
}

export const HEIC_UNREAD = 'A HEIC photo is filed, but the decoder cannot read it for its dates — a JPG or PDF of the same ' +
  'paper is read.'

/** What a file that is filed still will not give, or '' — the decoder reads no HEIC (ComplianceDocs.gs CERT_READ_WORDS.heic). */
export function paperWarning(file: { name: string; type: string }): string {
  const type = String(file.type || '').toLowerCase()
  const ext = extOf(file.name)
  return type === 'image/heic' || type === 'image/heif' || ext === 'heic' || ext === 'heif' ? HEIC_UNREAD : ''
}

/** The filed paper, centred in the platform's viewer from its bytes. */
export function openPaper(doc: PlatformDocOpener, id: string, meta: PlatformDocMeta): void {
  doc.open(id, () => readPaperFile(id), meta)
}

/* ---------- the flow: file, read, the record, confirm ---------- */

export type RecordState = PaperRecord & { status: 'idle' | 'loading' | 'ready' | 'failed' }

const RECORD_IDLE: RecordState = { status: 'idle', dateSource: '', dateRole: '', value: '', why: '', allowed: false }

export type PaperState = {
  phase: 'idle' | 'filing' | 'reading' | 'ready'
  /** why the filing did not go through */
  error: string
  filed: PaperRow | null
  reading: PaperRow | null
  /** why the reading waits for the next pass; '' once it settled */
  waiting: string
  record: RecordState
  confirming: boolean
  /** the record changed since it was shown: what it holds now, the witness of the next confirmation */
  moved: string | null
  said: { tone: 'success' | 'danger'; text: string } | null
  confirmedOn: string
}

export const PAPER_IDLE: PaperState = {
  phase: 'idle', error: '', filed: null, reading: null, waiting: '', record: RECORD_IDLE, confirming: false, moved: null,
  said: null, confirmedOn: '',
}

export const NEXT_PASS = 'It waits for the next pass, which reads it again within minutes. Press Read again to try now, or ' +
  'type the date from the document below.'

export const FILED_NO_ID = 'The server took the document but answered without its id, so it is not read or confirmed here ' +
  '— it shows under Documents once the server has written it.'

const said = (err: unknown): string => readRefusal(err instanceof Error ? err.message : String(err))

type PaperFile = { filename: string; mime: string; base64: string }

// The four doors in order.
export function useTrainingPaper(staff: Pick<RosterRow, 'key' | 'name'>) {
  const [state, setState] = useState<PaperState>(PAPER_IDLE)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const put = useCallback((fn: (s: PaperState) => PaperState) => {
    if (live.current) setState(fn)
  }, [])

  const loadRecord = useCallback(async (id: string) => {
    put((s) => ({ ...s, record: { ...s.record, status: 'loading' } }))
    try {
      const got = paperRecordOf(await readPaperRecord(id))
      put((s) => ({ ...s, record: { ...got, status: 'ready' } }))
    } catch (err) {
      put((s) => ({ ...s, record: { ...RECORD_IDLE, status: 'failed', why: said(err) } }))
    }
  }, [put])

  const read = useCallback(async (id: string) => {
    put((s) => ({ ...s, phase: 'reading', waiting: '' }))
    try {
      const got = paperOf(await readPaper(id))
      const settled = got.readState === 'read' || got.readState === 'unread'
      put((s) => ({ ...s, phase: 'ready', reading: got.id ? got : s.reading,
        waiting: settled ? '' : sentence(got.readWhy) || 'The dates are not read yet.' }))
      if (settled) staffWritten(staff.key)
    } catch (err) {
      put((s) => ({ ...s, phase: 'ready', waiting: `The dates could not be read just now: ${sentence(said(err))}` }))
    }
  }, [put, staff.key])

  const file = useCallback(async (reqId: string, paper: PaperFile) => {
    put(() => ({ ...PAPER_IDLE, phase: 'filing' }))
    let filed: PaperRow
    try {
      const raw = await filePaper({ person: staff.name, req_id: reqId, filename: paper.filename, mime: paper.mime,
        base64: paper.base64 })
      staffWrote(staff.key, raw)
      filed = paperOf(raw)
    } catch (err) {
      put((s) => ({ ...s, phase: 'idle', error: said(err) }))
      return
    }
    if (!filed.id) {
      put((s) => ({ ...s, phase: 'ready', error: FILED_NO_ID }))
      return
    }
    put((s) => ({ ...s, filed }))
    await Promise.all([read(filed.id), loadRecord(filed.id)])
  }, [put, read, loadRecord, staff.key, staff.name])

  /** A paper already on the ledger: its reading answered again (or read now) and the record read — nothing filed. */
  const resume = useCallback(async (paper: PaperRow) => {
    if (!paper.id) return
    put(() => ({ ...PAPER_IDLE, phase: 'reading', filed: paper }))
    await Promise.all([read(paper.id), loadRecord(paper.id)])
  }, [put, read, loadRecord])

  const filedId = state.filed?.id ?? ''
  const reading = state.phase === 'reading'
  const readAgain = useCallback(() => {
    if (filedId && !reading) void read(filedId)
  }, [filedId, reading, read])

  const recordLoading = state.record.status === 'loading'
  const reloadRecord = useCallback(() => {
    if (filedId && !recordLoading) void loadRecord(filedId)
  }, [filedId, recordLoading, loadRecord])

  const expected = state.record.value
  const confirming = state.confirming
  // True once the record holds the date.
  const confirm = useCallback(async (date: string): Promise<boolean> => {
    const id = filedId
    if (!id || confirming) return false
    put((s) => ({ ...s, confirming: true, said: null }))
    try {
      const got = await confirmPaperDate(id, date, expected)
      staffWrote(staff.key, got)
      const on = String(got?.confirmed_on || date)
      put((s) => ({ ...s, confirming: false, moved: null, confirmedOn: on, record: { ...s.record, status: 'loading' },
        said: { tone: 'success', text: String(got?.message || `The Employee Database now holds ${on}.`) } }))
      void loadRecord(id)
      return true
    } catch (err) {
      const current = (err as { envelope?: { data?: { current?: unknown } } } | null)?.envelope?.data?.current
      if (typeof current === 'string') {
        put((s) => ({ ...s, confirming: false, moved: current, record: { ...s.record, value: current },
          said: { tone: 'danger', text: said(err) } }))
      } else {
        put((s) => ({ ...s, confirming: false, said: { tone: 'danger', text: said(err) } }))
        void loadRecord(id)
      }
      return false
    }
  }, [filedId, confirming, expected, put, loadRecord, staff.key])

  return { state, file, resume, readAgain, reloadRecord, confirm }
}

