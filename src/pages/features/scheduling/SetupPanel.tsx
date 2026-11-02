// The master's setup: who the directors are, the waits and the cycle; the seed from the house books, the copy…
// Each is always run dry first, its report read, and only then pressed twice to run.
// The settings edition sees the waits and the cycle alone.
import { useState } from 'react'
import { CalendarArrowDown, CopyPlus, DatabaseZap, FlaskConical, Loader2, Save } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import type { Board } from './schedulingModel'
import {
  importTimeOff, rolledFrom, rollForward, saidOf, seedCalendars, setSettings, type SetupReport, type TimeOffImportLine,
  type TimeOffImportReport,
} from './schedulingLane'
import { FIELD, LABEL, Muted, OUTLINE_BTN, PRIMARY_BTN, Refusal, TwoPress } from './SchedulingParts'

const NUMBERS: { key: 'outreach_wait_min' | 'min_days_ahead' | 'cycle_days' | 'roll_lead_days'; label: string; hint: string }[] = [
  { key: 'outreach_wait_min', label: 'Minutes before everyone is texted', hint: 'After a call-off the house is texted first; still open after this, all staff.' },
  { key: 'min_days_ahead', label: 'Days of notice for Request Off and Time off', hint: 'Inside it only Call Off and Swap are offered.' },
  { key: 'cycle_days', label: 'Days in a period', hint: 'A multiple of 7.' },
  { key: 'roll_lead_days', label: 'Days before a period ends (no longer used)', hint: 'The calendar is no longer copied forward by itself.' },
]

function Report({ got }: { got: SetupReport | null }) {
  if (!got) return null
  return (
    <div className="mt-2">
      <p className="text-[11.5px] font-semibold text-text-2">{got.dry_run ? 'Dry run — nothing was written' : 'Done — written'}</p>
      <pre className="scroll-thin mt-1 max-h-[260px] overflow-auto rounded-md bg-surface-2 p-2 text-[11px] leading-4 text-text-1" data-report="">
        {JSON.stringify(got.report, null, 2)}
      </pre>
    </div>
  )
}

const OUTCOME: Record<TimeOffImportLine['outcome'], { word: string; tone: string }> = {
  would_import: { word: 'Would import', tone: 'bg-tint-primary text-primary' },
  imported: { word: 'Imported', tone: 'bg-tint-primary text-primary' },
  already_imported: { word: 'Already here', tone: 'bg-surface-2 text-text-2' },
  unmatched: { word: 'Not matched', tone: 'bg-tint-danger text-danger' },
  skipped: { word: 'Left behind', tone: 'bg-surface-2 text-text-3' },
}

