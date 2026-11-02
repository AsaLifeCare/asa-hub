// Settings → Hiring rules — everything the hiring lane is configured with that is NOT a message.
// Split out of Hiring messages, because that screen held message templates beside phone numbers beside day counts…
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, RotateCcw } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import CatalogueNotice, { catalogueOf, type CatalogueState } from '@/components/shared/CatalogueNotice'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { fetchAlerts, dropAlertsCache } from '@/lib/hiringAlerts'

type AlertRow = { key: string; value: string; note: string; default_value: string; group: string }

type Scorecard = { by_role: string[]; by_list: string[]; by_grant: string[]; unreadable?: boolean }

const GROUPS: { id: string; title: string; sub: string }[] = [
  { id: 'access', title: 'Who may sign an interview scorecard',
    sub: 'The scorecard says somebody sat in a room with the candidate, so being an admin does not admit you. Edit the list here or straight in the hiring_alerts_config tab — it is the same cell.' },
  { id: 'recipients', title: 'Who the team alerts reach',
    // The names used to be typed here and would have gone on being printed after the config changed.
    sub: 'The escalation floor is the row that is always paged; every other list adds to it. Emptying the floor restores the shipped numbers rather than silencing the alert.' },
  { id: 'timing', title: 'How long the platform waits',
    sub: 'Blank means the shipped value. A number typed here changes a gate, so each field says what it governs.' },
  { id: 'guard', title: 'The staff-collision rule',
    sub: 'What stops a card being opened for somebody who already works here — and, since 2026-08-28, what decides whether a RETURNING employee walks the hiring process again or is treated as staff and closed.' },
  // THE PLATFORM-WIDE SIX HAVE LEFT (Smart Comms → Desk).
]

const LABEL: Record<string, string> = {
  sms_recipients: 'SMS recipients',
  email_recipients: 'E-mail recipients',
  packet_hold_hours: "The candidate's day to produce the packet (hours)",
  onboarding_window_before_days: 'Onboarding portal opens this many days early',
  onboarding_window_after_days: 'Onboarding portal stays open this many days after',
  messages_paused: 'Pause the send door — an extra brake; test mode is the emergency stop',
  platform_email_enabled: 'May the platform send e-mail as itself?',
  hiring_timezone: 'The clock the whole platform reads',
  opt_out_phrases: 'Words that mean STOP (all outbound)',
  opt_in_phrases: 'Words that mean START again (all outbound)',
  wrong_number_phrases: 'Words that mean WRONG NUMBER (all outbound)',
  staff_guard_mode: 'Signed-in lanes',
  staff_guard_mode_public: 'The public referral form',
  staff_guard_block_statuses: 'Statuses that refuse a card',
  staff_guard_test_phones: 'Numbers that never collide',
  staff_guard_test_emails: 'Addresses that never collide',
  staff_guard_shared_emails: 'Institutional mailboxes (identify nobody)',
  interview_scorecard_emails: 'Addresses that may sign a scorecard',
}

const INPUT =
  'w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

const MINE = (r: AlertRow) => GROUPS.some((g) => g.id === r.group)

// SETTINGS THAT WERE NEVER HIRING RULES — the section needed a review of whether everything standing in it was…
const ELSEWHERE = new Set([
  'clients_views_master', 'clients_toolbar_master', 'potclients_views_master',
  'copilot_badges', 'myworld_badges', 'smartcomms_widget_badges',
  'franchise_view_badges', 'appgrid_badges', 'render_sheet_edit_badges',
  'platform_mail_badges',
  // THE SEVENTH BADGE, missed when the other six left.
  'behavior_all_badges',
  'test_mode', 'test_redirect_sms', 'test_redirect_email', 'test_banner',
  'packet_rehearsal_number',
  'contact_sweep_hours',
])
const ELSEWHERE_SHOWN = ['Access control', 'Potential Clients', 'Contact sync', 'Smart Comms']

