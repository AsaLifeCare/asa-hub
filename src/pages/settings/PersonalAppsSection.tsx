// Settings → Smart Shopper and Settings → Wellbeing.
// TWO SECTIONS, EACH APPEARING ONLY WHILE ITS APP IS INSTALLED — the platform's rule, restated when these were…
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import TestLane from './TestLane'

const chip = 'inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[12.5px] text-text-2'
const addInput =
  'h-7 w-28 rounded-full border border-dashed border-border-strong bg-transparent px-2.5 text-[12.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary'

// Shared list editor — the same shape the ledger's vocabulary uses, so the two screens teach the same gesture.
function ListEditor({
  label, hint, values, onChange,
}: { label: string; hint: string; values: string[]; onChange: (v: string[]) => void }) {
  const [adding, setAdding] = useState('')
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{label}</p>
      <p className="mb-2 text-[11.5px] leading-4 text-text-3">{hint}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <span key={v} className={chip}>
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove ${v}`} className="text-text-3 transition-colors hover:text-danger">×</button>
          </span>
        ))}
        <input
          value={adding} placeholder="add…"
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const v = adding.trim()
            if (v && !values.includes(v)) onChange([...values, v])
            setAdding('')
          }}
          className={addInput}
        />
      </div>
    </div>
  )
}

/* ─────────────────────────── Smart Shopper ─────────────────────────── */

export function ShopperSettingsSection() {
  const [categories, setCategories] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    gasAction<{ categories: string[] }>('shopList', {})
      .then((r) => alive && setCategories(r.categories))
      .catch(() => alive && setCategories([]))
    return () => { alive = false }
  }, [])

  const save = async () => {
    if (!categories) return
    setSaving(true)
    try {
      const out = await gasAction<{ categories: string[] }>('shopSettingsSet', { categories })
      setCategories(out.categories)
      toast({ type: 'success', title: 'Saved', body: 'In force on the next item — no deploy needed.' })
    } catch (e) {
      // The server refuses a removal that would orphan somebody's item, and that sentence is the useful one.
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setSaving(false) }
  }

  return (
    <motion.section id="shopper" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]">
      <Card padded={false} className="p-6">
        <CardHeader title="Smart Shopper" sub="How lists are sorted, and what the prices really are." />
        {!categories ? (
          <p className="flex items-center gap-2 text-[12.5px] text-text-3"><Loader2 size={13} className="animate-spin" /> Loading…</p>
        ) : (
          <div className="space-y-5">
            <ListEditor
              label="Categories" values={categories} onChange={setCategories}
              hint="Add what people actually sort by. The shipped ones cannot be removed, and a category with items filed under it cannot be removed at all."
            />
            <div className="flex justify-end border-t border-border pt-4">
              <button type="button" onClick={() => void save()} disabled={saving}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
                {saving && <Loader2 size={13} className="animate-spin" />} Save categories
              </button>
            </div>

            <div className="border-t border-border pt-4">
              <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Sending</p>
              <TestLane app="Smart Shopper" sends="the nudge when something drops under your target" />
            </div>

            {/* Said here as well as on the screen. Somebody configuring this app
                should know what its numbers are before anybody trusts one. */}
            <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2.5 text-[11.5px] leading-5 text-text-3">
              <p className="mb-1 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">About the prices</p>
              <p>
                “What does it cost?” does <strong className="text-text-2">not</strong> search any shop. It asks the
                platform’s model providers (Groq first) for typical price points from general knowledge, and stores
                them as <strong className="text-text-2">estimates</strong> with the model’s name attached. No links are
                kept, and an item under its target is called “worth checking” rather than an offer.
                The REAL numbers on the screen come from two other places, in different fields by law: what a person
                typed when they pressed “Bought it” (paid price and store), and — for managers — the company’s own
                priced invoices from the procurement catalog. An estimate and a receipt never share a column.
              </p>
            </div>
          </div>
        )}
      </Card>
    </motion.section>
  )
}

/* ─────────────────────────── Wellbeing ─────────────────────────── */

export function WellbeingSettingsSection() {
  return (
    <motion.section id="wellbeing" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]">
      <Card padded={false} className="p-6">
        <CardHeader title="Wellbeing" sub="The personal health apps, and what they do with what you enter." />
        <div className="space-y-4">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Meal Tracker</p>
            <p className="mt-1 text-[11.5px] leading-5 text-text-3">
              There is nothing to configure centrally, and that is the design: the goals are
              <strong className="text-text-2"> each person’s own</strong>, set on their own screen, and no
              administrator sets a calorie target for somebody else.
            </p>
          </div>
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Sending</p>
            <TestLane app="the wellbeing apps" sends="nothing today — neither has a situation registered yet" />
          </div>

          <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2.5 text-[11.5px] leading-5 text-text-3">
            <p className="mb-1 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Who can read it</p>
            <p>
              Nobody but the person who wrote it — <strong className="text-text-2">including admins</strong>. The rows
              are held per person on the server and are deliberately kept off the snapshot path, so no shared file of
              anyone’s food diary is ever built. There is no report, no export and no roll-up, and adding one would be
              a decision, not a feature.
            </p>
          </div>
        </div>
      </Card>
    </motion.section>
  )
}
