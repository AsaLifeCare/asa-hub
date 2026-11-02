// The master's setup: the three vehicles seeded, the Van Calendar's trips brought in once (never written back), and…
// A person transportation.settings lists sees the trip types alone.
// Seed and Import always run dry first; only after their report is read do they run, with a second press.
import { useState, type ReactNode } from 'react'
import { DatabaseZap, FlaskConical, Loader2, Save, Upload } from 'lucide-react'
import { dayLabel, momentWords, type Settings } from './vehicleCalendarModel'
import { importVanCalendar, saidOf, seedVehicles, setSettings, type SetupAnswer } from './vehicleCalendarLane'
import { AREA, FIELD, Field, Muted, OUTLINE_BTN, Refusal, TwoPress } from './parts'

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const names = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) : [])
const n = (v: unknown): string => (typeof v === 'number' ? String(v) : Array.isArray(v) ? String(v.length) : '—')

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 text-[12.5px] last:border-b-0">
      <span className="text-text-3">{label}</span>
      <span className="text-right font-medium text-text-1">{children}</span>
    </div>
  )
}

function Head({ got }: { got: SetupAnswer }) {
  return (
    <p className={got.dry_run ? 'text-[12px] font-semibold text-text-2' : 'text-[12px] font-semibold text-[var(--success)]'}>
      {got.dry_run ? 'Dry run — nothing was written.' : 'Done — written.'}{got.said ? ` ${got.said}` : ''}
    </p>
  )
}

export function SeedReport({ got }: { got: SetupAnswer | null }) {
  if (!got) return null
  const v = rec(got.report.vehicles)
  const s = rec(got.report.settings)
  return (
    <div className="mt-2 grid gap-1 rounded-[12px] bg-surface-2 p-3" data-seed-report="">
      <Head got={got} />
      <Line label="Vehicles to add">{names(v.add).join(', ') || 'None'}</Line>
      <Line label="Vehicles already there">{names(v.kept).join(', ') || 'None'}</Line>
      <Line label="Settings to add">{names(s.add).join(', ') || 'None'}</Line>
      <Line label="Settings already there">{names(s.kept).join(', ') || 'None'}</Line>
    </div>
  )
}

