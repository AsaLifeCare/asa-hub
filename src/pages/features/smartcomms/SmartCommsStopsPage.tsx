// STOPS — the addresses this platform will not write to, and why.
// THE BRAKE IS NOT A PREFERENCE.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Ban, Loader2, RefreshCw, Undo2 } from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { ohioDayYear } from '@/lib/ohio'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { askConfirm, askPrompt } from '@/stores/useDialogStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { heroBand, TINT_FG, type ExtendedTintName } from '@/lib/tints'
import { cn } from '@/lib/utils'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'

type Stop = {
  key: string; target: string; kind: string; name: string
  candidate_id: string; source: string; phrase: string; at: string
  // WHICH CONVERSATION THE ROW IS ABOUT (OptOut.gs, THE SCOPE).
  scope?: string
  /* Present only on the released half. */
  released_at?: string; released_by?: string
}

/** The three reasons a row can exist, and the band each one paints. */
const REASON: Record<string, { label: string; tint: ExtendedTintName; line: string }> = {
  'sms reply': {
    label: 'They asked us to stop', tint: 'violet',
    line: 'They texted a stop word to one of our lines.',
  },
  comm_reply: {
    label: 'They asked us to stop', tint: 'violet',
    line: 'They answered a message of ours with a stop word.',
  },
  'wrong number': {
    label: 'Wrong person', tint: 'amber',
    line: 'They told us the number is not the person we were writing to — our bad data, not their decision.',
  },
  'by hand': {
    label: 'Added by a person', tint: 'slate',
    line: 'Somebody put this address on the list from this screen.',
  },
  manual: {
    label: 'Added by a person', tint: 'slate',
    line: 'Somebody put this address on the list from this screen.',
  },
}

const REASON_KEYS = ['sms reply', 'wrong number', 'by hand'] as const

/** How far a row reaches, said as a reach and never as a label. */
const REACH: Record<string, string> = {
  hiring: 'Refused in the hiring conversation only — shifts and compliance still reach them.',
  staff: 'Refused in the staff conversation only — hiring messages still reach them.',
}

const TAB_TINT: ExtendedTintName = 'mint'

function reasonOf(s: Stop) {
  return REASON[String(s.source || '').toLowerCase()]
}

// Which of the three bands a row belongs to, or '' when the cell is a word this screen has no rule for — counted…
function bandOf(s: Stop): string {
  const r = String(s.source || '').toLowerCase()
  if (r === 'sms reply' || r === 'comm_reply') return 'sms reply'
  if (r.indexOf('wrong') !== -1) return 'wrong number'
  if (r === 'by hand' || r === 'manual') return 'by hand'
  return ''
}

