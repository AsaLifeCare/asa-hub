// Archive — the hiring lane's end of the road.
// The platform's rule is that a candidate must be reachable by phone.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowDownAZ, Clock, FileText, GripVertical, Hand, Phone, PhoneOff, RefreshCw, Search, Share2, ShieldAlert, UserRound } from 'lucide-react'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import Pager from '@/components/shared/Pager'
import { PAGE_SIZE, usePager } from '@/lib/pager'
import { gasAction } from '@/features/hiring/shared'
import { openFile } from '@/stores/useFileViewerStore'
import { share } from '@/stores/useShareStore'
import type { ExportColumn } from '@/lib/exportTable'
import { useCan } from '@/auth/permissions'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'

type Row = {
  id: string
  name: string
  status?: string
  stage?: string
  email?: string
  phone_raw?: string
  referral_name?: string
  referral_phone?: string
  source?: string
  applied_at?: string
  phone_status?: string
  phone_ask_at?: string
  archived?: boolean
  archived_at?: string
  archived_reason?: string
  resume_link?: string
  is_test?: boolean
}

type Answer = {
  rows: Row[]
  counts: { total: number; with_email: number; with_referral: number; nothing: number; archived: number }
}

/** The permission that opens this screen. The read refuses it server-side too. */
export const ARCHIVE_PERM = 'hiring.edit'

/**
 * Per-user page prefs — sort mode, a hand-made row order, and the order of the
 * four counters. localStorage, per browser, per person: a UI preference is
 * never global on this platform. A stored order names IDS, so a list that
 * changed since yesterday keeps the known rows where the hand put them and
 * appends the newcomers at the end — where somebody sorting by hand would
 * look for them.
 */
type SortMode = 'az' | 'newest' | 'manual'
type ArchivePrefs = { sort: SortMode; rowOrder: string[]; tileOrder: string[] }
const PREFS_KEY = 'asa:hiring-archive-prefs'

function loadPrefs(): ArchivePrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    return {
      sort: p.sort === 'az' || p.sort === 'manual' ? p.sort : 'newest',
      rowOrder: Array.isArray(p.rowOrder) ? p.rowOrder.map(String) : [],
      tileOrder: Array.isArray(p.tileOrder) ? p.tileOrder.map(String) : [],
    }
  } catch {
    return { sort: 'newest', rowOrder: [], tileOrder: [] }
  }
}
function savePrefs(p: ArchivePrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* private mode */ }
}

/** Known ids first, in the kept order; anything new goes to the end. */
function applyOrder<T extends { id?: string; label?: string }>(items: T[], order: string[]): T[] {
  if (!order.length) return items
  const rank = new Map(order.map((id, i) => [id, i]))
  const keyOf = (x: T) => String(x.id ?? x.label ?? '')
  return [...items].sort((a, b) => {
    const ra = rank.has(keyOf(a)) ? (rank.get(keyOf(a)) as number) : order.length
    const rb = rank.has(keyOf(b)) ? (rank.get(keyOf(b)) as number) : order.length
    return ra - rb
  })
}

/** What the Share sheet exports — the list as a table, one line per person. */
const SHARE_COLUMNS: ExportColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'email', label: 'E-mail' },
  { key: 'referral_name', label: 'Referred by' },
  { key: 'referral_phone', label: 'Referral phone', accessor: (r) => formatPhoneDisplay(r?.referral_phone) },
  { key: 'phone_raw', label: 'Phone on file (not dialable)', accessor: (r) => formatPhoneDisplay(r?.phone_raw) },
  { key: 'applied_at', label: 'Applied' },
  { key: 'archived_reason', label: 'Reason' },
]

