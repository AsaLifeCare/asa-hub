// Sheet import scaffold — the deterministic half of "paste a Sheets URL, get an app".
// Zero LLM: plain heuristics over the tab's headers and (when the import already landed and rows can be sampled)…
import type { Column } from '@/engine/templates/sheet/types'
import type { TintName } from '@/engine/types'

type Rows = Record<string, unknown>[]

/** One page the scaffold proposes; the modal renders these as checkboxes. */
export type ScaffoldPage = {
  id: string
  type: 'sheet' | 'dashboard' | 'board'
  title: string
  config: Record<string, unknown>
}

export type SheetScaffold = {
  /** sheet page columns, rich kinds + labels humanized from the headers */
  columns: Column[]
  /** sheet page `config.stats` tiles (total / per-value counts / recent dates) */
  stats: Record<string, unknown>[]
  // sheet page `config.detailPanel` — the working form of a `detail` page: a standalone detail page gets no record…
  detailPanel: Record<string, unknown>
  /** dashboard page widgets, null when nothing meaningful can be computed */
  dashboardWidgets: Record<string, unknown>[] | null
  /** board page config, null unless a stage-like chip column was found */
  board: { stageField: string; stages: { id: string; label: string; tint: TintName }[] } | null
}

export type ScaffoldSelection = { detailPanel: boolean; dashboard: boolean; board: boolean }

/* ------------------------------ text helpers ------------------------------ */

/** "first_name" / "dueDate" / "qtde-itens" → "First Name" / "Due Date". */
export function humanize(header: string): string {
  const words = header
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  if (words.length === 0) return header.trim() || 'Column'
  return words.map((w) => (w.length <= 2 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ')
}

/** Lowercased alphanumerics — the matching form of a header ("Due Date" → "duedate"). */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/* --------------------------- name-based hints ----------------------------- */

const NAME_DATE = /(date|due|deadline|start|end|expir|when|day|birth|nascimento|vencimento|prazo|_at$|_on$)/
const NAME_NUMBER = /(count|qty|quantity|amount|total|price|cost|score|age|salary|budget|number|hours|rate|valor|quantidade|idade|num)/
const NAME_PROGRESS = /(progress|completion|percent|pct|%)/
const NAME_PHOTO = /(photo|avatar|image|picture|foto|img|logo)/
const NAME_EMAIL = /(e?mail)/
const NAME_PHONE = /(phone|mobile|tel|whatsapp|telefone|celular)/
const NAME_URL = /(url|link|website|site)/
const NAME_DOC = /(file|document|doc|attachment|pdf|drive|anexo|arquivo)/
const NAME_CHIP = /(status|stage|state|phase|priority|type|category|kind|level|tier|severity|situacao|etapa|prioridade|categoria|tipo)/
const NAME_CHIPS = /(tags|labels|skills|members|assignees|teams|depart)/
const NAME_PERSON = /(name|person|owner|assignee|candidate|employee|client|customer|contact|member|lead|responsible|nome|cliente)/
/** Stage-like column names — a board groups by these. */
const NAME_STAGE = /(status|stage|phase|column|kanban|step|etapa|situacao)/

/* --------------------------- value classification -------------------------- */

const RE_ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/
const RE_SLASH_DATE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/
const RE_NUMBER = /^-?[$€£]?\s?\d{1,3}(,?\d{3})*(\.\d+)?\s?%?$/
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const RE_URL = /^https?:\/\/\S+$/i
const RE_IMAGE_URL = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i

/** Phone-ish: 7+ digits once spaces/punctuation are stripped, nothing else. */
const isPhoneValue = (v: string) => {
  const digits = v.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15 && /^[+()\d][\d\s().-]*$/.test(v)
}

const isDateValue = (v: string) => {
  if (RE_ISO_DATE.test(v) || RE_SLASH_DATE.test(v)) return true
  // month-name dates ("Mar 4, 2026") — Date.parse only, so plain numbers and day names never drift into a date…
  return /[a-z]/i.test(v) && !RE_URL.test(v) && !isNaN(Date.parse(v))
}

/** Non-empty string values of one column across the sample, capped. */
function sampleValues(rows: Rows, key: string, cap = 60): string[] {
  const out: string[] = []
  for (const r of rows) {
    const v = r[key]
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (s) out.push(s)
    if (out.length >= cap) break
  }
  return out
}

/** ≥80% of the observed values pass `test` (and at least one was observed). */
const mostly = (values: string[], test: (v: string) => boolean) =>
  values.length > 0 && values.filter(test).length / values.length >= 0.8

/** Distinct observed values in first-appearance order, capped. */
function distinct(values: string[], cap = 8): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
    if (out.length > cap) return out // over the cap — report cap+1 so callers can tell
  }
  return out
}

