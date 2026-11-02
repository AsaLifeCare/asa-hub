// DRAFT REFINER — the deterministic standard pass over a generated app — the drafts were coming out poor, so they…
// The model interprets the sentence; THIS module reads its answer the way a careful admin would and brings it up to…
import { addDays, format } from 'date-fns'
import type { PageType, TintName } from '@/engine/types'
import { humanize, tintFor } from '@/features/studio/scaffold'
import { animalPhoto } from '@/lib/animals'
import { isPhoneColumn } from '@/engine/templates/sheet/types'
import { generateRows } from './generate'
import type { LocalDraft } from './draftFromPrompt'

type Obj = Record<string, unknown>
type DraftPage = LocalDraft['pages'][number]

/* ------------------------------ standard sizes ---------------------------- */

const MIN_ROWS = 5
const MAX_ROWS = 8
const MAX_COLUMNS = 6
const MAX_STATS = 4
const MAX_ACTIONS = 3
const MAX_WIDGETS = 6
const MAX_STAGES = 5
const MAX_DETAIL_STATS = 4
const MAX_DETAIL_SECTIONS = 4
const MAX_RESOURCES = 6

/** Tints the engine renders — registry accents plus slate (bundles use it). */
const PALETTE = ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber', 'slate', 'green']
const TINT_CYCLE: TintName[] = ['blue', 'mint', 'lavender', 'amber', 'peach', 'pink']

const SHEET_KINDS = new Set(['text', 'avatar+text', 'chip', 'chips', 'date', 'number', 'progress', 'image', 'doc'])
const ACTION_KINDS = new Set(['patch', 'link', 'create', 'delete', 'navigate'])

const FALLBACK_IMAGES = [
  '/assets/library/houses/placeholder.jpg',
  '/assets/library/animals/cat.jpg',
  '/assets/app-hero.svg',
  '/assets/docs/cover-01.jpg',
  '/assets/library/animals/dog.jpg',
  '/assets/docs/cover-02.jpg',
]

/* --------------------------------- helpers -------------------------------- */

const asObj = (v: unknown): Obj => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const asArr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const str = (v: unknown, fb = ''): string => (typeof v === 'string' && v.trim() ? v.trim() : fb)
const isTint = (v: unknown): v is TintName => typeof v === 'string' && PALETTE.includes(v)
const tint = (v: unknown, fb: TintName): TintName => (isTint(v) ? v : fb)
const cycle = <T,>(pool: readonly T[], i: number): T => pool[i % pool.length]
const isoDay = (offset: number) => format(addDays(new Date(), offset), 'yyyy-MM-dd')

/** Distinct non-empty string values of `key` across rows, first-appearance order. */
const observed = (rows: Obj[], key: string, cap = 8): string[] => {
  const out: string[] = []
  for (const r of rows) {
    const v = r[key]
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= cap) break
  }
  return out
}

/** Every key present in at least one row, first-appearance order. */
const rowKeys = (rows: Obj[]): string[] => {
  const out: string[] = []
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (k === 'id' || k.startsWith('_') || out.includes(k)) continue
      out.push(k)
    }
  }
  return out
}

/** The first row key whose values read as plain text (a card/panel title). */
const firstTextKey = (rows: Obj[]): string | null => {
  for (const k of rowKeys(rows)) {
    if (rows.some((r) => typeof r[k] === 'string' && String(r[k]).trim() && !/^\d{4}-\d{2}-\d{2}/.test(String(r[k])))) return k
  }
  return rowKeys(rows)[0] ?? null
}

// scaffold's tintFor, extended with the priority words the bundles use (Urgent → pink) that its workflow-state list…
const PRIORITY_TINTS: [RegExp, TintName][] = [
  [/^(urgent|high|critical|severe|asap)/, 'pink'],
]
const semanticTint = (value: string, index: number): TintName => {
  const v = value.trim().toLowerCase()
  for (const [re, t] of PRIORITY_TINTS) if (re.test(v)) return t
  return tintFor(value, index)
}

/** A semantic tintBy for the observed values (scaffold.ts semantics). */
const tintByFor = (values: string[]): Record<string, TintName> =>
  Object.fromEntries(values.map((v, i) => [v, semanticTint(v, i)]))

/* ----------------------------- value coercion ----------------------------- */

const RE_ISO = /^\d{4}-\d{2}-\d{2}$/

/** Any date-ish value → ISO; the unparseable become a deterministic past day. */
function coerceDate(v: unknown, i: number): string {
  if (typeof v === 'string') {
    const s = v.trim()
    if (RE_ISO.test(s)) return s
    const t = Date.parse(s)
    if (!isNaN(t) && /[a-z0-9]/i.test(s)) return format(new Date(t), 'yyyy-MM-dd')
  }
  return isoDay(-(i + 1))
}

