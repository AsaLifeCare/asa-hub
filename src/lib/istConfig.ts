// THE IST LANE'S CONFIGURATION, ON THIS SIDE OF THE WIRE.
// The living copy is the `ist_config` tab (apps-script/IstConfig.gs).
import { gasAction } from '@/features/hiring/shared'
import {
  IST_CONFIG_SHIPPED, IST_CONFIG_SPEC, IST_CONFIG_TAB, IST_CONFIG_TINTS, IST_STATUS_DONE,
  IST_STATUS_OWED, cfgBits, cfgCatalogueOf, cfgIntValue, cfgPairsOf, cfgPartnerRefused, cfgResolveOne,
  cfgSaveProblems, cfgUsesCatalogue, resolveIstValues,
} from './istConfigDeclaration'

export {
  IST_CONFIG_GROUPS, IST_CONFIG_KEYS, IST_CONFIG_SHIPPED, IST_CONFIG_SPEC, IST_CONFIG_TAB,
  IST_CONFIG_TINTS, IST_STATUS_DONE, IST_STATUS_OWED, TINT_BG, TINT_CHIP, TINT_FG,
  cfgCatalogueOf, cfgCheck, cfgIntValue, cfgPairsOf, cfgResolveOne, cfgSaveProblems, resolveIstValues,
  type IstGroup, type IstKeySpec, type IstKeyType,
} from './istConfigDeclaration'

/** sheet or mirror — the tab answered. Everything else is a degraded answer, said aloud. */
export type IstConfigSource = 'sheet' | 'mirror' | 'last known' | 'shipped' | 'unreachable'

export type IstConfig = {
  /** Resolved: the cell when it holds something usable, the shipped value otherwise. */
  values: Record<string, string>
  source: IstConfigSource
  /** true whenever the values on screen are not the ones in the tab. */
  blind: boolean
  /** The sentence a screen shows. Empty when nothing is wrong. */
  reason: string
  /** Rows typed into the tab that this version does not read. */
  unknown: { key: string; value: string }[]
  /** Cells the declaration refused — each answers its shipped value. */
  problems: Record<string, string>
  tab: string
}

export const IST_CONFIG_FALLBACK: IstConfig = {
  values: IST_CONFIG_SHIPPED,
  source: 'unreachable',
  blind: true,
  reason:
    'The IST settings could not be read, so this screen is showing the columns it ships with. ' +
    'Nothing about who owes a training changed — a settings read that failed is not a person ' +
    'without training.',
  unknown: [],
  problems: {},
  tab: IST_CONFIG_TAB,
}

const blindOf = (source: IstConfigSource) => source !== 'sheet' && source !== 'mirror'

// ------------------------------------------------------------------ THE SHARED READ…

type Answer = {
  rows?: { key?: string; value?: string; problem?: string }[]
  unknown_rows?: { key?: string; value?: string }[]
  tab?: string
  source?: string
  blind?: boolean
  blind_reason?: string
}

let inFlight: Promise<IstConfig> | null = null
let cached: IstConfig | null = null
let fetchedAt = 0

// How long a read is reused.
export const IST_CONFIG_FRESH_MS = 3 * 60_000

/** The sentence a save says about when other screens follow — from the window above. */
export const IST_CONFIG_FOLLOW =
  `This screen already shows it; other open screens follow within ${IST_CONFIG_FRESH_MS / 60_000} minutes. ` +
  'The first-shift rules on the relay follow once the sheet mirror has copied the tab. No publish needed.'

export function fetchIstConfig(opts?: { force?: boolean }): Promise<IstConfig> {
  if (!opts?.force) {
    if (inFlight) return inFlight
    if (cached && Date.now() - fetchedAt < IST_CONFIG_FRESH_MS) return Promise.resolve(cached)
  }
  inFlight = gasAction<Answer>('istConfigGet', {})
    .then((d) => {
      const raw: Record<string, string> = {}
      for (const r of d?.rows ?? []) {
        const k = String(r?.key ?? '')
        if (k) raw[k] = String(r?.value ?? '')
      }
      // the backend already resolved blank and refused → shipped; this is the second belt
      const { values, problems } = resolveIstValues(raw)
      for (const r of d?.rows ?? []) {
        const k = String(r?.key ?? '')
        if (k && r?.problem) problems[k] = String(r.problem)
      }
      const source = (d?.source ?? 'sheet') as IstConfigSource
      const out: IstConfig = {
        values,
        source,
        blind: d?.blind === true || blindOf(source),
        reason: String(d?.blind_reason ?? ''),
        unknown: (d?.unknown_rows ?? []).map((r) => ({
          key: String(r?.key ?? ''), value: String(r?.value ?? ''),
        })).filter((r) => !!r.key),
        problems,
        tab: String(d?.tab ?? IST_CONFIG_TAB),
      }
      cached = out
      fetchedAt = Date.now()
      return out
    })
    .catch(() => {
      // the door did not answer or refused this role: the copy already held, else the declared values
      return cached ?? IST_CONFIG_FALLBACK
    })
    .finally(() => { inFlight = null })
  return inFlight
}

