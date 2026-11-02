// Settings → Learning — the competencies, and the bar they are measured against.
// This is the section the Learning screen points at when it is empty, and the only place the list is written.
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Plus, X } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { gasAction } from '@/features/hiring/shared'
import { askConfirm } from '@/stores/useDialogStore'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import TestLane from './TestLane'

type Skill = { id: string; name: string; area: string; description: string; stage: string; attempts: number }
type State = { skills: Skill[]; rules: Record<string, number> }

const field = 'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
const label = 'mb-1 block text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3'

/** What each threshold governs, in the words somebody setting it needs. */
const RULE_LABEL: { key: string; label: string; hint: string }[] = [
  { key: 'practisingRun', label: 'Practising after', hint: 'correct answers in a row' },
  { key: 'stableRun', label: 'Stable after', hint: 'correct answers in a row' },
  { key: 'masteredRun', label: 'Mastered after', hint: 'in a row WITH NO HELP — this is the one that certifies' },
  { key: 'generalisedGapDays', label: 'Generalised after', hint: 'days away, then still correct' },
]

export default function LearningSection() {
  const [state, setState] = useState<State | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', area: '', description: '' })
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try { setState(await gasAction<State>('learnState', {})) } catch { setState({ skills: [], rules: {} }) }
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!draft.name.trim()) return
    setBusy('add')
    try {
      await gasAction('learnSkillSave', draft)
      setDraft({ name: '', area: '', description: '' })
      setAdding(false)
      await load()
      toast({ type: 'success', title: 'Competency added' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not added', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const retire = async (s: Skill) => {
    // RETIRED, NOT DELETED — the attempts point at it, and an attempt whose competency vanished is evidence of…
    if (!(await askConfirm({
      title: `Retire “${s.name}”?`,
      body: 'It stops appearing on people’s screens. Nothing already recorded is lost.',
      confirmLabel: 'Retire',
      tone: 'danger',
    }))) return
    setBusy(s.id)
    try {
      await gasAction('learnSkillSave', { id: s.id, name: s.name, area: s.area, description: s.description, active: false })
      await load()
    } finally { setBusy('') }
  }

  return (
    <motion.section id="learning" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]">
      <Card padded={false} className="p-6">
        <CardHeader title="Learning" sub="What this company expects people to be able to do." />

        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Competencies</p>
              <button type="button" onClick={() => setAdding((a) => !a)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
                {adding ? <X size={13} /> : <Plus size={13} />} {adding ? 'Cancel' : 'Add one'}
              </button>
            </div>
            <p className="mb-2.5 text-[11.5px] leading-4 text-text-3">
              Nothing is seeded here on purpose — what your people need to be able to do is your list, not an app’s
              guess. Retiring one keeps every attempt already recorded against it.
            </p>

            {adding && (
              <div className="mb-3 space-y-2.5 rounded-md border border-border bg-surface-2/50 p-3">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div><label className={label}>Name</label>
                    <input autoFocus value={draft.name} placeholder="Safe transfer technique"
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className={field} /></div>
                  <div><label className={label}>Area</label>
                    <input value={draft.area} placeholder="Direct care"
                      onChange={(e) => setDraft((d) => ({ ...d, area: e.target.value }))} className={field} /></div>
                </div>
                <div><label className={label}>What good looks like</label>
                  <input value={draft.description} placeholder="One line the person will read before recording an attempt"
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} className={field} /></div>
                <div className="flex justify-end">
                  <button onClick={() => void save()} disabled={!draft.name.trim() || busy === 'add'}
                    className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
                    {busy === 'add' && <Loader2 size={13} className="animate-spin" />} Add competency
                  </button>
                </div>
              </div>
            )}

            {!state ? (
              <p className="flex items-center gap-2 text-[12.5px] text-text-3"><Loader2 size={13} className="animate-spin" /> Loading…</p>
            ) : state.skills.length === 0 ? (
              <p className="rounded-md border border-dashed border-border-strong px-3 py-5 text-center text-[12.5px] text-text-3">
                None yet. Until one exists, the Learning screen has nothing to show anybody.
              </p>
            ) : (
              <div className="space-y-1.5">
                {state.skills.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-text-1">{s.name}</span>
                      <span className="block truncate text-[11.5px] text-text-3">
                        {s.area || 'General'}{s.attempts > 0 && ` · ${s.attempts} attempt${s.attempts === 1 ? '' : 's'} recorded`}
                      </span>
                    </span>
                    <button onClick={() => void retire(s)} disabled={busy === s.id}
                      className="shrink-0 text-[11.5px] text-text-3 underline transition-colors hover:text-danger disabled:opacity-40">
                      retire
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">The bar</p>
            <p className="mb-2.5 text-[11.5px] leading-4 text-text-3">
              Read-only here, and shown because a threshold nobody can see is one people argue with. These can be made
              <strong className="text-text-2"> stricter</strong> in code, never laxer — a training record that got easier
              to satisfy because somebody edited a cell means nothing on the day it is audited.
            </p>
            <dl className="space-y-1 text-[12.5px]">
              {RULE_LABEL.map(({ key, label: l, hint }) => (
                <div key={key} className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="text-text-2">{l}</dt>
                  <dd className="font-semibold tabular-nums text-text-1">{state?.rules?.[key] ?? '—'}</dd>
                  <dd className="text-[11.5px] text-text-3">{hint}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Sending</p>
            <TestLane app="Learning" sends="the reminder for competencies never attempted" />
          </div>
        </div>
      </Card>
    </motion.section>
  )
}
