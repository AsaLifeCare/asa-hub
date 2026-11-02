// Settings → Contact sync — the contact clock and its two hands.
// Quo Enrich and Fill phones have to happen automatically, as the user's own updates land.
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Clock, Loader2, Network, Phone, Sparkles } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCan } from '@/auth/permissions'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { fetchAlerts } from '@/lib/hiringAlerts'
import { readSlice, sliceAgeMs } from '@/lib/snapshotClient'

// THE PLATFORM'S CONTACT LIST (ContactsSync.gs).
type PlatformContact = Record<string, unknown>
type SyncResult = {
  updated: number; inserted: number; unchanged: number; foreign: number
  refused: number; refused_named: string[]; writes: number; received: number; skipped?: string
}

// ANY WHOLE NUMBER OF HOURS.
const CADENCES = [1, 2, 3, 4, 6, 8, 12, 24]

export default function ContactSyncSection() {
  const canManage = useCan('apps.manage')
  const [hours, setHours] = useState('2')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<'' | 'save' | 'phones' | 'quo' | 'platform'>('')
  // the platform's list, as the relay filed it — null = no slice yet
  const [platform, setPlatform] = useState<{ rows: PlatformContact[]; ageMs: number | null } | null | 'none'>(null)

  useEffect(() => {
    let alive = true
    void readSlice<PlatformContact>('cortexContacts')
      .then((rows) => {
        if (!alive) return
        setPlatform(rows ? { rows, ageMs: sliceAgeMs('cortexContacts') } : 'none')
      })
      .catch(() => alive && setPlatform('none'))
    return () => { alive = false }
  }, [])

  const syncPlatform = async () => {
    if (!platform || platform === 'none' || !platform.rows.length) return
    setBusy('platform')
    try {
      // the SAME door the relay's clock knocks on, with the SAME rows — only the People-shaped columns travel; the…
      const cols = ['id', 'name', 'first_name', 'last_name', 'role', 'status', 'email', 'phone', 'city', 'state',
                    'employee_id', 'start_date', 'end_date', 'avatar', 'source', 'source_coverage', 'external_id', 'updated_at']
      const rows = platform.rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? ''])))
      const r = await gasAction<SyncResult>('peopleSyncFromPlatform', { rows }, { timeoutMs: 180000 })
      if (r.skipped) {
        toast({ type: 'info', title: 'Roster sync skipped', body: r.skipped })
      } else {
        toast({
          type: 'success',
          title: 'Roster refreshed from the platform',
          body: `${r.updated} row${r.updated === 1 ? '' : 's'} refreshed · ${r.inserted} added · ${r.unchanged} unchanged` +
                (r.refused ? ` · ${r.refused} refused by the filter` : '') + ` · ${r.writes} write${r.writes === 1 ? '' : 's'}`,
        })
      }
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        toast({ type: 'info', title: 'The roster sync is already running', body: 'Check the platform log for its counts.' })
      } else {
        toast({ type: 'danger', title: 'Roster sync failed', body: err instanceof Error ? err.message : 'Nothing was written.' })
      }
    } finally {
      setBusy('')
    }
  }

  useEffect(() => {
    let alive = true
    void (fetchAlerts() as Promise<{ rows: { key: string; value: string }[] }>)
      .then((r) => {
        if (!alive) return
        const v = parseInt(r.rows.find((row) => row.key === 'contact_sweep_hours')?.value ?? '2', 10)
        setHours(String(CADENCES.includes(v) ? v : 2))
        setLoaded(true)
      })
      // A failed read still shows the seeded default (2) — the server falls back to 2 for any unreadable value too…
      .catch(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [])

  const saveCadence = async () => {
    setBusy('save')
    try {
      await gasAction('hiringAlertsSet', { values: { contact_sweep_hours: hours } })
      // The config row is only the clock's memory — the trigger must be reinstalled to actually tick at the new…
      const r = await gasAction<{ hours: number }>('contactSweepInstall', {})
      toast({
        type: 'success',
        title: `Clock installed — every ${r.hours}h`,
        body: 'Phones fill + Quo enrich now run at this cadence, on their own.',
      })
    } catch (err) {
      toast({
        type: 'danger',
        title: 'Could not install the clock',
        body: err instanceof Error ? err.message : 'Try again.',
      })
    } finally {
      setBusy('')
    }
  }

  const fillPhones = async () => {
    setBusy('phones')
    try {
      const r = await gasAction<{ filled: number; examined: number }>('usersPhoneBackfill', {})
      toast({
        type: 'success',
        title: 'Phones filled',
        body: `${r.filled} phone(s) filled from the roster/candidates — ${r.examined} account(s) examined.`,
      })
    } catch (err) {
      toast({ type: 'danger', title: 'Fill phones failed', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setBusy('')
    }
  }

  const quoEnrich = async () => {
    setBusy('quo')
    try {
      // The Quo walk pages through the whole contact book (0.3s between pages) — minutes by nature, so the timeout…
      const r = await gasAction<{ updated: number; phonesAdded: number; emailsAdded: number }>(
        'usersQuoEnrich', {}, { timeoutMs: 150000 },
      )
      toast({
        type: 'success',
        title: 'Quo enrich done',
        body: `${r.updated} account(s) updated — ${r.phonesAdded} phone(s), ${r.emailsAdded} e-mail(s) added.`,
      })
    } catch (err) {
      toast({ type: 'danger', title: 'Quo enrich failed', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setBusy('')
    }
  }

  return (
    <motion.section
      id="contactsync"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader
          title="Contact sync"
          sub="The clock that keeps contact info fresh — fills missing phones from the roster/candidates, then walks the Quo (OpenPhone) book for more phones and e-mails."
        />
        {!loaded ? (
          <p className="flex items-center gap-2 py-4 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : (
          <div className="space-y-5">
            {/* the cadence — saved AND installed in one press */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[14px] font-medium text-text-1">Cadence</p>
                <p className="text-[12px] leading-5 text-text-3">
                  How often the clock runs. Saving reinstalls the trigger — no deploy.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Select value={hours} onValueChange={setHours} disabled={!canManage}>
                  <SelectTrigger className="h-9 w-[130px] rounded-sm border-border bg-surface text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CADENCES.map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        Every {h}h
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => void saveCadence()}
                  disabled={!canManage || busy !== ''}
                  className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
                >
                  {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Clock size={13} />}
                  {busy === 'save' ? 'Installing…' : 'Save cadence'}
                </button>
              </div>
            </div>

            {/* the two hands — for the moment somebody cannot wait */}
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Run now</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void fillPhones()}
                  disabled={!canManage || busy !== ''}
                  className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
                >
                  {busy === 'phones' ? <Loader2 size={13} className="animate-spin" /> : <Phone size={13} />}
                  Fill phones now
                </button>
                <button
                  type="button"
                  onClick={() => void quoEnrich()}
                  disabled={!canManage || busy !== ''}
                  className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
                >
                  {busy === 'quo' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {busy === 'quo' ? 'Walking the Quo book…' : 'Quo enrich now'}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-text-3">
                Both are idempotent — the clock and the hand never fight. The Quo walk takes minutes; leave the tab open.
              </p>
            </div>

            {/* the platform's list — what the roster learns every hour */}
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Platform contacts</p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] text-text-1">
                    {platform === null && 'Reading the platform list…'}
                    {platform === 'none' && 'No platform list on the relay yet — it appears on the next rebuild.'}
                    {platform && platform !== 'none' && (
                      <>
                        <span className="font-medium">{platform.rows.length} people</span> the platform knows, filtered
                        {platform.ageMs != null && <> · list {Math.max(1, Math.round(platform.ageMs / 60000))} min old</>}
                      </>
                    )}
                  </p>
                  <p className="text-[12px] leading-5 text-text-3">
                    The relay hands this list to the roster every hour; the merge into accounts runs on this clock. Blank-only, contexts beside, nothing removed.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void syncPlatform()}
                  disabled={!canManage || busy !== '' || !platform || platform === 'none'}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
                >
                  {busy === 'platform' ? <Loader2 size={13} className="animate-spin" /> : <Network size={13} />}
                  {busy === 'platform' ? 'Refreshing the roster…' : 'Refresh roster now'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </motion.section>
  )
}
