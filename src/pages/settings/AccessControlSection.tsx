// Settings → Access control (admins only, anchor #access).
// What is decided HERE is what was never about apps: 1.
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router'
import { Check, Loader2 } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { useAuthStore, type BackendUser } from '@/auth/useAuthStore'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { gasAction } from '@/features/hiring/shared'
import { fetchUsers } from '@/lib/usersDirectory'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { badgeRuleAllows, useBadgeAccessStore } from '@/lib/badgeAccess'
import { BADGE_ORDER } from '@/components/shared/RoleBadge'
import { useTenantStore } from '@/stores/useTenantStore'
import { activeWorldId } from '@/stores/useWorldStore'
import { MASTER_ONLY_SECTIONS, configAccessSections } from '@/lib/settingsNav'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { AppIcon } from '@/lib/icons'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import { reachForFeature, reachForSection } from '@/lib/badgeReach'
import { fetchAlerts, dropAlertsCache } from '@/lib/hiringAlerts'


// ================= Module access — RETIRED ================= A per-ROLE matrix over every app and page lived here…

/* ================= Badge vocabulary shared by the two matrices below ================= */

// Every badge a rule may name — the whole vocabulary except MASTER, which is never assignable: it is derived from…
const ASSIGNABLE_BADGES = BADGE_ORDER.filter((b) => b !== 'MASTER')

// THE CHIPS HERE DRAW THE TOKEN, NOT THE PRETTY WORD, and the monospace is the tell: this screen edits RULES, and a…
const BADGE_CHIP_CLS =
  'rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors'

// Order-blind, case-blind list equality.
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const norm = (l: string[]) => l.map((x) => x.trim().toUpperCase()).sort()
  const A = norm(a)
  const B = norm(b)
  return A.every((x, i) => x === B[i])
}

// The sentence a refusal carried.
function errText(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const env = (err as Error & { envelope?: { error?: unknown } }).envelope
    if (env && typeof env.error === 'string' && env.error) return env.error
    return err.message
  }
  return fallback
}

/* ---- Features: the badge matrix's last block ---- */

// FEATURES — a selection of capabilities configured the way App access by badge is; at the end of App access by…
type FeatureRow = {
  id: string
  label: string
  description: string
  /** Config key holding the CSV of badges (hiring_alerts_config). */
  configKey: string
  // NO `defaultBadges` HERE ANY MORE.
  icon: string
}

const FEATURE_ROWS: FeatureRow[] = [
  {
    id: 'platform_mail',
    label: 'Platform mailbox',
    description: 'The asa-hub inbox in the Mail app. The master always reads it.',
    configKey: 'platform_mail_badges',
    icon: 'inbox',
  },
  // The shell buttons by badge — the four squares and the star are configured here, BY BADGE.

  {
    id: 'franchise_view',
    label: 'Franchise view',
    description: 'The franchise card(s) in the places stack — who may look at and travel to the franchise (e.g. DIRECTOR). The master always sees them; no badges selected = the master alone.',
    configKey: 'franchise_view_badges',
    icon: 'building-2',
  },
  {
    id: 'smartcomms_widget',
    label: 'Smart Comms indicator',
    description: 'The "Your notifications" card on My asa. — which badges see what the platform has been sending. Meant for admins, directors and managers rather than staff or clients; no badges selected = everyone.',
    configKey: 'smartcomms_widget_badges',
    icon: 'megaphone',
  },
  {
    id: 'copilot_star',
    label: 'Copilot star',
    description: 'The purple star on the top bar and command bar, and its side panel. No badges selected = everyone.',
    configKey: 'copilot_badges',
    icon: 'sparkles',
  },
  {
    id: 'apps_grid',
    label: 'Apps grid button',
    description: 'The four-squares button on the command bar that opens the App Hub. No badges selected = everyone.',
    configKey: 'appgrid_badges',
    icon: 'layout-grid',
  },
  // Render Sheet's WRITE half: the app matrix above decides who sees the sheets; this row decides who may change…
  {
    id: 'render_sheet_edit',
    label: 'Render Sheet editing',
    description: 'Badges that may edit cells and add rows in Render Sheet. No badges selected = admins only.',
    configKey: 'render_sheet_edit_badges',
    icon: 'pencil',
  },
  // Behavior Support's SCOPE — the feature is visible up to the house manager badge (all of them); the badges below…
  {
    id: 'behavior_all',
    label: 'Behavior Support — everybody',
    description: 'Badges that read the wellbeing reading of EVERY person (how they work here, and whether that rhythm is healthy). Everyone else still opens the app and sees their own reading and nobody else’s. The master always reads everybody; no badges selected = the master alone.',
    configKey: 'behavior_all_badges',
    icon: 'brain',
  },
]

