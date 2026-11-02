// THE CANDIDATE'S CALENDAR — a single public page with one purpose — a standalone app of this platform that exists…
// A candidate opens the link we texted/e-mailed, picks the day and the hour of their interview, presses Send, and…
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CalendarDays, Check, Loader2, Send } from 'lucide-react'
import SiteFooter from '@/components/shared/SiteFooter'
import { DEFAULT_EXEC_URL, useApiConfigStore } from '@/stores/useApiConfigStore'
import { ohioToday } from '@/lib/ohio'
import { cn } from '@/lib/utils'

type Slot = { date: string; time: string }
type Context = {
  candidate_first: string
  mode: 'pick' | 'choose3'
  slots?: Slot[]
  taken?: string[]
}

// The company's interview periods — the same three hours the phone-screen lane schedules by (HUB_PERIOD_HOUR…
const TIMES = [
  { value: '10:00', label: '10:00 AM' },
  { value: '14:00', label: '2:00 PM' },
  { value: '17:00', label: '5:00 PM' },
]

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The next ten WEEKDAYS starting tomorrow, on the company's calendar. */
function pickDays(): { date: string; wd: string; day: number; mo: string }[] {
  const out: { date: string; wd: string; day: number; mo: string }[] = []
  const t = ohioToday()
  const d = new Date(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), 12)
  while (out.length < 10) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow === 0 || dow === 6) continue
    const pad = (n: number) => String(n).padStart(2, '0')
    out.push({
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      wd: WD[dow], day: d.getDate(), mo: MO[d.getMonth()],
    })
  }
  return out
}

async function publicPost<T>(action: string, payload: Record<string, unknown>): Promise<{ status: number; data?: T; message?: string }> {
  const url = useApiConfigStore.getState().execUrl || DEFAULT_EXEC_URL
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'body=' + encodeURIComponent(JSON.stringify({ action, payload })),
  })
  return (await res.json()) as { status: number; data?: T; message?: string }
}