export default function HiringRulesSection() {
  const [rows, setRows] = useState<AlertRow[] | null>(null)
  const [scorecard, setScorecard] = useState<Scorecard | null>(null)
  // Where the keys and their notes came from — the sheet, or the last-resort copy in the code.
  const [catalogue, setCatalogue] = useState<CatalogueState | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void (fetchAlerts() as Promise<{ rows: AlertRow[]; scorecard?: Scorecard }>)
      .then((r) => {
        if (!alive) return
        const mine = r.rows.filter(MINE)
        setRows(mine)
        setScorecard(r.scorecard ?? null)
        setCatalogue(catalogueOf(r))
        setDraft(Object.fromEntries(mine.map((x) => [x.key, x.value])))
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load the rules.'))
    return () => { alive = false }
  }, [])

  const dirty = rows?.some((r) => (draft[r.key] ?? '') !== r.value) ?? false

  const save = async () => {
    if (!rows) return
    setSaving(true)
    const changed = Object.fromEntries(
      rows.filter((r) => (draft[r.key] ?? '') !== r.value).map((r) => [r.key, draft[r.key] ?? '']))
    try {
      await gasAction('hiringAlertsSet', { values: changed })
      // EVERY READER SHARES ONE CACHE.
      dropAlertsCache()
      setRows(rows.map((r) => ({ ...r, value: draft[r.key] ?? r.value })))
      toast({ type: 'success', title: 'Hiring rules saved', body: 'In force on the next pass — no deploy needed.' })
    } catch (err) {
      // The server REFUSES a set that would break test mode, and that refusal is the useful message — showing "try…
      toast({ type: 'danger', title: 'Could not save', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.section
      id="hiringrules"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader
          title="Hiring rules — who hears, and how long the platform waits"
          sub="The words, the recipients and the clocks. It is not Hiring policy, which decides who may CALL each step; nothing here grants or refuses permission to anybody."
        />
        {error ? (
          <p className="rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{error}</p>
        ) : !rows ? (
          <p className="flex items-center gap-2 py-4 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : (
          <div className="space-y-6">
            <CatalogueNotice catalogue={catalogue} />
            {ELSEWHERE_SHOWN.length > 0 && (
              <p className="rounded-md bg-surface-2 px-3 py-2 text-[11.5px] leading-[1.55] text-text-3">
                <span className="font-semibold text-text-2">Sixteen settings that were listed here are not any more.</span>{' '}
                Seven badge lists, the platform mail badges, the contact sweep and the Potential
                Clients view master were never hiring rules, and every one of them already had its
                own screen — so this panel was a second place to edit the same cell, which is how
                one of two screens ends up showing a value that stopped being true. They are edited
                in {ELSEWHERE_SHOWN.join(', ')}. The six that reach the whole platform — the
                emergency stop, the STOP / START / WRONG NUMBER words every ear reads, the clock and
                the platform&apos;s own e-mail — now sit with the other brakes on the Smart Comms
                desk. Nothing was deleted: the keys and their values are untouched.
              </p>
            )}
            {GROUPS.map((g) => {
              const mine = rows.filter((r) => r.group === g.id && !ELSEWHERE.has(r.key))
              if (!mine.length) return null
              return (
                <div key={g.id}>
                  <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">{g.title}</p>
                  <p className="mb-2.5 text-[11.5px] leading-4 text-text-3">{g.sub}</p>
                  <div className="space-y-3.5">
                    {mine.map((r) => (
                      <div key={r.key}>
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-text-1">{LABEL[r.key] ?? r.key}</span>
                          {(draft[r.key] ?? '') !== r.default_value && (
                            <button
                              type="button"
                              title="Back to the shipped value"
                              onClick={() => setDraft((d) => ({ ...d, [r.key]: r.default_value }))}
                              className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                            >
                              <RotateCcw size={10} /> default
                            </button>
                          )}
                        </div>
                        <input
                          value={draft[r.key] ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                          className={INPUT + ' h-9'}
                        />
                        <p className="mt-1 text-[11.5px] leading-4 text-text-3">{r.note}</p>
                        {/* THE UNION, not just this cell. Three routes grant
                            and none revokes another, so somebody who deletes
                            an address here and sees the field empty would
                            otherwise never learn the person still has access
                            through their user record. */}
                        {r.key === 'interview_scorecard_emails' && scorecard && (
                          <div className="mt-2 rounded-sm border border-border bg-surface-2 px-2.5 py-2 text-[11.5px] leading-5 text-text-2">
                            <p className="font-semibold text-text-1">Who can sign one right now</p>
                            <p>
                              <span className="text-text-3">the interviewer login — </span>
                              {scorecard.by_role.length ? scorecard.by_role.join(', ') : 'no interviewer account'}
                            </p>
                            <p>
                              <span className="text-text-3">this list — </span>
                              {scorecard.by_list.length ? scorecard.by_list.join(', ') : 'nobody'}
                            </p>
                            <p>
                              <span className="text-text-3">granted in Access control — </span>
                              {scorecard.by_grant.length ? scorecard.by_grant.join(', ') : 'nobody'}
                            </p>
                            {scorecard.by_grant.length > 0 && (
                              <p className="mt-1 text-text-3">
                                Removing an address from this list does <strong>not</strong> revoke
                                a grant made in Access control — that one is revoked there.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            <div className="flex justify-end border-t border-border pt-4">
              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty || saving}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
              >
                {saving && <Loader2 size={13} className="animate-spin" />} Save rules
              </button>
            </div>
          </div>
        )}
      </Card>
    </motion.section>
  )
}