/** "$1,234.50" / "42%" / 7 → 1234.5 / 42 / 7; NaN → fallback. */
function coerceNumber(v: unknown, fb: number): number {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[$€£,%\s]/g, '').replace(/,/g, ''))
    if (isFinite(n) && v.trim()) return n
  }
  return fb
}

/** Progress is 0–1; a value over 1 is read as a percent (72 → 0.72). */
function coerceProgress(v: unknown, i: number): number {
  let n = coerceNumber(v, NaN)
  if (isNaN(n)) n = 0.15 + ((i * 0.17) % 0.8)
  if (n > 1) n = n / 100
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100))
}

/** Chips cells arrive as arrays, or as "a, b, c" strings the engine can't split. */
function coerceChips(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 3)
  if (typeof v === 'string') return v.split(/[,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 3)
  return []
}

/* ------------------------- placeholder resolution -------------------------- */

// Weak models answer with EXPRESSIONS instead of values — "{clientes.total}", "{clientes.ativos,percent}%".
const RE_PLACEHOLDER = /\{([^{}]+)\}/g
const RE_HAS_PLACEHOLDER = /\{[^{}]+\}/
const RE_ONLY_PLACEHOLDER = /^\s*\{[^{}]*\}\s*%?\s*$/

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** The row key a placeholder names — exact first, then normalised. */
const findKey = (rows: Obj[], name: string): string | null => {
  const keys = rowKeys(rows)
  const n = normKey(name)
  return keys.find((k) => k === name) ?? keys.find((k) => normKey(k) === n) ?? null
}

// "{field.total}" / "{field,count}" / "{field,sum}" / "{field,avg}" / "{field.value,count}" /…
function resolveExpr(inner: string, rows: Obj[]): number | null {
  const parts = inner.split(/[.,]/).map((p) => p.trim()).filter(Boolean)
  const op = (parts[parts.length - 1] ?? '').toLowerCase()
  if (parts.length === 2 && ['total', 'count', 'sum', 'avg'].includes(op)) {
    const key = findKey(rows, parts[0])
    if (op === 'total' || op === 'count') {
      return key ? rows.filter((r) => String(r[key] ?? '').trim() !== '').length : rows.length
    }
    if (!key) return null
    const nums = rows.map((r) => coerceNumber(r[key], NaN)).filter((n) => !isNaN(n))
    if (!nums.length) return null
    const sum = nums.reduce((a, b) => a + b, 0)
    return op === 'sum' ? Math.round(sum * 100) / 100 : Math.round((sum / nums.length) * 100) / 100
  }
  if (parts.length === 3 && ['count', 'percent'].includes(op)) {
    const key = findKey(rows, parts[0])
    if (!key) return null
    const want = normKey(parts[1])
    const hits = rows.filter((r) => normKey(String(r[key] ?? '')).includes(want)).length
    return op === 'count' ? hits : rows.length ? Math.round((hits / rows.length) * 100) / 100 : 0
  }
  return null
}

// A widget value that may have arrived as an expression.
function resolveValue(v: unknown, rows: Obj[]): number | null {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v !== 'string') return null
  const s = v.trim()
  const m = [...s.matchAll(RE_PLACEHOLDER)]
  if (m.length === 1) {
    const n = resolveExpr(m[0][1], rows)
    if (n !== null) return n
    if (s.replace(RE_PLACEHOLDER, '').replace(/[%\s]/g, '') === '') return null
  }
  const n = coerceNumber(s, NaN)
  return isNaN(n) ? null : n
}

/** Text with placeholders scrubbed out — a label never shows "{clientes.x}". */
function scrubText(v: unknown, fb: string): string {
  const s = str(v)
  if (!s) return fb
  const cleaned = s
    .replace(RE_PLACEHOLDER, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,:;.%-]+|[\s,:;–-]+$/g, '')
    .trim()
  return cleaned || fb
}

// A stat delta is a small signed number ("+3", "-2.5%") — anything else the model invented ("-NaN%", an expression)…
const RE_DELTA = /^[+-]?\d+(\.\d+)?\s*%?$/
const cleanDelta = (v: unknown): string | undefined => {
  const s = str(v)
  return RE_DELTA.test(s) ? s : undefined
}

// Count rows per label by matching the labels against a row field — the repair for a chart whose slice values…
function countsForLabels(rows: Obj[], labels: string[]): { counts: number[]; key: string } | null {
  let best: { counts: number[]; key: string; hits: number } | null = null
  for (const key of rowKeys(rows)) {
    const values = rows.map((r) => normKey(String(r[key] ?? '')))
    const counts = labels.map((l) => {
      const want = normKey(l)
      return values.filter((v) => v === want).length
    })
    const hits = counts.filter((c) => c > 0).length
    if (hits > 0 && (!best || hits > best.hits)) best = { counts, key, hits }
  }
  return best ? { counts: best.counts, key: best.key } : null
}

