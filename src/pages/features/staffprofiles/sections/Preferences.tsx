// Preferences: preferred shifts (with the Calendar Builder's own text when imported), open-shift pickup, weekend…
// Drawn at once from the last copy this account kept for the person, read again behind it, and again when the relay…
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'
import { keep, readKept } from '@/lib/kept'
import { placeScope } from '@/lib/placeKey'
import { onLiveEvent } from '@/lib/snapshotClient'
import { cn } from '@/lib/utils'
import { inputCls } from '@/pages/features/clientops/OpsPageShell'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { toast } from '@/stores/useToastStore'
import { staffCan, type RosterRow } from '../staffModel'
import {
  PREF_ALLERGIES, PREF_DAYS, PREF_OTHER_MAX, PREF_PICKUP, PREF_SHIFTS, PREF_WEEKS, housesShown, prefsFrom, samePrefs, staffPrefsOf, toggled,
  type Prefs, type PrefWeek,
} from '../prefsModel'
import {
  QUEUED_WORDS, readKey, readPreferences, savePreferences, staffWrote, useStaffRead, writeQueued,
} from '../useStaffRead'
import { useStaffViewer } from '../staffViewer'
import { EmptyNote, ReadLine, WhyNote } from '../StaffParts'

/** The relay's ring after a preferences save landed (server/snapshot_service.py STAFF_PROFILES_EVENT). */
export const STAFF_LIVE_EVENT = 'staff-profiles'
const KEPT_PREFIX = 'asa:staff:prefs:'

type KeptPrefs = { owner: string; raw: unknown }

function ownerNow(): string {
  const uid = useAuthStore.getState().user?.id ?? ''
  return uid ? placeScope(uid) : ''
}

function keptRaw(staff: string): unknown {
  const owner = ownerNow()
  if (!owner) return null
  const got = readKept<KeptPrefs>(`${KEPT_PREFIX}${owner}|${staff}`)
  return got && got.owner === owner ? got.raw : null
}