export function ImportReport({ got }: { got: SetupAnswer | null }) {
  if (!got) return null
  const r = got.report
  const skipped = Array.isArray(r.skipped) ? r.skipped.map(rec) : []
  const conflicts = Array.isArray(r.conflicts) ? r.conflicts.map(rec) : []
  return (
    <div className="mt-2 grid gap-1 rounded-[12px] bg-surface-2 p-3" data-import-report="">
      <Head got={got} />
      <Line label="Rows read">{n(r.read)}</Line>
      <Line label="Read one column over">{n(r.realigned)}</Line>
      <Line label="Unreadable">{n(r.unread)}</Line>
      <Line label={got.dry_run ? 'Trips to add' : 'Trips added'}>{n(r.add)}</Line>
      <Line label="Already imported">{n(r.already)}</Line>
      <Line label="End assumed">{n(r.end_assumed)}</Line>
      <Line label="Days">{r.first_day ? `${dayLabel(String(r.first_day))} – ${dayLabel(String(r.last_day ?? ''))}` : '—'}</Line>
      {names(r.vehicles_unmatched).length > 0 && <Line label="Vehicles not matched">{names(r.vehicles_unmatched).join(', ')}</Line>}
      {names(r.clients_unmatched).length > 0 && <Line label="Clients not on the list">{names(r.clients_unmatched).join(', ')}</Line>}
      {skipped.length > 0 && (
        <details className="mt-1 text-[12px]">
          <summary className="cursor-pointer text-text-2">{skipped.length} skipped</summary>
          <ul className="mt-1 grid gap-0.5 text-text-3">{skipped.map((x, i) => <li key={i}>Row {String(x.row ?? '?')}: {String(x.why ?? '')}</li>)}</ul>
        </details>
      )}
      {conflicts.length > 0 && (
        <details className="mt-1 text-[12px]">
          <summary className="cursor-pointer text-text-2">{conflicts.length} clash{conflicts.length === 1 ? '' : 'es'} sent to Needs assignment</summary>
          <ul className="mt-1 grid gap-0.5 text-text-3">
            {conflicts.map((x, i) => <li key={i}>Row {String(x.row ?? '?')}{x.with ? ` with row ${String(x.with)}` : ''}{x.note ? ` — ${String(x.note)}` : ''}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}

export const NOT_READ = 'not read yet'

function directorsNow(s: Settings | null): string {
  if (!s) return `Now: ${NOT_READ}`
  if (!s.directors_readable) return `Now: could not be read${s.directors_why ? ` — ${s.directors_why}` : ''}`
  return `Now: ${s.directors.map((x) => x.name).join(', ') || 'nobody'}`
}

export default function SetupPanel({ settings: s, onChanged, master = true }: {
  settings: Settings | null
  onChanged: () => void
  /** the master's whole setup; else the trip types alone (transportation.settings) */
  master?: boolean
}) {
  const [busy, setBusy] = useState('')
  const [armed, setArmed] = useState('')
  const [refusal, setRefusal] = useState('')
  const [seed, setSeed] = useState<SetupAnswer | null>(null)
  const [imported, setImported] = useState<SetupAnswer | null>(null)
  const [directors, setDirectors] = useState('')
  const [types, setTypes] = useState('')
  const [minutes, setMinutes] = useState('')
  const [said, setSaid] = useState('')

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

  const tripTypes = types.split('\n').map((t) => t.trim()).filter(Boolean)
  const values = {
    ...(master && directors.trim() ? { directors: directors.trim() } : {}),
    ...(tripTypes.length ? { trip_types: tripTypes } : {}),
    ...(master && minutes.trim() && Number(minutes) > 0 ? { import_minutes: Number(minutes) } : {}),
  }

  return (
    <div className="mt-1 grid gap-5" data-setup-panel={master ? '' : 'trip-types'}>
      {master && <>
      <section className="grid gap-2" data-setup="seed">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Seed the vehicles</p>
        <Muted>
          Adds the Van, the Mazda and the Ford and the settings that are missing; nothing already there is written.
          {s?.seeded ? ' The vehicles are seeded.' : ''}
        </Muted>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(busy)} className={OUTLINE_BTN} data-act="seed-dry"
            onClick={() => void act('seed-dry', async () => setSeed(await seedVehicles(true)))}>
            {busy === 'seed-dry' ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} Dry run
          </button>
          <TwoPress id="seed" armed={armed} busy={busy === 'seed'} disabled={!seed?.dry_run || Boolean(busy)} tone="primary" icon={<DatabaseZap size={13} />}
            label="Seed now" armedLabel="Seed the vehicles"
            onArm={(a, go) => { setArmed(a); if (go) void act('seed', async () => { setSeed(await seedVehicles(false)); onChanged() }) }} />
        </div>
        <SeedReport got={seed} />
      </section>

      <section className="grid gap-2 border-t border-border pt-4" data-setup="import">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Import the Van Calendar</p>
        <Muted>
          Brings the Van Calendar’s trips in once, as scheduled on the Van; the Van Calendar itself is only read, never
          written. A trip already brought in is never brought in again.
          {s?.imported_at ? ` Last imported ${momentWords(s.imported_at) || s.imported_at}.` : ''}
        </Muted>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(busy)} className={OUTLINE_BTN} data-act="import-dry"
            onClick={() => void act('import-dry', async () => setImported(await importVanCalendar(true)))}>
            {busy === 'import-dry' ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} Dry run
          </button>
          <TwoPress id="import" armed={armed} busy={busy === 'import'} disabled={!imported?.dry_run || Boolean(busy)} tone="primary" icon={<Upload size={13} />}
            label="Import now" armedLabel="Import the trips"
            onArm={(a, go) => { setArmed(a); if (go) void act('import', async () => { setImported(await importVanCalendar(false)); onChanged() }) }} />
        </div>
        <ImportReport got={imported} />
      </section>
      </>}

      <section className={master ? 'grid gap-3 border-t border-border pt-4' : 'grid gap-3'} data-setup="settings">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{master ? 'Who approves, and the trip types' : 'The trip types'}</p>
        {master && (
          <Field label="Directors (e-mails, comma between)" hint={directorsNow(s)}>
            <input value={directors} onChange={(e) => { setDirectors(e.target.value); setArmed('') }} className={FIELD} data-field="directors"
              placeholder="ty.bond@asalifecare.com, brittfrench1316@gmail.com" />
          </Field>
        )}
        <Field label="Trip types (one per line)" hint={`Now: ${s ? s.trip_types.join(', ') || 'none' : NOT_READ}`}>
          <textarea value={types} onChange={(e) => { setTypes(e.target.value); setArmed('') }} rows={4} className={AREA} data-field="trip-types" />
        </Field>
        {master && (
          <Field label="Minutes assumed for an imported trip with no end" hint="Used by the next import.">
            <input inputMode="numeric" value={minutes} onChange={(e) => { setMinutes(e.target.value.replace(/[^\d]/g, '')); setArmed('') }} className={FIELD}
              placeholder="120" data-field="import-minutes" />
          </Field>
        )}
        <div>
          <TwoPress id="settings" armed={armed} busy={busy === 'settings'} disabled={!Object.keys(values).length || Boolean(busy)} tone="primary" icon={<Save size={13} />}
            label="Save settings" armedLabel="Save"
            onArm={(a, go) => {
              setArmed(a)
              if (go) {
                void act('settings', async () => {
                  const got = await setSettings(values)
                  setSaid(String(got?.said ?? '') || 'Saved.')
                  setDirectors('')
                  setTypes('')
                  setMinutes('')
                  onChanged()
                })
              }
            }} />
        </div>
        <Muted>{said}</Muted>
      </section>
      <Refusal>{refusal}</Refusal>
    </div>
  )
}