/* ------------------------------ rows: sizes ------------------------------- */

// Trim to the standard ceiling and force unique string ids.
function trimRows(page: DraftPage, notes: string[]): Obj[] {
  let rows = asArr<Obj>(page.rows).filter((r) => r && typeof r === 'object' && !Array.isArray(r))
  if (rows.length > MAX_ROWS) {
    notes.push(`"${page.title}": kept ${MAX_ROWS} of ${rows.length} sample rows`)
    rows = rows.slice(0, MAX_ROWS)
  }
  const seen = new Set<string>()
  rows = rows.map((r, i) => {
    const id = str(r.id)
    if (id && !seen.has(id)) {
      seen.add(id)
      return { ...r, id }
    }
    let n = i + 1
    while (seen.has(`row-${n}`)) n++
    seen.add(`row-${n}`)
    return { ...r, id: `row-${n}` }
  })
  // a cell whose whole value is a placeholder ("{clientes.total}") is the model confusing data with expressions…
  let blanks = 0
  rows = rows.map((r) => {
    const out = { ...r }
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'string' && RE_ONLY_PLACEHOLDER.test(out[k] as string)) {
        delete out[k]
        blanks++
      }
    }
    return out
  })
  if (blanks > 0) notes.push(`"${page.title}": removed ${blanks} placeholder value(s) the model left unresolved`)
  return rows
}

// Top up to the standard 5 rows — from the SAME deterministic generator the studio's "Generate rows" button uses…
function padRows(type: PageType, title: string, config: Obj, rows: Obj[], notes: string[]): Obj[] {
  if (rows.length >= MIN_ROWS) return rows
  const seen = new Set(rows.map((r) => String(r.id)))
  const fill = generateRows(type, config)
    .slice(0, MIN_ROWS - rows.length)
    .map((r, i) => {
      let n = rows.length + i + 1
      while (seen.has(`row-${n}`)) n++
      seen.add(`row-${n}`)
      return { ...r, id: `row-${n}` }
    })
  notes.push(`"${title}": topped the sample up to ${MIN_ROWS} rows`)
  return [...rows, ...fill]
}

/* ---------------------------------- sheet --------------------------------- */

const NAME_STATUS = /(status|stage|state|phase|situacao|etapa)/i

// A sheet column as the refiner handles it — known fields plus anything the model added, which the merge rule…
type Col = { key: string; label: string; kind: string; tintBy?: Record<string, TintName> } & Record<string, unknown>