/* ------------------------------ chip tinting ------------------------------- */

/** Semantic tints for values that read as workflow states; anything else cycles. */
const STATUS_TINTS: [RegExp, TintName][] = [
  [/^(done|complete[sd]?|approved|active|paid|published|won|conclu|aprova|ativo|pago)/, 'mint'],
  [/^(in progress|in review|review|doing|ongoing|scheduled|andamento)/, 'blue'],
  [/^(to ?do|backlog|new|open|planned|draft|novo|aberto)/, 'lavender'],
  [/^(pending|waiting|on hold|paused|hold|pendente|aguard)/, 'amber'],
  [/^(blocked|cancelled|canceled|overdue|inactive|rejected|lost|late|atras|cancel|inativo|reprov)/, 'pink'],
]
const CHIP_CYCLE: TintName[] = ['blue', 'mint', 'lavender', 'amber', 'peach', 'pink']

export function tintFor(value: string, index: number): TintName {
  const v = value.trim().toLowerCase()
  for (const [re, tint] of STATUS_TINTS) if (re.test(v)) return tint
  return CHIP_CYCLE[index % CHIP_CYCLE.length]
}

const tintByFor = (values: string[]): Record<string, TintName> =>
  Object.fromEntries(values.map((v, i) => [v, tintFor(v, i)]))

/* ------------------------------ column kinds ------------------------------- */

type KindHint = {
  kind: Column['kind']
  icon?: string
  expiry?: boolean
  /** observed distinct values (chip columns only, ≤8) */
  values?: string[]
  list?: boolean
}

// Pick the kind for one column: observed values win, the header name breaks ties and decides everything when no…
function inferKind(header: string, values: string[]): KindHint {
  const name = norm(header)
  const has = values.length > 0

  // identity channels first — a phone number is numeric-shaped, an email is not text-worthy
  if ((has && mostly(values, (v) => RE_EMAIL.test(v))) || (!has && NAME_EMAIL.test(name)))
    return { kind: 'text', icon: 'mail' }
  // dates before phones: "2026-08-01" matches the phone shape (digits + dashes), and it is never a phone number
  if ((has && mostly(values, isDateValue)) || (!has && NAME_DATE.test(name)))
    return { kind: 'date', expiry: /(due|deadline|expir|vencimento|prazo)/.test(name) || undefined }
  if ((has && mostly(values, isPhoneValue)) || (!has && NAME_PHONE.test(name)))
    return { kind: 'text', icon: 'phone' }
  if (has && mostly(values, (v) => RE_IMAGE_URL.test(v))) return { kind: 'image' }
  if (has && mostly(values, (v) => RE_URL.test(v)))
    return NAME_DOC.test(name) ? { kind: 'doc' } : { kind: 'text', icon: 'link' }
  if (!has && NAME_PHOTO.test(name)) return { kind: 'image' }
  if (!has && NAME_DOC.test(name) && NAME_URL.test(name)) return { kind: 'doc' }

  if (has && mostly(values, (v) => RE_NUMBER.test(v))) {
    const numeric = values.map((v) => Number(v.replace(/[$€£,%\s]/g, '')))
    // progress bars read 0–1; a 0–100 percent column lies on one, so it stays a number
    if (NAME_PROGRESS.test(name) && numeric.every((n) => isFinite(n) && n >= 0 && n <= 1)) return { kind: 'progress' }
    return { kind: 'number' }
  }
  if (!has && NAME_NUMBER.test(name)) return { kind: NAME_PROGRESS.test(name) ? 'progress' : 'number' }

  // comma/semicolon lists — the engine caps long chips with a tooltip
  const listy = has && values.filter((v) => /[,;]/.test(v)).length / values.length >= 0.5
  if (listy || (!has && NAME_CHIPS.test(name))) return { kind: 'chips', list: true }

  // low-cardinality columns become chips: ≤8 distinct values over the sample, or a status-ish name even with no…
  if (has) {
    const vals = distinct(values)
    const ratio = vals.length / values.length
    if (vals.length <= 8 && (vals.length <= 2 || ratio <= 0.5 || NAME_CHIP.test(name)))
      return { kind: 'chip', values: vals }
  } else if (NAME_CHIP.test(name)) return { kind: 'chip' }

  return { kind: 'text' }
}

