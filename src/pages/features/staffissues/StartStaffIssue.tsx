// START A STAFF ISSUE — the write half of the Staff Issues app.
// WHERE IT GOES.
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Clock, HelpCircle, Plus, X } from 'lucide-react'
import { gasAction, SESSION_EXPIRED } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import { ohioToday } from '@/lib/ohio'
import {
  ChipPicker,
  Field,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '@/pages/features/clientops/OpsPageShell'
import { cn } from '@/lib/utils'

// The estate's own closed dropdown, counted over the whole book: Monitoring 53 · 1st Warning 52 · Terminated 35 ·…
const ACTIONS = [
  'Monitoring',
  '1st Warning',
  '2nd Warning',
  'Final Warning',
  'Not at this time',
  'Terminated',
  'Quit',
] as const

/** Measured: the mirror job's own cadence, and the snapshot's heartbeat. */
const MIRROR_MINUTES = 30
const WORST_MINUTES = 35

type Form = {
  date: string
  employees_involved: string
  situation: string
  follow_up: string
  disciplinary_action: string
  result: string
}

const empty = (): Form => ({
  // Ohio's today, not the reader's — the houses roll over on Ohio's clock.
  date: ohioToday(),
  employees_involved: '',
  situation: '',
  follow_up: '',
  disciplinary_action: '',
  result: '',
})

type Receipt =
  | { kind: 'landed'; row: number; who: string; when: string; sure: boolean }
  // kept in the Hub's database (Back-end per app on Python); the book receives it on the two-way sync's next pass
  | { kind: 'kept'; who: string; when: string }
  | { kind: 'queued'; who: string; when: string }
  | { kind: 'unconfirmed'; who: string; when: string }
  | { kind: 'refused'; why: string }
  | { kind: 'unattempted'; why: string }
  | { kind: 'unknown'; why: string }

// gasAction's own words for "the request never left" — the only failure it raises that proves nothing was attempted.
const NEVER_LEFT = 'Network error'

// The relay's OWN 502, which is not the door's.
const RELAY_UNREACHABLE = 'Backend unreachable through the relay'

// The /gas write envelope: accepted, but no row came back — and WHICH accepted it is decides what the person is…
function acceptedKind(d: unknown): 'queued' | 'unconfirmed' | null {
  if (!d || typeof d !== 'object') return null
  const env = d as { accepted?: unknown; queued?: unknown }
  if (env.accepted !== true) return null
  return env.queued === true ? 'queued' : 'unconfirmed'
}

export default function StartStaffIssue({ onSaved }: { onSaved?: () => void }) {
  const role = useAuthStore((s) => s.user?.role)
  const canWrite = role === 'admin' || role === 'manager'
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Form>(empty)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const needed: string[] = []
  if (!form.date.trim()) needed.push('Date')
  if (!form.employees_involved.trim()) needed.push('Employees involved')
  if (!form.situation.trim()) needed.push('Situation')

  async function submit() {
    if (busy || needed.length) return
    setBusy(true)
    const who = form.employees_involved.trim()
    const when = form.date
    try {
      const data = await gasAction<{ row?: number; id?: string; row_confirmed?: boolean; kept?: boolean }>(
        'staffIssueAdd',
        {
          date: form.date,
          employees_involved: who,
          situation: form.situation.trim(),
          follow_up: form.follow_up.trim(),
          disciplinary_action: form.disciplinary_action,
          result: form.result.trim(),
        },
        // NEVER RE-POST THIS ONE.
        { retry: false },
      )
      // The form is emptied ONLY when the write is accounted for.
      const accepted = acceptedKind(data)
      if (typeof data?.row === 'number' && data.row > 0) {
        setReceipt({ kind: 'landed', row: data.row, who, when, sure: data.row_confirmed !== false })
        setForm(empty())
      } else if (data?.kept === true) {
        setReceipt({ kind: 'kept', who, when })
        setForm(empty())
      } else if (accepted === 'queued') {
        // ACCEPTED AND HELD.
        setReceipt({ kind: 'queued', who, when })
        setForm(empty())
      } else if (accepted === 'unconfirmed') {
        // ACCEPTED AND HELD BY NOBODY.
        setReceipt({ kind: 'unconfirmed', who, when })
      } else {
        // A 200 with no row number is not a success either.
        setReceipt({
          kind: 'unknown',
          why: 'The door answered without the row number it always returns.',
        })
      }
      setOpen(false)
      onSaved?.()
    } catch (err) {
      const said = err instanceof Error ? err.message : String(err)
      const status = (err as { status?: number })?.status
      // A refusal the door PRONOUNCED (it looked, and said no) is a different fact from a request that never left…
      const relay502 = status === 502 && said.indexOf(RELAY_UNREACHABLE) === 0
      setReceipt(
        said === SESSION_EXPIRED
          ? { kind: 'refused', why: said }
          : relay502
            ? { kind: 'unknown', why: said }
            : typeof status === 'number'
              ? { kind: 'refused', why: said }
              : said.indexOf(NEVER_LEFT) === 0
                ? { kind: 'unattempted', why: said }
                : { kind: 'unknown', why: said },
      )
    } finally {
      setBusy(false)
    }
  }

  if (!canWrite) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(primaryBtnCls, 'h-8 px-3 text-[12px]')}
        title="Append a situation to the estate's Employee HR Tracker"
      >
        <Plus size={13} /> Start a staff issue
      </button>

      {/* The receipt follows the person: on the page while the form is shut,
          inside the form while it is open — a refusal drawn behind the
          overlay is a refusal nobody reads. */}
      {!open && receipt && (
        <StaffIssueReceipt inline receipt={receipt} onDismiss={() => setReceipt(null)} />
      )}

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/45" onClick={close} />
          <div className="absolute inset-0 grid place-items-center overflow-y-auto p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Start a staff issue"
              className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface shadow-3"
            >
              <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <h2 className="font-display text-[17px] font-bold text-text-1">Start a staff issue</h2>
                  <p className="mt-0.5 text-[11.5px] text-text-3">
                    Appended to the estate's Employee HR Tracker — the same sheet the HR staff
                    type into. Only the six columns it actually holds are asked for.
                  </p>
                </div>
                <button
                  onClick={close}
                  aria-label="Close"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="grid gap-3.5 px-5 py-4">
                {receipt && <StaffIssueReceipt receipt={receipt} onDismiss={() => setReceipt(null)} />}

                <Field label="Date" required>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => set('date', e.target.value)}
                    className={inputCls}
                  />
                </Field>

                <Field label="Employees involved" required>
                  <input
                    value={form.employees_involved}
                    onChange={(e) => set('employees_involved', e.target.value)}
                    placeholder="Names as the tracker writes them — or the house"
                    className={inputCls}
                  />
                </Field>

                <Field label="Situation" required>
                  <textarea
                    value={form.situation}
                    onChange={(e) => set('situation', e.target.value)}
                    rows={4}
                    placeholder="What happened."
                    className={cn(inputCls, 'h-auto py-2 leading-5')}
                  />
                </Field>

                <Field label="Follow up">
                  <textarea
                    value={form.follow_up}
                    onChange={(e) => set('follow_up', e.target.value)}
                    rows={3}
                    placeholder="What was done about it, if anything yet."
                    className={cn(inputCls, 'h-auto py-2 leading-5')}
                  />
                </Field>

                <Field label="Disciplinary action">
                  <ChipPicker
                    options={ACTIONS}
                    value={form.disciplinary_action as (typeof ACTIONS)[number] | ''}
                    onChange={(v) =>
                      set('disciplinary_action', v === form.disciplinary_action ? '' : v)
                    }
                    tint="amber"
                  />
                  <span className="text-[10.5px] text-text-3">
                    The sheet's own seven words. Leave it empty while nothing has been decided —
                    “Not at this time” is a decision, an empty cell is not.
                  </span>
                </Field>

                <Field label="Result">
                  <input
                    value={form.result}
                    onChange={(e) => set('result', e.target.value)}
                    placeholder="How it ended, once it has."
                    className={inputCls}
                  />
                </Field>

                <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[11.5px] text-text-2">
                  <Clock size={12} className="mr-1 inline align-[-2px] text-text-3" />
                  It is written to the sheet immediately. <span className="font-semibold">This page
                  will not show it for about {MIRROR_MINUTES} minutes</span> — the table reads a
                  mirror that is refilled on its own {MIRROR_MINUTES}-minute clock, and the
                  snapshot behind it can add five more. Do not save it twice while you wait.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                <button onClick={close} className={outlineBtnCls}>Cancel</button>
                <button
                  onClick={submit}
                  disabled={busy || needed.length > 0}
                  title={needed.length ? `Still needed: ${needed.join(', ')}` : undefined}
                  className={primaryBtnCls}
                >
                  {busy ? 'Writing to the sheet…' : 'Record it'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// THE RECEIPT.
function StaffIssueReceipt({
  receipt,
  onDismiss,
  inline,
}: {
  receipt: Receipt
  onDismiss: () => void
  // On the page it is a flex item in the page's own wrapping header row, so it takes a full line of its own after…
  inline?: boolean
}) {
  const tone =
    receipt.kind === 'landed' || receipt.kind === 'kept'
      ? 'border-tint-mint bg-tint-mint text-tint-fg-mint'
      : receipt.kind === 'queued' || receipt.kind === 'unknown' ||
        receipt.kind === 'unconfirmed'
        ? 'border-tint-amber bg-tint-amber text-tint-fg-amber'
        : 'border-tint-pink bg-tint-pink text-tint-fg-pink'
  const Icon =
    receipt.kind === 'landed' || receipt.kind === 'kept' ? Check
      : receipt.kind === 'queued' ? Clock
        : receipt.kind === 'unknown' || receipt.kind === 'unconfirmed' ? HelpCircle
          : AlertTriangle

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12px]',
        inline ? 'mt-1 w-full basis-full order-last' : 'mb-1',
        tone,
      )}
    >
      <Icon size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {receipt.kind === 'landed' && (
          <>
            <p className="font-semibold">
              {receipt.sure
                ? `Recorded in the Employee HR Tracker — row ${receipt.row}.`
                : 'Recorded in the Employee HR Tracker.'}
            </p>
            <p className="mt-0.5">
              {receipt.who} · {receipt.when}. It is in the estate's sheet now.{' '}
              {!receipt.sure && (
                <>
                  Somebody was typing into the same tab as this was written, so the row number
                  could not be confirmed by reading it back — it is near the bottom of Master,
                  around row {receipt.row}.{' '}
                </>
              )}
              It will appear in the table below in about {MIRROR_MINUTES} minutes (at worst ~
              {WORST_MINUTES}), when the mirror this page reads is next refilled. Refreshing
              sooner re-reads the same mirror and will not find it — that is the mirror being
              behind, not the row being lost. Please do not record it a second time.
            </p>
          </>
        )}
        {receipt.kind === 'kept' && (
          <>
            <p className="font-semibold">Recorded in the Hub.</p>
            <p className="mt-0.5">
              {receipt.who} · {receipt.when}. It is kept in the Hub&apos;s database and shows in the table below
              as soon as it refreshes; the Employee HR Tracker receives it on the next sync, within about ten
              minutes. Please do not record it a second time.
            </p>
          </>
        )}
        {receipt.kind === 'queued' && (
          <>
            <p className="font-semibold">Accepted and held — NOT in the sheet yet.</p>
            <p className="mt-0.5">
              {receipt.who} · {receipt.when}. Google was not reachable in the eight seconds this
              write is given, so the platform has it on its queue and will deliver it — once,
              never twice. Nothing is in the book until it does, and nothing below will change
              until the mirror runs afterwards. Check the sheet before writing this situation
              again.
            </p>
          </>
        )}
        {receipt.kind === 'unconfirmed' && (
          <>
            <p className="font-semibold">
              Sent — almost certainly recorded, but no receipt came back.
            </p>
            <p className="mt-0.5">
              {receipt.who} · {receipt.when}. The request reached Google and nothing is being
              held for later delivery, so nothing more will happen on its own. The platform
              virtually always finishes a request it has accepted, which means the row is very
              probably in the tracker already — but the answer was lost on the way back, so this
              screen will not claim it. Open the Employee HR Tracker and look for it before
              recording this situation again. Your words are still in the form.
            </p>
          </>
        )}
        {receipt.kind === 'refused' && (
          <>
            <p className="font-semibold">Refused — nothing was written.</p>
            <p className="mt-0.5">{receipt.why}</p>
          </>
        )}
        {receipt.kind === 'unattempted' && (
          <>
            <p className="font-semibold">Not attempted — the request never left this browser.</p>
            <p className="mt-0.5">
              {receipt.why} Nothing was written and the tracker is unchanged. Your words are still
              in the form; send them again when the connection is back.
            </p>
          </>
        )}
        {receipt.kind === 'unknown' && (
          <>
            <p className="font-semibold">Unknown — it left, and no answer came back.</p>
            <p className="mt-0.5">
              {receipt.why} The row may be in the sheet and it may not be, and this screen will
              not pretend to know which. Open the Employee HR Tracker and look for it before
              recording this situation again — pressing twice is how the book ends up with the
              same situation on two rows.
            </p>
          </>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md opacity-70 transition-opacity hover:opacity-100"
      >
        <X size={13} />
      </button>
    </div>
  )
}
