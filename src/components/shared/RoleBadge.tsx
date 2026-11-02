// The role chip, drawn ONCE for the whole platform.
// Five surfaces (topbar menu, sidebar footer, My asa., the profile sheet and Settings) each wrote their own…
import { roleBadge, type AuthUser } from '@/auth/types'
import { cn } from '@/lib/utils'

// THE OFFICIAL TYPES, EACH WITH ITS COLOUR.
const TYPE_TINT: Record<string, string> = {
  MASTER: 'bg-tint-lavender text-tint-fg-lavender',
  ADMIN: 'bg-tint-blue text-tint-fg-blue',
  ADMINISTRATOR: 'bg-tint-blue text-tint-fg-blue',
  DIRECTOR: 'bg-tint-peach text-tint-fg-peach',
  // TEAM LEAD SHARES THE DIRECTOR'S PEACH, on purpose and only for now: the twelve badges already spend eleven of…
  PLATFORMLEAD: 'bg-tint-peach text-tint-fg-peach',
  SUPERVISOR: 'bg-tint-peach text-tint-fg-peach',
  TEAMLEAD: 'bg-tint-peach text-tint-fg-peach',
  MANAGER: 'bg-tint-mint text-tint-fg-mint',
  HM: 'bg-tint-violet text-tint-fg-violet',
  STAFF: 'bg-primary-soft text-primary-strong',
  INTERVIEWER: 'bg-tint-pink text-tint-fg-pink',
  ONBOARDING: 'bg-tint-amber text-tint-fg-amber',
  ENTITY: 'bg-tint-slate text-tint-fg-slate',
  FAMILY: 'bg-tint-info text-tint-fg-info',
  SSA: 'bg-tint-mint text-tint-fg-mint',
  CLIENT: 'bg-tint-warning text-tint-fg-warning',
}

// THE WORD A CHIP DRAWS, when it differs from the word a rule matches.
const BADGE_WORD: Record<string, string> = { TEAMLEAD: 'Team Lead', PLATFORMLEAD: 'Platform Lead' }

// The token as a person reads it.
export function badgeWord(token: string): string {
  const t = String(token ?? '').trim()
  return BADGE_WORD[t.toUpperCase()] ?? t
}

export default function RoleBadge({
  user,
  label: labelProp,
  size = 'sm',
  className,
}: {
  user?: Pick<AuthUser, 'role' | 'isMaster'> | null
  // Render THIS word instead of deriving from the role — the type badges (HM, INTERVIEWER, …) ride the same chip…
  label?: string
  /** `xs` for dense chrome (menus, footers), `sm` for cards and panels. */
  size?: 'xs' | 'sm'
  className?: string
}) {
  if (!user && !labelProp) return null
  const token = labelProp ?? roleBadge(user!)
  const label = BADGE_WORD[token.toUpperCase()] ?? token
  const master = Boolean(user?.isMaster)
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full font-bold uppercase tracking-wide',
        size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[10px]',
        // the TOKEN picks the colour, never the drawn word: a chip whose tint came from "TEAM LEAD" would fall back…
        TYPE_TINT[token.toUpperCase()] ?? 'bg-primary-soft text-primary-strong',
        className,
      )}
      title={master && !labelProp ? 'Master — the one account named by HUB_MASTER_EMAIL' : undefined}
    >
      {label}
    </span>
  )
}

// THE ACCESS ORDER — an order of access to the system defined by the BADGES.
export const BADGE_ORDER = [
  // DIRECTOR above ADMINISTRATOR on purpose: Ty Bond carries both words and the rule is that he and Lisa read…
  'MASTER', 'PLATFORMLEAD', 'DIRECTOR', 'SUPERVISOR', 'ADMINISTRATOR', 'ADMIN', 'ENTITY', 'MANAGER',
  // TEAMLEAD directly over HM: the operator's matrix gives a team lead the house manager's column (2026-10-29)
  'TEAMLEAD', 'HM', 'INTERVIEWER', 'STAFF', 'CLIENT', 'FAMILY', 'SSA', 'ONBOARDING',
] as const

// The ONE badge a person's own corners show — only the highest one is drawn — sidebar footer, topbar menu, My asa.
export function HighestBadge({ user, size = 'xs', className }: {
  user?: (Pick<AuthUser, 'role' | 'isMaster'> & { types?: string[] }) | null
  size?: 'xs' | 'sm'
  className?: string
}) {
  if (!user) return null
  if (user.isMaster) return <RoleBadge user={user} size={size} className={className} />
  const types = (user.types ?? []).map((t) => String(t).toUpperCase().trim()).filter(Boolean)
  const highest = BADGE_ORDER.find((b) => types.includes(b)) ?? types[0]
  if (highest) return <RoleBadge user={user} label={highest} size={size} className={className} />
  return <RoleBadge user={user} size={size} className={className} />
}

// Every badge this user wears: MASTER (derived) first, then the TYPE list (the first HM shows HM and INTERVIEWER…
export function TypeBadges({ user, size = 'xs', className }: {
  user?: (Pick<AuthUser, 'role' | 'isMaster'> & { types?: string[] }) | null
  size?: 'xs' | 'sm'
  className?: string
}) {
  if (!user) return null
  // Deduped — a list that says CLIENT twice must still draw ONE chip.
  const types = [...new Set((user.types ?? []).map((t) => String(t).trim()).filter(Boolean))]
  if (!user.isMaster && types.length === 0) return null
  return (
    <>
      {user.isMaster && <RoleBadge user={user} size={size} className={className} />}
      {types.map((t) => (
        <RoleBadge key={t} user={user} label={t} size={size} className={className} />
      ))}
    </>
  )
}