// THE BUNDLE'S COPY — `config.ist` from the relay's /bundle: the mirror's cells, resolved against the same…
export function seedIstConfig(block: {
  values?: Record<string, string>; problems?: Record<string, string>; unknown?: string[]; tab?: string
} | null | undefined): boolean {
  if (!block || !block.values || typeof block.values !== 'object') return false
  // a fresher answer from the door (a save just read back) outranks the mirror's copy
  if (cached && cached.source !== 'mirror' && !cached.blind
      && Date.now() - fetchedAt < IST_CONFIG_FRESH_MS) return false
  const { values, problems } = resolveIstValues(block.values)
  cached = {
    values,
    source: 'mirror',
    blind: false,
    reason: '',
    unknown: (block.unknown ?? []).map((key) => ({ key: String(key), value: '' })),
    problems: { ...problems, ...(block.problems ?? {}) },
    tab: String(block.tab ?? IST_CONFIG_TAB),
  }
  fetchedAt = Date.now()
  return true
}

/** A save just landed — the next read must not be the copy from before it. */
export function dropIstConfigCache(): void {
  cached = null
  fetchedAt = 0
}

// SAVE CELLS, then read them back from the door.
export async function saveIstConfig(values: Record<string, string>,
  stored?: Record<string, string>): Promise<IstConfig> {
  const refused = cfgSaveProblems(values, stored ?? cached?.values ?? {})
  if (refused.length) throw new Error(`Not saved — ${refused.join(' · ')}`)
  await gasAction('istConfigSet', { values })
  dropIstConfigCache()
  return fetchIstConfig({ force: true })
}

// ------------------------------------------------------------------ THE PARSERS — every one falls back to the…

/** One cell as text, as the declaration resolves it: itself, its usable entries, or the shipped value. */
export function cfgText(cfg: IstConfig, key: string): string {
  if (!IST_CONFIG_SPEC[key]) return String(cfg.values[key] ?? '').trim()
  const catalogue = cfgUsesCatalogue(key) || IST_CONFIG_SPEC[key].falls_back_with
    ? cfgCatalogueOf(cfg.values) : undefined
  if (catalogue && cfgPartnerRefused(cfg.values, key, catalogue)) return IST_CONFIG_SHIPPED[key]
  return cfgResolveOne(key, cfg.values[key], catalogue).value
}

export function cfgList(cfg: IstConfig, key: string): string[] {
  const out = cfgBits(cfgText(cfg, key))
  return out.length ? out : cfgBits(IST_CONFIG_SHIPPED[key] ?? '')
}

// `a=b, c=d` (or `a:b`) in the order written.
export function cfgPairs(cfg: IstConfig, key: string): { keys: string[]; map: Record<string, string> } {
  return cfgPairsOf(cfgText(cfg, key)) ?? cfgPairsOf(IST_CONFIG_SHIPPED[key] ?? '') ?? { keys: [], map: {} }
}

/** A whole number inside the declared range (or the one given), else the shipped value. */
export function cfgInt(cfg: IstConfig, key: string, min?: number, max?: number): number {
  const spec = IST_CONFIG_SPEC[key]
  const lo = min ?? spec?.min ?? Number.NEGATIVE_INFINITY
  const hi = max ?? spec?.max ?? Number.POSITIVE_INFINITY
  const fallback = Number.parseInt(IST_CONFIG_SHIPPED[key] ?? '', 10)
  const n = cfgIntValue(key, cfgText(cfg, key))
  if (n === null || n < lo || n > hi) return Number.isFinite(fallback) ? fallback : (min ?? 0)
  return n
}

export function cfgYes(cfg: IstConfig, key: string): boolean {
  return cfgText(cfg, key).toLowerCase() === 'yes'
}

