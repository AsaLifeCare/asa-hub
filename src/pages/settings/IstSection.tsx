// Settings → IST — the house ⇄ client map, and the two silences.
// The map lives in settings, with a fallback for the case where a house is deactivated before anybody here knows…
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Pencil, Plus, Power, PowerOff, RefreshCw, Trash2, TriangleAlert, X } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { askConfirm } from '@/stores/useDialogStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { IST_CONFIG_FOLLOW, IST_CONFIG_SHIPPED, saveIstConfig } from '@/lib/istConfig'
import IstSettingsEditor, { keepDrafts, storedOf, type CfgAnswer, type CfgRow } from './IstSettingsEditor'
import TestLane from './TestLane'

type MapRow = { id: string; house: string; houseName: string; clientName: string; active: string; source: string }
type Situation = { id: string; enabled: string; to: string; channels: string; label: string }
type HouseRef = { house: string; houseName: string }
type State = {
  rows: MapRow[]
  rosterHouses: HouseRef[]
  rosterUnreadable: boolean
  housesWithoutClients: HouseRef[]
  clientsWithoutHouse: string[]
}

const field =
  'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
const label = 'mb-1 block text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3'

export default function IstSection() {
  const [state, setState] = useState<State | null>(null)
  const [failed, setFailed] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ house: '', houseName: '', clientName: '' })
  const [sit, setSit] = useState<Situation | null>(null)
  const [sitDraft, setSitDraft] = useState({ to: '', channels: '', enabled: 'no' })
  const [editing, setEditing] = useState('')
  const [edit, setEdit] = useState({ house: '', houseName: '' })
  const [busy, setBusy] = useState('')
  const [cfg, setCfg] = useState<CfgAnswer | null>(null)
  const [cfgFailed, setCfgFailed] = useState('')
  const [cfgDraft, setCfgDraft] = useState<Record<string, string>>({})
  /** The rows the drafts were last filled from — an edit is a draft that differs from them. */
  const cfgRowsRef = useRef<CfgRow[] | undefined>(undefined)

  /** The word the next rebuild marks a row with — the cell as saved, never a copy from memory. */
  const staleMark = cfg?.rows?.find((r) => r.key === 'ist_stale_marker')?.value
    || IST_CONFIG_SHIPPED.ist_stale_marker

  const load = useCallback(async (refresh: string[] = []) => {
    try {
      setState(await gasAction<State>('istHouseState', {}))
      setFailed('')
      // THE LANE'S OWN SETTINGS, read beside the map they govern.
      try {
        const answer = await gasAction<CfgAnswer>('istConfigGet', {})
        setCfg(answer)
        setCfgFailed('')
        // an unsaved edit on another key survives the re-read; the key just saved takes the tab's value
        const prev = cfgRowsRef.current
        cfgRowsRef.current = answer.rows ?? []
        setCfgDraft((d) => keepDrafts(prev, answer.rows ?? [], d, refresh))
      } catch (e) {
        setCfg(null)
        setCfgFailed(e instanceof Error ? e.message : 'The backend did not answer.')
      }
      // THE SAME ROW SMART COMMS SWEEPS — read here, written here, stored there.
      try {
        const sc = await gasAction<{ situations: Situation[] }>('smartCommsGet', {})
        const row = (sc.situations ?? []).find((s) => s.id === 'ist_due') ?? null
        setSit(row)
        if (row) setSitDraft({ to: row.to ?? '', channels: row.channels ?? '', enabled: row.enabled ?? 'no' })
      } catch { setSit(null) }
    } catch (e) {
      // THE SERVER'S OWN SENTENCE, not a shrug.
      setFailed(e instanceof Error ? e.message : 'The backend did not answer.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const add = async () => {
    if (!draft.house.trim() || !draft.clientName.trim()) return
    setBusy('add')
    try {
      // THROUGH THE RESOLVER, not the generic CRUD.
      await gasAction('istHouseSet', {
        house: draft.house.trim(),
        houseName: draft.houseName.trim(),
        clientName: draft.clientName.trim(),
      })
      setDraft({ house: '', houseName: '', clientName: '' })
      setAdding(false)
      await load()
      toast({ type: 'success', title: 'Added', body: 'Counted on the next rebuild.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not added', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const saveEdit = async (r: MapRow) => {
    setBusy(r.id)
    try {
      await gasAction('istHouseSet', { id: r.id, house: edit.house.trim(), houseName: edit.houseName.trim() })
      setEditing('')
      await load()
      toast({ type: 'success', title: 'Saved', body: 'Counted on the next rebuild.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const remove = async (r: MapRow) => {
    if (!(await askConfirm({
      title: `Remove ${r.clientName} from ${r.houseName || r.house}?`,
      body: `The IST rows behind this pair are KEPT and marked "${staleMark}" on the next `
        + 'rebuild — nothing already chased is lost.',
      confirmLabel: 'Remove',
      tone: 'danger',
    }))) return
    setBusy(r.id)
    try {
      await gasAction('istHouseSet', { id: r.id, remove: true })
      await load()
      toast({ type: 'success', title: 'Removed' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not removed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const saveSituation = async (patch: Partial<{ to: string; channels: string; enabled: string }>) => {
    if (!sit) return
    const next = { ...sitDraft, ...patch }
    setBusy('sit')
    try {
      // WRITTEN INTO THE SMART COMMS ROW, not into a second store of our own.
      await gasAction('smartCommsSet', { rows: [{ id: 'ist_due', ...next }] })
      setSitDraft(next)
      setSit({ ...sit, ...next })
      toast({
        type: 'success', title: 'Saved',
        body: next.enabled === 'yes'
          ? 'Live on the next sweep — test mode still decides whether it reaches a real person.'
          : 'Switched off. Nothing will be sent.',
      })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const rebuild = async () => {
    setBusy('rebuild')
    try {
      const out = await gasAction<{
        added: number; kept: number; rowsWhoseHouseLeftTheMap: string[]; configSource?: string
      }>('istRebuild', {})
      // WHICH SETTINGS IT OBEYED, said only when they were not the tab's — a run against the shipped floor is one…
      const blind = out.configSource && out.configSource !== 'sheet'
        ? ` It ran against the ${out.configSource} settings: the ${cfg?.tab ?? 'ist_config'} tab did not answer.`
        : ''
      toast({
        type: blind ? 'info' : 'success', title: `${out.added} new, ${out.kept} kept`,
        body: (out.rowsWhoseHouseLeftTheMap?.length
          ? `${out.rowsWhoseHouseLeftTheMap.length} row(s) whose house left the map were marked, not deleted.`
          : 'Open IST Records to see the table. Nothing was sent.') + blind,
      })
    } catch (e) {
      toast({ type: 'danger', title: 'Not rebuilt', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  // SAVE ONE CELL.
  const saveCfg = async (key: string) => {
    if (cfg?.blind) return
    setBusy('cfg:' + key)
    try {
      await saveIstConfig({ [key]: cfgDraft[key] ?? '' }, storedOf(cfg))
      await load([key])
      toast({ type: 'success', title: 'Saved', body: IST_CONFIG_FOLLOW })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const toggle = async (r: MapRow) => {
    const off = String(r.active).toLowerCase() !== 'no'
    setBusy(r.id)
    try {
      await gasAction('istHouseSet', { id: r.id, active: off ? 'no' : 'yes' })
      await load()
      // said every time, with the mark the cell holds now
      if (off) {
        toast({
          type: 'info', title: 'Switched off',
          body: `The IST rows for this pair are KEPT and marked "${staleMark}" on the next rebuild — nothing already chased is lost.`,
        })
      }
    } finally { setBusy('') }
  }

  return (
    <motion.section id="ist" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]">
      <Card padded={false} className="p-6">
        <CardHeader title="IST" sub="Which client lives in which house — the link the training table is built on." />

        {failed ? (
          <div className="rounded-md border border-tint-amber bg-tint-amber px-3 py-2.5 text-[12px] leading-5 text-tint-fg-amber">
            <p className="flex items-center gap-1.5 font-semibold">
              <TriangleAlert size={13} />
              {/^unknown action/i.test(failed) ? 'The backend does not have IST yet' : 'Could not read the map'}
            </p>
            <p className="mt-0.5">{failed}</p>
            <p className="mt-1">
              {/^unknown action/i.test(failed)
                ? 'Nothing is broken and nothing is missing — the platform release that carries this is not live yet. This section fills itself the moment it lands.'
                : 'Do not assume the map is empty — a failed read and an empty tab look the same from here, and only one of them is safe to act on.'}
            </p>
            <button type="button" onClick={() => void load()}
              className="mt-2 h-7 rounded-md border border-tint-fg-amber/30 px-2.5 text-[12px] font-semibold transition-opacity hover:opacity-70">
              Try again
            </button>
          </div>
        ) : !state ? (
          <p className="flex items-center gap-2 text-[12.5px] text-text-3"><Loader2 size={13} className="animate-spin" /> Loading…</p>
        ) : (
          <div className="space-y-5">
            {/* THE TWO SILENCES, FIRST — before the rows, because they are the
                part nobody would think to look for. */}
            {(state.housesWithoutClients.length > 0 || state.clientsWithoutHouse.length > 0 || state.rosterUnreadable) && (
              <div className="rounded-md border border-tint-amber bg-tint-amber px-3 py-2.5 text-[12px] leading-5 text-tint-fg-amber">
                <p className="mb-1 flex items-center gap-1.5 font-semibold">
                  <TriangleAlert size={13} /> The map is incomplete, and that is invisible downstream
                </p>
                {state.rosterUnreadable && (
                  <p className="mb-1">The roster could not be read, so the houses below may not be the ones actually in use.</p>
                )}
                {state.housesWithoutClients.length > 0 && (
                  <p>
                    <strong>{state.housesWithoutClients.length} house(s) on the roster have no client mapped</strong> —{' '}
                    {state.housesWithoutClients.map((h) => `${h.houseName || h.house}`).join(', ')}. Nobody working there
                    will ever be asked for an IST.
                  </p>
                )}
                {state.clientsWithoutHouse.length > 0 && (
                  <p>
                    <strong>{state.clientsWithoutHouse.length} client(s) have no house</strong> —{' '}
                    {/* the joined string became one wrapper per client so each
                        name can be picked up; the line reads the same */}
                    {state.clientsWithoutHouse.slice(0, 8).map((c, i) => (
                      <Fragment key={`${c}-${i}`}>
                        {i > 0 && ', '}
                        <DragPerson name={c} type="client">{c}</DragPerson>
                      </Fragment>
                    ))}
                    {state.clientsWithoutHouse.length > 8 ? ` and ${state.clientsWithoutHouse.length - 8} more` : ''}.
                  </p>
                )}
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">
                  House → client · {state.rows.length} row(s)
                </p>
                <div className="flex items-center gap-2">
                  {/* THE REBUILD LIVES HERE, WHERE THE MAP IS. It used to be a
                      ROW action on the IST table — which meant that with an
                      empty table there was no button anywhere, and the one
                      thing that would have filled it was unreachable. */}
                  <button type="button" onClick={() => void rebuild()} disabled={busy === 'rebuild' || state.rows.length === 0}
                    title={state.rows.length === 0 ? 'Add at least one pair first' : 'Recompute who owes an IST — sends nothing'}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40">
                    {busy === 'rebuild' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    Rebuild the table
                  </button>
                  <button type="button" onClick={() => setAdding((a) => !a)}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
                    {adding ? <X size={13} /> : <Plus size={13} />} {adding ? 'Cancel' : 'Add a pair'}
                  </button>
                </div>
              </div>

              {adding && (
                <div className="mb-3 space-y-2.5 rounded-md border border-border bg-surface-2/50 p-3">
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    <div><label className={label}>House code</label>
                      <input autoFocus value={draft.house} placeholder="ABD1547" className={field}
                        onChange={(e) => setDraft((d) => ({ ...d, house: e.target.value }))} /></div>
                    <div><label className={label}>House name</label>
                      <input value={draft.houseName} placeholder="48TH (A)" className={field}
                        onChange={(e) => setDraft((d) => ({ ...d, houseName: e.target.value }))} /></div>
                    <div><label className={label}>Client</label>
                      <input value={draft.clientName} placeholder="The client's name" className={field}
                        onChange={(e) => setDraft((d) => ({ ...d, clientName: e.target.value }))} /></div>
                  </div>
                  <p className="text-[11.5px] leading-4 text-text-3">
                    The client’s name has to be the one the platform knows them by — a name nothing answers to is
                    reported on the next rebuild rather than becoming a row against a person who does not exist.
                  </p>
                  <div className="flex justify-end">
                    <button onClick={() => void add()} disabled={!draft.house.trim() || !draft.clientName.trim() || busy === 'add'}
                      className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
                      {busy === 'add' && <Loader2 size={13} className="animate-spin" />} Add pair
                    </button>
                  </div>
                </div>
              )}

              {state.rows.length === 0 ? (
                <p className="rounded-md border border-dashed border-border-strong px-3 py-5 text-center text-[12.5px] text-text-3">
                  Empty. Until a pair exists, “Rebuild the table” refuses — building the table without this map
                  would say nobody owes an IST.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {state.rows.map((r) => {
                    const off = String(r.active).toLowerCase() === 'no'
                    if (editing === r.id) {
                      return (
                        <div key={r.id} className="rounded-md border border-primary bg-surface-2/50 p-3">
                          {/* r.id is the MAP row, not the client — the name is
                              the identity the tracker matches on. */}
                          <DragPerson name={r.clientName} type="client" subtitle={r.houseName || r.house} className="mb-2 flex items-center gap-3">
                            <Avatar name={r.clientName} size="sm" />
                            <span className="text-[13px] font-medium text-text-1">{r.clientName}</span>
                          </DragPerson>
                          <div className="grid gap-2.5 sm:grid-cols-2">
                            <div><label className={label}>House code</label>
                              <input autoFocus value={edit.house} className={field}
                                onChange={(e) => setEdit((d) => ({ ...d, house: e.target.value }))} /></div>
                            <div><label className={label}>House name</label>
                              <input value={edit.houseName} className={field}
                                onChange={(e) => setEdit((d) => ({ ...d, houseName: e.target.value }))} /></div>
                          </div>
                          <p className="mt-2 text-[11.5px] leading-4 text-text-3">
                            The client is not editable here — a different client is a different pair. Remove this one
                            and add that one.
                          </p>
                          <div className="mt-2 flex justify-end gap-2">
                            <button onClick={() => setEditing('')}
                              className="h-8 rounded-md border border-border px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2">
                              Cancel
                            </button>
                            <button onClick={() => void saveEdit(r)} disabled={busy === r.id || !edit.house.trim()}
                              className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
                              {busy === r.id && <Loader2 size={12} className="animate-spin" />} Save
                            </button>
                          </div>
                        </div>
                      )
                    }
                    return (
                      <div key={r.id}
                        className={`group flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 ${off ? 'opacity-50' : ''}`}>
                        {/* a person is never a bare string on this platform —
                            and never a face you cannot pick up either */}
                        <DragPerson name={r.clientName} type="client" subtitle={r.houseName || r.house} className="flex min-w-0 flex-1 items-center gap-3">
                          <Avatar name={r.clientName} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-text-1">{r.clientName}</span>
                            <span className="block truncate text-[11.5px] text-text-3">
                              {r.houseName || r.house} · {r.house}{off ? ' · switched off' : ''}
                            </span>
                          </span>
                        </DragPerson>
                        <div className="flex shrink-0 items-center gap-1">
                          <button onClick={() => { setEditing(r.id); setEdit({ house: r.house, houseName: r.houseName }) }}
                            title="Edit the house" disabled={busy === r.id}
                            className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => void toggle(r)} disabled={busy === r.id}
                            title={off ? 'Count it again' : 'Stop counting it, keep the history'}
                            className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
                            {off ? <Power size={13} /> : <PowerOff size={13} />}
                          </button>
                          <button onClick={() => void remove(r)} disabled={busy === r.id}
                            title="Remove this pair" className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-40">
                            {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ─────────── THE NOTICE, CONFIGURED WHERE THE APP IS ───────────
                IST's test mode belongs in the IST section with IST's own
                numbers, and passes from there into Smart Comms.
                Three screens for one app was the disorganisation.

                What is edited here is the `ist_due` ROW ITSELF — read with
                smartCommsGet, written with smartCommsSet. Smart Comms stays
                the single store; this is its editing surface for the app it
                belongs to. A copy kept here would be a second truth, and the
                two would disagree the first week somebody edited the other. */}
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">
                The IST notice
              </p>
              {!sit ? (
                <p className="rounded-md border border-dashed border-border-strong px-3 py-4 text-center text-[12.5px] text-text-3">
                  The <code>ist_due</code> situation is not in the Smart Comms tab yet — it is seeded on the
                  first read after publishing.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={busy === 'sit'}
                      onClick={() => void saveSituation({ enabled: sitDraft.enabled === 'yes' ? 'no' : 'yes' })}
                      className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-40 ${
                        sitDraft.enabled === 'yes'
                          ? 'bg-tint-mint text-tint-fg-mint hover:opacity-80'
                          : 'border border-border bg-surface text-text-2 hover:bg-surface-2'}`}>
                      {busy === 'sit' ? <Loader2 size={12} className="animate-spin" />
                        : sitDraft.enabled === 'yes' ? <Power size={12} /> : <PowerOff size={12} />}
                      {sitDraft.enabled === 'yes' ? 'Sending is ON' : 'Sending is OFF'}
                    </button>
                    <span className="text-[11.5px] text-text-3">
                      Goes to the employee who owes the training, by {sitDraft.channels || 'sms, email'}.
                    </span>
                  </div>

                  <div>
                    <label className={label}>Who else gets a copy</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={sitDraft.to}
                        placeholder="team"
                        onChange={(e) => setSitDraft((d) => ({ ...d, to: e.target.value }))}
                        className={field + ' max-w-[420px]'}
                      />
                      <button type="button" disabled={busy === 'sit' || sitDraft.to === (sit.to ?? '')}
                        onClick={() => void saveSituation({ to: sitDraft.to })}
                        className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
                        {busy === 'sit' && <Loader2 size={12} className="animate-spin" />} Save
                      </button>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-4 text-text-3">
                      Numbers and e-mails, comma separated — or the word <strong className="text-text-2">team</strong>,
                      which means the named responsible people and widens when that list does. This is the same cell
                      Smart Comms reads; editing it here and editing it there are the same edit.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* ─────────── THE LANE'S SETTINGS, IN A TAB ───────────
                Every key of server/ist_config_defaults.json, drawn by its
                declared type and checked as it is typed; no publish. */}
            <div className="border-t border-border pt-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">
                  IST settings
                </p>
                {cfg && (
                  <span className="text-[11.5px] text-text-3">
                    {cfg.source === 'sheet'
                      ? `read from the ${cfg.tab} tab`
                      : `the ${cfg.tab} tab did not answer — showing the ${cfg.source} values`}
                  </span>
                )}
              </div>

              {cfgFailed ? (
                <div className="rounded-md border border-tint-amber bg-tint-amber px-3 py-2.5 text-[12px] leading-5 text-tint-fg-amber">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <TriangleAlert size={13} />
                    {/^unknown action/i.test(cfgFailed)
                      ? 'The backend does not have the IST settings yet'
                      : 'Could not read the IST settings'}
                  </p>
                  <p className="mt-0.5">{cfgFailed}</p>
                  <p className="mt-1">
                    The screens are drawing the values they ship with, which are the ones the platform
                    has always used. Nothing about who owes a training changed.
                  </p>
                </div>
              ) : !cfg ? (
                <p className="flex items-center gap-2 text-[12.5px] text-text-3">
                  <Loader2 size={13} className="animate-spin" /> Loading…
                </p>
              ) : (
                <div className="space-y-4">
                  {cfg.blind && (
                    <div className="rounded-md border border-tint-amber bg-tint-amber px-3 py-2.5 text-[12px] leading-5 text-tint-fg-amber">
                      <p className="flex items-center gap-1.5 font-semibold">
                        <TriangleAlert size={13} /> These are not the values in the tab
                      </p>
                      <p className="mt-0.5">{cfg.blind_reason}</p>
                      <p className="mt-0.5">
                        Saving is off until the tab answers: a save into a tab nothing has read would
                        be a change nobody can check. Fix the tab first, then reload this screen.
                      </p>
                    </div>
                  )}

                  {cfg.unknown_rows?.length > 0 && (
                    <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2.5 text-[11.5px] leading-5 text-text-3">
                      <strong className="text-text-2">
                        {cfg.unknown_rows.length} row(s) in the tab that this version does not read
                      </strong>{' '}
                      — {cfg.unknown_rows.map((r) => r.key).join(', ')}. Editing one of them changes
                      nothing. Either the platform is older than the tab, or they are left over.
                    </div>
                  )}

                  <IstSettingsEditor answer={cfg} draft={cfgDraft} busy={busy}
                    onChange={(key, value) => setCfgDraft((d) => ({ ...d, [key]: value }))}
                    onSave={(key) => void saveCfg(key)} />
                </div>
              )}
            </div>

            <div className="border-t border-border pt-4">
              <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">
                Where it lands right now
              </p>
              <TestLane app="IST Records" sends="the notice to an employee who still owes a client training" />
            </div>

            <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2.5 text-[11.5px] leading-5 text-text-3">
              <p className="mb-1 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">When a house closes</p>
              <p>
                Switching a pair off — or a house leaving the roster — never deletes the IST rows behind it. The next
                rebuild marks them <strong className="text-text-2">“{staleMark}”</strong> (ist_stale_marker) and names
                them in its answer. A training somebody was already chasing does not disappear because a lookup changed.
              </p>
            </div>
          </div>
        )}
      </Card>
    </motion.section>
  )
}