// A day out of whatever the sheet wrote, by CUTTING — never by constructing a Date, which would move the day for…
function dayOf(v: unknown): string {
  const s = String(v ?? '').trim()
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/.exec(s)
  if (iso) return iso[1]
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  return ''
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDay(v: unknown): string {
  const iso = dayOf(v)
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`
}

function Chip({ children, tint = 'slate' }: { children: React.ReactNode; tint?: TintName | 'slate' }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-medium',
      TINT_BG[tint as TintName], TINT_FG[tint as TintName])}>
      {children}
    </span>
  )
}

// WHAT WE STILL HAVE TO GO ON.
function routeOf(r: Row): { label: string; tint: TintName } {
  if (String(r.referral_phone ?? '').replace(/\D/g, '').length >= 10) {
    return { label: 'referral can be texted', tint: 'mint' }
  }
  if (String(r.email ?? '').includes('@')) return { label: 'e-mail only', tint: 'amber' }
  return { label: 'nothing to reach them by', tint: 'pink' }
}

export default function ArchivePage({ inset = false }: {
  // TRUE when this draws as a VIEW of the unified Hiring page.
  inset?: boolean
} = {}) {
  const may = useCan(ARCHIVE_PERM)
  const navigate = useNavigate()
  // A name is a door: an archived person still opens as the full profile — the mega profile page carries their…
  const openProfile = (id: string) => navigate('/app/hiring/candidate?id=' + encodeURIComponent(id))
  const [data, setData] = useState<Answer | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'discarded' | 'referral' | 'email' | 'nothing'>('all')
  const [prefs, setPrefs] = useState<ArchivePrefs>(loadPrefs)
  const [dragRow, setDragRow] = useState<string | null>(null)
  const [dragTile, setDragTile] = useState<string | null>(null)

  const setSort = (sort: SortMode) => setPrefs((p) => { const n = { ...p, sort }; savePrefs(n); return n })

  const load = useCallback(async () => {
    if (!may) return
    setBusy(true)
    setErr('')
    try {
      setData(await gasAction<Answer>('talentNoNumberList', {}))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The list could not be read.')
    } finally {
      setBusy(false)
    }
  }, [may])

  useEffect(() => { void load() }, [load])

  const rows = useMemo(() => {
    const all = data?.rows ?? []
    const needle = q.trim().toLowerCase()
    const kept = all.filter((r) => {
      // TWO POPULATIONS, AND THEY ARE NOT THE SAME PEOPLE.
      if (only === 'discarded' && !r.archived) return false
      if (only === 'referral' && String(r.referral_phone ?? '').replace(/\D/g, '').length < 10) return false
      if (only === 'email' && !String(r.email ?? '').includes('@')) return false
      if (only === 'nothing') {
        const hasRef = String(r.referral_phone ?? '').replace(/\D/g, '').length >= 10
        if (hasRef || String(r.email ?? '').includes('@')) return false
      }
      if (!needle) return true
      return `${r.name} ${r.email ?? ''} ${r.referral_name ?? ''} ${r.source ?? ''}`.toLowerCase().includes(needle)
    })
    if (prefs.sort === 'az') return [...kept].sort((a, b) => a.name.localeCompare(b.name))
    if (prefs.sort === 'manual') return applyOrder(kept, prefs.rowOrder)
    return kept // 'newest' — the server already sorts by applied_at, newest first
  }, [data, q, only, prefs.sort, prefs.rowOrder])

  const pager = usePager(rows, PAGE_SIZE, `${q}|${only}`)

  if (!may) {
    return (
      <div className="mx-auto max-w-[560px] pt-10">
        <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-tint-amber text-tint-fg-amber">
            <ShieldAlert size={22} />
          </span>
          <h2 className="font-display text-[17px] font-bold text-text-1">This list is not open to you</h2>
          <p className="max-w-[380px] text-[13px] leading-5 text-text-2">
            It carries applicants’ contact details, so it needs the{' '}
            <span className="font-mono text-[12px]">{ARCHIVE_PERM}</span> permission.
          </p>
        </Card>
      </div>
    )
  }

  // Drop A onto B: A takes B's place.
  const moveRow = (fromId: string, toId: string) => {
    if (fromId === toId) return
    const ids = rows.map((r) => r.id)
    const from = ids.indexOf(fromId), to = ids.indexOf(toId)
    if (from === -1 || to === -1) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setPrefs((p) => { const n = { ...p, sort: 'manual' as SortMode, rowOrder: ids }; savePrefs(n); return n })
  }
  const moveTile = (fromLabel: string, toLabel: string) => {
    if (fromLabel === toLabel) return
    const labels = stats.map((s) => s.label)
    const from = labels.indexOf(fromLabel), to = labels.indexOf(toLabel)
    if (from === -1 || to === -1) return
    labels.splice(to, 0, labels.splice(from, 1)[0])
    setPrefs((p) => { const n = { ...p, tileOrder: labels }; savePrefs(n); return n })
  }

  const c = data?.counts
  const baseStats: { label: string; value: number; tint: TintName }[] = c
    ? [
        { label: 'Without a number', value: c.total, tint: 'pink' },
        { label: 'Discarded', value: c.archived, tint: 'peach' },
        { label: 'Referral we can text', value: c.with_referral, tint: 'mint' },
        { label: 'E-mail only', value: c.with_email, tint: 'amber' },
        { label: 'Nothing at all', value: c.nothing, tint: 'lavender' },
      ]
    : []
  const stats = applyOrder(baseStats, prefs.tileOrder)

  return (
    <div className="space-y-4">
      <div className={cn('flex flex-wrap items-end gap-3', inset && 'min-[1240px]:pr-[210px]')}>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 font-display text-[24px] font-bold leading-8 text-text-1">
            <PhoneOff size={20} className="text-text-3" />
            Archive
          </h1>
          <p className="text-[14px] text-text-3">
            Everyone who left the board — discarded with their whole record, or never
            reachable by phone — and what we still have to go on.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Share the list AS FILTERED AND ORDERED on screen — the same sheet
              every table shares through, so it can also become a file. */}
          <button
            onClick={() =>
              share({
                title: 'Archive — candidates without a number',
                subtitle: `${rows.length} ${rows.length === 1 ? 'person' : 'people'} — as filtered on screen`,
                rows,
                columns: SHARE_COLUMNS,
                filename: 'hiring-archive',
                icon: 'archive',
              })
            }
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-text-2 hover:bg-surface-2"
          >
            <Share2 size={14} />
            Share
          </button>
          <button
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(busy && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <Card>
          <p className="text-[13.5px] text-tint-fg-pink">{err}</p>
          <button onClick={() => void load()} className="mt-2 text-[13px] font-semibold text-primary hover:underline">
            Try again
          </button>
        </Card>
      )}

      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              draggable
              onDragStart={(e) => { setDragTile(s.label); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (dragTile) moveTile(dragTile, s.label); setDragTile(null) }}
              onDragEnd={() => setDragTile(null)}
              title="Drag to reorder"
              className={cn('cursor-grab rounded-lg px-4 py-3 active:cursor-grabbing', TINT_BG[s.tint],
                dragTile === s.label && 'opacity-50')}
            >
              <p className={cn('font-display text-[26px] font-bold leading-8 tabular-nums', TINT_FG[s.tint])}>{s.value}</p>
              <p className={cn('text-[12.5px]', TINT_FG[s.tint])}>{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, e-mail, referral…"
            className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-[14px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
          />
        </div>
        {([
          ['all', 'All'],
          ['discarded', 'Discarded'],
          ['referral', 'Referral we can text'],
          ['email', 'E-mail only'],
          ['nothing', 'Nothing at all'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setOnly(id)}
            className={cn('rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
              only === id ? 'bg-primary text-on-primary' : 'bg-surface-2 text-text-2 hover:bg-surface-3')}
          >
            {label}
          </button>
        ))}

        {/* Order: newest, A–Z, or by hand. Dragging any row
            switches to manual by itself — an order you made by hand should not
            need a mode button pressed first to survive. */}
        <div className="ml-auto flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5">
          {([
            ['newest', 'Newest', Clock],
            ['az', 'A–Z', ArrowDownAZ],
            ['manual', 'Manual', Hand],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setSort(id)}
              title={id === 'manual' ? 'Your own order — drag rows to arrange' : `Sort by ${label}`}
              className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors',
                prefs.sort === id ? 'bg-surface text-text-1 shadow-1' : 'text-text-3 hover:text-text-2')}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {busy && !data && <p className="text-[14px] text-text-3">Reading the board…</p>}

      {data && !rows.length && (
        <Card>
          <p className="text-[13.5px] text-text-3">
            {data.counts.total === 0
              ? 'Everybody on the board has a number we can call.'
              : 'No row matches this filter.'}
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {pager.slice.map((r) => {
          const route = routeOf(r)
          return (
            <div
              key={r.id}
              onDragOver={(e) => { if (dragRow) e.preventDefault() }}
              onDrop={(e) => { if (dragRow) { e.preventDefault(); moveRow(dragRow, r.id); setDragRow(null) } }}
              className={cn(dragRow === r.id && 'opacity-50')}
            >
            <Card className="flex flex-wrap items-start gap-3">
              {/* The GRIP drags the ROW into your order; the avatar keeps its
                  own drag — the person, to the focus tracker. Two different
                  drags, two different handles, on purpose. A CLICK on the
                  avatar or the name opens the person's profile — click and
                  dragstart never collide, so both drags stay intact. */}
              <span
                draggable
                onDragStart={(e) => { setDragRow(r.id); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation() }}
                onDragEnd={() => setDragRow(null)}
                title="Drag to arrange the list by hand"
                className="mt-2.5 shrink-0 cursor-grab text-text-3 active:cursor-grabbing"
              >
                <GripVertical size={15} />
              </span>
              <DragPerson name={r.name} id={r.id} type="staff" subtitle={r.status} className="shrink-0">
                <span
                  role="button"
                  onClick={() => openProfile(r.id)}
                  title={`Open ${r.name}'s profile`}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                >
                  <Avatar src="" name={r.name} size="md" />
                </span>
              </DragPerson>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    onClick={() => openProfile(r.id)}
                    title={`Open ${r.name}'s profile`}
                    className="cursor-pointer text-[15px] font-semibold text-text-1 hover:underline"
                  >
                    <DragPerson name={r.name} id={r.id} type="staff" subtitle={r.status}>{r.name}</DragPerson>
                  </p>
                  {r.status ? <Chip tint="blue">{r.status}</Chip> : null}
                  <Chip tint={route.tint}>{route.label}</Chip>
                  {r.is_test ? <Chip tint="lavender">rehearsal card</Chip> : null}
                  {r.archived ? <Chip tint="slate">archived</Chip> : null}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-text-2">
                  {r.applied_at ? <span className="text-text-3">Applied {shortDay(r.applied_at)}</span> : null}
                  {r.email ? <span>{r.email}</span> : null}
                  {r.referral_name || r.referral_phone ? (
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound size={13} className="text-text-3" />
                      {/* the referrer is a person too — no id anywhere in the
                          row, and the name is the identity Focus matches on */}
                      <DragPerson name={r.referral_name ?? ''} type="staff" subtitle={`Referred ${r.name}`}>
                        {r.referral_name || 'Referred by somebody'}
                      </DragPerson>
                      {r.referral_phone ? (
                        <a href={`tel:${String(r.referral_phone).replace(/\D/g, '')}`} className="font-medium text-primary hover:underline">
                          {formatPhoneDisplay(r.referral_phone)}
                        </a>
                      ) : null}
                    </span>
                  ) : null}
                  {/* A phone column that exists but cannot be dialled — a
                      shared company line, most often — is worth showing: it
                      explains why the row is here at all. */}
                  {/* THE SENTENCE DEPENDS ON WHY THE ROW IS HERE. "not a number
                      we can reach them on" is true of the without-a-number
                      population and FALSE of a discarded candidate whose phone
                      is perfectly good — the same words about two different
                      facts is how a screen starts lying quietly. */}
                  {r.phone_raw ? (
                    <span className="inline-flex items-center gap-1.5 text-text-3">
                      <Phone size={13} />
                      {formatPhoneDisplay(r.phone_raw)}
                      {String(r.phone_raw).replace(/\D/g, '').length >= 10 && r.archived
                        ? ''
                        : ' — not a number we can reach them on'}
                    </span>
                  ) : null}
                </div>

                {r.archived_reason ? (
                  <p className="mt-1 text-[12.5px] text-text-3">{r.archived_reason}</p>
                ) : null}
              </div>

              {r.resume_link ? (
                <button
                  onClick={() => openFile({ title: r.name, subtitle: 'Résumé', url: String(r.resume_link), icon: 'file-text' })}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
                >
                  <FileText size={14} />
                  Résumé
                </button>
              ) : null}
            </Card>
            </div>
          )
        })}
        <Pager {...pager} onPage={pager.setPage} noun="candidates" />
      </div>
    </div>
  )
}