/** A colour map from a tints cell; a state without a usable colour keeps its shipped one. */
export function cfgTints(cfg: IstConfig, key: string): Record<string, string> {
  const shipped = cfgPairsOf(IST_CONFIG_SHIPPED[key] ?? '')?.map ?? {}
  const { keys, map } = cfgPairs(cfg, key)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(shipped)) out[k] = String(v).toLowerCase()
  for (const k of keys) {
    const tint = String(map[k] ?? '').toLowerCase()
    out[k] = IST_CONFIG_TINTS.includes(tint) ? tint : (out[k] ?? 'lavender')
  }
  return out
}

// THE CERTIFICATION COLOURS OF ONE SCREEN.
export function certStateTints<T>(cfg: IstConfig, own: Record<string, T>, paint: (tint: string) => T):
  Record<string, T> {
  const now = cfgTints(cfg, 'ist_cert_status_tints')
  const was = cfgPairsOf(IST_CONFIG_SHIPPED.ist_cert_status_tints)?.map ?? {}
  const out: Record<string, T> = { ...own }
  for (const [state, tint] of Object.entries(now)) {
    if (tint && tint !== String(was[state] ?? '').toLowerCase()) out[state] = paint(tint)
  }
  return out
}

// HOW FAR AHEAD COUNTS AS "EXPIRING", in days.
export function expiringDays(cfg: IstConfig): number {
  return cfgInt(cfg, 'ist_cert_expiring_days')
}

/** A day as YYYY-MM-DD by the Ohio clock — the day an IST lapse is counted on, as on the relay. */
export function ohioDay(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

const dayNumber = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : Number.NaN
}

// IS THIS IST ROW STILL OWED?
export function istRowOwed(
  row: { status?: string; trainedAt?: string | null }, cfg: IstConfig, now: Date = new Date(),
): boolean {
  const at = String(row.trainedAt ?? '').trim()
  const done = String(row.status ?? '').trim().toLowerCase() === IST_STATUS_DONE || !!at
  if (!done) return true
  const days = cfgInt(cfg, 'ist_valid_days')
  if (!days || !at) return false
  const when = dayNumber(at.slice(0, 10))
  if (Number.isNaN(when)) return false
  return dayNumber(ohioDay(now)) > when + days
}

/** Rows as the IST table files them: a completed IST that lapsed reads as owed. */
export function istRowsAsFiled<R extends { status?: unknown; trainedAt?: unknown }>(
  rows: R[], cfg: IstConfig, now: Date = new Date(),
): R[] {
  return rows.map((r) => {
    const row = { status: String(r.status ?? ''), trainedAt: String(r.trainedAt ?? '') }
    const done = row.status.trim().toLowerCase() === IST_STATUS_DONE || !!row.trainedAt.trim()
    return done && istRowOwed(row, cfg, now) ? { ...r, status: IST_STATUS_OWED } : r
  })
}

// ------------------------------------------------------------------ THE OVERLAYS — a shipped schema, plus what the…

/** A course column as the two bespoke compliance screens hold one. */
export type CertScreenColumn = { key: string; label: string; certId: string }

// THE COURSE COLUMNS OF A BESPOKE SCREEN — Workforce Compliance's roster and the Certifications Dashboard.
export function certScreenColumns(
  shipped: readonly CertScreenColumn[], cfg: IstConfig,
): CertScreenColumn[] {
  const byKey = new Map(shipped.map((c) => [c.key, c]))
  const catalogue = cfgPairs(cfg, 'ist_cert_labels')
  const keys: string[] = []
  for (const k of catalogue.keys) if (k && !keys.includes(k)) keys.push(k)
  for (const c of shipped) if (!keys.includes(c.key)) keys.push(c.key)
  if (!keys.length) return [...shipped]

  const floor: IstConfig = { ...cfg, values: IST_CONFIG_SHIPPED }
  const shortNow = cfgPairs(cfg, 'ist_matrix_labels').map
  const shortWas = cfgPairs(floor, 'ist_matrix_labels').map
  const longNow = catalogue.map
  const longWas = cfgPairs(floor, 'ist_cert_labels').map

  return keys.map((key) => {
    const base = byKey.get(key)
    const edited =
      (shortNow[key] && shortNow[key] !== shortWas[key] ? shortNow[key] : '') ||
      (longNow[key] && longNow[key] !== longWas[key] ? longNow[key] : '')
    if (base) return edited ? { ...base, label: edited } : base
    // a course the screen does not ship: `cert-<key>` is how every record is keyed already
    return { key, label: shortNow[key] || longNow[key] || key, certId: `cert-${key}` }
  })
}

