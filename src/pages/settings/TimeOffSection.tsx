/** Settings → Time Off: the director list, the old form's feed, the test rows and the book the relay writes. */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Plus, X } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { toast } from '@/stores/useToastStore'
import { ohioDateTime } from '@/lib/ohio'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { lane, post } from '@/pages/features/shifts/laneFetch'
import { DISCARD_TEST_PATH, SETTINGS_PATH, nextPress } from '@/pages/features/timeoff/timeOffModel'

type Resolved = {
  name: string; ok: boolean; why?: string; people_matches?: number; account_matches?: number
  people_name?: string; phone?: boolean; email?: boolean; account_role?: string
}

type State = {
  minted: boolean
  directors: string[]
  /** false when the house's Settings tab carries no directors row: the list did not land */
  directors_readable?: boolean
  /** false when the cell names nobody (or could not be read); there is no fallback list anywhere */
  directors_declared?: boolean
  directors_why?: string
  resolved: Resolved[]
  form_sync: string
  form_cutover_at: string
  form_watermark: string
  test_rows?: number
  test_mode?: boolean
  house: { id: string; mirrored_at: string; writable: boolean | null; writable_why: string; rows: number }
}

function resolvedLine(r: Resolved): string {
  if (r.why) return r.why
  if (!r.ok) {
    const n = (r.people_matches ?? 0) + (r.account_matches ?? 0)
    return n ? 'matches more than one person' : 'matches nobody'
  }
  const bits = [r.people_name ? `People: ${r.people_name}` : 'no People row',
                r.account_role ? `account: ${r.account_role}` : 'no account',
                r.phone ? 'a phone on file' : 'no phone', r.email ? 'an e-mail on file' : 'no e-mail']
  return bits.join(' · ')
}

// What the directors list means for time off and swaps right now, or '' while it names somebody.
export function directorsNotice(s: Pick<State, 'directors' | 'directors_readable' | 'directors_why'>): string {
  if (s.directors_readable === false) {
    return `The directors list of the Time Off house could not be read — ${s.directors_why || 'no reason was given'}. ` +
      'No time off request is filed or decided, and no swap can be opened, until it can be; saving a list here writes it again.'
  }
  if (s.directors.length) return ''
  return 'The directors cell of the Time Off house names nobody. Requests and swaps are still opened and their house ' +
    'manager still answers, but the director half of every request, and the director\'s approval of every swap, ' +
    'waits until a name is saved here.'
}

