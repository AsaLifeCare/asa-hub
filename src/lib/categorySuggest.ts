// Smart category suggestions for Settings → App control (v10).
// A pure, deterministic, fully local heuristic engine — no backend, no ML service.
import { FALLBACK_CATEGORY_ID, type CategoryDef } from '@/lib/categories'
import type { AppManifest } from '@/engine/types'

/** Suggestions at or above this confidence count as "high confidence". */
export const HIGH_CONFIDENCE = 0.7

/** Confidence reported when nothing matched — suggestion just keeps current. */
export const LOW_CONFIDENCE = 0.25

/** Top score at or above this counts as full-strength evidence. */
const STRONG_SCORE = 6

/** Field weights: the app's name says the most, page schemas the least. */
const NAME_WEIGHT = 3
const TAGLINE_WEIGHT = 2
const PAGES_WEIGHT = 1

export type CategorySuggestion = {
  appId: string
  /** Suggested category id (a CategoryDef id). */
  categoryId: string
  label: string
  /** 0..1, rounded to 2 decimals. */
  confidence: number
  /** Human-readable evidence, strongest first, e.g. 'name “med” (+3)'. */
  reasons: string[]
  /** Every category that scored, sorted desc — for transparency/debugging. */
  scores: { id: string; label: string; score: number }[]
  /** False when no keyword matched anywhere (suggestion = current category). */
  hasSignal: boolean
}

// Keyword lexicons per built-in category id (CategoryDef.id — for defaults the id is the category string manifests…
const BUILTIN_LEXICON: Record<string, string[]> = {
  Workspace: [
    'home', 'overview', 'workspace', 'today', 'daily', 'personal', 'inbox', 'mail',
    'greeting', 'start', 'bookmark', 'bookmarks', 'calendar', 'calendars', 'events', 'week', 'agenda',
    'schedule',
  ],
  Manage: [
    'people', 'directory', 'profiles', 'staff', 'team', 'teams', 'hiring', 'hired', 'candidates',
    'applicants', 'recruiter', 'recruiting',
    'onboarding', 'training', 'certification', 'certifications', 'policy', 'policies', 'acknowledgments',
    'roles', 'permissions', 'access', 'hr', 'employees', 'org', 'assignments',
  ],
  Library: [
    'docs', 'doc', 'documents', 'knowledge', 'guides', 'library', 'book', 'books', 'articles',
    'reader', 'reading', 'videos', 'academy', 'courses', 'lessons', 'learning', 'plans', 'portal',
    'playbooks', 'photos', 'images', 'media', 'resources', 'families', 'family',
  ],
  Care: [
    'care', 'caregiver', 'med', 'meds', 'medication', 'medications', 'mar', 'mars', 'health',
    'meal', 'meals', 'nutrition', 'diet', 'allergy', 'sleep', 'hydration', 'wellbeing', 'wellness',
    'workout', 'fitness', 'behavior', 'behaviour', 'diseases', 'diagnosis', 'diagnoses', 'doses',
    'pill', 'pills', 'clinic', 'doctor', 'doctors', 'guardians', 'recipients', 'clients',
  ],
  Operations: [
    'operations', 'shift', 'shifts', 'coverage', 'fleet', 'mileage', 'vehicle', 'vehicles',
    'transport', 'transportation', 'routes', 'drivers', 'maintenance', 'repair', 'repairs', 'orders',
    'visit', 'visits', 'evv', 'audit', 'audits', 'compliance', 'inventory', 'supplies', 'stock',
    'equipment', 'assets', 'delivery', 'deliveries', 'warehouse', 'dispatch', 'logistics',
    'incidents', 'appointments', 'offs', 'board', 'kanban', 'houses', 'house',
  ],
  Intelligence: [
    'dashboard', 'analytics', 'report', 'reports', 'kpi', 'kpis', 'metrics', 'insight', 'insights',
    'intelligence', 'crm', 'referral', 'referrals', 'census', 'quality', 'trends', 'executive',
    'owners', 'charts', 'graphs', 'data', 'indicators', 'leadership', 'pipeline', 'glance',
  ],
  Finance: [
    'expense', 'expenses', 'payroll', 'billing', 'invoice', 'invoices', 'budget', 'budgets',
    'finance', 'financial', 'payers', 'claims', 'revenue', 'cost', 'costs', 'money', 'wallet',
    'payment', 'payments', 'accounting', 'receipts', 'hours', 'spend', 'waiver',
  ],
}