type Col = Record<string, unknown> & { key?: string; label?: string }
type Cfg = Record<string, unknown>

// THE IST RECORDS TABLE.
export function istRecordsConfig(shipped: Cfg, cfg: IstConfig): Cfg {
  const shippedCols = Array.isArray(shipped.columns) ? (shipped.columns as Col[]) : []
  if (!shippedCols.length) return shipped
  const byKey = new Map(shippedCols.map((c) => [String(c.key ?? ''), c]))

  const { keys, map } = cfgPairs(cfg, 'ist_columns')
  const columns: Col[] = keys.map((key) => {
    const base = byKey.get(key)
    const label = map[key] || String(base?.label ?? key)
    return base ? { ...base, label } : { key, label, kind: 'text' }
  })
  if (!columns.length) return shipped

  const tints = cfgTints(cfg, 'ist_status_tints')
  const statuses = cfgList(cfg, 'ist_statuses')
  const withTints = columns.map((c) =>
    c.key === 'status' ? { ...c, tintBy: tints } : c)

  const filters = Array.isArray(shipped.filters) ? (shipped.filters as Cfg[]) : []
  const nextFilters = filters.map((f) =>
    f.key === 'status' ? { ...f, options: statuses } : f)

  return {
    ...shipped,
    columns: withTints,
    filters: nextFilters,
    pagination: { ...(shipped.pagination as Cfg ?? {}), pageSize: cfgInt(cfg, 'ist_page_size') },
  }
}

// THE COMPLIANCE MATRIX.
export function certMatrixConfig(shipped: Cfg, cfg: IstConfig): Cfg {
  const shippedCols = Array.isArray(shipped.columns) ? (shipped.columns as Col[]) : []
  if (!shippedCols.length) return shipped

  const spine = shippedCols.filter((c) => c.key === 'name' || c.key === 'attention')
  const template = shippedCols.find((c) => c.key !== 'name' && c.key !== 'attention')
  if (!template || spine.length < 2) return shipped

  const courses = cfgList(cfg, 'ist_matrix_columns')
  if (!courses.length) return shipped
  const short = cfgPairs(cfg, 'ist_matrix_labels').map
  const long = cfgPairs(cfg, 'ist_cert_labels').map
  const labelOf = (k: string) => short[k] || long[k] || k

  const byKey = new Map(shippedCols.map((c) => [String(c.key ?? ''), c]))
  const courseCols: Col[] = courses.map((k) => {
    const base = byKey.get(k) ?? template
    const own = (base.tintBy ?? {}) as Record<string, string>
    return { ...base, key: k, label: labelOf(k), tintBy: certStateTints(cfg, own, (t) => t) }
  })

  const name = spine.find((c) => c.key === 'name') as Col
  const attention = spine.find((c) => c.key === 'attention') as Col

  // A FILTER FOR A COLUMN THAT IS NO LONGER THERE goes with it.
  const filters = Array.isArray(shipped.filters) ? (shipped.filters as Col[]) : []
  const courseSet = new Set(courses)
  const catalogue = new Set(cfgPairs(cfg, 'ist_cert_labels').keys)
  const nextFilters = filters.filter((f) => {
    const k = String(f.key ?? '')
    return !catalogue.has(k) || courseSet.has(k)
  })

  const detail = shipped.detailPanel as Cfg | undefined
  let nextDetail = detail
  if (detail && Array.isArray(detail.sections)) {
    nextDetail = {
      ...detail,
      sections: (detail.sections as Cfg[]).map((s) => {
        if (!Array.isArray(s.fields)) return s
        const fields = s.fields as Col[]
        const expiries = fields.filter((f) => /_expires$/.test(String(f.value ?? '')))
        if (!expiries.length) return s
        const iconOf = new Map(expiries.map((f) => [String(f.value ?? '').replace(/_expires$/, ''), f.icon]))
        const others = fields.filter((f) => !/_expires$/.test(String(f.value ?? '')))
        return {
          ...s,
          fields: [
            ...others,
            ...courses.map((k) => ({
              icon: iconOf.get(k) ?? 'badge-check',
              label: labelOf(k),
              value: `${k}_expires`,
              fallback: '—',
            })),
          ],
        }
      }),
    }
  }

  return {
    ...shipped,
    columns: [name, ...courseCols, attention],
    filters: nextFilters,
    pagination: { ...(shipped.pagination as Cfg ?? {}), pageSize: cfgInt(cfg, 'ist_matrix_page_size') },
    ...(nextDetail ? { detailPanel: nextDetail } : {}),
  }
}
