// Settings → Asking rhythm (admins only, anchor #flowadmin).
// IT WAS THREE CARDS AND IS ONE.
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Repeat, RotateCcw, Save } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

const INPUT = 'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text-1 outline-none focus:border-primary'

// ------------------------------------------------------------------ CADENCES — the asking rhythm, and the drift it…

type Source = { from: 'step' | 'global' | 'shipped'; key: string; value: string }
type Cadence = {
  id: string; label: string; asks: string
  retry: 'pass' | 'own' | 'once'; retry_words: string; action: string
  attempts: number; minutes: number
  attempts_source: Source; minutes_source: Source
  attempts_key: string; minutes_key: string
  open: number; drifting: number
}
type CadenceAnswer = {
  rows: Cadence[]; book_readable: boolean
  global_attempts: number; global_minutes: number
  floor_minutes: number; cap_attempts: number
}

const SOURCE_WORD: Record<Source['from'], string> = {
  step: 'this step’s own cell',
  global: 'the global cell',
  /** Nobody typed it — it is what the platform ships for this step, and it
   *  wins over the global cell because that is the order the sender resolves
   *  in. Saying "the global cell" here sent somebody to change a number that
   *  governs nothing. */
  shipped: 'what the platform ships',
}

/** minutes → the way a person says it */
function saidAs(m: number): string {
  if (m % 10080 === 0) return `${m / 10080} week${m === 10080 ? '' : 's'}`
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'}`
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'}`
  return `${m} min`
}