function ImportLines({ got }: { got: TimeOffImportReport | null }) {
  if (!got) return null
  const c = got.report.counts
  return (
    <div className="mt-2" data-timeoff-import="">
      <p className="text-[11.5px] font-semibold text-text-2">{got.dry_run ? 'Dry run — nothing was written' : 'Done — written'}</p>
      <Muted className="mt-0.5">{got.said}</Muted>
      <Muted className="mt-0.5">
        {c.rows} request(s) read: {Object.entries(c.by_status).map(([k, n]) => `${n} ${k}`).join(', ')}.
        {c.with_conflicts ? ` ${c.with_conflicts} approved request(s) fall on shifts still on the calendar — nothing was changed there.` : ''}
      </Muted>
      <ul className="scroll-thin mt-1.5 grid max-h-[360px] gap-1 overflow-auto">
        {got.report.lines.map((l) => {
          const o = OUTCOME[l.outcome] ?? OUTCOME.skipped
          const where = [...l.houses, ...l.houses_unknown.map((h) => `${h} (unknown)`)].join(', ') || 'no houses'
          return (
            <li key={l.ref} className="rounded-md border border-border bg-surface px-2 py-1.5 text-[11.5px] leading-4" data-import-line={l.outcome}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 font-semibold text-text-1">
                  {l.matched || l.person}
                  {l.matched && l.matched !== l.person && <span className="font-normal text-text-3"> (filed as {l.person})</span>}
                </span>
                <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-semibold', o.tone)}>{o.word}</span>
              </div>
              <p className="text-text-2">
                {l.from === l.to ? l.from : `${l.from} to ${l.to}`} · {l.status}
                {l.as ? ` → ${l.as === 'waiting' ? 'waiting on the directors' : 'approved'}` : ''} · {where}
              </p>
              {l.why && <p className="text-text-3">{l.why}</p>}
              {l.conflicts.length > 0 && (
                <p className="text-warning">Holds {l.conflicts.length} shift(s) those days: {l.conflicts.join(' · ')}</p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function SetupPanel({ open, onClose, board, full = true, onChanged }: {
  open: boolean
  onClose: () => void
  board: Board
  /** the master's whole setup; false: the settings edition's waits and cycle alone */
  full?: boolean
  /** the board should be read again */
  onChanged: () => void
}) {
  const s = board.settings
  const [directors, setDirectors] = useState('')
  const [nums, setNums] = useState<Record<string, string>>({})
  const [first, setFirst] = useState(board.period.first)
  const [last, setLast] = useState(board.period.last)
  const [busy, setBusy] = useState('')
  const [armed, setArmed] = useState('')
  const [refusal, setRefusal] = useState('')
  const [said, setSaid] = useState('')
  const [seed, setSeed] = useState<SetupReport | null>(null)
  const [roll, setRoll] = useState<SetupReport | null>(null)
  const [carry, setCarry] = useState<TimeOffImportReport | null>(null)

  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what)
    setRefusal('')
    setSaid('')
    try {
      await fn()
    } catch (err) {
      setRefusal(saidOf(err))
    } finally {
      setBusy('')
      setArmed('')
    }
  }

  const values: Record<string, string> = {
    ...(full && directors.trim() ? { directors: directors.trim() } : {}),
    ...Object.fromEntries(Object.entries(nums).filter(([, v]) => v.trim() !== '')),
  }
  // the settings edition's save names each changed number as this panel showed it (Python's door alone reads it)
  const seen: Record<string, string> = full ? {}
    : Object.fromEntries(NUMBERS.filter((n) => n.key in values).map((n) => [n.key, String(s[n.key])]))

  return (
    <SidePanel open={open} onClose={onClose} label="Setup" title={full ? 'Scheduling setup' : 'Scheduling settings'}
      footer={<button type="button" onClick={onClose} className={cn(OUTLINE_BTN, 'w-full')}>Close</button>}>
      <section className="mt-3 grid gap-2" data-setup="settings">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{full ? 'Directors and waits' : 'Waits and the cycle'}</p>
        {full && (
          <label className={LABEL}>
            Directors (e-mails, comma between)
            <input value={directors} onChange={(e) => setDirectors(e.target.value)} className={FIELD}
              placeholder={s.directors_readable ? `Now: ${s.directors.join(', ')}` : 'Now: could not be read'} />
          </label>
        )}
        {NUMBERS.map((n) => (
          <label key={n.key} className={LABEL} title={n.hint}>
            {n.label}
            <input inputMode="numeric" value={nums[n.key] ?? ''} onChange={(e) => setNums({ ...nums, [n.key]: e.target.value })}
              className={FIELD} placeholder={`Now: ${s[n.key]}`} />
          </label>
        ))}
        <button type="button" disabled={!Object.keys(values).length || Boolean(busy)} className={PRIMARY_BTN}
          onClick={() => void act('settings', async () => {
            try {
              await setSettings(values, seen)
            } catch (err) {
              // a refusal may say the values moved: the board is read again so "Now:" shows them
              onChanged()
              throw err
            }
            setSaid('Saved.')
            setDirectors('')
            setNums({})
            onChanged()
          })}>
          {busy === 'settings' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save settings
        </button>
        {said && <Muted>{said}</Muted>}
        {!full && <Muted>Who the directors are, the seed, the copy forward and the time off import stay the master’s.</Muted>}
      </section>

      {full && (<>
      <section className="mt-5 grid gap-2 border-t border-border pt-4" data-setup="seed">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Seed from the house books</p>
        <Muted>Copies each house book’s calendar into Scheduling once. Run it dry, read the report, then run it.</Muted>
        <div className="grid grid-cols-2 gap-2">
          <label className={LABEL}>First day<input type="date" value={first} onChange={(e) => { setFirst(e.target.value); setSeed(null) }} className={FIELD} /></label>
          <label className={LABEL}>Last day<input type="date" value={last} onChange={(e) => { setLast(e.target.value); setSeed(null) }} className={FIELD} /></label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={Boolean(busy)} className={OUTLINE_BTN}
            onClick={() => void act('seed-dry', async () => setSeed(await seedCalendars(true, first, last)))}>
            {busy === 'seed-dry' ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} Dry run
          </button>
          <TwoPress id="seed" armed={armed} busy={busy === 'seed'} disabled={!seed?.dry_run || Boolean(busy)} icon={<DatabaseZap size={13} />}
            label="Seed now" armedLabel="Seed every house"
            onArm={(a, go) => { setArmed(a); if (go) void act('seed', async () => { setSeed(await seedCalendars(false, first, last)); onChanged() }) }} />
        </div>
        <Report got={seed} />
      </section>

      <section className="mt-5 grid gap-2 border-t border-border pt-4" data-setup="roll">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Copy forward</p>
        <Muted>
          Makes the next period for every house from the shifts as scheduled; one-off changes are left behind.
          {' It never happens by itself: the Builder publishes the next weeks of a house.'}
        </Muted>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={Boolean(busy)} className={OUTLINE_BTN}
            onClick={() => void act('roll-dry', async () => setRoll(await rollForward(true)))}>
            {busy === 'roll-dry' ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} Dry run
          </button>
          <TwoPress id="roll" armed={armed} busy={busy === 'roll'} disabled={!roll?.dry_run || Boolean(busy)} icon={<CopyPlus size={13} />}
            label="Copy forward now" armedLabel="Copy every house forward"
            onArm={(a, go) => { setArmed(a); if (go) void act('roll', async () => { setRoll(await rollForward(false, rolledFrom(roll?.report))); onChanged() }) }} />
        </div>
        <Report got={roll} />
      </section>

      <section className="mt-5 grid gap-2 border-t border-border pt-4" data-setup="timeoff-import">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Import time off</p>
        <Muted>
          Carries the Time Off app’s approved requests in as approved time off and its pending ones to the directors’
          My Work. Nobody is texted and no shift on the calendar changes. Run it dry, read the list, then import; a
          second import adds nothing already carried.
        </Muted>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={Boolean(busy)} className={OUTLINE_BTN}
            onClick={() => void act('carry-dry', async () => setCarry(await importTimeOff(false)))}>
            {busy === 'carry-dry' ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} Dry run
          </button>
          <TwoPress id="carry" armed={armed} busy={busy === 'carry'} disabled={!carry?.dry_run || Boolean(busy)} icon={<CalendarArrowDown size={13} />}
            label="Import" armedLabel="Import the time off"
            onArm={(a, go) => { setArmed(a); if (go) void act('carry', async () => { setCarry(await importTimeOff(true)); onChanged() }) }} />
        </div>
        <ImportLines got={carry} />
      </section>
      </>)}
      <Refusal>{refusal}</Refusal>
    </SidePanel>
  )
}
