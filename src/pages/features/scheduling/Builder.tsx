// BUILDER — inside Scheduling: Set A/B Pattern → Assign and Balance Shifts → Final Review, for one house over whole…
// The draft is kept on the server per house and first Monday, saved as it changes, and read like Scheduling's other…
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, CalendarCheck, ClipboardCheck, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/useToastStore'
import { addDays, type WriteAnswer } from './schedulingModel'
import {
  builderKey, holdViewAs, publishBuilder, readBuilder, saidOf, saveBuilder, useReadAhead, useSchedulingRead,
} from './schedulingLane'
import {
  MAX_WEEKS, OPEN_KEY, WEEKDAYS, addRow, applyPattern, copyPrevious, dropRow, emptyDraft, finalReview, mondayOf, patternCheck,
  rangeWords, shortDay, swapRow, timeOffDays, weekdayOf, weeksOf,
  type BuilderRead, type BuilderRow, type Draft, type DraftState,
} from './builderModel'
import BuilderShiftPanel, { type ShiftTarget } from './BuilderShiftPanel'
import PatternCheckPanel from './PatternCheckPanel'
import BuilderReview from './BuilderReview'
import { AssignGrid, BuilderLegend, PatternGrid, type CellPress } from './BuilderGrids'
import { FIELD, LABEL, Muted, OUTLINE_BTN, PRIMARY_BTN, Refusal, TwoPress } from './SchedulingParts'

type Step = 'pattern' | 'assign' | 'review'
type Local = { id: string; house: string; first: string; last: string; draft: Draft; state: DraftState; rev: number; dirty: boolean }

const STEPS: { id: Step; label: string }[] = [
  { id: 'pattern', label: 'Set A/B Pattern' },
  { id: 'assign', label: 'Assign and Balance Shifts' },
  { id: 'review', label: 'Final Review' },
]
const CARD = 'rounded-[16px] border border-border bg-surface p-3 shadow-1 sm:p-4'

function conflictOf(err: unknown): boolean {
  return Boolean((err as { envelope?: { data?: { conflict?: boolean } } } | null)?.envelope?.data?.conflict)
}

/** A new draft starts from the house's people who are active staff. */
function seedRows(data: BuilderRead): BuilderRow[] {
  if (!data.staff) return data.roster
  const active = new Map(data.staff.map((s) => [s.key, s.name]))
  return data.roster.filter((r) => active.has(r.key)).map((r) => ({ key: r.key, name: active.get(r.key) ?? r.name }))
}

function setAt(list: string[] | undefined, i: number, v: string): string[] {
  const out = Array.from({ length: 7 }, (_, j) => list?.[j] ?? '')
  out[i] = v
  return out
}

/** A shift taken from where it was pressed and put on `to` (a row key, OPEN, or nowhere when it is deleted). */
function placeShift(d: Draft, p: CellPress, to: string | null, text: string): Draft {
  if ('week' in p) {
    const pat = { ...(p.week === 'a' ? d.a : d.b) }
    const open = (p.week === 'a' ? d.open_a : d.open_b).map((l) => [...l])
    let at = -1
    if (p.row === OPEN_KEY) { if (p.index !== undefined) { open[p.dow].splice(p.index, 1); at = p.index } }
    else if (to !== p.row) pat[p.row] = setAt(pat[p.row], p.dow, '')
    if (to === OPEN_KEY) { if (at >= 0) open[p.dow].splice(at, 0, text); else open[p.dow].push(text) }
    else if (to) pat[to] = setAt(pat[to], p.dow, text)
    return p.week === 'a' ? { ...d, a: pat, open_a: open } : { ...d, b: pat, open_b: open }
  }
  const cells = { ...d.cells }
  const open = { ...d.open }
  const list = [...(open[p.iso] ?? [])]
  let at = -1
  if (p.row === OPEN_KEY) { if (p.index !== undefined) { list.splice(p.index, 1); at = p.index } }
  else if (to !== p.row) cells[p.row] = { ...cells[p.row], [p.iso]: '' }
  if (to === OPEN_KEY) { if (at >= 0) list.splice(at, 0, text); else list.push(text) }
  else if (to) cells[to] = { ...cells[to], [p.iso]: text }
  open[p.iso] = list
  return { ...d, cells, open }
}

