// The black header over Render Sheet: what is on the list, how much of it is open, and whether this badge may type…
// THE BADGE IS THE SERVER'S ANSWER, not a guess.
import AppHero from '@/components/shared/AppHero'
import { HERO_DASH, heroNumber, type HeroFigure, type HeroRead } from '@/lib/appHero'

/** One entry of renderSheetList's answer. */
export type TabInfo = {
  key: string; tab: string; source: 'hub' | 'linked'
  /** beside alive:false these are 0s nobody measured — never counted */
  rows: number; cols: number
  /** false: the list could not open this sheet */
  alive?: boolean
  // the engine's own ledger (renderSheetList): the write doors answer 403 for it, so this screen must not offer…
  read_only?: boolean
}

/** One renderSheetGrid answer, as far as the header needs it. */
export type GridInfo = { tab: string; header: string[]; rows: unknown[]; truncated: boolean }

/** A sheet whose rows the list actually counted. */
export const tabCounted = (t: TabInfo): boolean =>
  t.alive !== false && typeof t.rows === 'number' && Number.isFinite(t.rows)

/** The count on a sheet's chip: its rows, or the dash for a sheet never opened. */
export const tabRowsLabel = (t: TabInfo): string => (tabCounted(t) ? t.rows.toLocaleString() : HERO_DASH)

/** Estate sheets (est_) ride as `linked` but are the platform's own, not added by link. */
export const addedByLink = (t: TabInfo): boolean => t.source === 'linked' && !t.key.startsWith('est_')

export type RenderSheetFigures = {
  /** every sheet the list returned */
  tabs: number
  /** of those, spreadsheets somebody added by link */
  linked: number
  /** the registry of linked spreadsheets did not answer — the list holds only the rest */
  registryUnread: boolean
  /** rows across the sheets the list counted; null when it counted none */
  rows: number | null
  /** sheets on the list whose rows are not in that total */
  uncounted: number
  /** the open sheet, and what it holds */
  openTab: string
  /** the open sheet's own row count — the list's when the grid was trimmed */
  openRows: number | null
  openCols: number | null
  /** where the open sheet's grid read stands */
  openRead: 'pending' | 'failed' | 'ready'
  /** the grid drew only the first rows */
  openTruncated: boolean
  /** rows the grid drew */
  openShown: number
  /** the engine owns the open sheet — nothing is typed there */
  openReadOnly: boolean
  canEdit: boolean
}

type OpenSheet = Pick<RenderSheetFigures, 'openTab' | 'openRows' | 'openCols' | 'openRead' | 'openTruncated' | 'openShown'>

// THE OPEN SHEET, FROM THE READ THAT OPENED IT.
export function openSheetFigures(
  info: TabInfo | undefined,
  grid: GridInfo | null,
  gridFailed: boolean,
): OpenSheet {
  const openTab = info?.tab ?? ''
  if (!grid) {
    return { openTab, openRows: null, openCols: null, openRead: gridFailed ? 'failed' : 'pending', openTruncated: false, openShown: 0 }
  }
  const unopened = grid.header.length === 0 && info?.alive === false
  return {
    openTab,
    openRows: unopened ? null
      : grid.truncated ? (info && tabCounted(info) ? info.rows : null)
      : grid.rows.length,
    openCols: unopened ? null : grid.header.length,
    openRead: 'ready',
    openTruncated: grid.truncated,
    openShown: grid.rows.length,
  }
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${heroNumber(n)} ${n === 1 ? one : many}`

// THE LIST'S OWN COUNTS, never a stand-in.
export function renderSheetFigures(
  tabs: TabInfo[],
  open: OpenSheet & Pick<RenderSheetFigures, 'openReadOnly' | 'canEdit'>,
  registryUnread = false,
): RenderSheetFigures {
  const counted = tabs.filter(tabCounted)
  return {
    tabs: tabs.length,
    linked: tabs.filter(addedByLink).length,
    registryUnread,
    rows: counted.length ? counted.reduce((n, t) => n + t.rows, 0) : null,
    uncounted: tabs.length - counted.length,
    ...open,
  }
}

function openNote(f: RenderSheetFigures): string {
  if (!f.openTab) return 'no sheet is open'
  if (f.openRead === 'pending') return `${f.openTab} has not answered yet`
  if (f.openRows === null) {
    return f.openTruncated
      ? `${f.openTab} · the first ${heroNumber(f.openShown)} drawn; the list could not count the rest`
      : `${f.openTab} could not be opened, or does not exist yet`
  }
  const cols = f.openCols === null ? '' : ` · ${plural(f.openCols, 'column')}`
  return `${f.openTab}${cols}${f.openTruncated ? ` · the first ${heroNumber(f.openShown)} drawn` : ''}`
}

export default function RenderSheetHero({ read, figures, onRetry }: {
  read: HeroRead
  figures: RenderSheetFigures | null
  onRetry?: () => void
}) {
  const f = figures
  const builtin = f ? f.tabs - f.linked : 0

  const outOfTotal = f
    ? [
        f.uncounted ? `${plural(f.uncounted, 'sheet')} could not be opened` : '',
        f.registryUnread ? 'the linked spreadsheets could not be listed' : '',
      ].filter(Boolean)
    : []

  const list: HeroFigure[] = [
    {
      label: 'Sheets on the list',
      value: f && !f.registryUnread ? f.tabs : null,
      // the registry is its own read: the list is not whole without it
      read: f?.registryUnread
        ? { state: 'failed', reason: `the linked spreadsheets could not be listed · ${plural(builtin, 'built-in')} here` }
        : undefined,
      note: !f
        ? ''
        : f.linked
          ? `${plural(builtin, 'built-in')} · ${heroNumber(f.linked)} added by link`
          : 'the built-in whitelist, nothing added by link yet',
    },
    {
      label: 'Rows across them',
      tint: 'blue',
      value: f ? f.rows : null,
      note: !f
        ? ''
        : f.rows === null
          ? f.tabs ? 'no sheet on the list could be opened to count' : 'nothing on the list to count'
          : outOfTotal.length
            ? `${outOfTotal.join(' · ')} — not in this total`
            : 'counted off every sheet on the list',
    },
    {
      label: 'Rows in the open sheet',
      value: f ? f.openRows : null,
      read: f && f.openTab && f.openRead === 'failed'
        ? { state: 'failed', reason: `${f.openTab} could not be read` }
        : undefined,
      note: f ? openNote(f) : '',
    },
    {
      label: 'Editing here',
      text: true,
      value: f ? (f.canEdit ? (f.openReadOnly ? 'Read-only sheet' : 'Allowed') : 'Read-only') : null,
      note: !f
        ? ''
        : !f.canEdit
          ? 'your badge opens these sheets to read'
          : f.openReadOnly
            ? 'the engine owns this ledger — only what sends writes it'
            : 'double-click a cell; every write carries what you last saw',
    },
  ]

  return (
    <AppHero
      eyebrow="Render sheet · the sheets, as sheets"
      label="Render sheet — what is on the list"
      read={read}
      figures={list}
      reading="Reading the sheet list…"
      failed="The sheet list could not be read, so these figures are unknown — not zero."
      sentence={f
        ? f.registryUnread
          ? 'The linked spreadsheets could not be listed · the built-ins are here, the rest is unknown'
          : `${plural(f.tabs, 'sheet')} on the list · view is the badge matrix’s, editing is the sheet-edit badges’`
        : undefined}
      onRetry={onRetry}
    />
  )
}
