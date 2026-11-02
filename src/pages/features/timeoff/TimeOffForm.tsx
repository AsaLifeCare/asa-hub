/** Request time off: the form's questions, checked by the relay's dry run before Submit is offered. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPlus, Loader2, Send, X } from 'lucide-react'
import Card from '@/components/shared/Card'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { ohioToday } from '@/lib/ohio'
import {
  askedLine, daysBetween, daysWords, dayWords, filedLine, mayFile, nextPress, prefillHouses, previewFor, spanWords,
  type Preview, type TimeOffFeed,
} from './timeOffModel'
import { fileRequest, previewRequest } from './useTimeOff'

const FIELD = 'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors focus:border-primary'
const LABEL = 'mb-1 block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-3'

export default function TimeOffForm({ feed, askedHouse, askedPerson, askedStart, onFiled }: {
  feed: TimeOffFeed
  askedHouse?: string
  askedPerson?: string
  askedStart?: string
  onFiled: () => void
}) {
  const today = ohioToday()
  const reach = feed.me.may_file_for
  const [person, setPerson] = useState(reach === 'self' ? feed.me.name : (askedPerson ?? ''))
  const [start, setStart] = useState(askedStart ?? '')
  const [end, setEnd] = useState('')
  const [picked, setPicked] = useState<string[] | null>(null)
  const [reason, setReason] = useState('')
  const [checked, setChecked] = useState<{ key: string; preview: Preview } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewFailed, setPreviewFailed] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  const endValue = end || start
  const ready = Boolean(person.trim() && start && endValue)
  /** what is sent: the reader's own choice once made, else the house the address named */
  const sent = useMemo(() => picked ?? prefillHouses(askedHouse, [], feed.houses), [picked, askedHouse, feed.houses])
  const sentKey = sent.join(',')
  const key = JSON.stringify([person, start, endValue, sentKey, reason])
  const preview = previewFor(checked, key)
  /** what is drawn ticked: the choice, else the address's house and the houses the person is drawn on */
  const houses = useMemo(() => picked ?? prefillHouses(askedHouse, preview?.drawn_houses, feed.houses),
    [picked, askedHouse, preview, feed.houses])

  useEffect(() => {
    setArmed('')
    setPreviewFailed('')
    if (!ready) { setChecked(null); return }
    const mine = ++seq.current
    const timer = setTimeout(() => {
      setPreviewing(true)
      previewRequest({ person, start, end: endValue, houses: sentKey ? sentKey.split(',') : [], reason })
        .then((p) => { if (mine === seq.current) setChecked({ key, preview: p }) })
        .catch((e) => {
          if (mine !== seq.current) return
          setChecked(null)
          setPreviewFailed(e instanceof Error ? e.message : String(e))
        })
        .finally(() => { if (mine === seq.current) setPreviewing(false) })
    }, 350)
    return () => clearTimeout(timer)
  }, [ready, person, start, endValue, sentKey, reason, key])

  const people = useMemo(() => feed.people.map((p) => p.name), [feed.people])
  const refusals = preview?.refusals ?? []
  const may = mayFile(ready, preview, previewing, busy)

  const submit = async () => {
    const press = nextPress(armed, 'submit')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await fileRequest({ person, start, end: endValue, houses, reason })
      toast({ type: 'success', title: `Time off asked — ${got.ref}`, body: filedLine(got.asked) })
      setStart(''); setEnd(''); setReason(''); setChecked(null); setPicked(null)
      if (reach !== 'self') setPerson('')
      onFiled()
    } catch (e) {
      toast({ type: 'danger', title: 'Not filed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const toggleHouse = (code: string) => {
    setPicked(houses.includes(code) ? houses.filter((c) => c !== code) : [...houses, code])
  }

  return (
    <Card padded={false} className="mb-5 p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <CalendarPlus size={16} className="text-text-2" />
        <h2 className="font-display text-[15px] font-semibold text-text-1">Request time off</h2>
      </div>
      {!reach ? (
        <p className="text-[13px] text-text-2">This account files no time off.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <span className={LABEL}>Name</span>
            {reach === 'self' ? (
              <span className="inline-flex h-9 items-center rounded-full bg-surface-2 px-3 text-[13px] font-medium text-text-1">
                {feed.me.name || 'This account is not on a roster'}
              </span>
            ) : (
              <>
                <input list="timeoff-people" value={person} onChange={(e) => setPerson(e.target.value)}
                  placeholder={reach === 'houses' ? 'Somebody drawn on your houses' : 'Anybody on staff'}
                  className={FIELD} aria-label="Name" />
                <datalist id="timeoff-people">
                  {feed.me.name && <option value={feed.me.name} />}
                  {people.map((n) => <option key={n} value={n} />)}
                </datalist>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className={LABEL}>Start date</span>
              <input type="date" value={start} min={feed.me.every_house ? undefined : today}
                onChange={(e) => setStart(e.target.value)} className={FIELD} />
            </label>
            <label>
              <span className={LABEL}>End date</span>
              <input type="date" value={end} min={start || undefined}
                onChange={(e) => setEnd(e.target.value)} className={FIELD} />
            </label>
            <p className="col-span-2 -mt-1 text-[11.5px] text-text-3">Same as start date if only off for one day.</p>
          </div>
          <div className="md:col-span-2">
            <span className={LABEL}>Calendar / house</span>
            <div className="flex flex-wrap gap-1.5">
              {feed.houses.map((h) => {
                const on = houses.includes(h.code)
                return (
                  <button key={h.code} type="button" onClick={() => toggleHouse(h.code)}
                    className={cn('rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                      on ? 'border-primary bg-primary/10 font-semibold text-text-1'
                        : 'border-border bg-surface text-text-2 hover:bg-surface-2')}>
                    {h.label} <span className="text-text-3">{h.code}</span>
                  </button>
                )
              })}
              {!feed.houses.length && <span className="text-[12px] text-text-3">No house calendar could be read.</span>}
            </div>
          </div>
          <label className="md:col-span-2">
            <span className={LABEL}>Reason (optional)</span>
            <textarea value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none focus:border-primary" />
            <span className="mt-1 block text-[11.5px] text-text-3">Only your house manager and the directors read this.</span>
          </label>
        </div>
      )}

      {reach && ready && (
        <div className="mt-4 rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-[1.6] text-text-2">
          {!preview && !previewFailed && <p className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Checking…</p>}
          {previewFailed && <p className="text-danger">The check could not be made, so it cannot be sent yet — {previewFailed}</p>}
          {preview && (
            <>
              <p className="font-semibold text-text-1">
                {spanWords(start, endValue)} · {daysWords(preview.days ?? daysBetween(start, endValue))}
                {preview.person && preview.person !== feed.me.name ? ` · for ${preview.person}` : ''}
              </p>
              {preview.asked && <p>{askedLine(preview.asked)}</p>}
              {preview.asked?.hm_why && <p className="text-text-3">{preview.asked.hm_why}</p>}
              {(preview.ignored_houses ?? []).length > 0 && (
                <p className="text-text-3">
                  Not counted: {(preview.ignored_houses ?? []).map((h) => h.label).join(', ')} — no calendar row there, so
                  that house's manager is not asked.
                </p>
              )}
              {(preview.touches ?? []).map((t) => (
                <p key={`${t.location}|${t.col_iso}`}>
                  On the calendar {dayWords(t.col_iso)} {t.value} at {t.label}. If approved, that shift is put up as an
                  open shift for the house manager.
                </p>
              ))}
              {refusals.map((r) => (
                <p key={r} className="flex items-start gap-1.5 font-semibold text-danger"><X size={13} className="mt-1 shrink-0" />{r}</p>
              ))}
            </>
          )}
        </div>
      )}

      {reach && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void submit()} disabled={!may}
            className={cn('inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13px] font-semibold transition-all disabled:opacity-40',
              armed === 'submit' ? 'bg-danger text-white' : 'bg-primary text-on-primary hover:bg-primary-hover')}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {armed === 'submit' ? 'Submit — press again to send it' : 'Submit'}
          </button>
          {armed === 'submit' && (
            <button type="button" onClick={() => setArmed('')} className="text-[12.5px] text-text-3 hover:text-text-1">Not yet</button>
          )}
          {feed.test_mode && (
            <span className="rounded-full bg-tint-amber px-2.5 py-0.5 text-[11.5px] font-semibold text-tint-fg-amber">
              Test mode: the approvers' messages are written to the mock outbox
            </span>
          )}
        </div>
      )}
    </Card>
  )
}
