// THE BLACK HEADERS OF THE SCHEMA-DRIVEN APPS.
// A page whose whole screen is the engine's own template has nowhere to put a hand-written header, so it declares…
import { ohioWall } from '@/lib/ohio'
import type { PageHeroSpec } from '@/lib/appHero'

type Row = Record<string, unknown>

const text = (r: Row, k: string): string => (r[k] == null ? '' : String(r[k]).trim())
const count = (rows: Row[], of: (r: Row) => boolean): number => rows.filter(of).length
const n = (v: number): string => v.toLocaleString()
const plural = (v: number, one: string, many = `${one}s`): string => `${n(v)} ${v === 1 ? one : many}`

/** A number in a cell, or null — a blank cell is not a zero. */
function number(r: Row, k: string): number | null {
  const raw = r[k]
  if (raw == null || raw === '') return null
  const v = Number(raw)
  return Number.isFinite(v) ? v : null
}

/** Midnight of Ohio's today: the houses' day, not the reader's phone's. */
function todayMs(): number {
  const d = ohioWall(new Date())
  if (!d) return Date.now()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** A date cell as a day on Ohio's carrier, or null when it cannot be read. */
function day(r: Row, k: string): number | null {
  const s = text(r, k)
  if (!s) return null
  const d = ohioWall(s)
  if (!d || Number.isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The most common value of a column, with how many rows carry it. */
function commonest(rows: Row[], key: string): { value: string; rows: number } | null {
  const tally = new Map<string, number>()
  for (const r of rows) {
    const v = text(r, key)
    if (v) tally.set(v, (tally.get(v) ?? 0) + 1)
  }
  let best: { value: string; rows: number } | null = null
  for (const [value, count_] of tally) if (!best || count_ > best.rows) best = { value, rows: count_ }
  return best
}

/* ---------- Diseases Registry ---------- */

const DAY = 86_400_000

// The clients a condition row names — its `clientIds` cell, an array or a list written into one cell.
function clientIdsOf(r: Row): string[] {
  const raw = r.clientIds
  const list = Array.isArray(raw) ? raw : raw == null ? [] : String(raw).split(/[,;\n]/)
  return list.map((v) => String(v).trim()).filter(Boolean)
}

// CLIENTS, NOT CASES.
const clientsAffected = (rows: Row[]): number | null => {
  const ids = new Set(rows.flatMap((r) => clientIdsOf(r).map((id) => id.toLowerCase())))
  return ids.size || null
}

/** Cases on record: each row's own client count, added — a client counts once per condition. */
const casesOnRecord = (rows: Row[]): number | null => {
  const counted = rows.map((r) => number(r, 'clientsAffected')).filter((v): v is number => v !== null)
  return counted.length ? counted.reduce((s, v) => s + v, 0) : null
}

export const diseasesHero: PageHeroSpec = {
  eyebrow: 'Diseases registry · what the conditions on file say',
  label: 'Diseases registry — the conditions on file',
  reading: 'Reading the conditions…',
  failed: 'The conditions could not be read, so these figures are unknown — not zero.',
  figures: [
    {
      label: 'Conditions tracked',
      compute: (rows) => rows.length,
      note: (rows) => {
        const categories = new Set(rows.map((r) => text(r, 'category')).filter(Boolean))
        return categories.size ? `across ${plural(categories.size, 'category', 'categories')}` : 'no category named on any row'
      },
    },
    {
      label: 'Clients affected',
      tint: 'pink',
      compute: clientsAffected,
      note: (rows) => {
        const cases = casesOnRecord(rows)
        const casesWords = cases === null ? '' : ` · ${plural(cases, 'case')} on record`
        if (clientsAffected(rows) === null) {
          return cases === null ? 'no condition names its clients' : `no condition names its clients${casesWords}`
        }
        const unnamed = count(rows, (r) => clientIdsOf(r).length === 0)
        return unnamed
          ? `${plural(unnamed, 'condition')} ${unnamed === 1 ? 'names no client and is' : 'name no client and are'} not in it${casesWords}`
          : `each client counted once, however many conditions${casesWords}`
      },
    },
    {
      label: 'High-severity conditions',
      tint: 'amber',
      compute: (rows) => {
        const graded = rows.filter((r) => text(r, 'severity'))
        return graded.length ? count(graded, (r) => text(r, 'severity').toLowerCase() === 'high') : null
      },
      note: (rows) => {
        const ungraded = count(rows, (r) => !text(r, 'severity'))
        return ungraded
          ? `${plural(ungraded, 'condition')} ${ungraded === 1 ? 'carries' : 'carry'} no severity`
          : 'every condition carries a severity'
      },
    },
    {
      label: 'Most prevalent',
      text: true,
      compute: (rows) => {
        const ranked = rows
          .map((r) => ({ name: text(r, 'name'), clients: number(r, 'clientsAffected') }))
          .filter((c) => c.name && c.clients !== null)
          .sort((a, b) => (b.clients as number) - (a.clients as number))
        return ranked[0]?.name ?? null
      },
      note: (rows) => {
        const ranked = rows
          .map((r) => ({ name: text(r, 'name'), clients: number(r, 'clientsAffected') }))
          .filter((c) => c.name && c.clients !== null)
          .sort((a, b) => (b.clients as number) - (a.clients as number))
        const top = ranked[0]
        return top ? `${plural(top.clients as number, 'client')} on record` : 'no condition names a client count'
      },
    },
  ],
  sentence: (rows) => {
    const withCode = count(rows, (r) => !!text(r, 'icdCode'))
    return `${plural(rows.length, 'condition')} on file · ${n(withCode)} with an ICD-10 code`
  },
}

/* ---------- ISP Library ---------- */

const clientsCovered = (rows: Row[]): number | null => {
  const named = new Set(rows.map((r) => text(r, 'client_name').toLowerCase()).filter(Boolean))
  return named.size || null
}

export const ispHero: PageHeroSpec = {
  eyebrow: 'ISP library · the service plans on file',
  label: 'ISP library — the service plans on file',
  reading: 'Reading the service plans…',
  failed: 'The service plans could not be read, so these figures are unknown — not zero.',
  figures: [
    {
      label: 'Service plans',
      compute: (rows) => rows.length,
      note: (rows) => {
        const unnamed = count(rows, (r) => !text(r, 'client_name'))
        return unnamed
          ? `${plural(unnamed, 'plan')} ${unnamed === 1 ? 'names' : 'name'} no client`
          : 'every plan names its client'
      },
    },
    {
      label: 'Clients covered',
      tint: 'blue',
      compute: clientsCovered,
      note: (rows) => {
        const covered = clientsCovered(rows)
        if (covered === null) return 'no plan names a client'
        const extra = rows.length - covered
        return extra > 0 ? `${plural(extra, 'plan')} more than one per client` : 'one plan each'
      },
    },
    {
      label: 'Allergies written down',
      tint: 'pink',
      compute: (rows) => (rows.length ? count(rows, (r) => !!text(r, 'allergies')) : null),
      note: (rows) => {
        const blank = count(rows, (r) => !text(r, 'allergies'))
        return blank
          ? `${plural(blank, 'plan')} ${blank === 1 ? 'leaves' : 'leave'} the field blank — blank is not “none”`
          : 'every plan fills the field in'
      },
    },
    {
      label: 'Newest plan year',
      text: true,
      compute: (rows) => {
        const years = rows.map((r) => text(r, 'isp_year')).filter(Boolean).sort()
        return years[years.length - 1] ?? null
      },
      note: (rows) => {
        const undated = count(rows, (r) => !text(r, 'isp_year'))
        return undated
          ? `${plural(undated, 'plan')} ${undated === 1 ? 'carries' : 'carry'} no year`
          : 'every plan carries its year'
      },
    },
  ],
  sentence: (rows) => {
    const supervised = count(rows, (r) => !!text(r, 'supervision_level'))
    return `${plural(rows.length, 'service plan')} on file · ${n(supervised)} ${supervised === 1 ? 'states' : 'state'} a supervision level`
  },
}

/* ---------- Task Board ---------- */

const openCards = (rows: Row[]): Row[] => rows.filter((r) => text(r, 'column').toLowerCase() !== 'done')

/** A stage id the way the board's own column heading reads it. */
const stageWords = (id: string): string => {
  const words = id.replace(/[-_]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : id
}

export const taskBoardHero: PageHeroSpec = {
  eyebrow: 'Task board · the cards on the board',
  label: 'Task board — the cards on the board',
  reading: 'Reading the board…',
  failed: 'The board could not be read, so these figures are unknown — not zero.',
  figures: [
    {
      label: 'Cards still open',
      compute: (rows) => (rows.some((r) => text(r, 'column')) ? openCards(rows).length : null),
      note: (rows) => {
        if (!rows.some((r) => text(r, 'column'))) return 'no card names a column'
        const done = rows.length - openCards(rows).length
        return `of ${plural(rows.length, 'card')} on the board · ${n(done)} done`
      },
    },
    {
      label: 'Past their date',
      tint: 'pink',
      compute: (rows) => {
        const dated = openCards(rows).filter((r) => day(r, 'due') !== null)
        return dated.length ? count(dated, (r) => (day(r, 'due') as number) < todayMs()) : null
      },
      note: (rows) => {
        const open = openCards(rows)
        const undated = count(open, (r) => day(r, 'due') === null)
        if (!open.length) return 'nothing open on the board'
        if (undated === open.length) return 'no open card carries a readable date'
        return undated
          ? `${plural(undated, 'open card')} ${undated === 1 ? 'carries' : 'carry'} no date`
          : 'every open card carries a date'
      },
    },
    {
      label: 'Due within seven days',
      tint: 'amber',
      compute: (rows) => {
        const dated = openCards(rows).filter((r) => day(r, 'due') !== null)
        if (!dated.length) return null
        const from = todayMs()
        return count(dated, (r) => {
          const d = day(r, 'due') as number
          return d >= from && d < from + 7 * DAY
        })
      },
      note: (rows) => {
        const open = openCards(rows)
        if (!open.length) return 'nothing open on the board'
        return open.some((r) => day(r, 'due') !== null)
          ? 'counted on Ohio’s day, the one the houses keep'
          : 'no open card carries a readable date'
      },
    },
    {
      label: 'Busiest column',
      text: true,
      compute: (rows) => {
        const top = commonest(openCards(rows), 'column')
        return top ? stageWords(top.value) : null
      },
      note: (rows) => {
        const top = commonest(openCards(rows), 'column')
        return top ? `${plural(top.rows, 'open card')} waiting there` : 'nothing open on the board'
      },
    },
  ],
  sentence: (rows) => {
    // the board offers four priorities; the top two are the ones that press
    const pressing = count(openCards(rows), (r) => ['high', 'urgent'].includes(text(r, 'priority').toLowerCase()))
    return `${plural(openCards(rows).length, 'open card')} · ${n(pressing)} marked high or urgent`
  },
}