export function FlowAdminCadences() {
  const [data, setData] = useState<CadenceAnswer | null>(null)
  const [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    void (async () => {
      try {
        const d = await api.list<Cadence>('hiringCadences') as unknown
        // The adapter answers an OBJECT, not a row list — api.list hands back whatever the resource returned, so…
        const answer = (Array.isArray(d) ? null : d) as CadenceAnswer | null
        if (answer && Array.isArray(answer.rows)) { setData(answer); setFailed(false) }
        else setFailed(true)
      } catch { setFailed(true) }
    })()
  }, [])
  useEffect(() => { load() }, [load])

  async function saveCell(key: string, value: string) {
    setBusy(key)
    try {
      await gasAction('hiringSimConfigSet', { values: { [key]: value } })
      setDraft((d) => { const n = { ...d }; delete n[key]; return n })
      load()
      toast({ type: 'success', title: 'Saved', body: 'It governs the NEXT ask — use Re-arm for the ones already running.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: String((e as Error)?.message ?? e) })
    } finally { setBusy('') }
  }

  async function rearm(step: string) {
    setBusy('rearm:' + step)
    try {
      const out = await gasAction('flowCadenceRearm', { step }) as { rearmed?: number } | null
      load()
      toast({ type: 'success', title: 'Re-armed',
              body: `${out?.rearmed ?? 0} ask(s) in flight now run on the current numbers.` })
    } catch (e) {
      toast({ type: 'danger', title: 'Not re-armed', body: String((e as Error)?.message ?? e) })
    } finally { setBusy('') }
  }

  return (
    <motion.div
      id="flowadmin"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
      className="scroll-mt-24"
    >
      <Card>
        <CardHeader
          title="Flow Admin — the asking rhythm"
          sub="How many times the platform asks, and how long it waits between."
          extra={<Repeat size={17} className="mt-0.5 shrink-0 text-text-3" />}
        />

        {/* THE THREE THINGS THIS SCREEN HAS TO ADMIT BEFORE IT OFFERS A KNOB. */}
        <div className="mb-3 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[12.5px] leading-[1.55] text-text-2">
          <p>
            <b>A change governs the next ask, not the ones already running.</b> The numbers are
            copied into each conversation when it starts, and every retry reads that copy — so a
            person asked yesterday keeps yesterday’s rhythm until you press <b>Re-arm</b>.
            The count beside each step says how many are in that position right now.
          </p>
          <p className="mt-1.5">
            An interval under {data?.floor_minutes ?? 5} minutes is <b>not</b> rounded up — the
            platform ignores it and falls back to the global {data?.global_minutes ?? 30}. This
            screen refuses to save one instead of letting the sheet and the behaviour disagree.
          </p>
        </div>

        {failed && (
          <p className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
            The rhythm could not be read. That is a read that failed, not a platform with no
            rhythm — nothing below is being shown because nothing below is known.
          </p>
        )}
        {!data && !failed && <p className="text-[12.5px] italic text-text-3">Reading the rhythm…</p>}

        {data && !data.book_readable && (
          <p className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
            The ask book could not be read, so “in flight” and “drifting” are unknown below rather
            than zero. The numbers themselves are still the truth.
          </p>
        )}

        <div className="space-y-2">
          {(data?.rows ?? []).map((c) => {
            const aKey = c.attempts_key, mKey = c.minutes_key
            const aVal = draft[aKey] ?? (c.attempts_source.from === 'step' ? c.attempts_source.value : '')
            const mVal = draft[mKey] ?? (c.minutes_source.from === 'step' ? c.minutes_source.value : '')
            const badMins = mVal.trim() !== '' && (Number(mVal) < (data?.floor_minutes ?? 5) || !Number.isFinite(Number(mVal)))
            return (
              <div key={c.id} className="rounded-md border border-border bg-surface p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[13px] font-semibold text-text-1">{c.label}</span>
                  <code className="font-mono text-[11px] text-text-3">{c.id}</code>
                  <span className="text-[11.5px] text-text-3">asks {c.asks}</span>
                  {c.retry === 'once' && (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10.5px] font-bold text-warning">
                      told once
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11.5px] leading-[1.5] text-text-3">{c.retry_words}</p>

                <div className="mt-2.5 grid gap-2 sm:grid-cols-[110px_130px_minmax(0,1fr)]">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold text-text-2">Times</span>
                    <input
                      value={aVal} inputMode="numeric" placeholder={String(c.attempts)}
                      onChange={(e) => setDraft((d) => ({ ...d, [aKey]: e.target.value }))}
                      className={INPUT}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold text-text-2">Wait (min)</span>
                    <input
                      value={mVal} inputMode="numeric" placeholder={String(c.minutes)}
                      onChange={(e) => setDraft((d) => ({ ...d, [mKey]: e.target.value }))}
                      className={cn(INPUT, badMins && 'border-danger')}
                    />
                  </label>
                  <div className="text-[11.5px] leading-[1.5] text-text-3">
                    {/* WHERE THE NUMBER IN FORCE COMES FROM. Blank is an answer
                        here too: it means this step follows the global cell. */}
                    <p>
                      In force: <b className="text-text-2">{c.attempts}×, every {saidAs(c.minutes)}</b>
                      {' '}— from {SOURCE_WORD[c.attempts_source.from]}
                      {c.attempts_source.from !== c.minutes_source.from
                        ? ` and ${SOURCE_WORD[c.minutes_source.from]}` : ''}.
                    </p>
                    <p className="mt-0.5">
                      Leave a box empty and this step follows the global{' '}
                      {data?.global_attempts}× / {saidAs(data?.global_minutes ?? 30)}.
                    </p>
                    {data?.book_readable && (
                      <p className="mt-0.5">
                        {c.open === 0
                          ? 'Nothing of this kind is in flight.'
                          : c.drifting === 0
                            ? `${c.open} in flight, all on these numbers.`
                            : `${c.open} in flight — ${c.drifting} still on older numbers.`}
                      </p>
                    )}
                  </div>
                </div>

                {badMins && (
                  <p className="mt-1.5 text-[11.5px] text-danger">
                    Under {data?.floor_minutes ?? 5} minutes the platform ignores this and waits
                    the global {data?.global_minutes ?? 30} instead. Use {data?.floor_minutes ?? 5} or more.
                  </p>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {(draft[aKey] !== undefined || draft[mKey] !== undefined) && (
                    <>
                      <button
                        disabled={badMins || busy === aKey || busy === mKey}
                        onClick={() => {
                          if (draft[aKey] !== undefined) void saveCell(aKey, draft[aKey])
                          if (draft[mKey] !== undefined) void saveCell(mKey, draft[mKey])
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-60"
                      >
                        <Save size={13} /> Save
                      </button>
                      <button
                        onClick={() => setDraft((d) => { const n = { ...d }; delete n[aKey]; delete n[mKey]; return n })}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
                      >
                        <RotateCcw size={13} /> Undo
                      </button>
                    </>
                  )}
                  {data?.book_readable && c.drifting > 0 && (
                    <button
                      disabled={busy === 'rearm:' + c.id}
                      onClick={() => void rearm(c.id)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-warning/50 bg-warning/10 px-3 py-1.5 text-[12.5px] font-semibold text-warning disabled:opacity-60"
                      title="Carry the current numbers onto the conversations already under way. It never lowers how many times somebody has already been asked."
                    >
                      <Repeat size={13} /> Re-arm {c.drifting} in flight
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </motion.div>
  )
}

