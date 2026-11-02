// Broadcast: one text to a group of staff.
// Review shows the exact recipients, Send confirms with the count, and every broadcast is a row with each copy's…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ChevronDown, ChevronRight, Loader2, Megaphone, PenLine, Printer, RefreshCw, Send, Share2, Undo2, Users,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import ExportMenu from '@/components/shared/ExportMenu'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { askConfirm } from '@/stores/useDialogStore'
import { share } from '@/stores/useShareStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { ohioDateTime } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'
import CoveredNotices from '@/pages/features/smartcomms/CoveredNotices'
import { looksLikeCovered } from '@/pages/features/smartcomms/coveredLogic'
import {
  HISTORY_COLUMNS, SIGNATURE_MAX, TEXT_MAX, composerFromRow, composerKey, composerPayload, headline, modeSentences,
  newClientId,
  outcomeChip, previewMatches, reviewBlock, rowActions, sendBlock, sourceWord, stateChip, tallyOf, tallyWords,
  type AudienceId, type BroadcastBoard, type BroadcastPreview, type BroadcastRow, type Composer,
} from '@/pages/features/smartcomms/broadcastLogic'

const INPUT = 'h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong'
const AREA = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] leading-5 text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong'
const BTN = 'inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40'
const PRIMARY = 'inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40'
const ICON_BTN = 'grid h-9 w-9 place-items-center rounded-md border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1'

/** Automatic continues before the rest is left to the Continue button. */
const AUTO_CONTINUE = 6

const EMPTY: Composer = { audience: '', house: '', meddel: false, message: '', signature: '' }

function errText(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : ''
  if (m === 'timeout') {
    return 'The server is still working on it. Refresh the list in a minute — a copy that already left is never sent twice.'
  }
  return m || fallback
}

function Chip({ label, tint }: { label: string; tint: keyof typeof TINT_BG }) {
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', TINT_BG[tint], TINT_FG[tint])}>{label}</span>
  )
}