export default function TimeOffSection() {
  const [s, setS] = useState<State | null>(null)
  const [failed, setFailed] = useState('')
  const [draft, setDraft] = useState<string[]>([])
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const got = await lane<State>(SETTINGS_PATH)
      setS(got)
      setDraft(got.directors)
      setFailed('')
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The server did not answer.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async (body: { directors?: string[]; form_sync?: string }) => {
    setBusy(true)
    try {
      const got = await post<State>(SETTINGS_PATH, body)
      setS(got)
      setDraft(got.directors)
      toast({ type: 'success', title: 'Saved', body: 'The Time Off settings are saved.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy(false) }
  }

  const [armed, setArmed] = useState('')
  const discard = async () => {
    const step = nextPress(armed, 'discard')
    setArmed(step.armed)
    if (!step.act) return
    setBusy(true)
    try {
      const got = await post<{ discarded: string[]; failed: { ref: string; why: string }[] }>(DISCARD_TEST_PATH,
        { note: 'filed in test mode, discarded at go-live' })
      toast({ type: got.failed.length ? 'warning' : 'success',
              title: `${got.discarded.length} test request${got.discarded.length === 1 ? '' : 's'} discarded`,
              body: got.failed.length ? `Not discarded: ${got.failed.map((f) => `${f.ref} (${f.why})`).join('; ')}` : 'They no longer hold anybody off.' })
      await load()
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing was discarded', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy(false) }
  }

  const changed = s ? draft.join('|') !== s.directors.join('|') : false

  return (
    <motion.section id="timeoff" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]">
      <Card padded={false} className="p-6">
        <CardHeader title="Time Off" sub="Who approves the director half, the old form's feed, and the house." />
        {failed && <p className="mt-3 rounded-lg border-2 border-danger bg-danger/[0.05] px-3 py-2 text-[12.5px] text-text-1">
          The settings could not be read — {failed}</p>}
        {!s && !failed && <p className="mt-3 flex items-center gap-2 text-[12.5px] text-text-3"><Loader2 size={13} className="animate-spin" /> Reading…</p>}
        {s && !s.minted && (
          <p className="mt-3 rounded-lg border-2 border-[#8b0000] bg-[#8b0000]/5 px-3 py-2 text-[12.5px] text-text-1">
            Time off is not set up on this server yet (its book has not been created) — nothing can be filed,
            decided or enforced until it is.
          </p>
        )}
        {s && s.minted && (
          <div className="mt-4 grid gap-5">
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Directors</p>
              {directorsNotice(s) && (
                <p role="alert" className={`mb-2 rounded-lg border-2 px-3 py-2 text-[12.5px] leading-[18px] text-text-1 ${
                  s.directors_readable === false ? 'border-danger bg-danger/[0.05]' : 'border-amber-500 bg-amber-500/[0.06]'}`}>
                  {directorsNotice(s)}
                </p>
              )}
              <ul className="grid gap-1.5">
                {draft.map((name) => {
                  const r = s.resolved.find((x) => x.name === name)
                  return (
                    <li key={name} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                      <span className="text-[13px] font-semibold text-text-1">{name}</span>
                      <span className={`text-[12px] ${r && !r.ok ? 'font-semibold text-danger' : 'text-text-3'}`}>
                        {r ? resolvedLine(r) : 'checked when saved'}
                      </span>
                      <button type="button" onClick={() => setDraft((d) => d.filter((n) => n !== name))}
                        aria-label={`Remove ${name}`} className="ml-auto rounded-md p-1 text-text-3 hover:bg-surface-2 hover:text-text-1">
                        <X size={14} />
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a director by name"
                  className="h-9 w-full max-w-[280px] rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary" />
                <button type="button" disabled={!adding.trim()}
                  onClick={() => { setDraft((d) => [...new Set([...d, adding.trim()])]); setAdding('') }}
                  className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
                  <Plus size={13} /> Add
                </button>
                <button type="button" disabled={!changed || busy || !draft.length}
                  onClick={() => void save({ directors: draft })}
                  className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-4 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-40">
                  {busy && <Loader2 size={13} className="animate-spin" />} Save directors
                </button>
              </div>
              {!draft.length && <p className="mt-1 text-[12px] font-semibold text-danger">The list cannot be empty — a request would have no director to ask.</p>}
            </div>
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Google Form rows</p>
              <label className="flex items-center gap-2 text-[13px] text-text-1">
                <input type="checkbox" checked={s.form_sync === 'on'} disabled={busy}
                  onChange={(e) => void save({ form_sync: e.target.checked ? 'on' : 'off' })} />
                New rows of the old time-off form are added as requests
              </label>
              <p className="mt-1 text-[12px] text-text-3">
                {s.form_cutover_at ? `Cutover ${ohioDateTime(s.form_cutover_at) || s.form_cutover_at}` : 'No cutover yet — set by the migration'}
                {s.form_watermark ? ` · last form row added ${ohioDateTime(s.form_watermark) || s.form_watermark}` : ''}
              </p>
            </div>
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Requests filed in test mode</p>
              <p className="text-[12.5px] text-text-2">
                {s.test_rows
                  ? `${s.test_rows} open request${s.test_rows === 1 ? ' was' : 's were'} filed in test mode. They hold people off like any other — discard them at go-live.`
                  : 'No open request was filed in test mode.'}
              </p>
              {(s.test_rows ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" disabled={busy} onClick={() => void discard()}
                    className={`inline-flex h-9 items-center gap-1 rounded-md px-4 text-[12.5px] font-semibold disabled:opacity-40 ${armed === 'discard' ? 'bg-danger text-white' : 'border border-border bg-surface text-text-2 hover:bg-surface-2'}`}>
                    {armed === 'discard' ? 'Discard them — press again' : 'Discard test rows'}
                  </button>
                  {armed && <button type="button" onClick={() => setArmed('')} className="text-[12px] text-text-3 hover:text-text-1">Not yet</button>}
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">The book</p>
              <p className="text-[12.5px] text-text-2">
                <span className="font-mono">{s.house.id}</span> · {s.house.rows} rows · copied{' '}
                {s.house.mirrored_at ? ohioDateTime(s.house.mirrored_at) : 'not yet'} · last write{' '}
                <span className={s.house.writable === false ? 'font-semibold text-danger' : ''}>
                  {s.house.writable === null ? 'none since the relay started' : s.house.writable ? 'saved' : `refused (${s.house.writable_why})`}
                </span>
              </p>
            </div>
          </div>
        )}
      </Card>
    </motion.section>
  )
}