/** Filler tokens that carry no category signal. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'with', 'by', 'in', 'on', 'at', 'from',
  'per', 'across', 'into', 'your', 'you', 'my', 'our', 'is', 'are', 'all', 'every', 'who',
  'has', 'have', 'it', 'its', 'what', 'when', 'that', 'this', 'one', 'new', 'app', 'asa',
])

/** Lowercase alphanumeric tokens, length ≥ 2, stopwords removed. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

// Does keyword `kw` match token `t`?
function keywordMatches(kw: string, t: string): boolean {
  if (kw === t) return true
  const shorter = Math.min(kw.length, t.length)
  return shorter >= 5 && (t.startsWith(kw) || kw.startsWith(t))
}

/** Keywords a category matches on: built-in lexicon + its label tokens. */
function lexiconFor(def: CategoryDef): string[] {
  const builtin = BUILTIN_LEXICON[def.id] ?? []
  const labelTokens = tokenize(def.label)
  return [...new Set([...builtin, ...labelTokens])]
}

// Suggest a category for `app` out of `defs`.
export function suggestCategory(
  app: Pick<AppManifest, 'id' | 'name' | 'tagline' | 'category' | 'pages'>,
  defs: CategoryDef[],
  currentId: string,
): CategorySuggestion {
  const fields: { field: string; weight: number; tokens: string[] }[] = [
    { field: 'name', weight: NAME_WEIGHT, tokens: tokenize(app.name) },
    { field: 'tagline', weight: TAGLINE_WEIGHT, tokens: tokenize(app.tagline) },
    {
      field: 'pages',
      weight: PAGES_WEIGHT,
      tokens: tokenize(app.pages.map((p) => `${p.title} ${p.type}`).join(' ')),
    },
  ]

  const scored = defs.map((def) => {
    const lexicon = lexiconFor(def)
    let score = 0
    const hits: { field: string; kw: string; weight: number }[] = []
    for (const f of fields) {
      // each token contributes at most once per category per field
      const seen = new Set<string>()
      for (const t of f.tokens) {
        if (seen.has(t)) continue
        const kw = lexicon.find((k) => keywordMatches(k, t))
        if (kw) {
          seen.add(t)
          score += f.weight
          hits.push({ field: f.field, kw, weight: f.weight })
        }
      }
    }
    return { id: def.id, label: def.label, score, hits }
  })

  const ranked = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))

  const fallback = defs.some((d) => d.id === currentId) ? currentId : FALLBACK_CATEGORY_ID
  const fallbackLabel = defs.find((d) => d.id === fallback)?.label ?? fallback

  if (ranked.length === 0) {
    return {
      appId: app.id,
      categoryId: fallback,
      label: fallbackLabel,
      confidence: LOW_CONFIDENCE,
      reasons: ['no keyword signal — keeping current category'],
      scores: [],
      hasSignal: false,
    }
  }

  const top = ranked[0]
  const second = ranked[1]?.score ?? 0
  const total = ranked.reduce((sum, s) => sum + s.score, 0)
  const strength = Math.min(1, top.score / STRONG_SCORE)
  const share = top.score / total
  const margin = (top.score - second) / top.score
  const confidence =
    Math.round(Math.min(0.98, LOW_CONFIDENCE + 0.73 * strength * (0.5 * share + 0.5 * margin)) * 100) / 100

  const reasons = top.hits
    .sort((a, b) => b.weight - a.weight || a.kw.localeCompare(b.kw))
    .slice(0, 4)
    .map((h) => `${h.field} “${h.kw}” (+${h.weight})`)

  return {
    appId: app.id,
    categoryId: top.id,
    label: top.label,
    confidence,
    reasons,
    scores: ranked.map(({ id, label, score }) => ({ id, label, score })),
    hasSignal: true,
  }
}