/** Per-kind leading icon for detail fields and stat tiles. */
const FIELD_ICON: Record<string, string> = {
  date: 'calendar-days',
  number: 'hash',
  progress: 'loader-pinwheel',
  chip: 'tag',
  chips: 'tags',
  image: 'image',
  doc: 'file-text',
  text: 'circle',
}

/* ------------------------------- inference --------------------------------- */

// Headers + sampled rows → typed columns.
export function inferColumns(headers: string[], rows: Rows): Column[] {
  const keys = headers.map((h) => h.trim()).filter(Boolean)
  const hints = keys.map((k) => inferKind(k, sampleValues(rows, k)))

  // person pairing: a name-ish text column + a photo-ish column → avatar+text (the photo column stays an image; the…
  const photoIdx = keys.findIndex((k, i) => hints[i].kind === 'image' && NAME_PHOTO.test(norm(k)))
  const nameIdx = keys.findIndex((k, i) => hints[i].kind === 'text' && NAME_PERSON.test(norm(k)))
  if (photoIdx >= 0 && nameIdx >= 0) hints[nameIdx] = { ...hints[nameIdx], kind: 'avatar+text' }

  // exactly one primary: the person column, else the first free-text column
  let primaryIdx = hints.findIndex((h) => h.kind === 'avatar+text')
  if (primaryIdx < 0) primaryIdx = hints.findIndex((h) => h.kind === 'text' && !h.icon)
  if (primaryIdx < 0) primaryIdx = hints.findIndex((h) => h.kind === 'text')

  return keys.map((k, i) => {
    const h = hints[i]
    const col: Column = { key: k, label: humanize(k), kind: h.kind }
    if (i === primaryIdx) col.primary = true
    if (h.icon) col.icon = h.icon
    if (h.expiry) col.expiry = true
    if (h.values && h.kind === 'chip') col.tintBy = tintByFor(h.values)
    if (h.kind === 'doc') col.urlKey = k
    if (h.kind === 'text' && !h.icon) {
      const vals = sampleValues(rows, k, 30)
      const avg = vals.length ? vals.reduce((n, v) => n + v.length, 0) / vals.length : 0
      if (avg > 80) {
        col.wrap = 2
        col.maxWidth = 360
      }
    }
    return col
  })
}

/* ------------------------------- scaffold ---------------------------------- */

const MAX_CHIP_STATS = 4
const MAX_BOARD_STAGES = 8

// The chip column a board could group by: stage-like name, or observed values that read as workflow states ("todo /…
function findStageColumn(columns: Column[]): Column | null {
  for (const col of columns) {
    if (col.kind !== 'chip') continue
    const values = Object.keys(col.tintBy ?? {})
    if (values.length < 2 || values.length > MAX_BOARD_STAGES) continue
    if (NAME_STAGE.test(norm(col.key))) return col
    const stagish = values.filter((v) => STATUS_TINTS.some(([re]) => re.test(v.trim().toLowerCase())))
    if (stagish.length >= Math.ceil(values.length / 2)) return col
  }
  return null
}