function refineSheet(page: DraftPage, rows: Obj[], notes: string[]): { config: Obj; rows: Obj[] } {
  const config = { ...page.config }
  const declared: Col[] = asArr<Obj>(config.columns)
    .map((c) => ({ ...c, key: str(c.key), label: str(c.label), kind: str(c.kind, 'text') }))
    .filter((c) => c.key)

  // keys must agree: a column no row carries is dropped, a row key no column declares becomes a text column — the…
  const keys = rowKeys(rows)
  let columns = declared.filter((c) => keys.includes(c.key))
  const dropped = declared.length - columns.length
  if (dropped > 0) notes.push(`"${page.title}": dropped ${dropped} column(s) no row carries`)
  const missing = keys.filter((k) => !columns.some((c) => c.key === k))
  if (missing.length > 0 && columns.length < MAX_COLUMNS) {
    const add = missing.slice(0, MAX_COLUMNS - columns.length)
    columns = [...columns, ...add.map((k) => ({ key: k, label: humanize(k), kind: 'text' }))]
    notes.push(`"${page.title}": declared ${add.length} column(s) the rows already carried`)
  }
  if (columns.length > MAX_COLUMNS) {
    notes.push(`"${page.title}": kept the first ${MAX_COLUMNS} of ${columns.length} columns`)
    columns = columns.slice(0, MAX_COLUMNS)
  }
  if (columns.length === 0 && rows.length > 0) {
    columns = rowKeys(rows).slice(0, MAX_COLUMNS).map((k) => ({ key: k, label: humanize(k), kind: 'text' }))
  }

  // kinds: refuse what the engine can't render, then coerce the row values into the shape the declared kind reads
  columns = columns.map((c) => {
    if (!SHEET_KINDS.has(c.kind)) {
      notes.push(`"${page.title}": column "${c.label || c.key}" had an unknown kind — set to text`)
      return { ...c, kind: 'text' }
    }
    if (!c.label) return { ...c, label: humanize(c.key) }
    return c
  })
  const outRows = rows.map((r, i) => {
    const row = { ...r }
    for (const c of columns) {
      switch (c.kind) {
        case 'date':
          row[c.key] = coerceDate(row[c.key], i)
          break
        case 'number':
          row[c.key] = coerceNumber(row[c.key], ((i * 37) % 90) + 5)
          break
        case 'progress':
          row[c.key] = coerceProgress(row[c.key], i)
          break
        case 'chips':
          row[c.key] = coerceChips(row[c.key])
          break
        case 'avatar+text':
          if (typeof row.avatar !== 'string' || !row.avatar) row.avatar = animalPhoto(i)
          break
      }
    }
    return row
  })

  /* chip tintBy: keep declared tints, tint observed-but-untinted values */
  columns = columns.map((c) => {
    if (c.kind !== 'chip') return c
    const values = observed(outRows, c.key)
    if (!values.length) return c
    const existing = asObj(c.tintBy)
    const tintBy: Record<string, TintName> = {}
    values.forEach((v, i) => {
      tintBy[v] = isTint(existing[v]) ? (existing[v] as TintName) : semanticTint(v, i)
    })
    return { ...c, tintBy }
  })

  /* the finishing pieces every curated sheet has */
  if (typeof config.entity === 'undefined') {
    const base = page.title.trim().toLowerCase().replace(/\s+/g, ' ').replace(/s$/, '') || 'record'
    config.entity = [base, `${base}s`]
  }
  if (typeof config.searchable === 'undefined') config.searchable = true
  if (typeof config.selectable === 'undefined') config.selectable = true
  if (typeof config.densityToggle === 'undefined') config.densityToggle = true

  const firstChip = columns.find((c) => c.kind === 'chip' && Object.keys(asObj(c.tintBy)).length > 0)
  const firstDate = columns.find((c) => c.kind === 'date')
  if (!Array.isArray(config.stats) || config.stats.length === 0) {
    const stats: Obj[] = [{ label: 'Total', tint: 'blue' }]
    for (const v of Object.keys(asObj(firstChip?.tintBy)).slice(0, 2)) {
      stats.push({ label: humanize(v), tint: asObj(firstChip?.tintBy)[v], filter: { key: firstChip?.key, equals: v } })
    }
    if (firstDate) stats.push({ label: `${firstDate.label} · last 30d`, tint: 'amber', withinDays: { key: firstDate.key, days: 30 } })
    const tiles = stats.slice(0, MAX_STATS)
    config.stats = tiles
    notes.push(`"${page.title}": added ${tiles.length} stat tile(s) above the table`)
  } else {
    config.stats = asArr<Obj>(config.stats).filter((st) => str(st.label)).slice(0, MAX_STATS)
  }

  if (!config.detailPanel && columns.length > 0) {
    const primary = columns.find((c) => c.kind === 'avatar+text') ?? columns[0]
    const numbers = columns.filter((c) => c.kind === 'number' || c.kind === 'progress')
    config.detailPanel = {
      header: {
        title: primary.key,
        subtitle: columns.find((c) => c !== primary && c.kind === 'text')?.key,
        avatar: 'initials',
        ...(firstChip ? { statusChip: { field: firstChip.key, tintBy: asObj(firstChip.tintBy) } } : {}),
      },
      stats: numbers.slice(0, MAX_DETAIL_STATS).map((c, i) => ({
        label: c.label, value: c.key, icon: 'hash', tint: cycle(TINT_CYCLE, i),
      })),
      sections: [{
        kind: 'fields',
        title: 'Details',
        fields: columns.filter((c) => c !== primary).slice(0, 8)
          .map((c) => ({ label: c.label, value: c.key, ...(isPhoneColumn({ key: c.key, icon: str(c.icon) }) ? { icon: 'phone' } : {}) })),
      }],
    }
    notes.push(`"${page.title}": a row click now opens a record panel`)
  }

  const actions = asArr<Obj>(config.rowActions)
    .filter((a) => str(a.id) && str(a.label) && ACTION_KINDS.has(str(a.kind)))
    .slice(0, MAX_ACTIONS)
  const statusCol = columns.find((c) => c.kind === 'chip' && NAME_STATUS.test(c.key))
  const doneValue = statusCol
    ? Object.keys(asObj(statusCol.tintBy)).find((v) => semanticTint(v, 0) === 'mint')
    : undefined
  const alreadyMarks = statusCol && actions.some((a) => a.kind === 'patch' && typeof asObj(a.patch)[statusCol.key] !== 'undefined')
  if (statusCol && doneValue && !alreadyMarks && actions.length < MAX_ACTIONS) {
    actions.push({
      id: 'mark-done', label: `Mark ${doneValue.toLowerCase()}`, icon: 'check', kind: 'patch', quick: true,
      patch: { [statusCol.key]: doneValue },
      when: { field: statusCol.key, neq: doneValue },
      toast: `"${humanize(statusCol.key)}" set to ${doneValue}.`,
    })
    notes.push(`"${page.title}": added a quick "mark ${doneValue.toLowerCase()}" row action`)
  }
  if (actions.length) config.rowActions = actions
  else delete config.rowActions

  config.columns = columns
  return { config, rows: outRows }
}

/* ------------------------------ board/pipeline ---------------------------- */