function keepRaw(staff: string, raw: unknown): void {
  const owner = ownerNow()
  const copy: KeptPrefs = { owner, raw }
  if (owner) keep(`${KEPT_PREFIX}${owner}|${staff}`, copy)
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function PreferencesSection({ row }: { row: RosterRow }) {
  const staff = row.key
  const load = useCallback(() => readPreferences(staff).then((raw) => { keepRaw(staff, raw); return raw }), [staff])
  const read = useStaffRead(readKey('staffProfilePreferences', staff), load, staffPrefsOf, () => keptRaw(staff))
  const { reload } = read
  useEffect(() => onLiveEvent(STAFF_LIVE_EVENT, () => reload()), [reload])
  const data = read.data
  return (
    <div className="grid gap-5" data-preferences="">
      <ReadLine state={read} what="the preferences" onRetry={reload} />
      {data && !data.ready && (
        <SectionCard title="Preferences">
          {data.why && !/not set up/i.test(data.why) && <WhyNote why={data.why} />}
          <EmptyNote kind="missing">Preferences are not set up yet: their store has not been created. Nothing here can be saved until it is.</EmptyNote>
        </SectionCard>
      )}
      {data?.ready && (
        <PreferencesForm key={staff} staff={staff} houses={data.houses} saved={data.prefs} updatedAt={data.updatedAt}
          why={data.why} onConflict={reload} />
      )}
    </div>
  )
}

function Tile({ label, checked, disabled, onChange, data }: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (on: boolean) => void
  data?: string
}) {
  return (
    <label data-pref={data}
      className={cn('flex min-h-11 items-center gap-2.5 rounded-[12px] border px-3 py-2 text-[13px] transition-colors',
        checked ? 'border-primary bg-primary-soft text-text-1' : 'border-border bg-surface text-text-2',
        disabled ? 'cursor-default' : 'cursor-pointer hover:bg-surface-2')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-[var(--primary)]" />
      <span className="min-w-0 flex-1 break-words">{label}</span>
    </label>
  )
}

function TileGrid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={cn('grid gap-2', cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>{children}</div>
}

function PreferencesForm({ staff, houses, saved, updatedAt, why, onConflict }: {
  staff: string
  houses: { code: string; name: string }[]
  saved: Prefs
  updatedAt: string
  why: string
  onConflict: () => void
}) {
  const locked = !staffCan(useStaffViewer(), 'staff.preferences')
  const [base, setBase] = useState({ prefs: saved, updatedAt })
  const [draft, setDraft] = useState<Prefs>(saved)
  const [another, setAnother] = useState('')
  const [saving, setSaving] = useState(false)
  const dirty = !samePrefs(draft, base.prefs)
  const busy = useRef({ dirty, saving })
  useEffect(() => { busy.current = { dirty, saving } })

  // a new answer replaces what is drawn, unless changes are not yet saved or a save is on its way
  useEffect(() => {
    if (busy.current.dirty || busy.current.saving) return
    setDraft((d) => (samePrefs(d, saved) ? d : saved))
    setBase((b) => (b.updatedAt === updatedAt && samePrefs(b.prefs, saved) ? b : { prefs: saved, updatedAt }))
  }, [saved, updatedAt])

  const shown = useMemo(() => housesShown(houses, draft.unavailable_locations), [houses, draft.unavailable_locations])
  const set = (patch: Partial<Prefs>) => setDraft((d) => ({ ...d, ...patch }))
  const setDay = (week: PrefWeek, day: string, on: boolean) =>
    set({ unavailable_days: { ...draft.unavailable_days, [week]: toggled(draft.unavailable_days[week], day, on) } })

  const anotherText = another.replace(/\s+/g, ' ').trim().slice(0, 80)
  const canAdd = !locked && !!anotherText && draft.other_locations.length < PREF_OTHER_MAX &&
    !draft.other_locations.some((x) => x.toLowerCase() === anotherText.toLowerCase())
  const addAnother = () => {
    if (!canAdd) return
    set({ other_locations: [...draft.other_locations, anotherText] })
    setAnother('')
  }

  const save = async () => {
    if (!dirty || saving || locked) return
    const next = prefsFrom(draft)
    setSaving(true)
    try {
      const answer = await savePreferences(staff, next, base.updatedAt)
      if (writeQueued(answer)) {
        setBase((b) => ({ ...b, prefs: next }))
        toast({ type: 'success', title: 'Preferences accepted', body: QUEUED_WORDS })
      } else {
        const o = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>
        const landed = prefsFrom(o.prefs ?? next)
        const stamp = typeof o.updated_at === 'string' ? o.updated_at : base.updatedAt
        setBase({ prefs: landed, updatedAt: stamp })
        setDraft(landed)
        keepRaw(staff, { ready: true, houses, prefs: landed, updated_at: stamp, updated_by: o.updated_by ?? '', why })
        toast({ type: 'success', title: 'Preferences saved' })
      }
      staffWrote(staff, answer)
    } catch (e) {
      const said = errText(e)
      toast({ type: 'danger', title: 'Preferences not saved', body: said })
      if (/^changed since/i.test(said)) {
        setDraft(base.prefs)
        onConflict()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {why && <WhyNote why={why} />}
      <SectionCard title="Preferred shifts">
        <TileGrid>
          {PREF_SHIFTS.map((s) => (
            <Tile key={s.id} data={`shift-${s.id}`} label={s.label} disabled={locked} checked={draft.shifts.includes(s.id)}
              onChange={(on) => set({ shifts: toggled(draft.shifts, s.id, on) })} />
          ))}
        </TileGrid>
        {draft.shifts_note && (
          <p className="mt-2 text-[12.5px] text-text-3" data-shifts-note="">From the Calendar Builder: {draft.shifts_note}</p>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-[12px] font-medium text-text-2">
            Picks up open shifts
            <select value={draft.pickup} disabled={locked} onChange={(e) => set({ pickup: e.target.value })}
              className={inputCls} data-pref-pickup="">
              {PREF_PICKUP.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] font-medium text-text-2">
            Weekend work
            <input value={draft.weekend_work} maxLength={200} disabled={locked} placeholder="e.g. Every other weekend"
              onChange={(e) => set({ weekend_work: e.target.value })} className={inputCls} data-pref-weekend="" />
          </label>
        </div>
      </SectionCard>

      <SectionCard title="Unavailable days">
        <div className="scroll-thin -mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[460px] text-[12.5px]" data-unavailable-days="">
            <thead>
              <tr className="border-b border-border text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">
                <th className="py-2 pr-3 text-left font-semibold">Week</th>
                {PREF_DAYS.map((d) => <th key={d.id} className="px-1 py-2 text-center font-semibold">{d.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {PREF_WEEKS.map((w) => (
                <tr key={w.id}>
                  <td className="py-2.5 pr-3 font-medium text-text-1">{w.label}</td>
                  {PREF_DAYS.map((d) => (
                    <td key={d.id} className="px-1 py-2.5 text-center">
                      <input type="checkbox" aria-label={`${w.label} ${d.label}`} disabled={locked}
                        checked={draft.unavailable_days[w.id].includes(d.id)} onChange={(e) => setDay(w.id, d.id, e.target.checked)}
                        className="h-4 w-4 accent-[var(--primary)]" data-day={`${w.id}-${d.id}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Unavailable locations"
        sub="Locations where this staff member cannot work. Builder asks for an override before assigning them there.">
        <div className="grid gap-3">
          {shown.length === 0 && draft.other_locations.length === 0 && (
            <p className="text-[12.5px] text-text-3">No house is on the registry just now.</p>
          )}
          {(shown.length > 0 || draft.other_locations.length > 0) && (
            <TileGrid cols={2}>
              {shown.map((h) => (
                <Tile key={h.code} data={`house-${h.code}`} label={h.name} disabled={locked}
                  checked={draft.unavailable_locations.includes(h.code)}
                  onChange={(on) => set({ unavailable_locations: toggled(draft.unavailable_locations, h.code, on) })} />
              ))}
              {draft.other_locations.map((x) => (
                <Tile key={`other-${x}`} data="other-location" label={x} disabled={locked} checked
                  onChange={(on) => { if (!on) set({ other_locations: draft.other_locations.filter((y) => y !== x) }) }} />
              ))}
            </TileGrid>
          )}
          {!locked && (
            <div className="flex flex-wrap items-center gap-2">
              <input value={another} maxLength={80} placeholder="Another location" aria-label="Another location"
                onChange={(e) => setAnother(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAnother() } }}
                className={cn(inputCls, 'min-w-0 flex-1')} data-another-location="" />
              <button type="button" onClick={addAnother} disabled={!canAdd} data-add-location=""
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-3">
                <Plus size={14} /> Add location
              </button>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Allergies">
        <div className="grid gap-3">
          <TileGrid>
            {PREF_ALLERGIES.map((a) => (
              <Tile key={a.id} data={`allergy-${a.id}`} label={a.label} disabled={locked} checked={draft.allergies.includes(a.id)}
                onChange={(on) => set({ allergies: toggled(draft.allergies, a.id, on), ...(a.id === 'other' && !on ? { allergy_other: '' } : {}) })} />
            ))}
          </TileGrid>
          {draft.allergies.includes('other') && (
            <input value={draft.allergy_other} maxLength={200} disabled={locked} placeholder="Other allergy"
              aria-label="Other allergy" onChange={(e) => set({ allergy_other: e.target.value })}
              className={cn(inputCls, 'sm:max-w-[420px]')} data-allergy-other="" />
          )}
        </div>
      </SectionCard>

      <SectionCard title="Note">
        <input value={draft.note} maxLength={500} disabled={locked} placeholder="Note" aria-label="Note"
          onChange={(e) => set({ note: e.target.value })} className={cn(inputCls, 'w-full')} data-pref-note="" />
      </SectionCard>

      {!locked && (
        <div className="flex flex-wrap items-center justify-end gap-2" data-pref-actions="">
          <button type="button" disabled={!dirty || saving} onClick={() => { setDraft(base.prefs); setAnother('') }} data-pref-cancel=""
            className="inline-flex h-9 items-center rounded-full border border-border bg-surface px-4 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-3">
            Cancel
          </button>
          <button type="button" disabled={!dirty || saving} onClick={() => { void save() }} data-pref-save=""
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-3">
            {saving && <Loader2 size={14} className="animate-spin" />} Save preferences
          </button>
        </div>
      )}
    </>
  )
}