// The full multi-page proposal.
export function buildScaffold(headers: string[], rows: Rows): SheetScaffold | null {
  const keys = headers.map((h) => h.trim()).filter(Boolean)
  if (keys.length === 0) {
    // inspect saw no headers but the import has rows — take the first row's keys
    const first = rows.find((r) => r && typeof r === 'object')
    if (!first) return null
    keys.push(...Object.keys(first).filter((k) => k !== 'id' && !k.startsWith('_')))
  }
  if (keys.length === 0) return null

  const columns = inferColumns(keys, rows)
  const primary = columns.find((c) => c.primary) ?? columns[0]
  const chips = columns.filter((c) => c.kind === 'chip')
  const firstChip = chips.find((c) => Object.keys(c.tintBy ?? {}).length > 0) ?? chips[0]
  const firstDate = columns.find((c) => c.kind === 'date')
  const numbers = columns.filter((c) => c.kind === 'number' || c.kind === 'progress')

  // sheet stat tiles: total → per-value counts of the first chip column → recent-date count (withinDays counts…
  const stats: Record<string, unknown>[] = [{ label: 'Total', tint: 'blue' }]
  const chipVals = firstChip ? Object.keys(firstChip.tintBy ?? {}) : []
  if (firstChip && chipVals.length > 0) {
    for (const v of chipVals.slice(0, MAX_CHIP_STATS)) {
      stats.push({ label: humanize(v), tint: firstChip.tintBy?.[v] ?? 'blue', filter: { key: firstChip.key, equals: v } })
    }
  }
  if (firstDate) stats.push({ label: `${firstDate.label} · last 30d`, tint: 'amber', withinDays: { key: firstDate.key, days: 30 } })

  /* the record panel a row click opens (see SheetScaffold.detailPanel) */
  const photoCol = columns.find((c) => c.kind === 'image' && norm(c.key) === 'avatar')
  const detailPanel: Record<string, unknown> = {
    header: {
      title: primary.key,
      subtitle: columns.find((c) => c !== primary && c.kind === 'text' && !c.icon)?.key,
      avatar: photoCol ? photoCol.key : 'initials',
      ...(firstChip ? { statusChip: { field: firstChip.key, tintBy: firstChip.tintBy } } : {}),
    },
    stats: [...numbers, ...(firstDate && !numbers.includes(firstDate) ? [firstDate] : [])]
      .slice(0, 4)
      .map((c, i) => ({ label: c.label, value: c.key, icon: FIELD_ICON[c.kind] ?? 'hash', tint: CHIP_CYCLE[i % CHIP_CYCLE.length] })),
    sections: [
      {
        kind: 'fields',
        title: 'Details',
        fields: columns
          .filter((c) => c !== primary)
          .slice(0, 12)
          .map((c) => ({ icon: c.icon ?? FIELD_ICON[c.kind] ?? 'circle', label: c.label, value: c.key })),
      },
    ],
  }

  // dashboard: worth generating only when a widget beyond the bare total can be computed — a grid with one tile is…
  const dashboardWidgets: Record<string, unknown>[] = []
  dashboardWidgets.push({ kind: 'stat', label: 'Total', tint: 'blue', from: {} })
  if (firstChip && chipVals.length > 0) {
    for (const v of chipVals.slice(0, MAX_CHIP_STATS)) {
      dashboardWidgets.push({ kind: 'stat', label: humanize(v), tint: firstChip.tintBy?.[v] ?? 'blue', from: { where: [{ field: firstChip.key, eq: v }] } })
    }
    dashboardWidgets.push({
      kind: 'donut',
      title: `By ${firstChip.label}`,
      centerLabel: 'records',
      from: { groupBy: firstChip.key, order: chipVals, tintBy: firstChip.tintBy },
    })
  }
  if (firstDate) {
    dashboardWidgets.push({
      kind: 'list',
      title: 'Latest',
      span: 2,
      from: {
        sortBy: firstDate.key,
        desc: true,
        limit: 5,
        titleField: primary.key,
        metaFields: [firstChip?.key ?? firstDate.key].filter(Boolean),
      },
    })
  }
  const dashboard = dashboardWidgets.length > 1 ? dashboardWidgets : null

  // board: only with a stage column AND a `title` column — the card face reads rec.title literally, so anything…
  const stageCol = findStageColumn(columns)
  const hasTitle = columns.some((c) => norm(c.key) === 'title')
  const board =
    stageCol && hasTitle
      ? {
          stageField: stageCol.key,
          stages: Object.keys(stageCol.tintBy ?? {}).map((v) => ({ id: v, label: humanize(v), tint: stageCol.tintBy?.[v] ?? 'blue' })),
        }
      : null

  return { columns, stats: stats.slice(0, 6), detailPanel, dashboardWidgets: dashboard, board }
}

// Assemble the pages for the checked boxes.
export function scaffoldPages(scaffold: SheetScaffold, sel: ScaffoldSelection, appName: string): ScaffoldPage[] {
  const sheetConfig: Record<string, unknown> = {
    entity: ['record', 'records'],
    searchable: true,
    exportable: true,
    columns: scaffold.columns,
    stats: scaffold.stats,
  }
  if (sel.detailPanel) sheetConfig.detailPanel = scaffold.detailPanel

  const pages: ScaffoldPage[] = [{ id: 'main', type: 'sheet', title: appName, config: sheetConfig }]
  if (sel.dashboard && scaffold.dashboardWidgets) {
    pages.push({ id: 'dashboard', type: 'dashboard', title: 'Overview', config: { widgets: scaffold.dashboardWidgets } })
  }
  if (sel.board && scaffold.board) {
    pages.push({ id: 'board', type: 'board', title: 'Board', config: { stages: scaffold.board.stages, stageField: scaffold.board.stageField } })
  }
  return pages
}
