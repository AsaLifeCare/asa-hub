// THE PROFILE, DEFINED ONCE — the right-hand detail panel and the My asa.
// card are built from this file and from nothing else.
import { roleBadge, type AuthUser } from '@/auth/types'
import { BADGE_ORDER, badgeWord } from '@/components/shared/RoleBadge'
import { ohioDay, ohioTime } from '@/lib/ohio'
import { formatPhoneDisplay } from '@/lib/phoneFormat'

// Badge word → hero-chip TintName — the same colours RoleBadge wears, translated to the detail Header's…
const BADGE_PANEL_TINT: Record<string, string> = {
  MASTER: 'lavender', PLATFORMLEAD: 'peach', DIRECTOR: 'peach', SUPERVISOR: 'peach', TEAMLEAD: 'peach',
  ADMINISTRATOR: 'blue', ADMIN: 'blue',
  ENTITY: 'slate', MANAGER: 'mint', HM: 'violet', INTERVIEWER: 'pink',
  STAFF: 'mint', CLIENT: 'warning', FAMILY: 'info', SSA: 'mint', ONBOARDING: 'amber',
}

// EVERY WAY TO REACH THE PERSON, COUNTED ONCE — the inner My asa.

// Sign-in e-mail FIRST — it is the identity, the others are contact — then the extras, deduped case-insensitively…
export function contactEmails(user: Pick<AuthUser, 'email' | 'emails'>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [user.email, ...(user.emails ?? [])]) {
    const value = String(raw ?? '').trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

// The labelled numbers, primary first.
export function contactPhones(user: Pick<AuthUser, 'phone' | 'phones'>): { label: string; number: string }[] {
  const out: { label: string; number: string }[] = []
  const at = new Map<string, number>()
  const rows = [{ label: '', number: user.phone ?? '' }, ...(user.phones ?? [])]
  for (const row of rows) {
    const number = String(row?.number ?? '').trim()
    if (!number) continue
    const label = String(row?.label ?? '').trim()
    const digits = number.replace(/\D+/g, '')
    const key = digits || number.toLowerCase()
    const seen = at.get(key)
    if (seen != null) {
      if (!out[seen].label && label) out[seen].label = label
      continue
    }
    at.set(key, out.length)
    out.push({ label, number })
  }
  return out.map((p) => ({ label: p.label || 'Phone', number: p.number }))
}

/** `masterOverview` (Master.gs) — `null` on a list means UNREADABLE, not empty. */
export type MasterOverview = {
  master?: string
  transport?: { sending?: string; test_mode?: string; kill_switch?: string }
  sessions?: { email: string; last_seen: string }[] | null
  armedSituations?: { id: string; to: string; channels: string }[] | null
  admins?: string[] | null
}

/** A `fields` section whose rows are built here rather than bound by key. */
type FieldSpec = { icon: string; label: string; value: string; fallback?: string; multiline?: boolean }

// One person can hold several live sessions (a phone, two tabs, yesterday's laptop).
function groupSessions(sessions: { email: string; last_seen: string }[]): { email: string; count: number; last: string }[] {
  const by = new Map<string, { email: string; count: number; last: string }>()
  for (const s of sessions) {
    const key = String(s.email || '').toLowerCase() || '(unknown)'
    const prev = by.get(key)
    const last = String(s.last_seen || '')
    if (prev) {
      prev.count += 1
      if (last > prev.last) prev.last = last
    } else {
      by.set(key, { email: String(s.email || '(unknown)'), count: 1, last })
    }
  }
  return [...by.values()].sort((a, b) => (b.last > a.last ? 1 : -1))
}

// `2026-08-10T16:10:34Z` → `12:10 PM · Aug 10`, unparseable input back as itself.
function shortWhen(iso: string): string {
  const s = String(iso || '')
  const t = ohioTime(s)
  return t ? `${t} · ${ohioDay(s)}` : s || '—'
}

// A section over a feed that can be unreadable.
function feedSection(title: string, rows: unknown[] | null | undefined, fields: FieldSpec[]) {
  if (rows == null) {
    return {
      kind: 'fields' as const,
      title: `${title} — unreadable`,
      fields: [{ icon: 'triangle-alert', label: 'Read', value: 'feed_failed', multiline: true }],
    }
  }
  if (rows.length === 0) {
    return { kind: 'fields' as const, title, fields: [{ icon: 'circle-slash', label: 'None', value: 'feed_empty_' + title, multiline: true }] }
  }
  return { kind: 'fields' as const, title: `${title} (${rows.length})`, fields }
}

export type ProfilePanel = {
  record: Record<string, unknown>
  config: Record<string, unknown>
  /** True when the server answered `masterOverview` — the panel is the rich one. */
  isMaster: boolean
}

// Build the profile panel for `user`.
export function buildProfilePanel({
  user,
  installedCount,
  overview,
  onEdit,
  place,
}: {
  user: AuthUser
  installedCount: number
  overview?: MasterOverview | null
  onEdit?: () => void
  // THE PLACE THIS PROFILE BELONGS TO - each of the places carries its own different profile - the world makes its…
  place?: { label: string; owner: boolean }
}): ProfilePanel {
  const isMaster = Boolean(overview) || Boolean(user.isMaster)
  const sessions = overview?.sessions == null ? null : groupSessions(overview.sessions)
  const armed = overview?.armedSituations ?? null
  const admins = overview?.admins ?? null

  // THE ONE HIGHEST BADGE (the drawer said "Admin" over a DIRECTOR) — the same order every other corner of the…
  const types = (user.types ?? []).map((t) => String(t).toUpperCase().trim()).filter(Boolean)
  const highest = place?.owner ? (user.worldRole === 'user' ? 'USER' : 'OWNER') : isMaster ? 'MASTER' : (BADGE_ORDER.find((b) => types.includes(b)) ?? types[0] ?? roleBadge(user))
  const highestTint = place?.owner ? 'lavender' : BADGE_PANEL_TINT[highest] ?? (isMaster ? 'lavender' : 'mint')

  const emails = contactEmails(user)
  const phones = contactPhones(user)

  // EVERY DISPLAYED STRING IS A KEY IN THIS RECORD, and that is not a style choice — it is the fix for the bug that…
  const record: Record<string, unknown> = {
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    title: user.title || '',
    avatar: user.avatar || '',
    subtitleLine: [place?.label ?? user.title, user.email].filter(Boolean).join(' · ') || user.email,
    // the hero chip is the one badge drawn outside <RoleBadge/>, so it asks the same place for the drawn word…
    badge: badgeWord(highest),
    appsCount: installedCount,
    appsLine: `${installedCount} installed`,
  }
  // one key per address and per number — `FieldRow` resolves `value` as a KEY PATH into this record, so a literal…
  emails.forEach((e, i) => { record[`email_${i}`] = e })
  phones.forEach((p, i) => { record[`phone_${i}`] = p.number })

  // ONE ROW PER WAY TO REACH THEM.
  const accountFields: FieldSpec[] = []
  if (emails.length === 0) accountFields.push({ icon: 'mail', label: 'Email', value: 'email' })
  emails.forEach((_, i) => {
    accountFields.push({ icon: 'mail', label: i === 0 ? 'Email' : `Email ${i + 1}`, value: `email_${i}` })
  })
  if (phones.length === 0) accountFields.push({ icon: 'phone', label: 'Phone', value: 'phone', fallback: 'not set' })
  phones.forEach((p, i) => {
    accountFields.push({ icon: 'phone', label: phones.length === 1 ? 'Phone' : p.label, value: `phone_${i}` })
  })
  accountFields.push({ icon: 'briefcase', label: 'Job title', value: 'title', fallback: 'not set' })

  const sections: Record<string, unknown>[] = [
    { kind: 'fields', title: 'Account', fields: accountFields },
  ]

  // The ordinary account stops here, with its own contact details and no platform internals.
  if (!isMaster) {
    sections.push({
      kind: 'fields',
      title: 'Workspace',
      fields: [{ icon: 'layout-grid', label: 'Apps', value: 'appsLine' }],
    })
  }

  if (isMaster) {
    record.m_master = overview?.master || '—'
    record.m_sending = overview?.transport?.sending || '—'
    record.m_test = overview?.transport?.test_mode || '—'
    record.m_kill = overview?.transport?.kill_switch || '—'
    record.feed_failed = 'This feed could not be read. It is NOT empty — treat it as unknown.'

    sections.push({
      kind: 'fields',
      title: 'Master — transport',
      // `multiline` on all three on purpose.
      fields: [
        { icon: 'radio', label: 'Sending', value: 'm_sending', multiline: true },
        { icon: 'flask-conical', label: 'Test mode', value: 'm_test', multiline: true },
        { icon: 'octagon-x', label: 'Kill switch', value: 'm_kill', multiline: true },
      ],
    })

    // THESE THREE USE `multiline`/`bullets`, NOT THE ONE-LINE FIELD, and the reason is not spacing.
    record['feed_empty_Armed situations'] = 'No situation is armed — nothing on this platform sends right now.'
    armed?.forEach((s, i) => {
      record[`armed_${i}`] = [s.to ? `to: ${formatPhoneDisplay(s.to)}` : '', s.channels].filter(Boolean).join(' · ') || '—'
    })
    sections.push(
      feedSection(
        'Armed situations',
        armed,
        (armed ?? []).map((s, i) => ({ icon: 'megaphone', label: s.id, value: `armed_${i}`, multiline: true })),
      ),
    )

    record['feed_empty_Signed in now'] = 'Nobody holds a live session.'
    sessions?.forEach((s, i) => {
      record[`sess_${i}`] = `${s.count > 1 ? `${s.count} sessions · ` : ''}last seen ${shortWhen(s.last)}`
    })
    sections.push(
      feedSection(
        'Signed in now',
        sessions,
        (sessions ?? []).map((s, i) => ({ icon: 'user', label: s.email, value: `sess_${i}`, multiline: true })),
      ),
    )

    // One row for the whole list: admin accounts are a SET, and a section that repeats the label "Admin" down the…
    record['feed_empty_Admins'] = 'No account holds admin.'
    record.admins_list = (admins ?? [])
      .map((a) => (a.toLowerCase() === String(user.email).toLowerCase() ? `${a} (you)` : a))
      .join(' · ')
    sections.push(
      feedSection('Admins', admins, [
        { icon: 'shield', label: 'Accounts', value: 'admins_list', bullets: true, tint: 'lavender' } as FieldSpec,
      ]),
    )

    sections.push({
      kind: 'fields',
      title: 'Master — who',
      fields: [
        {
          icon: 'key-round',
          label: 'HUB_MASTER_EMAIL',
          value: 'm_master',
          multiline: true,
        },
      ],
    })
  }

  const config: Record<string, unknown> = {
    header: {
      // key paths, never literals — see the record comment above
      avatar: 'avatar',
      title: 'name',
      subtitle: 'subtitleLine',
      statusChip: { label: highest, tint: highestTint },
    },
    sections,
  }

  // FOUR REAL NUMBERS OR NONE.
  if (isMaster) {
    record.m_sessions = sessions == null ? '—' : sessions.length
    record.m_armed = armed == null ? '—' : armed.length
    record.m_admins = admins == null ? '—' : admins.length
    config.stats = [
      { label: 'Apps installed', value: 'appsCount', icon: 'layout-grid', tint: 'blue' },
      { label: 'Signed in', value: 'm_sessions', icon: 'users', tint: 'mint' },
      { label: 'Armed', value: 'm_armed', icon: 'megaphone', tint: 'amber' },
      { label: 'Admins', value: 'm_admins', icon: 'shield', tint: 'lavender' },
    ]
  }

  if (onEdit) {
    config.footer = {
      buttons: [{ label: 'Edit my profile', icon: 'pencil', variant: 'primary', onClick: onEdit }],
    }
  }

  return { record, config, isMaster }
}