export default function SmartCommsStopsPage() {
  const [rows, setRows] = useState<Stop[] | null>(null)
  const [past, setPast] = useState<Stop[]>([])
  const [unreadable, setUnreadable] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [tab, setTab] = useState<'now' | 'past'>('now')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await gasAction<{ optOuts?: Stop[]; released?: Stop[]; unreadable?: string }>(
        'optOutList', {}, { timeoutMs: 120_000 })
      setRows(d.optOuts ?? [])
      setPast(d.released ?? [])
      setUnreadable(d.unreadable ?? '')
      setError('')
    } catch (e) {
      // rows stay as they were — a failed refresh must not redraw the list as empty, which would read as "everybody…
      setError(e instanceof Error ? e.message : 'The list could not be read.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const add = async () => {
    const target = await askPrompt({
      title: 'Stop contacting somebody',
      body: 'A phone number or an e-mail address. Nothing the platform sends will reach them again.',
      placeholder: '+13305551234',
      confirmLabel: 'Add to the list',
    })
    if (!target) return
    setBusy(target)
    try {
      const r = await gasAction<{ message: string }>('optOutSet', { target })
      toast({ type: 'success', title: r.message })
      await load()
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing changed', body: e instanceof Error ? e.message : 'Try again.' })
    }
    setBusy('')
  }

  const release = async (s: Stop) => {
    const ok = await askConfirm({
      title: `Contact ${s.name || formatPhoneDisplay(s.target)} again?`,
      body: 'They asked us to stop, or the number was never theirs. Only release this if you know they want to hear from us — the record of the original request is kept either way.',
      confirmLabel: 'Release',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(s.key)
    try {
      const r = await gasAction<{ message: string }>('optOutSet', { target: s.target, release: 'yes' })
      toast({ type: 'success', title: r.message })
      await load()
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing changed', body: e instanceof Error ? e.message : 'Try again.' })
    }
    setBusy('')
  }

  // NULL UNTIL AN ANSWER LANDS, and it stays null when one never does — every number below prints an em dash rather…
  const ready = rows !== null
  const live = rows ?? []
  const everHeld = live.length + past.length

  // The bar describes every row the list has ever held, live and released together, because that is the set the…
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const s of [...live, ...past]) {
      const b = bandOf(s)
      if (b) c[b] = (c[b] ?? 0) + 1
    }
    return c
  }, [live, past])
  const unbanded = Math.max(0, everHeld - REASON_KEYS.reduce((n, k) => n + (counts[k] ?? 0), 0))

  const shown = tab === 'now' ? live : past

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Stops"
          subtitle="Who this platform will not write to, the words that put them there, and who let them back in."
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button" onClick={() => void add()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
              >
                <Ban size={14} /> Add somebody
              </button>
              <PageSwitch />
              <button
                type="button" onClick={() => void load()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          }
        />
      </motion.div>

      {/* THE HEADLINE — the same dark surface every desk in this app uses. The
          number is what is silent RIGHT NOW; the bar is every row the list has
          ever held, so a screen with nothing live still says what happened. */}
      <div className="mb-5 rounded-[16px] bg-detail-hero p-6 shadow-2">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Silent right now
            </p>
            <p className="font-stat text-[60px] leading-none text-white">
              {ready ? live.length : '—'}
            </p>
            <p className="mt-1 text-[12px] text-white/60">
              {ready
                ? <>of {everHeld} the list has ever held · {past.length} let back in</>
                : <>the list has not answered — nothing here is a measured zero</>}
            </p>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Why the platform stopped writing
            </p>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              {ready && everHeld > 0 ? REASON_KEYS.map((k) => (
                counts[k] ? (
                  <span
                    key={k}
                    title={`${counts[k]} · ${REASON[k].label}`}
                    style={{ width: `${(counts[k] / everHeld) * 100}%`, background: heroBand(REASON[k].tint) }}
                  />
                ) : null
              )) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[12px] text-white/70">
              {REASON_KEYS.map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: heroBand(REASON[k].tint) }} />
                  {REASON[k].label} <span className="font-stat text-white">{ready ? (counts[k] ?? 0) : '—'}</span>
                </span>
              ))}
              {/* A word this screen has no rule for is counted, never folded
                  into one of the three it does know. */}
              {unbanded > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-white/25" />
                  a reason this screen has no rule for <span className="font-stat text-white">{unbanded}</span>
                </span>
              )}
            </div>
            <p className="mt-3 text-[12.5px] leading-[1.55] text-white/80">
              The send door asks this list before every message it delivers, so a row here stops e-mail and SMS
              alike. A <span className="text-white">stop</span> is the person&apos;s own decision about us and
              reaches every conversation. A <span className="text-white">wrong number</span> is our bad data about
              somebody who never applied — it is honoured only in the conversation it happened in, so a mistake made
              while hiring can no longer silence somebody&apos;s shifts.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{error}</p>
      )}

      {/* THE ERROR IS CARRIED, NEVER SWALLOWED. While the list cannot be read
          the send door refuses everything, which is the honest behaviour and
          needs saying — a silent empty list would read as "nobody opted out"
          on the one screen where that is unsafe. */}
      {unreadable && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-tint-amber px-3 py-2 text-[12px] leading-4 text-tint-fg-amber">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span>
            <strong>The list could not be read.</strong> Nothing is being sent while that is true — every message is
            refused rather than risk reaching somebody who asked us to stop.
            <span className="block opacity-80">{unreadable}</span>
          </span>
        </p>
      )}

      <div className="mb-3 flex items-center gap-1 border-b border-border">
        {([['now', 'Silent now'], ['past', 'Let back in']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn('-mb-px border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors sm:px-4',
              tab === id ? cn('border-current', TINT_FG[TAB_TINT])
                : 'border-transparent text-text-3 hover:text-text-2')}
          >
            {label}
            <span className="ml-1.5 font-stat text-[11.5px] opacity-70">
              {ready ? (id === 'now' ? live.length : past.length) : '—'}
            </span>
          </button>
        ))}
      </div>

      {!ready ? (
        <p className="flex items-center gap-2 py-6 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading…
        </p>
      ) : shown.length === 0 ? (
        <Card padded={false} className="p-6">
          <p className="text-[13.5px] font-semibold text-text-1">
            {tab === 'now' ? 'Every address the platform holds can be written to' : 'Nobody has been let back in'}
          </p>
          <p className="mt-1 max-w-[62ch] text-[12.5px] leading-5 text-text-2">
            {tab === 'now'
              ? 'No message is being refused by this list. A stop word in a reply lands here on its own, within minutes of somebody sending it — this screen is for the ones a person has to record by hand.'
              : 'No suppression has ever been undone. When one is, the row stays with the date and the name of whoever decided it.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map((s) => {
            const reason = reasonOf(s)
            const releasedHere = tab === 'past'
            return (
              <Card key={s.key + (s.released_at || '')} padded={false} className="flex items-start gap-3 p-3">
                <DragPerson name={s.name || ''} id={s.candidate_id} className="flex min-w-0 flex-1 items-start gap-3">
                  <Avatar src="" name={s.name || s.target} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-text-1">
                      {s.name || formatPhoneDisplay(s.target)}
                      {s.name && <span className="ml-1.5 font-normal text-text-3">{formatPhoneDisplay(s.target)}</span>}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-text-3">
                      <span
                        className="rounded px-1.5 py-0.5 font-semibold text-white/90"
                        style={{ background: heroBand(reason?.tint ?? 'slate') }}
                      >
                        {reason?.label ?? s.source ?? 'no reason recorded'}
                      </span>
                      {s.at && <span>{ohioDayYear(s.at)}</span>}
                      <span className="text-text-3/70">{s.kind === 'email' ? 'e-mail' : 'phone'}</span>
                    </p>
                    {reason && <p className="mt-1 text-[12.5px] leading-4 text-text-2">{reason.line}</p>}
                    {/* HOW FAR IT REACHES, always drawn — the difference
                        between "nothing reaches them" and "nothing about
                        hiring reaches them" is the difference that left a
                        member of staff unreachable for five months. */}
                    <p className="mt-1 text-[12px] leading-4 text-text-3">
                      {releasedHere
                        ? 'It refuses nothing now.'
                        : REACH[String(s.scope || '')] ?? 'Refused in every conversation this platform has.'}
                    </p>
                    {/* THEIR OWN WORDS, when there are any. The phrase is what
                        the ear matched, and it is the only evidence a reader
                        has for a suppression somebody wrote. */}
                    {s.phrase && (
                      <p className="mt-1 rounded-md bg-surface-2 px-2 py-1 text-[12.5px] italic leading-4 text-text-2">
                        “{s.phrase}”
                      </p>
                    )}
                    {releasedHere && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-text-3">
                        <Undo2 size={12} />
                        Let back in {s.released_at ? ohioDayYear(s.released_at) : ''}
                        {s.released_by ? ` by ${s.released_by}` : ''}
                      </p>
                    )}
                  </div>
                </DragPerson>
                {!releasedHere && (
                  <button
                    type="button" onClick={() => void release(s)} disabled={busy === s.key}
                    className="h-7 shrink-0 rounded-md border border-border bg-surface px-2.5 text-[11.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
                  >
                    {busy === s.key ? 'Releasing…' : 'Release'}
                  </button>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