function FeatureBadgeGroup() {
  const [saved, setSaved] = useState<Record<string, string[]> | null>(null) // null = loading
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  // Same overlay discipline as the app rows: draft state renders, the ref is read at SEND time so a debounce never…
  const [draft, setDraft] = useState<Record<string, string[]>>({})
  const draftRef = useRef<Record<string, string[]>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    let alive = true
    setLoadError('')
    // ONE read for every feature row — the config comes back whole, so a second feature costs no extra round-trip.
    void (fetchAlerts() as Promise<{ rows?: { key: string; value: string }[] }>)
      .then((r) => {
        if (!alive) return
        const rows = r.rows ?? []
        setSaved(
          Object.fromEntries(
            FEATURE_ROWS.map((f) => {
              const raw = rows.find((row) => row.key === f.configKey)?.value ?? ''
              const list = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
              // AN EMPTY CELL IS NOT A SELECTION — configurations made here were not being saved.
              return [f.id, list]
            }),
          ),
        )
      })
      .catch((err) => {
        // editing over a guessed value would write badges the master never saw, so the group waits and offers a…
        if (alive) setLoadError(err instanceof Error ? err.message : 'Could not load the feature config.')
      })
    return () => {
      alive = false
    }
  }, [loadAttempt])

  const push = async (feature: FeatureRow) => {
    const badges = draftRef.current[feature.id]
    if (!badges) return
    delete timersRef.current[feature.id]
    setBusy((b) => ({ ...b, [feature.id]: true }))
    // LANDED, NOT ANSWERED.
    let landed = false
    try {
      const r = await gasAction<{ saved?: number }>('hiringAlertsSet', {
        values: { [feature.configKey]: badges.join(', ') },
      })
      landed = !(typeof r?.saved === 'number' && r.saved < 1)
      if (landed) dropAlertsCache()   // every reader shares one memo of this config
      if (landed) {
        // An empty list is not "nobody": the server reads it back as the default, so that is what we record — the…
        setSaved((s) => ({ ...(s ?? {}), [feature.id]: badges }))
      } else {
        toast({
          type: 'danger',
          title: `${feature.label} not saved`,
          body: 'The live backend does not know this setting yet — it arrives with the next platform release — press Apply again then. Your choice stays on screen.',
        })
      }
    } catch (err) {
      // a refusal keeps the overlay too: the choice stays staged for Apply
      toast({
        type: 'danger',
        title: `${feature.label} access not saved`,
        body: accessRefusal(err) || errText(err, 'The server did not take the change — try again.'),
      })
    } finally {
      // retire the overlay ONLY if the write LANDED and it is still the list we just sent — a click during the…
      if (landed && draftRef.current[feature.id] === badges) {
        const rest = { ...draftRef.current }
        delete rest[feature.id]
        draftRef.current = rest
        setDraft(rest)
      }
      setBusy((b) => ({ ...b, [feature.id]: false }))
    }
  }

  // The shell-feature rows keep the same promise as the app matrix — see `carryHidden` there.
  const stage = (feature: FeatureRow, badgesIn: string[]) => {
    const stored = saved?.[feature.id] ?? []
    const offered = reachForFeature(ASSIGNABLE_BADGES, feature.id).badges
    const hidden = stored.filter((b) => !offered.includes(b) && !badgesIn.includes(b))
    const badges = hidden.length ? [...badgesIn, ...hidden] : badgesIn
    draftRef.current = { ...draftRef.current, [feature.id]: badges }
    setDraft(draftRef.current)
    clearTimeout(timersRef.current[feature.id])
    timersRef.current[feature.id] = setTimeout(() => void push(feature), 500)
  }

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      // a debounce pending on unmount still lands — leaving the screen must not silently discard a decision already…
      for (const f of FEATURE_ROWS) {
        if (timers[f.id] !== undefined && draftRef.current[f.id]) {
          clearTimeout(timers[f.id])
          void push(f)
        }
      }
    }
  }, [])

  // APPLY for the FEATURES block — the matrix's button, and the rows below need the same promise.
  const [applying, setApplying] = useState(false)
  const applyAll = async () => {
    if (applying) return
    const staged = { ...draftRef.current }
    const pending = FEATURE_ROWS.filter((f) => staged[f.id])
    if (!pending.length) return
    setApplying(true)
    for (const id of Object.keys(timersRef.current)) {
      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
    }
    const values: Record<string, string> = {}
    for (const f of pending) values[f.configKey] = staged[f.id].join(', ')
    try {
      await gasAction('hiringAlertsSet', { values })
    } catch (err) {
      setApplying(false)
      toast({
        type: 'danger',
        title: 'Features not applied',
        body: errText(err, 'The server did not take the change — try again.'),
      })
      return
    }
    // ONE confirming read — the judge of what actually landed.
    let rows: { key: string; value: unknown }[] | null = null
    try {
      // FORCE: "the judge of what actually landed" cannot be a cached copy from before the write it is judging.
      const r = await (fetchAlerts({ force: true }) as Promise<{ rows?: { key: string; value: unknown }[] }>)
      rows = r.rows ?? []
    } catch {
      /* nothing retires over a read we do not have */
    }
    setApplying(false)
    if (!rows) {
      toast({
        type: 'danger',
        title: 'Applied, but not confirmed',
        body: 'The confirming read failed — your selections stay on screen; press Apply again.',
      })
      return
    }
    const freshByKey = new Map(rows.map((row) => [String(row.key), row]))
    let confirmedN = 0
    let mismatched = 0
    const missing: string[] = []
    const clearIds: string[] = []
    for (const f of pending) {
      const row = freshByKey.get(f.configKey)
      if (!row) {
        // the old backend's read does not even list the key — it cannot hold it
        missing.push(f.configKey)
        continue
      }
      const got = String(row.value ?? '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
      if (sameSet(got, staged[f.id])) {
        confirmedN += 1
        clearIds.push(f.id)
      } else {
        mismatched += 1
      }
    }
    if (clearIds.length) {
      setSaved((s) => {
        const n = { ...(s ?? {}) }
        for (const id of clearIds) {
          const f = FEATURE_ROWS.find((x) => x.id === id)
          if (f) n[id] = staged[id]
        }
        return n
      })
      const rest = { ...draftRef.current }
      for (const id of clearIds) if (rest[id] === staged[id]) delete rest[id]
      draftRef.current = rest
      setDraft(rest)
    }
    const keptN = mismatched + missing.length
    toast(
      keptN
        ? {
            type: 'danger',
            title: 'Apply finished with misses',
            body:
              `${confirmedN} confirmed on the sheet · ${keptN} did not land — kept on screen; press Apply again.` +
              (missing.length
                ? ` The live backend does not know these settings yet — it arrives with the next platform release — press Apply again then: ${missing.join(', ')}.`
                : ''),
          }
        : {
            type: 'success',
            title: 'Features applied',
            body: `${confirmedN} setting${confirmedN === 1 ? '' : 's'} confirmed on the sheet.`,
          },
    )
  }

  return (
    <div>
      {loadError ? (
        <div className="space-y-3 rounded-md border border-border bg-surface-2 px-4 py-3">
          <p className="text-[13px] text-text-1">{loadError}</p>
          <button
            type="button"
            onClick={() => setLoadAttempt((n) => n + 1)}
            className="h-8 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-3"
          >
            Retry
          </button>
        </div>
      ) : saved === null ? (
        <p className="flex items-center gap-2 py-2 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Loading the feature config…
        </p>
      ) : (
        <div className="space-y-1.5">
          {FEATURE_ROWS.map((f) => {
            // AND THE LAST SUBSTITUTION GOES TOO.
            const badges = draft[f.id] ?? saved[f.id] ?? []
            // DEFAULT NOW MEANS "NOTHING CHOSEN", which is what the sheet stores as an empty cell — not "the chosen…
            const isDefault = badges.length === 0   // no row: the master's alone
            return (
              <div key={f.id} className="rounded-md border border-border bg-surface px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <AppIcon name={f.icon} size={15} className="shrink-0 text-text-3" />
                  <span className="min-w-0 flex-1">
                    <span className="clamp-1 block text-[13px] font-semibold leading-4 text-text-1">{f.label}</span>
                    <span className="clamp-1 mt-0.5 block text-[11.5px] leading-4 text-text-3">{f.description}</span>
                  </span>
                  {busy[f.id] && <Loader2 size={12} className="shrink-0 animate-spin text-text-3" />}
                  {/* the feature twin of the app row's EVERYONE chip: a feature
                      with no badges is not open to everyone, it is back to its
                      default — so the chip says that instead of lying */}
                  {/* NO BADGES MEANS THE MASTER ALONE — and the
                      server has always agreed: hubGrantedFeatureOn_ returns
                      true for the master and FALSE for everybody when the cell
                      is empty. This tag said "Default", and the sentence under
                      the card said an empty row falls back to the feature's
                      default — both describing a rule that does not exist
                      anywhere in the code. The app rows above have said "Only
                      you" for a day; one law, one word, both matrices. */}
                  {isDefault ? (
                    <span
                      className="shrink-0 text-[11.5px] font-medium text-text-3"
                      title="Nobody has been given this yet, so it works for you and nobody else."
                    >
                      Only you
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => stage(f, [])}
                      title="Clear the badges — the feature becomes yours alone again."
                      className="shrink-0 text-[11.5px] font-semibold text-primary hover:underline"
                    >
                      Make it mine alone
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {reachForFeature(ASSIGNABLE_BADGES, f.id).badges.map((b) => {
                    const on = badges.includes(b)
                    return (
                      <button
                        key={b}
                        type="button"
                        onClick={() => stage(f, on ? badges.filter((x) => x !== b) : [...badges, b])}
                        aria-pressed={on}
                        className={cn(
                          BADGE_CHIP_CLS,
                          on
                            ? 'border-primary bg-primary-soft text-primary-strong'
                            : 'border-border text-text-3 hover:bg-surface-2 hover:text-text-1',
                        )}
                      >
                        {b}
                      </button>
                    )
                  })}
                </div>
                {(() => { const rr = reachForFeature(ASSIGNABLE_BADGES, f.id); return rr.dropped.length ? (
                  <p className="mt-1 text-[10.5px] leading-4 text-text-3/80">
                    Not offered: {rr.dropped.join(', ')} — {rr.why}.
                  </p>
                ) : null })()}
              </div>
            )
          })}
          <p className="pt-1 text-[11px] leading-4 text-text-3">
            No badges means it is yours alone — the master always has it, and nobody else does until a badge names
            them. A change reaches people as their sessions refresh — within
            ~6h (the session cache), not instantly.
          </p>
          {/* APPLY at the block's end — the staged
              rows to the sheet in one write, then read back and confirmed. */}
          <div className="flex items-center justify-end gap-3 border-t border-border pt-3">
            <span className="text-[11.5px] text-text-3">
              {Object.keys(draft).length
                ? `${Object.keys(draft).length} change${Object.keys(draft).length === 1 ? '' : 's'} staged — Apply writes them and confirms against the sheet.`
                : 'Chips save as you click — a change that does not land stays staged here for Apply.'}
            </span>
            <button
              onClick={() => { void applyAll() }}
              disabled={applying || Object.keys(draft).length === 0}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {applying ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}



// "Unknown action." IS A REFUSAL WEARING A DISGUISE — the configurations made on this screen were not being saved.
function accessRefusal(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/unknown action/i.test(msg)) {
    return 'The server refused this write by name. Either this session may not edit these matrices — the master ' +
           'may, and so may any admin named on the Access control rule — or this door does not answer from the ' +
           'place you are standing in. Your choice stays on screen.'
  }
  return msg || 'Try again.'
}

// CONFIG ACCESS BY BADGE — which configurations a given user reaches, decided by badge.
function ConfigBadgeGroup() {
  const apps = useRegistryStore((s) => s.apps)
  const configRules = useBadgeAccessStore((s) => s.configRules)
  const setConfigRule = useBadgeAccessStore((s) => s.setConfigRule)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState<Record<string, string[]>>({})
  const draftRef = useRef<Record<string, string[]>>({})
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // every section the platform has, not the viewer's — an app the viewer never installed still needs a rule
  const isMaster = useEffectiveIsMaster()
  const sections = useMemo(
    () => [
      ...configAccessSections(apps, isMaster),
      // NOT a Settings section — the app studio, made configurable like the rest.
      { id: 'playground', icon: 'flask-conical', label: 'Playground — app studio', adminOnly: true },
    ],
    [apps, isMaster],
  )

  // EVERY PENDING SECTION IN ONE EXECUTION — the Settings sections were all defined and then vanished.
  const pushAll = (ids?: string[]) => {
    const pending = ids ?? Object.keys(draftRef.current)
    if (!pending.length) return Promise.resolve()
    const sections: Record<string, string[]> = {}
    pending.forEach((id) => { sections[id] = draftRef.current[id] ?? [] })
    pending.forEach((id) => setBusy((b) => ({ ...b, [id]: true })))
    return gasAction<{ sections?: Record<string, string> }>('appAccessSetBulk', { sections })
      .then((r) => {
        // adopt ONLY what the sheet echoed back — the verify-before-clear law
        pending.forEach((id) => {
          const echoed = r?.sections?.[id]
          // A SET, NEVER A STRING (the law stated on sameSet, two hundred lines up, and disobeyed right here): the…
          const want = sections[id] ?? []
          const back = String(echoed ?? '').split(',').map((x) => x.trim()).filter(Boolean)
          if (echoed === undefined || sameSet(back, want)) {
            setConfigRule(id, sections[id] ?? [])
            setDraft((d) => {
              const mine = d[id]
              if (!mine || mine.join('.') !== (sections[id] ?? []).join('.')) return d
              const n = { ...d }; delete n[id]; return n
            })
            delete draftRef.current[id]
          }
        })
      })
      .catch((err) => {
        // the choice STAYS on screen — a rule that did not land must not look saved
        toast({ type: 'danger', title: 'Rules not saved', body: accessRefusal(err) })
      })
      .finally(() => pending.forEach((id) => setBusy((b) => ({ ...b, [id]: false }))))
  }

  const push = (id: string) => { void pushAll([id]) }

  // The sections matrix keeps the same promise — see `carryHidden` in the app group: a screen may only decide about…
  const stage = (id: string, badgesIn: string[]) => {
    const stored = configRules[id] ?? []
    const entry = sections.find((n) => n.id === id)
    const offered = reachForSection(ASSIGNABLE_BADGES, entry?.adminOnly === true).badges
    const hidden = stored.filter((b) => !offered.includes(b) && !badgesIn.includes(b))
    const badges = hidden.length ? [...badgesIn, ...hidden] : badgesIn
    draftRef.current = { ...draftRef.current, [id]: badges }
    setDraft((d) => ({ ...d, [id]: badges }))
    clearTimeout(timersRef.current[id])
    timersRef.current[id] = setTimeout(() => push(id), 500)
  }

  const [applyingSections, setApplyingSections] = useState(false)
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null)

  // PUSH EVERYTHING PENDING, THEN ASK THE SHEET WHAT IT HOLDS.
  const applySections = async () => {
    if (applyingSections) return
    setApplyingSections(true)
    setVerdict(null)
    for (const id of Object.keys(timersRef.current)) {
      clearTimeout(timersRef.current[id]); delete timersRef.current[id]
    }
    const wanted = { ...draftRef.current }
    try {
      // THE ECHO IS THE TRUTH HERE TOO — found on this very screen while the sections were being separated.
      await pushAll(Object.keys(wanted))
      const missed = Object.keys(wanted).filter((id) => draftRef.current[id] !== undefined)
      if (!Object.keys(wanted).length) {
        setVerdict({ ok: true, text: 'Nothing was waiting — everything on screen is what the sheet holds.' })
      } else if (!missed.length) {
        setVerdict({ ok: true, text: `${Object.keys(wanted).length} rule(s) saved — the sheet echoed every one back.` })
      } else {
        setVerdict({
          ok: false,
          text: `${missed.length} of ${Object.keys(wanted).length} did not land: ${missed.join(', ')}. ` +
                'These matrices take the master and the admins named on the Access control rule — if the server ' +
                'does not take this session, every write here is refused by name. Your choices stay on screen.',
        })
      }
    } catch (err) {
      setVerdict({ ok: false, text: accessRefusal(err) })
    } finally {
      setApplyingSections(false)
    }
  }

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const id of Object.keys(timers)) clearTimeout(timers[id])
      // ONE call for everything still pending — thirty parallel executions on the way out is exactly how these were…
      void pushAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <p className="mb-2.5 text-[12px] leading-4 text-text-3">
        Which badges reach each section of this screen's own menu. No badges leaves the section exactly as it is
        today. A rule can only take away — naming a badge on an admin-only section does not open it to that badge,
        because the section's own gate runs first. You always see everything.
      </p>
      <div className="space-y-1.5">
        {sections.map((s) => {
          const badges = draft[s.id] ?? configRules[s.id] ?? []
          const open = badges.length === 0
          const reach = reachForSection(ASSIGNABLE_BADGES, Boolean(s.adminOnly), MASTER_ONLY_SECTIONS.includes(s.id))
          return (
            <div key={s.id} className="rounded-md border border-border bg-surface px-3 py-2.5">
              <div className="flex items-center gap-2">
                <AppIcon name={s.icon} size={15} className="shrink-0 text-text-3" />
                <span className="clamp-1 min-w-0 flex-1 text-[13px] font-semibold text-text-1">{s.label}</span>
                {busy[s.id] && <Loader2 size={13} className="shrink-0 animate-spin text-text-3" />}
                {MASTER_ONLY_SECTIONS.includes(s.id) ? (
                  <span className="shrink-0 text-[11.5px] font-medium text-text-3" title={reach.why}>
                    The master
                  </span>
                ) : open ? (
                  <span className="shrink-0 text-[11.5px] font-medium text-text-3">
                    {s.adminOnly ? 'Admins' : 'Everyone'}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => stage(s.id, [])}
                    className="shrink-0 text-[11.5px] font-semibold text-primary hover:underline"
                  >
                    Clear the rule
                  </button>
                )}
              </div>
              {MASTER_ONLY_SECTIONS.includes(s.id) && (
                <p className="mt-1.5 text-[11.5px] leading-4 text-text-3">
                  The platform owner's alone — it is not granted by badge, so a rule here would open it to nobody.
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                {reach.badges.map((b) => {
                  const on = badges.includes(b)
                  return (
                    <button
                      key={b}
                      type="button"
                      aria-pressed={on}
                      onClick={() => stage(s.id, on ? badges.filter((x) => x !== b) : [...badges, b])}
                      className={cn(
                        BADGE_CHIP_CLS,
                        on
                          ? 'border-primary bg-primary-soft text-primary-strong'
                          : 'border-border text-text-3 hover:bg-surface-2 hover:text-text-1',
                      )}
                    >
                      {b}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/**
        * THE BUTTON THIS GROUP NEVER HAD — every block needs an Apply that
        * works, and the one at the end was missing.
        *
        * The chips saved on a debounce and nothing on screen ever said whether
        * the sheet took them. When the write is refused — the door answers 404
        * "Unknown action." to a session accessMatrixMayEdit_ does not take —
        * the only trace was a toast that fades, so the screen looked identical
        * whether it had saved or not. Apply pushes everything pending and then
        * READS THE SHEET BACK, and the verdict stays on screen until the next
        * press: named, countable, and impossible to miss.
        */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void applySections()}
          disabled={applyingSections}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-white transition-opacity disabled:opacity-40"
        >
          {applyingSections ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Apply
        </button>
        {verdict && (
          <p className={cn('text-[12.5px]', verdict.ok ? 'text-tint-fg-mint' : 'text-tint-fg-amber')}>
            {verdict.text}
          </p>
        )}
      </div>
    </div>
  )
}




export default function AccessControlSection() {
  const me = useAuthStore((s) => s.user)
  const driver = useApiConfigStore((s) => s.driver)
  const live = driver === 'apps-script'
  const isAdmin = me?.role === 'admin'
  // These matrices are the master's word over everybody, not an admin preference — and, since it is delegated, the…
  const isMaster = me?.isMaster === true
  // AND WHOEVER THE RULE NAMES EDITS TOO.
  const configRulesForGate = useBadgeAccessStore((s) => s.configRules)
  const mayEditMatrix = isMaster || badgeRuleAllows(configRulesForGate['access'], me)
  // AND EACH CARD ANSWERS FOR ITS OWN DOOR — Access Control was failing every time.
  const currentTenantId = useTenantStore((s) => s.currentTenantId)
  const homeTenantId = useTenantStore((s) => s.homeTenantId)
  const inWorld = Boolean(activeWorldId())
  const awayFromHome = Boolean(homeTenantId) && currentTenantId !== homeTenantId
  /** Refused away from headquarters — the hiring-config door is not declared safe there. */
  const featuresHere = !inWorld && !awayFromHome
  /** Declared safe in any place; only a world is not the platform. */
  const sectionsHere = !inWorld
  // live + admin: the REAL directory (usersList) replaces the demo six.

  useEffect(() => {
    if (!live || !isAdmin) return
    let alive = true
    fetchUsers()
      .then((raw) => {
        if (!alive) return
        const rows = raw as unknown as BackendUser[]
        // hidden-from-config accounts stay out of THIS table too — the overrides adoption below still covers them…
        useAuthStore.setState((s) => ({
          overrides: {
            ...s.overrides,
            ...Object.fromEntries(rows.map((r) => [String(r.id ?? ''), r.overrides ?? {}])),
          },
        }))
      })
      .catch(() => {
        // Nothing on screen hangs off this read any more — the overrides it adopts simply stay as they were until…
      })
    return () => {
      alive = false
    }
  }, [live, isAdmin])

  // The directory itself is still read HERE, and only for one reason: the per-person overrides on those rows become…


  const navigate = useNavigate()
  return (
    <motion.section
      id="access"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px] space-y-6"
    >
      {mayEditMatrix && inWorld && (
        <Card padded={false} className="p-6">
          <CardHeader
            title="Access control lives in the company, not in a world"
            sub="A world keeps its own data — the platform's rules about people are not kept there."
          />
          <p className="rounded-md bg-tint-amber px-3 py-2.5 text-[12.5px] leading-5 text-text-2">
            Leave the world and these cards return, writable as ever.
          </p>
        </Card>
      )}
      {mayEditMatrix && !inWorld && awayFromHome && (
        <Card padded={false} className="p-6">
          <CardHeader
            title="Features wait for headquarters — the rest does not"
            sub="You are away from home, and away from home the platform runs only the doors it declares safe in another place."
          />
          <p className="rounded-md bg-tint-amber px-3 py-2.5 text-[12.5px] leading-5 text-text-2">
            The <strong className="font-semibold text-text-1">Features</strong> rules — the platform mailbox,
            the buttons on the shell, the copilot star — are kept in a config whose door is not one of them, so
            that card is waiting for
            <strong className="font-semibold text-text-1"> ASA LifeCare Ohio</strong>. Settings sections below
            are declared safe in any place: they are writable from right here{isMaster ? ', and so is the badge and tenant matrix in App Control' : ''}.
          </p>
        </Card>
      )}
      {/* THE APPS ARE NOT DECIDED HERE ANY MORE — 100% of App access by
          badge's responsibilities moved to App Control.
          The card that stood here — every app crossed with the
          badge vocabulary, the per-app clear, the controls inside an app, the
          tenant half of each row and the bulk Apply — IS the App Control
          screen's Matrix layout, which edited the very same rules through the
          very same action. Two doors onto one fact is the failure this
          platform keeps naming; there is one now, and it is /app/app-control.
          What stays below is what was never about apps: the FEATURES that are
          not apps, and which badges reach the sections of this screen. */}
      {mayEditMatrix && featuresHere && (
        <Card padded={false} className="p-6">
          <CardHeader
            title="Features"
            sub="Things gated by a badge that are not apps — the platform mailbox, the buttons on the shell, the copilot star. No badges means it is yours alone: the master always has it, and nobody else does until a badge names them."
          />
          <FeatureBadgeGroup />
        </Card>
      )}
      {mayEditMatrix && sectionsHere && (
        <Card padded={false} className="p-6">
          <CardHeader
            title="Settings sections"
            sub="Which badges reach each section of this screen's own menu. A rule can only take away — the section's own gate runs first."
          />
          <ConfigBadgeGroup />
        </Card>
      )}

      {/* PER-PERSON OVERRIDES MOVED — folded into one of the other screens,
          because on their own they were of no use.
          Capabilities and app denials are two columns of ONE person's row;
          editing them on two screens meant two doors onto one decision and a
          second place to forget. They live together now behind the eye on
          the Users list, where the person is already in front of you. */}
      <Card padded={false} className="p-6">
        <CardHeader
          title="Per-person access"
          sub="Moved — it is now one door, beside the apps."
        />
        <p className="rounded-md bg-surface-2 px-3 py-2.5 text-[12.5px] leading-5 text-text-2">
          What ONE person may do — and which of their badge's apps they keep — is edited from the
          <strong className="font-semibold text-text-1"> eye </strong>
          on their row in the Users app. Capabilities and app denials are two columns of the same
          record, so they are chosen in the same place and saved in one write.
        </p>
        <button
          type="button"
          onClick={() => navigate('/app/users/accounts')}
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
        >
          Open Users
        </button>
      </Card>

    </motion.section>
  )
}