type Stage = { id: string; label: string; tint: string }
const DEFAULT_STAGES: Record<string, Stage[]> = {
  board: [
    { id: 'backlog', label: 'Backlog', tint: 'slate' },
    { id: 'doing', label: 'Doing', tint: 'blue' },
    { id: 'review', label: 'Review', tint: 'amber' },
    { id: 'done', label: 'Done', tint: 'mint' },
  ],
  pipeline: [
    { id: 'new', label: 'New', tint: 'blue' },
    { id: 'qualified', label: 'Qualified', tint: 'lavender' },
    { id: 'proposal', label: 'Proposal', tint: 'amber' },
    { id: 'won', label: 'Won', tint: 'mint' },
  ],
}

function refineStaged(page: DraftPage, rows: Obj[], notes: string[]): { config: Obj; rows: Obj[] } {
  const config = { ...page.config }
  const isBoard = page.type === 'board'
  const stageField = str(config.stageField, isBoard ? 'column' : 'stage')
  config.stageField = stageField

  let stages: Stage[] = asArr<Obj>(config.stages)
    .map((s, i) => ({ id: str(s.id), label: str(s.label) || humanize(str(s.id)), tint: tint(s.tint, cycle(TINT_CYCLE, i)) }))
    .filter((s) => s.id)
  if (stages.length < 2) {
    notes.push(`"${page.title}": fewer than 2 usable stages — restored the standard set`)
    stages = DEFAULT_STAGES[isBoard ? 'board' : 'pipeline']
  }
  if (stages.length > MAX_STAGES) {
    notes.push(`"${page.title}": kept ${MAX_STAGES} of ${stages.length} stages`)
    stages = stages.slice(0, MAX_STAGES)
  }
  config.stages = stages
  const stageIds = stages.map((s) => s.id)

  // a card outside the declared stages is a card nobody sees — the board template drops it literally, so repair…
  let moved = 0
  const outRows = rows.map((r) => {
    const row = { ...r }
    if (!stageIds.includes(String(row[stageField]))) {
      row[stageField] = stageIds[0]
      moved++
    }
    if (isBoard && typeof row.title !== 'string') {
      const k = firstTextKey(rows)
      if (k && k !== 'title') {
        row.title = row[k]
        moved++
      }
    }
    return row
  })
  if (moved > 0) notes.push(`"${page.title}": re-seated ${moved} card(s) onto declared stages`)

  /* cardFields must name keys the rows actually carry */
  const cf = { ...asObj(config.cardFields) }
  const keys = rowKeys(outRows)
  if (cf.title !== undefined && !keys.includes(str(cf.title))) cf.title = firstTextKey(outRows) ?? undefined
  if (cf.subtitle !== undefined && !keys.includes(str(cf.subtitle))) delete cf.subtitle
  const tags = asObj(cf.tags)
  if (tags.key !== undefined) {
    if (!keys.includes(str(tags.key))) delete cf.tags
    else cf.tags = { ...tags, tintBy: tintByFor(observed(outRows, str(tags.key))) }
  }
  if (cf.meta !== undefined) {
    const meta = asArr<string>(cf.meta).filter((m) => keys.includes(m))
    if (meta.length) cf.meta = meta
    else delete cf.meta
  }
  if (Object.keys(cf).length) config.cardFields = cf
  else delete config.cardFields
  return { config, rows: outRows }
}

/* -------------------------------- dashboard ------------------------------- */