export default function InterviewSchedulerPage() {
  const [params] = useSearchParams()
  const t = params.get('t') ?? ''
  const [ctx, setCtx] = useState<Context | null>(null)
  const [ctxError, setCtxError] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!t) { setCtxError('This link is missing its key — please use the exact link we sent you.'); return }
    publicPost<Context>('interviewSlotContext', { t })
      .then((env) => {
        if (env.status === 200 && env.data) setCtx(env.data)
        else setCtxError(env.message || 'This link is no longer valid — please reach out and we will send a fresh one.')
      })
      .catch(() => setCtxError('We could not reach the scheduler — please try the link again in a minute.'))
  }, [t])

  const days = useMemo(() => pickDays(), [])
  const taken = useMemo(() => new Set(ctx?.taken ?? []), [ctx])
  const canSend = !!date && !!time && !busy

  const send = async () => {
    if (!canSend) return
    setBusy(true)
    setError('')
    try {
      const env = await publicPost('interviewSlotSubmit', { t, date, time })
      if (env.status === 200) {
        setDone(true)
        // pressing Send closes the screen.
        setTimeout(() => { try { window.close() } catch { /* the note remains */ } }, 1800)
      } else {
        setError(env.message || 'That did not go through — please try again.')
      }
    } catch {
      setError('That did not go through — please check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  // The escape: none of the offered slots works — the interviewer is asked for six different ones and a fresh offer…
  const sendNone = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const env = await publicPost('interviewSlotSubmit', { t, none: true })
      if (env.status === 200) {
        setDone(true)
        setTimeout(() => { try { window.close() } catch { /* the note remains */ } }, 1800)
      } else {
        setError(env.message || 'That did not go through — please try again.')
      }
    } catch {
      setError('That did not go through — please check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const slotLabel = (s: Slot) => {
    const tm = TIMES.find((x) => x.value === s.time)
    const d = new Date(+s.date.slice(0, 4), +s.date.slice(5, 7) - 1, +s.date.slice(8, 10), 12)
    return `${WD[d.getDay()]}, ${MO[d.getMonth()]} ${d.getDate()} · ${tm ? tm.label : s.time}`
  }

  // the page owns its scroll (body overflow is hidden for the app shell), so a tall calendar is never clipped and…
  return (
    <div className="flex h-dvh flex-col items-center overflow-y-auto bg-gradient-to-br from-tint-mint/40 via-app to-tint-lavender/40 px-4">
      <div className="my-auto w-full max-w-[560px] py-10">
        <div className="mb-5 flex items-center justify-center gap-2">
          <span className="font-display text-[22px] font-bold tracking-tight text-text-1">asa<span className="text-primary">.</span></span>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-2 sm:p-8">
          {ctxError ? (
            <div className="py-8 text-center">
              <p className="text-[14px] leading-6 text-text-2">{ctxError}</p>
            </div>
          ) : !ctx ? (
            <p className="flex items-center justify-center gap-2 py-14 text-[13.5px] text-text-3">
              <Loader2 size={15} className="animate-spin" /> Opening your calendar…
            </p>
          ) : done ? (
            <div className="py-10 text-center">
              <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-tint-mint text-tint-fg-mint">
                <Check size={26} />
              </span>
              <h1 className="font-display text-[20px] font-bold text-text-1">You’re all set{ctx.candidate_first ? `, ${ctx.candidate_first}` : ''}!</h1>
              <p className="mt-2 text-[13.5px] leading-6 text-text-2">
                We received your pick and our team is confirming it now.
                <br />You can close this window.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-6 text-center">
                <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-tint-lavender text-tint-fg-lavender">
                  <CalendarDays size={22} />
                </span>
                <h1 className="font-display text-[20px] font-bold leading-7 text-text-1">
                  {ctx.candidate_first ? `${ctx.candidate_first}, pick` : 'Pick'} your interview time
                </h1>
                <p className="mt-1.5 text-[13px] leading-5 text-text-3">
                  {ctx.mode === 'choose3'
                    ? 'Our supervisor offered these times — pick the one that works for you, date and time.'
                    : 'Choose the day and the hour that work best for you, then press Send.'}
                </p>
              </div>

              {ctx.mode === 'choose3' ? (
                <div className="space-y-2">
                  {(ctx.slots ?? []).map((s) => {
                    const on = date === s.date && time === s.time
                    return (
                      <button
                        key={`${s.date}T${s.time}`}
                        onClick={() => { setDate(s.date); setTime(s.time) }}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-[14px] font-semibold transition-all',
                          on
                            ? 'border-primary bg-primary/10 text-text-1'
                            : 'border-border bg-surface text-text-2 hover:border-border-strong hover:bg-surface-2',
                        )}
                      >
                        <span className={cn('grid h-5 w-5 place-items-center rounded-full border', on ? 'border-primary bg-primary text-on-primary' : 'border-border-strong')}>
                          {on && <Check size={12} />}
                        </span>
                        {slotLabel(s)}
                      </button>
                    )
                  })}
                  <button
                    onClick={sendNone}
                    disabled={busy}
                    className="w-full rounded-xl border border-dashed border-border px-4 py-3 text-[13px] font-semibold text-text-3 transition-colors hover:border-border-strong hover:text-text-2"
                  >
                    None of these work for me — ask for other times
                  </button>
                </div>
              ) : (
                <>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">The day</p>
                  <div className="grid grid-cols-5 gap-2">
                    {days.map((d) => {
                      const on = date === d.date
                      return (
                        <button
                          key={d.date}
                          onClick={() => setDate(d.date)}
                          className={cn(
                            'flex flex-col items-center rounded-xl border py-2.5 transition-all',
                            on
                              ? 'border-primary bg-primary/10'
                              : 'border-border bg-surface hover:border-border-strong hover:bg-surface-2',
                          )}
                        >
                          <span className="text-[10.5px] font-semibold uppercase text-text-3">{d.wd}</span>
                          <span className={cn('text-[17px] font-bold leading-6', on ? 'text-primary' : 'text-text-1')}>{d.day}</span>
                          <span className="text-[10.5px] text-text-3">{d.mo}</span>
                        </button>
                      )
                    })}
                  </div>

                  <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-text-3">The hour</p>
                  <div className="grid grid-cols-3 gap-2">
                    {TIMES.map((x) => {
                      const blocked = !!date && taken.has(`${date}T${x.value}`)
                      const on = time === x.value && !blocked
                      return (
                        <button
                          key={x.value}
                          disabled={blocked}
                          onClick={() => setTime(x.value)}
                          className={cn(
                            'rounded-xl border py-3 text-[14px] font-semibold transition-all',
                            blocked && 'cursor-not-allowed border-border text-text-3 opacity-45',
                            !blocked && (on
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border bg-surface text-text-2 hover:border-border-strong hover:bg-surface-2'),
                          )}
                        >
                          {x.label}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              {error && <p className="mt-4 rounded-md bg-tint-pink/40 px-3 py-2 text-[12.5px] text-text-1">{error}</p>}

              <button
                disabled={!canSend}
                onClick={send}
                className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14.5px] font-bold text-on-primary transition-all hover:bg-primary-hover active:scale-[0.99] disabled:opacity-40"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />} Send
              </button>
              <p className="mt-3 text-center text-[11.5px] leading-4 text-text-3">
                Times are Eastern (Ohio). Sending this tells our team the time you chose.
              </p>
            </>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