export default function Builder({ initialHouse, tick, onPublished }: {
  initialHouse: string
  tick: number
  onPublished: (answer: WriteAnswer, house: string) => void
}) {
  const [sel, setSel] = useState({ house: initialHouse, first: '', last: '' })
  const selKey = builderKey(sel.house, sel.first, sel.last)
  const read = useSchedulingRead(selKey, () => readBuilder(sel.house, sel.first, sel.last), tick)
  const reload = read.reload
  const shownRef = useRef<BuilderRead | null>(null)
  if (read.data) shownRef.current = read.data
  // while another end date is read, the same house and first Monday stay drawn; never another house's
  const last0 = shownRef.current
  const data = read.data ?? (last0 && last0.house === sel.house && (!sel.first || last0.first === sel.first) ? last0 : null)
  const houses = (data ?? last0)?.houses ?? []
  // the server's own pick is the house already read
  const picked0 = !sel.house && !sel.first ? read.data?.house ?? '' : ''
  const ahead = useMemo(() => houses.filter((h) => h.code !== picked0)
    .map((h) => ({ key: builderKey(h.code, '', ''), read: () => readBuilder(h.code, '', '') })), [houses, picked0])
  useReadAhead(ahead, selKey)
  useEffect(() => { if (picked0) holdViewAs(selKey, builderKey(picked0, '', '')) }, [read.data, picked0, selKey])
  const [local, setLocal] = useState<Local | null>(null)
  // each draft as this screen last held it, so a house picked again opens on its own edits
  const drafts = useRef(new Map<string, Local>())
  if (local) drafts.current.set(local.id, local)
  const [step, setStep] = useState<Step>('pattern')
  const [checkOpen, setCheckOpen] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [press, setPress] = useState<CellPress | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishRefusal, setPublishRefusal] = useState('')
  const [armed, setArmed] = useState('')
  const seq = useRef(0)
  const inflight = useRef(false)
  const localRef = useRef(local)
  localRef.current = local
  const store = data?.store ?? ''

  // a read lays its draft down unless this screen holds the same draft with edits, or a newer save of it
  useLayoutEffect(() => {
    const got = read.data
    if (!got) return
    const id = `${got.house}|${got.first}`
    setLocal((cur) => {
      if (cur && cur.id === id && (cur.dirty || cur.rev >= got.rev)) return cur
      const mine = drafts.current.get(id)
      if (mine && (mine.dirty || mine.rev >= got.rev)) return mine
      return { id, house: got.house, first: got.first, last: got.last, draft: got.draft ?? emptyDraft(seedRows(got)),
               state: got.state, rev: got.rev, dirty: false }
    })
  }, [read.data])

  // another draft opens on its own step
  const openedId = useRef('')
  useEffect(() => {
    if (!local || openedId.current === local.id) return
    openedId.current = local.id
    setStep(local.state === 'pattern' ? 'pattern' : 'assign')
    setReviewed(false)
    setCheckOpen(false)
    setPress(null)
  }, [local])

  const flush = useCallback(async (): Promise<{ ok: boolean; rev: number }> => {
    const l = localRef.current
    if (!l || !l.dirty) return { ok: true, rev: l?.rev ?? 0 }
    if (inflight.current) return { ok: false, rev: l.rev }
    inflight.current = true
    setSaving(true)
    const mine = seq.current
    try {
      const a = await saveBuilder({ house: l.house, first: l.first, last: l.last, draft: l.draft,
                                    state: l.state === 'pattern' ? 'pattern' : 'approved', rev: String(l.rev) })
      const settled = seq.current === mine
      // a draft left for another house keeps the save's answer for when it is picked again
      const held = drafts.current.get(l.id)
      if (held) {
        const same = held.draft === l.draft && held.last === l.last && held.state === l.state
        drafts.current.set(l.id, { ...held, rev: a.rev, ...(same ? { state: a.state, dirty: false } : {}) })
      }
      setLocal((cur) => (cur && cur.id === l.id ? { ...cur, rev: a.rev, state: settled ? a.state : cur.state, dirty: !settled } : cur))
      setSaveError('')
      return { ok: settled, rev: a.rev }
    } catch (err) {
      if (conflictOf(err)) {
        toast({ type: 'warning', title: saidOf(err) })
        drafts.current.delete(l.id)
        setLocal(null)
        reload()
      } else setSaveError(saidOf(err))
      return { ok: false, rev: l.rev }
    } finally {
      inflight.current = false
      setSaving(false)
    }
  }, [reload])

  useEffect(() => {
    if (!local?.dirty || store) return
    const t = setTimeout(() => { void flush() }, 900)
    return () => clearTimeout(t)
  }, [local, store, flush])

  /** A change to the draft; a change to the pattern takes the approval back until it is applied and approved again. */
  const edit = (fn: (d: Draft) => Draft, opts: { pattern?: boolean; last?: string } = {}) => {
    seq.current++
    setLocal((cur) => {
      if (!cur) return cur
      const draft = fn(cur.draft)
      return { ...cur, draft: opts.pattern ? { ...draft, applied: false } : draft, dirty: true, last: opts.last ?? cur.last,
               state: opts.pattern ? 'pattern' : cur.state }
    })
  }

  const first = local?.first ?? ''
  const last = local?.last ?? ''
  const houseLabel = data?.houses.find((h) => h.code === local?.house)?.short || local?.house || ''
  const staff = useMemo(() => data?.staff ?? [], [data])
  const staffByKey = useMemo(() => new Map(staff.map((s) => [s.key, s])), [staff])
  const draft = local?.draft ?? null
  const applied = useMemo(() => (draft ? applyPattern(draft, first, last) : { cells: {}, open: {} }), [draft, first, last])
  const check = useMemo(() => (data && draft ? patternCheck(data, draft, applied.cells, first, last, houseLabel) : null),
    [data, draft, applied, first, last, houseLabel])
  const review = useMemo(() => (step === 'review' && data && draft ? finalReview(data, draft, first, last, houseLabel) : null),
    [step, data, draft, first, last, houseLabel])
  const timeOff = useMemo(() => (data ? timeOffDays(data) : new Set<string>()), [data])

  const warnOf = (key: string) => {
    const s = staffByKey.get(key)
    if (data?.staff && !s) return 'Not on the active staff list'
    if (s && s.ist !== true) return s.ist_why || `No IST at ${houseLabel}`
    return ''
  }
  const noIst = (draft?.rows ?? []).filter((r) => { const s = staffByKey.get(r.key); return s && s.ist !== true })
  const inactive = data?.staff ? (draft?.rows ?? []).filter((r) => !staffByKey.has(r.key)) : []

  const target: ShiftTarget | null = useMemo(() => {
    if (!press || !draft) return null
    if ('week' in press) {
      const text = press.row === OPEN_KEY
        ? (press.index === undefined ? '' : (press.week === 'a' ? draft.open_a : draft.open_b)[press.dow]?.[press.index] ?? '')
        : (press.week === 'a' ? draft.a : draft.b)[press.row]?.[press.dow] ?? ''
      return { row: press.row, index: press.index, text, words: `Week ${press.week.toUpperCase()} · ${WEEKDAYS[press.dow]}` }
    }
    const text = press.row === OPEN_KEY
      ? (press.index === undefined ? '' : draft.open[press.iso]?.[press.index] ?? '')
      : draft.cells[press.row]?.[press.iso] ?? ''
    return { row: press.row, index: press.index, text, words: `${WEEKDAYS[weekdayOf(press.iso)]} ${shortDay(press.iso)}` }
  }, [press, draft])

  const onPress = (p: CellPress) => { setCheckOpen(false); setPress(p) }
  const saveShift = (to: string | null, text: string) => {
    if (!press) return
    const p = press
    edit((d) => placeShift(d, p, to, text), { pattern: 'week' in p })
    setPress(null)
  }

  const apply = () => {
    edit((d) => ({ ...d, ...applyPattern(d, first, last) }), { pattern: true })
    // the pattern laid down is the one checked: applied is set after the edit takes approval back
    seq.current++
    setLocal((cur) => (cur ? { ...cur, draft: { ...cur.draft, applied: true }, dirty: true } : cur))
    setPress(null)
    setReviewed(true)
    setCheckOpen(true)
  }
  const approve = () => {
    seq.current++
    setLocal((cur) => (cur ? { ...cur, state: cur.state === 'pattern' ? 'approved' : cur.state, dirty: true } : cur))
    setCheckOpen(false)
    setStep('assign')
  }

  const changeHouse = (code: string) => {
    void flush()
    setSel({ house: code, first: '', last: '' })
  }
  const changeFirst = (v: string) => {
    if (!v || !local) return
    const m = mondayOf(v)
    if (m === first) return
    const weeks = weeksOf(first, last).length || 4
    void flush()
    setSel({ house: local.house, first: m, last: addDays(m, weeks * 7 - 1) })
  }
  const changeLast = (v: string) => {
    if (!local || v === last) return
    edit((d) => d, { pattern: true, last: v })
    setSel({ house: local.house, first, last: v })
  }

  const publish = async () => {
    if (!local) return
    setPublishing(true)
    setPublishRefusal('')
    try {
      let rev = local.rev
      if (localRef.current?.dirty) {
        const f = await flush()
        if (!f.ok) { setPublishRefusal('The draft could not be saved just now — try again.'); return }
        rev = f.rev
      }
      const answer = await publishBuilder(local.house, local.first, rev)
      const rep = answer.builder
      toast(rep && rep.skipped_count
        ? { type: 'warning', title: answer.said || 'Published.',
            body: rep.skipped.slice(0, 3).map((s) => `${s.name}${s.date ? ` ${shortDay(s.date)}` : ''}: ${s.why}`).join(' · ') }
        : { type: 'success', title: answer.said || 'Published.' })
      onPublished(answer, local.house)
    } catch (err) {
      if (conflictOf(err)) { drafts.current.delete(local.id); setLocal(null); reload() }
      setPublishRefusal(saidOf(err))
    } finally {
      setPublishing(false)
      setArmed('')
    }
  }

  const approved = local ? local.state !== 'pattern' : false
  const ready = Boolean(data && local && local.id === `${data.house}|${data.first}`)
  const sundays = first ? Array.from({ length: MAX_WEEKS }, (_, i) => addDays(first, 7 * (i + 1) - 1)) : []
  const status = saving ? 'Saving…' : local?.dirty ? (store ? 'Not kept' : 'Unsaved changes') : local && local.rev ? 'Saved' : ''

  const location = (value: string) => (
    <label className={cn(LABEL, 'min-w-[180px] flex-1')}>
      Location
      <select value={value} onChange={(e) => changeHouse(e.target.value)} className={FIELD} data-location="">
        {houses.map((h) => <option key={h.code} value={h.code}>{h.short}{h.location && h.location !== h.short ? ` — ${h.location}` : ''}</option>)}
      </select>
    </label>
  )

  if (!ready || !local || !data || !draft) {
    const picked = sel.house || last0?.house || ''
    const pickedLabel = houses.find((h) => h.code === picked)?.short || picked
    return (
      <div className={cn(CARD, 'grid gap-3')} data-builder="" data-builder-loading={picked}>
        {houses.length > 0 && <div className="flex flex-wrap items-end gap-3">{location(picked)}</div>}
        {read.status === 'failed'
          ? <Refusal>The Builder could not be read — {read.error || 'the server did not answer'}.</Refusal>
          : <p className="flex items-center gap-2 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" />
              {pickedLabel ? `Reading ${pickedLabel}'s draft…` : 'Reading the Builder…'}
            </p>}
        {read.status === 'failed' && <button type="button" className={cn(OUTLINE_BTN, 'justify-self-start')} onClick={reload}>Try again</button>}
      </div>
    )
  }

  return (
    <div className="grid gap-4" data-builder="">
      <ol className="grid gap-1.5 rounded-[16px] border border-border bg-surface p-1.5 shadow-1 sm:grid-cols-3" aria-label="Builder steps">
        {STEPS.map((s) => {
          const on = s.id === step
          const locked = s.id !== 'pattern' && !approved
          return (
            <li key={s.id}>
              <button type="button" disabled={locked} onClick={() => { setPress(null); setCheckOpen(false); setStep(s.id) }}
                aria-current={on ? 'step' : undefined} data-step={s.id}
                className={cn('h-9 w-full rounded-[12px] px-3 text-left text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  on ? 'bg-tint-primary text-primary ring-1 ring-primary' : 'text-text-2 hover:bg-surface-2')}>
                {s.label}
              </button>
            </li>
          )
        })}
      </ol>

      {(store || data.staff_why || saveError || read.error) && (
        <div className="grid gap-1">
          {store && <p className="rounded-md bg-tint-warning px-3 py-2 text-[12.5px] text-tint-fg-warning" data-store="">{store} Changes stay on this screen only.</p>}
          {data.staff_why && <Refusal>Only active staff can be offered, and {data.staff_why}.</Refusal>}
          {saveError && <Refusal>The draft was not saved — {saveError}</Refusal>}
          {read.error && <p className="text-[12px] text-warning">It could not be read again just now — {read.error}.</p>}
        </div>
      )}

      {step === 'pattern' && (
        <>
          <div className={cn(CARD, 'flex flex-wrap items-end gap-3')} data-pattern-bar="">
            {location(local.house)}
            <label className={cn(LABEL, 'min-w-[160px]')}>
              Start date · Monday
              <input type="date" value={first} onChange={(e) => changeFirst(e.target.value)} className={FIELD} />
            </label>
            <label className={cn(LABEL, 'min-w-[200px]')}>
              End date · Sunday
              <select value={last} onChange={(e) => changeLast(e.target.value)} className={FIELD}>
                {sundays.map((s, i) => <option key={s} value={s}>{s} · {i + 1} week{i ? 's' : ''}</option>)}
              </select>
            </label>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {(reviewed || draft.applied) && (
                <button type="button" className={OUTLINE_BTN} onClick={() => { setPress(null); setCheckOpen(true) }} data-act="review-check">
                  <ClipboardCheck size={14} /> Review pattern check
                </button>
              )}
              <button type="button" className={PRIMARY_BTN} onClick={apply} disabled={!draft.rows.length && !draft.open_a.some((l) => l.length)}
                data-act="apply-pattern">
                <CalendarCheck size={14} /> Apply patterns to period
              </button>
            </div>
          </div>

          {(noIst.length > 0 || inactive.length > 0) && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-tint-amber px-3 py-2 text-[12.5px] leading-5 text-tint-fg-amber" data-ist-warning="">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                {noIst.length > 0 && (
                  <span className="block">
                    <span className="font-semibold">No IST at {houseLabel}:</span> {noIst.map((r) => r.name).join(', ')}. Someone new to the
                    house without its IST works as a training — publishing leaves their shifts out; place them from House Calendars.
                  </span>
                )}
                {inactive.length > 0 && (
                  <span className="block"><span className="font-semibold">Not active staff:</span> {inactive.map((r) => r.name).join(', ')}.</span>
                )}
              </span>
            </div>
          )}

          <div className={CARD}>
            <PatternGrid draft={draft} staff={staff} staffWhy={data.staff_why} selected={press} warnOf={warnOf} onPress={onPress}
              canCopy={Boolean(data.prev)}
              onCopy={(w) => { if (data.prev) edit((d) => copyPrevious(d, w, data.prev![w], data.staff), { pattern: true }) }}
              onAddRow={(s) => edit((d) => addRow(d, { key: s.key, name: s.name }), { pattern: true })}
              onSwapRow={(from, s) => edit((d) => swapRow(d, from, { key: s.key, name: s.name }), { pattern: true })}
              onDropRow={(key) => edit((d) => dropRow(d, key), { pattern: true })} />
          </div>
        </>
      )}

      {step === 'assign' && (
        <>
          <div className={cn(CARD, 'flex flex-wrap items-center justify-between gap-3')}>
            <p className="text-[13px] font-semibold text-text-1">
              {houseLabel} · {rangeWords(first, last)} · {weeksOf(first, last).length} weeks
              {local.state === 'published' && <span className="ml-2 rounded-full bg-tint-mint px-2 py-0.5 text-[11px] text-tint-fg-mint">Published</span>}
            </p>
            <button type="button" className={PRIMARY_BTN} onClick={() => { setPress(null); setStep('review') }} data-act="final-review">
              Final Review <ArrowRight size={14} />
            </button>
          </div>
          <div className="overflow-hidden rounded-[16px] border border-border bg-surface shadow-1">
            <AssignGrid draft={draft} first={first} last={last} timeOff={timeOff} selected={press} onPress={onPress} today={data.today} />
            <div className="border-t border-border"><BuilderLegend /></div>
          </div>
        </>
      )}

      {step === 'review' && review && (
        <BuilderReview review={review} houseLabel={houseLabel} first={first} last={last} onRefresh={reload}
          refreshing={read.status === 'loading'}
          publish={(
            <div className="grid justify-items-end gap-1">
              <TwoPress id="publish" armed={armed} busy={publishing} disabled={Boolean(store) || !approved || saving}
                label="Publish New Calendar" armedLabel="Write it into House Calendars"
                icon={publishing ? <Loader2 size={13} className="animate-spin" /> : <CalendarCheck size={13} />}
                onArm={(a, act) => { setArmed(a); if (act) void publish() }} />
              <Refusal>{publishRefusal}</Refusal>
              <Muted>Cells a request or a one-off holds stay as they are; days already past are not written.</Muted>
            </div>
          )} />
      )}

      <p className="text-right text-[11.5px] text-text-3" data-save-state="">
        {status}{local.state !== 'pattern' && local.rev ? ` · ${local.state === 'published' ? 'published' : 'approved'}` : ''}
        {data.updated_by && !local.dirty ? ` · last saved by ${data.updated_by}` : ''}
      </p>

      {check && (
        <PatternCheckPanel open={checkOpen} check={check} approved={approved} busy={saving}
          refusal={store ? store : !draft.applied ? 'Apply the patterns to the period before approving.' : ''}
          canApprove={!store && draft.applied}
          onClose={() => setCheckOpen(false)} onEdit={() => { setCheckOpen(false); setStep('pattern') }} onApprove={approve} />
      )}
      <BuilderShiftPanel target={target} rows={draft.rows} onClose={() => setPress(null)}
        onSave={(to, text) => saveShift(to, text)} onDelete={() => saveShift(null, '')} />
    </div>
  )
}