function refineDashboard(page: DraftPage, rows: Obj[], appName: string, notes: string[]): { config: Obj; rows: Obj[] } {
  const config = { ...page.config }
  let placeholders = 0
  const hasExpr = (v: unknown) => typeof v === 'string' && RE_HAS_PLACEHOLDER.test(v)

  const greeting = asObj(config.greeting)
  if (hasExpr(greeting.name) || hasExpr(greeting.subtitle)) placeholders++
  config.greeting = {
    name: scrubText(greeting.name, appName),
    subtitle: scrubText(greeting.subtitle, 'The week at a glance'),
  }

  const widgets: Obj[] = []
  let dropped = 0
  for (const w of asArr<Obj>(config.widgets)) {
    const kind = str(w.kind)
    if (widgets.length >= MAX_WIDGETS) {
      dropped++
      continue
    }
    switch (kind) {
      case 'stat': {
        if (hasExpr(w.value)) placeholders++
        // an unanswerable expression ("{clientes.total}" with no such column) becomes the one count that is always…
        const value = resolveValue(w.value, rows) ?? rows.length
        const label = scrubText(w.label, 'Total')
        widgets.push({ ...w, label, value, delta: cleanDelta(w.delta), tint: tint(w.tint, 'blue') })
        break
      }
      case 'ring': {
        if (hasExpr(w.percent) || hasExpr(w.caption)) placeholders++
        const resolved = resolveValue(w.percent, rows)
        widgets.push({
          ...w,
          percent: resolved !== null ? coerceProgress(resolved, widgets.length) : coerceProgress(w.percent, widgets.length),
          caption: scrubText(w.caption, '') || undefined,
        })
        break
      }
      case 'donut':
      case 'bars': {
        const rawParts = asArr<Obj>(kind === 'donut' ? w.slices : w.bars)
        const cap = kind === 'donut' ? 6 : 7
        let parts = rawParts
          .map((p, i) => {
            if (hasExpr(p.value)) placeholders++
            return { label: scrubText(p.label, `${i + 1}`), value: resolveValue(p.value, rows) ?? 0, tint: tint(p.tint, cycle(TINT_CYCLE, i)) }
          })
          .slice(0, cap)
        // an all-zero chart is the model's expressions failing silently — compute the counts from the sample rows…
        let title = scrubText(w.title, '')
        if (parts.length && parts.every((p) => p.value === 0)) {
          const repair = countsForLabels(rows, parts.map((p) => p.label))
          if (repair) {
            parts = parts.map((p, i) => ({ ...p, value: repair.counts[i] }))
            if (!title || normKey(title) === kind) title = `By ${humanize(repair.key)}`
            notes.push(`"${page.title}": computed the "${title}" chart from the sample rows`)
          } else {
            parts = []
          }
        }
        if (!parts.length) {
          dropped++
          break
        }
        const out: Obj = { ...w, ...(title ? { title } : {}) }
        if (kind === 'donut') out.slices = parts
        else out.bars = parts
        widgets.push(out)
        break
      }
      case 'note': {
        if (hasExpr(w.text)) placeholders++
        const text = scrubText(w.text, '')
        if (text) widgets.push({ ...w, text, tint: tint(w.tint, 'lavender') })
        else dropped++
        break
      }
      case 'list':
        if (asArr(w.items).length) widgets.push(w)
        else dropped++
        break
      default:
        dropped++
    }
  }
  if (dropped > 0) notes.push(`"${page.title}": dropped ${dropped} widget(s) the dashboard cannot render`)
  if (placeholders > 0) notes.push(`"${page.title}": resolved or removed ${placeholders} data expression(s) the model left as placeholders`)
  if (!widgets.length) {
    widgets.push(
      { kind: 'stat', label: 'Records', value: rows.length, tint: 'blue' },
      { kind: 'note', text: 'Drafted from your description — reshape the widgets in the builder.', tint: 'lavender' },
    )
    notes.push(`"${page.title}": no usable widgets — restored a standard pair`)
  }
  config.widgets = widgets
  return { config, rows }
}

/* --------------------------------- detail --------------------------------- */

function refineDetail(page: DraftPage, rows: Obj[]): { config: Obj; rows: Obj[] } {
  const config = { ...page.config }
  const keys = rowKeys(rows)
  const header = { ...asObj(config.header) }
  if (!keys.includes(str(header.title))) header.title = firstTextKey(rows) ?? 'name'
  if (header.subtitle !== undefined && !keys.includes(str(header.subtitle))) delete header.subtitle
  const chip = asObj(header.statusChip)
  if (chip.field !== undefined) {
    if (!keys.includes(str(chip.field))) delete header.statusChip
    else header.statusChip = { field: str(chip.field), tintBy: tintByFor(observed(rows, str(chip.field))) }
  }
  config.header = header

  const stats = asArr<Obj>(config.stats)
    .filter((s) => keys.includes(str(s.value)))
    .slice(0, MAX_DETAIL_STATS)
    .map((s, i) => ({ ...s, label: str(s.label) || humanize(str(s.value)), tint: tint(s.tint, cycle(TINT_CYCLE, i)) }))
  if (stats.length) config.stats = stats
  else delete config.stats

  const sections = asArr<Obj>(config.sections)
    .map((sec) => {
      if (sec.kind === 'fields') {
        const fields = asArr<Obj>(sec.fields).filter((f) => keys.includes(str(f.value)))
        return fields.length ? { ...sec, fields } : null
      }
      return sec
    })
    .filter((sec): sec is Obj => sec !== null)
    .slice(0, MAX_DETAIL_SECTIONS)
  if (sections.length) config.sections = sections
  else delete config.sections

  const avatarKey = str(header.avatar)
  const outRows = avatarKey && avatarKey !== 'initials'
    ? rows.map((r, i) => (typeof r[avatarKey] === 'string' && r[avatarKey] ? r : { ...r, [avatarKey]: animalPhoto(i) }))
    : rows
  return { config, rows: outRows }
}

/* --------------------- gallery / videos / documents ----------------------- */