export default function SmartCommsBroadcastPage() {
  const [board, setBoard] = useState<BroadcastBoard | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [c, setC] = useState<Composer>(EMPTY)
  const [preview, setPreview] = useState<BroadcastPreview | null>(null)
  const [previewKey, setPreviewKey] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState('')
  /* one key per composition: kept across retries, replaced when words or audience change */
  const sendKey = useRef<{ id: string; composer: string }>({ id: newClientId(), composer: '' })
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await gasAction<BroadcastBoard>('staffBroadcastBoard', {}, { timeoutMs: 120_000 })
      setBoard(d)
      setLoadError('')
      /* THE FIRST AUDIENCE THE DOOR OPENS, once — never over a choice made. */
      setC((prev) => {
        if (prev.audience) return prev
        const first = (d.audiences || []).find((a) => a.allowed)
        const house = d.houses && d.houses.length === 1 ? d.houses[0].location : prev.house
        return { ...prev, audience: first ? first.id : '', house }
      })
    } catch (e) {
      /* the board stays as it was — a failed refresh must not redraw the history as empty */
      setLoadError(errText(e, 'The Broadcast page could not be read.'))
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const set = <K extends keyof Composer>(k: K, v: Composer[K]) => setC((prev) => ({ ...prev, [k]: v }))

  const stale = !!preview && !previewMatches(c, previewKey)
  const blockReview = reviewBlock(c, board)
  const blockSend = stale ? 'The text or the audience changed since the review — review again.' : sendBlock(preview, board)

  const replaceRow = (row: BroadcastRow) => {
    setBoard((b) => {
      if (!b) return b
      const rest = (b.history || []).filter((h) => h.id !== row.id)
      return { ...b, history: [row, ...rest] }
    })
  }

  const review = async () => {
    if (blockReview) return
    setReviewing(true)
    try {
      const key = composerKey(c)
      const p = await gasAction<BroadcastPreview>('staffBroadcastPreview', composerPayload(c), { timeoutMs: 120_000 })
      setPreview(p)
      setPreviewKey(key)
    } catch (e) {
      toast({ type: 'danger', title: 'The recipients could not be reviewed', body: errText(e, 'Try again.') })
    }
    setReviewing(false)
  }

  /** carry a stopped pass on; per-copy keys make a repeat send nothing twice */
  const carryOn = async (row: BroadcastRow) => {
    let current = row
    for (let i = 0; i < AUTO_CONTINUE && current.state === 'partial' && current.can_continue; i++) {
      const t = tallyOf(current.tally)
      setProgress(`${current.count - t.pending} of ${current.count} done — sending the rest…`)
      const d = await gasAction<{ broadcast?: BroadcastRow; refused?: string }>(
        'staffBroadcastContinue', { id: current.id }, { timeoutMs: 180_000 })
      if (!d.broadcast) break
      current = d.broadcast
      replaceRow(current)
      if (d.refused) break
    }
    setProgress('')
    return current
  }

  const send = async () => {
    if (!preview || blockSend) return
    const n = preview.count
    const names = preview.recipients.map((r) => r.name || formatPhoneDisplay(r.to))
    const sample = names.slice(0, 8).join(', ') + (names.length > 8 ? ` and ${names.length - 8} more` : '')
    const cautions: string[] = []
    if (preview.reason_words.length) {
      cautions.push(`The text may say why a shift is open or who called off (${preview.reason_words.join(', ')}) — staff never learn either.`)
    }
    cautions.push(...modeSentences(preview.mode, preview.situation))
    const ok = await askConfirm({
      title: `Send this text to ${n} ${n === 1 ? 'person' : 'people'}?`,
      body: `${preview.audience_label}: ${sample}.`,
      detail: cautions.join(' ') || undefined,
      confirmLabel: `Send to ${n}`,
      tone: preview.reason_words.length ? 'danger' : 'primary',
    })
    if (!ok) return
    setSending(true)
    const composing = composerKey(c)
    if (sendKey.current.composer && sendKey.current.composer !== composing) {
      sendKey.current = { id: newClientId(), composer: composing }
    } else {
      sendKey.current = { ...sendKey.current, composer: composing }
    }
    try {
      const d = await gasAction<{ broadcast?: BroadcastRow; already?: boolean; changed?: boolean; preview?: BroadcastPreview }>(
        'staffBroadcastSend',
        { ...composerPayload(c), client_id: sendKey.current.id, audience_sha: preview.audience_sha },
        { timeoutMs: 180_000 })
      if (d.changed && d.preview) {
        /* nothing sent: the list moved since review, confirm again */
        setPreview(d.preview)
        setPreviewKey(composerKey(c))
        toast({ type: 'warning', title: 'The audience changed — nothing was sent',
                body: `It is ${d.preview.count} now, not ${n}. Check the list and send again.` })
      } else if (d.broadcast) {
        replaceRow(d.broadcast)
        setOpen((o) => ({ ...o, [d.broadcast!.id]: true }))
        if (d.already) toast({ type: 'info', title: 'This broadcast had already been sent — here it is.' })
        const done = d.broadcast.state === 'partial' ? await carryOn(d.broadcast) : d.broadcast
        toast({ type: 'success', title: 'Broadcast recorded', body: headline(done).text })
        setC((prev) => ({ ...prev, message: '', signature: '' }))
        setPreview(null)
        setPreviewKey('')
        sendKey.current = { id: newClientId(), composer: '' }
      }
    } catch (e) {
      toast({ type: 'danger', title: 'The broadcast did not complete', body: errText(e, 'Refresh the list to see where it stands.') })
    }
    setSending(false)
  }

  const continueRow = async (row: BroadcastRow) => {
    setBusy(row.id)
    try {
      const d = await gasAction<{ broadcast?: BroadcastRow; refused?: string }>(
        'staffBroadcastContinue', { id: row.id }, { timeoutMs: 180_000 })
      if (d.broadcast) {
        replaceRow(d.broadcast)
        const done = d.broadcast.state === 'partial' ? await carryOn(d.broadcast) : d.broadcast
        toast({ type: d.refused ? 'info' : 'success', title: d.refused || headline(done).text })
      }
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing was continued', body: errText(e, 'Try again.') })
    }
    setBusy('')
  }

  /** refill the composer from a row, under a new key */
  const writeAgain = (row: BroadcastRow) => {
    setC(composerFromRow(row))
    setPreview(null)
    setPreviewKey('')
    sendKey.current = { id: newClientId(), composer: '' }
    toast({ type: 'info', title: 'The words are back in the composer above', body: 'Review the recipients, then send.' })
  }

  const withdrawRow = async (row: BroadcastRow) => {
    const pending = tallyOf(row.tally).pending
    const ok = await askConfirm({
      title: `Withdraw this broadcast?`,
      body: `The ${pending} ${pending === 1 ? 'person' : 'people'} not asked yet will never receive it. What already left cannot be recalled.`,
      confirmLabel: 'Withdraw',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(row.id)
    try {
      const d = await gasAction<{ broadcast?: BroadcastRow; refused?: string }>(
        'staffBroadcastWithdraw', { id: row.id }, { timeoutMs: 120_000 })
      if (d.broadcast) replaceRow(d.broadcast)
      toast({ type: d.refused ? 'info' : 'success', title: d.refused || 'Withdrawn — the rest will never be asked.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing was withdrawn', body: errText(e, 'Try again.') })
    }
    setBusy('')
  }

  const history = board?.history ?? []
  const sentences = useMemo(() => modeSentences(board?.mode, board?.situation), [board])
  const audiences = board?.audiences ?? []
  const houses = board?.houses ?? []

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Broadcast"
          subtitle="One text to a group of staff — the exact list shown before it goes, and every brake the platform has."
          actions={
            <div className="flex items-center gap-2">
              <PageSwitch />
              <button type="button" onClick={() => void load()} className={BTN}>
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          }
        />
      </motion.div>

      <div className="mb-5 rounded-[16px] bg-detail-hero p-6 shadow-2">
        <div className="flex flex-wrap items-start gap-6">
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">Where a broadcast goes today</p>
            {!board ? (
              <p className="mt-2 text-[13px] text-white/70">{loadError || 'Reading…'}</p>
            ) : sentences.length ? (
              <ul className="mt-2 space-y-1.5 text-[13px] leading-5 text-white/85">
                {sentences.map((s) => <li key={s}>{s}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] leading-5 text-white/85">
                Test mode is off and the sending switch is on: a broadcast reaches every phone on the list you confirm.
              </p>
            )}
          </div>
          <div className="min-w-0 sm:w-[260px]">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">The words on the Desk</p>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-white/10 px-3 py-2 font-mono text-[12px] leading-5 text-white/85">
              {board?.situation?.sms_text || '{message}\n{signature}'}
            </pre>
            <p className="mt-1.5 text-[11.5px] leading-4 text-white/55">
              Rewrite them on the Desk (row <span className="font-mono">staff_broadcast</span>) — no publish needed.
            </p>
          </div>
        </div>
      </div>

      {loadError && board && (
        <p className="mb-3 rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{loadError}</p>
      )}

      {board && !board.can_send && (
        <Card padded={false} className="mb-5 flex items-start gap-3 p-4">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-tint-fg-amber" />
          <div>
            <p className="text-[13.5px] font-semibold text-text-1">Broadcasting is not open to this account</p>
            <p className="mt-0.5 text-[12.5px] leading-5 text-text-2">{board.why}</p>
          </div>
        </Card>
      )}

      {board?.can_send && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {/* ---- THE COMPOSER ---- */}
          <Card>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-3">Who it goes to</p>
            <div className="flex flex-wrap gap-1.5">
              {audiences.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  disabled={!a.allowed}
                  title={a.allowed ? '' : a.why}
                  onClick={() => set('audience', a.id as AudienceId)}
                  className={cn('h-8 rounded-full border px-3 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    c.audience === a.id ? 'border-primary bg-tint-primary text-tint-fg-primary' : 'border-border bg-surface text-text-2 hover:bg-surface-2')}
                >
                  {a.label}
                </button>
              ))}
            </div>
            {audiences.some((a) => !a.allowed) && (
              <p className="mt-1.5 text-[11.5px] leading-4 text-text-3">
                {audiences.filter((a) => !a.allowed).map((a) => `${a.label}: ${a.why}`).join(' · ')}
              </p>
            )}

            {c.audience === 'house' && (
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <select value={c.house} onChange={(e) => set('house', e.target.value)} className={INPUT} aria-label="House">
                  <option value="">Choose the house…</option>
                  {houses.map((h) => (
                    <option key={h.location} value={h.location}>
                      {h.label} — {h.people} on the calendar, {h.meddel} Med Del
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-[12.5px] text-text-2">
                  <input type="checkbox" checked={c.meddel} onChange={(e) => set('meddel', e.target.checked)} />
                  Only Med Del at this house
                </label>
              </div>
            )}

            <label className="mt-4 block">
              <span className="mb-1 flex items-center justify-between text-[11px] font-semibold text-text-2">
                <span>Message</span>
                <span className={cn('font-stat', c.message.trim().length > TEXT_MAX ? 'text-danger' : 'text-text-3')}>
                  {c.message.trim().length}/{TEXT_MAX}
                </span>
              </span>
              <textarea
                rows={6}
                value={c.message}
                onChange={(e) => set('message', e.target.value)}
                placeholder="ASA ALERT — Open shift today 2P–10P at MS. Please contact Tonisha if you can take it."
                className={AREA}
              />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 flex items-center justify-between text-[11px] font-semibold text-text-2">
                <span>Signature (optional)</span>
                <span className={cn('font-stat', c.signature.trim().length > SIGNATURE_MAX ? 'text-danger' : 'text-text-3')}>
                  {c.signature.trim().length}/{SIGNATURE_MAX}
                </span>
              </span>
              <input
                value={c.signature}
                onChange={(e) => set('signature', e.target.value)}
                placeholder="Tonisha — MS house manager"
                className={INPUT}
              />
            </label>
            <p className="mt-2 text-[11.5px] leading-4 text-text-3">
              An open shift never says why it is open — staff never learn who called off or the reason.
            </p>
            {/* a hand-typed "covered" may double the automatic follow-up: warned, never blocked */}
            {looksLikeCovered(c.message) && (
              <p className="mt-2 rounded-md bg-tint-info px-3 py-2 text-[12px] leading-4 text-tint-fg-info">
                A call-off’s shift filled on Requests already tells everyone its URGENT OPEN SHIFT reached that it is
                covered — see “Covered — said by itself” below. Send this only for a shift that did not come from a
                call-off.
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void review()} disabled={!!blockReview || reviewing} className={PRIMARY}>
                {reviewing ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />} Review recipients
              </button>
              {blockReview && <span className="text-[12px] text-text-3">{blockReview}</span>}
            </div>
          </Card>

          {/* ---- THE PREVIEW ---- */}
          <Card>
            {!preview ? (
              <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-center">
                <Megaphone size={22} className="text-text-3" />
                <p className="mt-2 text-[13px] font-semibold text-text-1">Review before you send</p>
                <p className="mt-1 max-w-[46ch] text-[12.5px] leading-5 text-text-2">
                  The exact number of people, every name, who is left out and why, and the text as the first of them
                  will read it.
                </p>
              </div>
            ) : (
              <div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-3">{preview.audience_label}</p>
                    <p className="font-stat text-[44px] leading-none text-text-1">{preview.readable ? preview.count : '—'}</p>
                    <p className="text-[12px] text-text-2">
                      {preview.readable ? `${preview.count === 1 ? 'person' : 'people'} will receive it` : 'the audience could not be read'}
                    </p>
                  </div>
                  <button type="button" onClick={() => void send()} disabled={!!blockSend || sending} className={PRIMARY}>
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {sending ? (progress || 'Sending…') : `Send to ${preview.count}`}
                  </button>
                </div>
                {blockSend && <p className="mt-2 text-[12px] leading-4 text-tint-fg-amber">{blockSend}</p>}

                {preview.reason_words.length > 0 && (
                  <p className="mt-3 flex items-start gap-2 rounded-md bg-tint-amber px-3 py-2 text-[12px] leading-4 text-tint-fg-amber">
                    <AlertTriangle size={14} className="mt-px shrink-0" />
                    <span>
                      <strong>This text may say why a shift is open or who called off</strong> ({preview.reason_words.join(', ')}). The rule: an open
                      shift never says why, and staff never learn who called off. You can still send it.
                    </span>
                  </p>
                )}
                {modeSentences(preview.mode, preview.situation).map((s) => (
                  <p key={s} className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-[12px] leading-4 text-text-2">{s}</p>
                ))}

                <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-3">As the first of them reads it</p>
                <pre className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] leading-5 text-text-1">
                  {preview.sample}
                </pre>
                <p className="mt-1 text-[11px] text-text-3">{preview.chars} characters</p>

                <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-3">Every name</p>
                <div className="mt-1 flex max-h-[220px] flex-wrap gap-1.5 overflow-y-auto">
                  {preview.recipients.map((r, i) => (
                    <span key={`${i}-${r.to}`} title={`${formatPhoneDisplay(r.to)} · from ${sourceWord(r.from)}`}
                          className="rounded-full border border-border bg-surface px-2 py-0.5 text-[12px] text-text-2">
                      {r.name || formatPhoneDisplay(r.to)}
                    </span>
                  ))}
                </div>
                {(preview.dropped.length > 0 || preview.notes.length > 0 || preview.why.length > 0) && (
                  <div className="mt-3 space-y-1 text-[12px] leading-4 text-text-2">
                    {preview.why.map((w) => <p key={w} className="text-tint-fg-amber">{w}</p>)}
                    {preview.dropped.map((d) => (
                      <p key={d.reason}>
                        <span className="font-semibold text-text-1">Not texted: {d.count}</span> — {d.label}
                        {d.names.length ? `: ${d.names.join(', ')}` : ''}
                      </p>
                    ))}
                    {preview.notes.map((n) => <p key={n}>{n}</p>)}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ---- EVERY BROADCAST, AND WHAT EACH COPY DID ---- */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text-1">
          Broadcasts <span className="ml-1 font-stat text-[12.5px] text-text-3">{board ? history.length : '—'}</span>
        </h2>
        <div className="flex items-center gap-1">
          <ExportMenu filename="broadcasts" columns={HISTORY_COLUMNS} rows={history} />
          <button
            type="button"
            aria-label="Share these broadcasts"
            title="Share these broadcasts"
            onClick={() => share({
              title: 'Broadcasts',
              subtitle: `${history.length} ${history.length === 1 ? 'broadcast' : 'broadcasts'} — as shown on screen`,
              rows: history,
              columns: HISTORY_COLUMNS,
              filename: 'broadcasts',
              icon: 'megaphone',
            })}
            className={ICON_BTN}
          >
            <Share2 size={15} />
          </button>
          <button type="button" aria-label="Print" title="Print these broadcasts" onClick={() => window.print()} className={ICON_BTN}>
            <Printer size={15} />
          </button>
        </div>
      </div>
      {board?.history_error && (
        <p className="mb-3 rounded-md bg-tint-amber px-3 py-2 text-[12px] leading-4 text-tint-fg-amber">
          The broadcast house could not be read, so this list is not an empty one — it is one that could not be seen:
          {' '}{board.history_error}
        </p>
      )}
      {!board ? (
        <p className="flex items-center gap-2 py-6 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading…
        </p>
      ) : history.length === 0 && !board.history_error ? (
        <Card padded={false} className="p-6">
          <p className="text-[13.5px] font-semibold text-text-1">No broadcast yet</p>
          <p className="mt-1 max-w-[62ch] text-[12.5px] leading-5 text-text-2">
            Every broadcast lands here with its words, its audience and what each copy did.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {history.map((row) => {
            const chip = stateChip(row.state)
            const head = headline(row)
            const acts = rowActions(row)
            const isOpen = !!open[row.id]
            return (
              <Card key={row.id} padded={false} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-text-3">
                      <span>{ohioDateTime(row.at)}</span>
                      <span>·</span>
                      <span className="font-semibold text-text-2">{row.by_name}</span>
                      <span>·</span>
                      <span>{row.audience_label}</span>
                      <span>·</span>
                      <span className="font-stat">{row.count}</span>
                      <Chip label={chip.label} tint={chip.tint} />
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-5 text-text-1">{row.message}</p>
                    {row.signature && <p className="text-[12.5px] text-text-2">{row.signature}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {acts.cont && (
                      <button type="button" disabled={busy === row.id} onClick={() => void continueRow(row)} className={BTN}>
                        <Send size={13} /> Continue
                      </button>
                    )}
                    {acts.withdraw && (
                      <button type="button" disabled={busy === row.id} onClick={() => void withdrawRow(row)} className={BTN}>
                        <Undo2 size={13} /> Withdraw
                      </button>
                    )}
                    {acts.resend && (
                      <button type="button" onClick={() => writeAgain(row)} className={BTN}>
                        <PenLine size={13} /> Write it again
                      </button>
                    )}
                  </div>
                </div>
                <p className={cn('mt-2 rounded-md px-3 py-2 text-[12.5px] leading-5', TINT_BG[head.tone], TINT_FG[head.tone])}>
                  {head.text}
                </p>
                {row.warnings && (
                  <p className="mt-1.5 text-[11.5px] text-text-3">Warned before sending: the text carried {row.warnings}.</p>
                )}
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [row.id]: !o[row.id] }))}
                  className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-text-2 hover:text-text-1"
                >
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  Each recipient — {tallyWords(row.tally)}
                </button>
                {isOpen && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left text-[12px]">
                      <thead className="text-[11px] uppercase tracking-[0.08em] text-text-3">
                        <tr>
                          <th className="py-1 pr-3 font-semibold">Name</th>
                          <th className="py-1 pr-3 font-semibold">Number</th>
                          <th className="py-1 pr-3 font-semibold">From</th>
                          <th className="py-1 pr-3 font-semibold">What the send door answered</th>
                        </tr>
                      </thead>
                      <tbody>
                        {row.recipients.map((r, i) => {
                          const oc = outcomeChip(r.outcome)
                          return (
                            <tr key={`${r.to}-${i}`} className="border-t border-border">
                              <td className="py-1 pr-3 text-text-1">{r.name || '—'}</td>
                              <td className="py-1 pr-3 font-mono text-text-2">{formatPhoneDisplay(r.to)}</td>
                              <td className="py-1 pr-3 text-text-3">{sourceWord(r.from)}</td>
                              <td className="py-1 pr-3">
                                <Chip label={oc.label} tint={oc.tint} />
                                {r.why && <span className="ml-1.5 text-text-3">{r.why}</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* ---- THE "COVERED" FOLLOW-UPS THE PLATFORM SENT BY ITSELF ---- */}
      <CoveredNotices />
    </div>
  )
}
