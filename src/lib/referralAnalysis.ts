// The Potential Clients analysis: Compare draws it, the black header quotes it, the Funnel's board uses its rule.
// A blank score is unscored, never a 0.
import { funnelColumnOf } from '@/lib/intakeStages'

export type Lead = Record<string, unknown>

/** How many of the ranking the Compare screen lays side by side. */
export const TOP_N = 12
/** A score above this is worth the call — and enters the Funnel on its own. */
export const WORTH_CALL_ABOVE = 8
/** A referral whose window closes within this many days counts as expiring. */
export const EXPIRING_DAYS = 14
/** The stages a hand moves a card into; any of them wins over the score. */
export const MOVED_STAGES = ['contacted', 'assessment', 'intake', 'converted', 'lost'] as const

const DAY_MS = 86_400_000
const text = (v: unknown): string => String(v ?? '').trim()

/** The scraper's score, or null when it never scored the row. */
export function leadRating(r: Lead | null | undefined): number | null {
  const raw = text(r?.ai_rating)
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** Days until the referral expires — negative once it has, null with no date. */
export function leadDaysLeft(r: Lead | null | undefined, now: number = Date.now()): number | null {
  const raw = text(r?.expiration_date)
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isFinite(t) ? Math.round((t - now) / DAY_MS) : null
}

export const isReachable = (r: Lead): boolean => Boolean(text(r?.phone) || text(r?.email))
export const hasFunding = (r: Lead): boolean => Boolean(text(r?.funding_source))
export const isRoundClock = (r: Lead): boolean => /24\s*\/?\s*7|around the clock/i.test(String(r?.frequency ?? ''))
export const isWorthCall = (r: Lead): boolean => {
  const n = leadRating(r)
  return n !== null && n > WORTH_CALL_ABOVE
}
export const isExpiring = (r: Lead, now: number = Date.now()): boolean => {
  const d = leadDaysLeft(r, now)
  return d !== null && d >= 0 && d <= EXPIRING_DAYS
}
export const isExpired = (r: Lead, now: number = Date.now()): boolean => {
  const d = leadDaysLeft(r, now)
  return d !== null && d < 0
}

// The Funnel column a referral sits in, or '' when off the board.
export function boardStage(r: Lead): string {
  const s = text(r?.stage).toLowerCase()
  if ((MOVED_STAGES as readonly string[]).includes(s)) return s
  const column = funnelColumnOf(r?.stage)
  if (column) return column
  if (text(r?.in_funnel)) return 'new'
  return isWorthCall(r) ? 'new' : ''
}
export const isOnBoard = (r: Lead): boolean => boardStage(r) !== ''

/** The rank: the scraper's score, then whether we can act on it. An unscored row scores nothing on the first axis. */
export type SignalKey = 'score' | 'reach' | 'funding' | 'hours' | 'time'
export type Signal = { key: SignalKey; label: string; max: number; of: (r: Lead, now: number) => number }

export const SIGNALS: readonly Signal[] = [
  { key: 'score', label: 'Score', max: 10, of: (r) => leadRating(r) ?? 0 },
  { key: 'reach', label: 'Reachable', max: 3, of: (r) => (isReachable(r) ? 3 : 0) },
  { key: 'funding', label: 'Funding named', max: 3, of: (r) => (hasFunding(r) ? 3 : 0) },
  { key: 'hours', label: 'Hours', max: 2, of: (r) => (isRoundClock(r) ? 2 : 0) },
  {
    key: 'time', label: 'Time left', max: 2,
    of: (r, now) => {
      const d = leadDaysLeft(r, now)
      if (d === null) return 1                  // no date is not an expired date
      if (d < 0) return 0
      return d <= EXPIRING_DAYS ? 2 : 1         // urgency counts FOR a referral, not against
    },
  },
]
export const RANK_MAX = SIGNALS.reduce((s, x) => s + x.max, 0)
export const rankOf = (r: Lead, now: number = Date.now()): number => SIGNALS.reduce((s, x) => s + x.of(r, now), 0)

/** The rank in words — what put a referral where it is. */
export function whyRanked(r: Lead, now: number = Date.now()): string[] {
  const score = leadRating(r)
  const out = [score === null ? 'not yet scored' : `score ${score}`]
  if (isReachable(r)) out.push('reachable')
  if (hasFunding(r)) out.push('funding named')
  if (isRoundClock(r)) out.push('24/7 hours')
  const d = leadDaysLeft(r, now)
  out.push(d === null ? 'no expiry date' : d < 0 ? 'already expired' : `${d}d left`)
  return out
}

// One referral's place in the ranking — its seat, of how many, its rank and what put it there; null when the…
export type Standing = { place: number; of: number; rank: number; why: string[]; onBoard: boolean }

export function standingOf(a: Pick<ReferralAnalysis, 'ranked' | 'total' | 'now'> | null, id: string): Standing | null {
  const seat = a && id ? a.ranked.findIndex((r) => String(r.id ?? '') === id) : -1
  if (!a || seat < 0) return null
  const r = a.ranked[seat]
  const onBoard = isOnBoard(r)
  return {
    place: seat + 1, of: a.total, rank: rankOf(r, a.now), onBoard,
    why: [...whyRanked(r, a.now), onBoard ? 'on the board' : 'not on the board yet'],
  }
}

/** Where the file is thinnest — the single largest share of referrals we cannot act on yet. */
export type ReferralGap = { key: 'unscored' | 'unreachable' | 'unfunded' | 'expired'; n: number; label: string }

export type ReferralAnalysis = {
  now: number
  total: number
  scored: number
  unscored: number
  worthCall: number
  reachable: number
  funded: number
  expiring: number
  expired: number
  /** every referral, best first (ties by name) */
  ranked: Lead[]
  /** the first TOP_N of the ranking — what Compare lays side by side */
  top: Lead[]
  /** of `top`, the ones not on the board yet — the decisions still open */
  waiting: number
  leader: { row: Lead; rank: number; why: string[] } | null
  byZip: [string, number][]
  byFunding: [string, number][]
  histogram: { n: number; c: number; pct: number }[]
  gap: ReferralGap | null
}

const tally = (rows: Lead[], keyOf: (r: Lead) => string): [string, number][] => {
  const m = new Map<string, number>()
  rows.forEach((r) => {
    const k = keyOf(r)
    if (k) m.set(k, (m.get(k) ?? 0) + 1)
  })
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
}

export function analyseReferrals(rows: Lead[], now: number = Date.now()): ReferralAnalysis {
  const total = rows.length
  const ratings = rows.map(leadRating)
  const scored = ratings.filter((n) => n !== null).length
  const reachable = rows.filter(isReachable).length
  const funded = rows.filter(hasFunding).length
  const expired = rows.filter((r) => isExpired(r, now)).length

  const ranks = new Map<Lead, number>(rows.map((r) => [r, rankOf(r, now)]))
  const ranked = [...rows].sort(
    (a, b) => (ranks.get(b) as number) - (ranks.get(a) as number) ||
      String(a.client_name ?? '').localeCompare(String(b.client_name ?? '')),
  )
  const top = ranked.slice(0, TOP_N)
  const first = ranked[0]

  const buckets = new Map<number, number>()
  ratings.forEach((n) => {
    if (n === null) return
    const b = Math.round(n)
    buckets.set(b, (buckets.get(b) ?? 0) + 1)
  })
  const peak = Math.max(1, ...buckets.values())

  const gaps: ReferralGap[] = [
    { key: 'unscored', n: total - scored, label: 'not yet scored' },
    { key: 'unreachable', n: total - reachable, label: 'no phone or e-mail' },
    { key: 'unfunded', n: total - funded, label: 'no funding named' },
    { key: 'expired', n: expired, label: 'already expired' },
  ]
  const widest = gaps.reduce((best, g) => (g.n > best.n ? g : best), gaps[0])

  return {
    now,
    total,
    scored,
    unscored: total - scored,
    worthCall: rows.filter(isWorthCall).length,
    reachable,
    funded,
    expiring: rows.filter((r) => isExpiring(r, now)).length,
    expired,
    ranked,
    top,
    waiting: top.filter((r) => !isOnBoard(r)).length,
    leader: first ? { row: first, rank: ranks.get(first) as number, why: whyRanked(first, now) } : null,
    byZip: tally(rows, (r) => text(r.postal_code)),
    byFunding: tally(rows, (r) => text(r.funding_source) || '— not named'),
    histogram: Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
      const c = buckets.get(n) ?? 0
      return { n, c, pct: (c / peak) * 100 }
    }),
    gap: widest.n > 0 ? widest : null,
  }
}