function refineGallery(page: DraftPage, rows: Obj[], notes: string[]): { config: Obj; rows: Obj[] } {
  const config = { ...page.config }
  const keys = rowKeys(rows)
  const srcKey = keys.includes(str(config.srcKey)) ? str(config.srcKey) : 'src'
  const titleKey = keys.includes(str(config.titleKey)) ? str(config.titleKey) : 'title'
  config.srcKey = srcKey
  config.titleKey = titleKey
  if (config.groupBy !== undefined && !keys.includes(str(config.groupBy))) delete config.groupBy
  if (config.subtitleKey !== undefined && !keys.includes(str(config.subtitleKey))) delete config.subtitleKey
  let filled = 0
  const outRows = rows.map((r, i) => {
    const row = { ...r }
    if (typeof row[srcKey] !== 'string' || !row[srcKey]) {
      row[srcKey] = cycle(FALLBACK_IMAGES, i)
      filled++
    }
    return row
  })
  if (filled > 0) notes.push(`"${page.title}": filled ${filled} missing image(s) with library art`)
  return { config, rows: outRows }
}

function refineVideos(page: DraftPage, rows: Obj[], notes: string[]): { config: Obj; rows: Obj[] } {
  const config = { ...page.config }
  let channels = asArr<Obj>(config.channels)
    .map((c, i) => ({ id: str(c.id), label: str(c.label) || humanize(str(c.id)), tint: tint(c.tint, cycle(TINT_CYCLE, i)) }))
    .filter((c) => c.id)
  if (!channels.length) channels = [{ id: 'general', label: 'General', tint: 'blue' }]
  const kept = channels.slice(0, 6)
  config.channels = kept
  const ids = kept.map((c) => c.id)
  let fixed = 0
  const outRows = rows.map((r, i) => {
    const row = { ...r }
    if (!ids.includes(String(row.channel))) {
      row.channel = ids[0]
      fixed++
    }
    if (typeof row.thumb !== 'string' || !row.thumb) row.thumb = `/assets/videos/thumb-0${(i % 6) + 1}.jpg`
    row.durationSec = coerceNumber(row.durationSec, 300)
    return row
  })
  if (fixed > 0) notes.push(`"${page.title}": re-shelved ${fixed} video(s) onto declared channels`)
  return { config, rows: outRows }
}

function refineDocuments(page: DraftPage, rows: Obj[], notes: string[]): { config: Obj; rows: Obj[] } {
  const config = { ...page.config }
  let collections = asArr<Obj>(config.collections)
    .map((c, i) => ({ id: str(c.id), label: str(c.label) || humanize(str(c.id)), icon: str(c.icon, 'book-open'), tint: tint(c.tint, cycle(TINT_CYCLE, i)) }))
    .filter((c) => c.id)
  if (!collections.length) collections = [{ id: 'guides', label: 'Guides', icon: 'book-open', tint: 'blue' }]
  const kept = collections.slice(0, 6)
  config.collections = kept
  const ids = kept.map((c) => c.id)
  let fixed = 0
  const outRows = rows.map((r) => {
    const row = { ...r }
    if (!ids.includes(String(row.collection))) {
      row.collection = ids[0]
      fixed++
    }
    if (!Array.isArray(row.body) || row.body.length === 0) {
      row.body = [{ kind: 'p', text: str(row.excerpt, 'Drafted from your description.') }]
      fixed++
    }
    return row
  })
  if (fixed > 0) notes.push(`"${page.title}": filed ${fixed} document(s) into declared collections`)
  return { config, rows: outRows }
}

/* --------------------- timeline / checklist / schedule -------------------- */

function refineTimeline(page: DraftPage, rows: Obj[], notes: string[]): { config: Obj; rows: Obj[] } {
  const config = { ...page.config }
  const timeKey = str(config.timeKey, 'at')
  config.timeKey = timeKey
  config.titleKey = str(config.titleKey, 'title')
  config.bodyKey = str(config.bodyKey, 'detail')
  const kindKey = str(config.kindKey)
  const outRows = rows.map((r, i) => ({ ...r, [timeKey]: coerceDate(r[timeKey], i) }))
  if (kindKey) {
    const kinds = observed(outRows, kindKey)
    if (kinds.length) {
      const existing = asObj(config.kindTints)
      const kindTints: Record<string, TintName> = {}
      kinds.forEach((k, i) => {
        kindTints[k] = isTint(existing[k]) ? (existing[k] as TintName) : semanticTint(k, i)
      })
      config.kindTints = kindTints
    }
  }
  void notes
  return { config, rows: outRows }
}

function refineChecklist(page: DraftPage, rows: Obj[]): { config: Obj; rows: Obj[] } {
  const config = { ...page.config }
  config.groupKey = str(config.groupKey, 'section')
  config.labelKey = str(config.labelKey, 'item')
  return { config, rows }
}

