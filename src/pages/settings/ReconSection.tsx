// Settings → Time Reconciliation — the thresholds, on a screen.
// The configuration has to be loadable here, without anybody opening a spreadsheet.
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, TriangleAlert } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'

type ReconCfg = {
  gapMin: number; overlapMin: number; missingCoveragePct: number; smartRunDays: number
  auto: string
  source: { mode: string; spreadsheetId: string; punchesTab: string; staffMapTab: string; clientMapTab: string }
  meanings: Record<string, string>
}

const NUMS: { key: keyof Pick<ReconCfg, 'gapMin' | 'overlapMin' | 'missingCoveragePct' | 'smartRunDays'>; label: string; suffix: string }[] = [
  { key: 'gapMin', label: 'Coverage gap after', suffix: 'min' },
  { key: 'overlapMin', label: 'Double coverage after', suffix: 'min' },
  { key: 'missingCoveragePct', label: 'Missing coverage under', suffix: '%' },
  { key: 'smartRunDays', label: 'Report runs from the last', suffix: 'days' },
]

const field =
  'h-9 w-24 rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors focus:border-primary'

export default function ReconSection() {
  const [cfg, setCfg] = useState<ReconCfg | null>(null)
  const [failed, setFailed] = useState('')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const c = await gasAction<ReconCfg>('reconConfigGet', {})
      setCfg(c)
      setDraft({
        gapMin: String(c.gapMin), overlapMin: String(c.overlapMin),
        missingCoveragePct: String(c.missingCoveragePct), smartRunDays: String(c.smartRunDays),
      })
      setFailed('')
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The backend did not answer.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async (extra?: { auto: string }) => {
    setBusy(true)
    try {
      const out = await gasAction<{ config: ReconCfg; message: string }>('reconConfigSet', { ...draft, ...extra })
      setCfg((c) => (c ? { ...c, ...out.config } : c))
      toast({ type: 'success', title: 'Saved', body: out.message })
    } catch (e) {
      // The server names the field and its bounds — that sentence is the fix.
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy(false) }
  }

  return (
    <motion.section id="recon" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]">
      <Card padded={false} className="p-6">
        <CardHeader title="Time Reconciliation" sub="What counts as an anomaly, and whether the import runs itself." />

        {failed ? (
          <div className="rounded-md border border-tint-amber bg-tint-amber px-3 py-2.5 text-[12px] leading-5 text-tint-fg-amber">
            <p className="flex items-center gap-1.5 font-semibold"><TriangleAlert size={13} />
              {/^unknown action/i.test(failed) ? 'The backend does not have this yet — it arrives with the next platform release' : 'Could not read the configuration'}</p>
            <p className="mt-0.5">{failed}</p>
            <button type="button" onClick={() => void load()}
              className="mt-2 h-7 rounded-md border border-tint-fg-amber/30 px-2.5 text-[12px] font-semibold transition-opacity hover:opacity-70">
              Try again
            </button>
          </div>
        ) : !cfg ? (
          <p className="flex items-center gap-2 text-[12.5px] text-text-3"><Loader2 size={13} className="animate-spin" /> Loading…</p>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Runs by itself</p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy}
                  onClick={() => void save({ auto: cfg.auto === 'on' ? 'off' : 'on' })}
                  className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-40 ${
                    cfg.auto === 'on' ? 'bg-tint-mint text-tint-fg-mint hover:opacity-80'
                      : 'border border-border bg-surface text-text-2 hover:bg-surface-2'}`}>
                  {busy && <Loader2 size={12} className="animate-spin" />}
                  {cfg.auto === 'on' ? 'Automatic — daily' : 'Manual only'}
                </button>
                <span className="text-[11.5px] text-text-3">{cfg.meanings.auto}</span>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">What counts as an anomaly</p>
              <div className="space-y-2.5">
                {NUMS.map(({ key, label, suffix }) => (
                  <div key={key} className="flex flex-wrap items-center gap-2.5">
                    <span className="w-52 text-[13px] text-text-1">{label}</span>
                    <input value={draft[key] ?? ''} inputMode="numeric" className={field}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
                    <span className="w-10 text-[12px] text-text-3">{suffix}</span>
                    <span className="min-w-0 flex-1 text-[11.5px] leading-4 text-text-3">{cfg.meanings[key]}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" onClick={() => void save()} disabled={busy}
                  className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
                  {busy && <Loader2 size={13} className="animate-spin" />} Save thresholds
                </button>
              </div>
            </div>

            <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2.5 text-[11.5px] leading-5 text-text-3">
              <p className="mb-1 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Where the punches come from</p>
              <p>
                <strong className="text-text-2">{cfg.source.mode}</strong> · workbook <code>{cfg.source.spreadsheetId.slice(0, 12)}…</code> ·
                tabs <strong className="text-text-2">{cfg.source.punchesTab}</strong>, {cfg.source.staffMapTab}, {cfg.source.clientMapTab}.
                Read-only here on purpose: pointing the import at the wrong workbook is the one mistake this screen
                must not make easy. Changing the source is a deliberate edit of the config row.
              </p>
            </div>
          </div>
        )}
      </Card>
    </motion.section>
  )
}