function refineSchedule(page: DraftPage, rows: Obj[], notes: string[]): { config: Obj; rows: Obj[] } {
  const config = { ...page.config }
  let resources = asArr<Obj>(config.resources)
    .map((r) => ({ id: str(r.id), name: str(r.name) || humanize(str(r.id)), ...(r.role ? { role: str(r.role) } : {}) }))
    .filter((r) => r.id)
  if (resources.length < 2) {
    notes.push(`"${page.title}": fewer than 2 people on the rota — restored a standard team`)
    resources = [
      { id: 'r-1', name: 'Alex Rivera', role: 'Coordinator' },
      { id: 'r-2', name: 'Sam Lee', role: 'Specialist' },
      { id: 'r-3', name: 'Jo Patel', role: 'Lead' },
    ]
  }
  const keptRes = resources.slice(0, MAX_RESOURCES)
  config.resources = keptRes
  const resIds = keptRes.map((r) => r.id)

  const eventTypes = asObj(config.eventTypes)
  const types: Record<string, Obj> = {}
  Object.entries(eventTypes).forEach(([k, v], i) => {
    types[k] = { label: str(asObj(v).label) || humanize(k), tint: tint(asObj(v).tint, cycle(TINT_CYCLE, i)) }
  })
  if (!Object.keys(types).length) types.shift = { label: 'Shift', tint: 'blue' }
  config.eventTypes = types
  const typeIds = Object.keys(types)

  let fixed = 0
  const outRows = rows.map((r, i) => {
    const row = { ...r }
    if (!resIds.includes(String(row.personId))) {
      row.personId = cycle(resIds, i)
      fixed++
    }
    row.date = coerceDate(row.date, i)
    if (typeof row.start !== 'string' || !/^\d{2}:\d{2}$/.test(row.start)) row.start = cycle(['08:30', '10:00', '13:00', '15:30'], i)
    row.durationMin = coerceNumber(row.durationMin, 60)
    if (!typeIds.includes(String(row.type))) row.type = typeIds[0]
    return row
  })
  if (fixed > 0) notes.push(`"${page.title}": re-assigned ${fixed} event(s) to people on the rota`)
  return { config, rows: outRows }
}

/* --------------------------------- the pass ------------------------------- */

// One generated draft in, one standard draft out — same shape, plus the list of everything that was aligned…
export function refineDraft(input: LocalDraft): { draft: LocalDraft; notes: string[] } {
  const notes: string[] = []
  const name = str(input.name, 'Custom app')
  const pages = asArr<DraftPage>(input.pages).map((page) => {
    const p: DraftPage = {
      id: str(page.id, 'main'),
      type: page.type,
      title: str(page.title, 'Page'),
      config: { ...asObj(page.config) },
      rows: asArr<Obj>(page.rows),
    }
    let rows = trimRows(p, notes)
    // dashboards pad BEFORE the widget pass: generateRows ignores the config for them (no phantom-key risk), and a…
    if (p.type === 'dashboard') rows = padRows(p.type as PageType, p.title, p.config, rows, notes)
    let out: { config: Obj; rows: Obj[] }
    switch (p.type as PageType) {
      case 'sheet':
        out = refineSheet(p, rows, notes)
        break
      case 'board':
      case 'pipeline':
        out = refineStaged(p, rows, notes)
        break
      case 'dashboard':
        out = refineDashboard(p, rows, name, notes)
        break
      case 'detail':
        out = refineDetail(p, rows)
        break
      case 'gallery':
        out = refineGallery(p, rows, notes)
        break
      case 'videos':
        out = refineVideos(p, rows, notes)
        break
      case 'documents':
        out = refineDocuments(p, rows, notes)
        break
      case 'timeline':
        out = refineTimeline(p, rows, notes)
        break
      case 'checklist':
        out = refineChecklist(p, rows)
        break
      case 'schedule':
        out = refineSchedule(p, rows, notes)
        break
      default:
        out = { config: p.config, rows }
    }
    const padded = padRows(p.type as PageType, p.title, out.config, out.rows, notes)
    // the tag tintBy is derived from the FINAL rows — the padding generator cycles priorities, and a value it adds…
    let config = out.config
    if (p.type === 'board' || p.type === 'pipeline') {
      const cf = asObj(config.cardFields)
      const tags = asObj(cf.tags)
      const tagKey = str(tags.key)
      if (tagKey) {
        const existing = asObj(tags.tintBy)
        const tintBy: Record<string, TintName> = {}
        observed(padded, tagKey).forEach((v, i) => {
          tintBy[v] = isTint(existing[v]) ? (existing[v] as TintName) : semanticTint(v, i)
        })
        config = { ...config, cardFields: { ...cf, tags: { ...tags, tintBy } } }
      }
    }
    return { ...p, config, rows: padded }
  })

  return {
    draft: {
      name,
      tagline: str(input.tagline),
      icon: str(input.icon, 'rocket'),
      accent: str(input.accent, 'lavender'),
      category: str(input.category, 'Workspace'),
      pages,
    },
    notes,
  }
}
