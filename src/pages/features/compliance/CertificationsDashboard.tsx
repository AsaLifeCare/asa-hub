// WORKFORCE COMPLIANCE — THE DASHBOARD.
// The Certifications dashboard is simply the Dashboard now, built out of the facts already in hand and worth…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  AlertTriangle, BadgeCheck, CalendarClock, CheckCircle2, Loader2,
  RefreshCw, ScanSearch, ShieldAlert,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import ScreenSwitcher from '@/pages/features/employeetracker/ScreenSwitcher'
import { api } from '@/lib/api'
import { TRACKER_OWN_ONLY, isTrackerOwnOnly } from '@/lib/certUploads'
import {
  fetchIstConfig, certScreenColumns, certStateTints, cfgInt, IST_CONFIG_FALLBACK, TINT_BG, TINT_FG,
  type CertScreenColumn, type IstConfig,
} from '@/lib/istConfig'
import { cn } from '@/lib/utils'

/* ── the two shapes, as the resources hold them ── */
type MatrixRow = {
  id?: string; name?: string; role?: string; avatar?: string
  dodd?: string; cpr?: string; med1?: string; med2?: string; med3?: string
  mais?: string; money?: string; mandt?: string; attention?: number
}
type CertRow = {
  personName?: string; certId?: string; certName?: string
  status?: string; expiresAt?: string | null
}

// THE EIGHT TRACKED CERTIFICATIONS — the shipped floor, not the law.
export const COLS = [
  { key: 'dodd', label: 'DODD 8-Hr', certId: 'cert-dodd' },
  { key: 'cpr', label: 'CPR / First Aid', certId: 'cert-cpr' },
  { key: 'med1', label: 'Med Delivery 1', certId: 'cert-med1' },
  { key: 'med2', label: 'Med Delivery 2', certId: 'cert-med2' },
  { key: 'med3', label: 'Med Delivery 3', certId: 'cert-med3' },
  { key: 'mais', label: 'DODD MAIS', certId: 'cert-mais' },
  { key: 'money', label: 'Money Management', certId: 'cert-money' },
  { key: 'mandt', label: 'MANDT', certId: 'cert-mandt' },
] as const

const norm = (s?: string) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

// The ledger writes American dates ("1/13/2027"), 762 of 770 of them.
function parseDue(raw?: string | null): Date | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]))
  const iso = new Date(s)
  return Number.isNaN(iso.getTime()) ? null : iso
}

const STATUS_TINT: Record<string, string> = {
  valid: 'bg-tint-mint', expiring: 'bg-tint-amber',
  expired: 'bg-tint-pink', missing: 'bg-surface-3',
}
const STATUS_FG: Record<string, string> = {
  valid: 'text-tint-fg-mint', expiring: 'text-tint-fg-amber',
  expired: 'text-tint-fg-pink', missing: 'text-text-3',
}

// What the two reads answered.
export type CertificationReads = {
  matrix: MatrixRow[]; certs: CertRow[]; failed: string[]; ownOnly: boolean; loading: boolean
  load: () => Promise<void>
}

export function useCertificationReads(): CertificationReads {
  const [matrix, setMatrix] = useState<MatrixRow[]>([])
  const [certs, setCerts] = useState<CertRow[]>([])
  const [failed, setFailed] = useState<string[]>([])
  const [ownOnly, setOwnOnly] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const miss: string[] = []
    let own = false
    const pull = async <T,>(resource: string, set: (rows: T[]) => void) => {
      try {
        const r = await api.list<T>(resource as never)
        set(Array.isArray(r) ? r : [])
      } catch (e) {
        // an own answer is not a failed read: it is a whole estate this account may not see
        if (isTrackerOwnOnly(e)) own = true
        else miss.push(resource)
        set([])
      }
    }
    await Promise.all([
      pull<MatrixRow>('certMatrix', setMatrix),
      pull<CertRow>('staffCerts', setCerts),
    ])
    setFailed(miss)
    setOwnOnly(own)
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])
  return { matrix, certs, failed, ownOnly, loading, load }
}

export default function CertificationsDashboard() {
  return <CertificationsScreen reads={useCertificationReads()} />
}

export function CertificationsScreen({ reads }: { reads: CertificationReads }) {
  const { matrix, certs, failed, ownOnly, loading, load } = reads
  /** The course list's own settings; `null` until the read comes back. */
  const [istCfg, setIstCfg] = useState<IstConfig | null>(null)

  // The course list, from the tab.
  useEffect(() => {
    void fetchIstConfig().then(setIstCfg).catch(() => setIstCfg(IST_CONFIG_FALLBACK))
  }, [])

  const cols = useMemo<readonly CertScreenColumn[]>(
    () => (istCfg ? certScreenColumns(COLS, istCfg) : COLS),
    [istCfg],
  )
  // an edited ist_cert_status_tints colour wins; an untouched one keeps this screen's own
  const cfgNow = istCfg ?? IST_CONFIG_FALLBACK
  const stateBg = useMemo(
    () => certStateTints(cfgNow, STATUS_TINT, (t) => TINT_BG[t] ?? STATUS_TINT.missing), [cfgNow])
  const stateFg = useMemo(
    () => certStateTints(cfgNow, STATUS_FG, (t) => TINT_FG[t] ?? STATUS_FG.missing), [cfgNow])
  /** How far the renewal rail reaches (`ist_dashboard_months`, this month included). */
  const monthsAhead = cfgInt(cfgNow, 'ist_dashboard_months')

  /* ── the active roster: one row per person the estate still carries ── */
  const roster = useMemo(() => {
    const rows = matrix.map((m) => {
      const cells = cols.map((c) => String((m as Record<string, unknown>)[c.key] ?? ''))
      const bad = cells.filter((s) => s === 'expired' || s === 'missing').length
      const soon = cells.filter((s) => s === 'expiring').length
      return { name: m.name ?? '', role: m.role ?? '', avatar: m.avatar ?? '', cells, bad, soon }
    }).filter((r) => r.name)
    return rows
  }, [matrix, cols])

  const census = useMemo(() => {
    let action = 0, attention = 0, clear = 0
    for (const r of roster) {
      if (r.bad) action++
      else if (r.soon) attention++
      else clear++
    }
    return { action, attention, clear, total: roster.length }
  }, [roster])

  /* ── the ledger, and the gap between it and the roster ── */
  const ledger = useMemo(() => {
    const by: Record<string, number> = { valid: 0, expiring: 0, expired: 0, missing: 0 }
    const names = new Set<string>()
    for (const c of certs) {
      by[c.status ?? ''] = (by[c.status ?? ''] ?? 0) + 1
      const n = norm(c.personName)
      if (n) names.add(n)
    }
    const onRoster = new Set(roster.map((r) => norm(r.name)))
    let expiredOnRoster = 0
    for (const c of certs) {
      if (c.status === 'expired' && onRoster.has(norm(c.personName))) expiredOnRoster++
    }
    return {
      total: certs.length, by, people: names.size,
      offRoster: [...names].filter((n) => !onRoster.has(n)).length,
      expiredOnRoster,
      expiredOffRoster: (by.expired ?? 0) - expiredOnRoster,
    }
  }, [certs, roster])

  /* ── the renewal workload, month by month, from the ledger's own dates ── */
  const months = useMemo(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const buckets = Array.from({ length: monthsAhead }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
      return {
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleDateString('en-US', { month: 'short' }),
        year: d.getFullYear(),
        n: 0,
      }
    })
    const index = new Map(buckets.map((b, i) => [b.key, i]))
    let overdue = 0, unreadable = 0
    for (const c of certs) {
      const d = parseDue(c.expiresAt)
      if (!d) { unreadable++; continue }
      if (d < start) { overdue++; continue }
      const i = index.get(`${d.getFullYear()}-${d.getMonth()}`)
      if (i !== undefined) buckets[i].n++
    }
    const peak = Math.max(1, ...buckets.map((b) => b.n))
    return { buckets, peak, overdue, unreadable }
  }, [certs, monthsAhead])

  /* ── per certification: the mix, and whether the green has evidence ── */
  const byCert = useMemo(() => {
    const ledgerHas = new Set(certs.map((c) => `${norm(c.personName)}|${c.certId ?? ''}`))
    return cols.map((c) => {
      const at = cols.findIndex((x) => x.key === c.key)
      const cells = roster.map((r) => r.cells[at])
      const count = (s: string) => cells.filter((x) => x === s).length
      const valid = count('valid')
      const backed = roster.filter((r, i) =>
        r.cells[at] === 'valid'
        && ledgerHas.has(`${norm(roster[i].name)}|${c.certId}`)).length
      return {
        ...c,
        valid, backed, unbacked: valid - backed,
        expiring: count('expiring'), expired: count('expired'), missing: count('missing'),
        records: certs.filter((x) => x.certId === c.certId).length,
      }
    })
  }, [roster, certs, cols])

  const unbacked = useMemo(() => ({
    valid: byCert.reduce((s, c) => s + c.valid, 0),
    without: byCert.reduce((s, c) => s + c.unbacked, 0),
  }), [byCert])

  const worst = useMemo(
    () => [...roster].sort((a, b) => b.bad - a.bad || b.soon - a.soon || a.name.localeCompare(b.name)).slice(0, 10),
    [roster],
  )

  const blind = failed.length === 2

  return (
    <div className="w-full">
      <PageHeader
        title="Dashboard"
        subtitle="Certifications across the estate — who cannot be put on a shift, and what expires next"
        actions={
          // Same pair, same order as the tracker: Refresh, then the switcher.
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Refresh
            </button>
            <ScreenSwitcher />
          </div>
        }
      />

      {ownOnly ? (
        <p className="-mt-2 mb-4 text-[11.5px] text-text-3">
          — people on the active roster · — certification records: {TRACKER_OWN_ONLY}
        </p>
      ) : (
      <p className="-mt-2 mb-4 text-[11.5px] text-text-3">
        {roster.length} people on the active roster · {ledger.total} certification records over {ledger.people} names
        {failed.length > 0 && (
          <span className="text-tint-fg-amber"> — could not be read: {failed.join(', ')} (the panels below are narrower than the truth, not emptier)</span>
        )}
        {istCfg?.blind && (
          // The COURSE LIST is the shipped one; the records are the real ones.
          <span className="text-tint-fg-amber">
            {' '}— the {istCfg.tab} settings could not be read, so the course list is the one this
            screen ships with; every record counted below is still the real one
          </span>
        )}
      </p>
      )}

      {loading && !roster.length && !ownOnly ? (
        <div className="flex items-center justify-center gap-2 px-4 py-16 text-[12px] text-text-3">
          <Loader2 size={13} className="animate-spin" /> Reading the estate…
        </div>
      ) : ownOnly ? (
        // one person's rows are not the estate: no census, no counts — the figure that never landed, said
        <div className="rounded-[16px] bg-detail-hero p-6 shadow-2 md:p-7">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/45">
            Cannot be cleared for a shift
          </p>
          <p className="font-stat text-[60px] font-bold leading-[0.95] text-white">—</p>
          <p className="mt-2 max-w-[560px] text-[13.5px] leading-5 text-white/70">{TRACKER_OWN_ONLY}</p>
        </div>
      ) : blind ? (
        <EmptyState
          title="Neither source answered"
          body="The roster and the certification ledger both failed to read. That is not the same as nobody being certified — this screen knows nothing right now."
        />
      ) : (
        <>
          {/* ══ THE HERO ══ */}
          <div className="rounded-[16px] bg-detail-hero p-6 shadow-2 md:p-7">
            <div className="grid gap-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
              {/* the one number */}
              <div>
                <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/45">
                  Cannot be cleared for a shift
                </p>
                <p className="font-stat text-[60px] font-bold leading-[0.95] text-white">{census.action}</p>
                <p className="mt-1 text-[13.5px] leading-5 text-white/65">
                  of {census.total} people on the active roster
                </p>
                <p className="mt-3 inline-flex rounded-full bg-tint-pink px-2.5 py-1 text-[11.5px] font-bold text-tint-fg-pink">
                  {ledger.expiredOnRoster} expired certifications on them
                </p>
              </div>

              {/* the census, honestly */}
              <div>
                <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/45">The roster</p>
                <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-white/10">
                  {([
                    ['bg-tint-pink', census.action],
                    ['bg-tint-amber', census.attention],
                    ['bg-tint-mint', census.clear],
                  ] as const).map(([cls, n], i) => (
                    <span key={i} className={cls} style={{ width: `${census.total ? (n / census.total) * 100 : 0}%` }} />
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-1.5 text-[12px] text-white/70 sm:grid-cols-3">
                  <Legend tint="bg-tint-pink" n={census.action} label="one or more expired or missing" />
                  <Legend tint="bg-tint-amber" n={census.attention} label="something expiring" />
                  <Legend tint="bg-tint-mint" n={census.clear} label="every tracked certification current" />
                </div>
              </div>

              {/* the reconciliation nobody should have to ask for */}
              <div className="rounded-[12px] border border-white/10 bg-white/5 p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/45">
                  Why not {ledger.by.expired}?
                </p>
                <p className="mt-1.5 text-[12.5px] leading-5 text-white/70">
                  The ledger holds <B>{ledger.by.expired}</B> expired records across <B>{ledger.people}</B> names.
                  {' '}<B>{ledger.expiredOffRoster}</B> of them belong to the <B>{ledger.offRoster}</B> names the
                  active roster does not carry — people who left, and history nobody deleted.
                  {' '}<B>{ledger.expiredOnRoster}</B> sit on somebody who can be put on a schedule tomorrow.
                  This band counts those.
                </p>
              </div>
            </div>
          </div>

          {/* ══ THE FOUR COUNTS, over the ledger ══ */}
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile icon={<BadgeCheck size={15} className="text-tint-fg-blue" />} tint="bg-tint-blue"
              value={ledger.total} label="Records on file" sub={`over ${ledger.people} names`} />
            <Tile icon={<CheckCircle2 size={15} className="text-tint-fg-mint" />} tint="bg-tint-mint"
              value={ledger.by.valid ?? 0} label="Valid" sub="in good standing" />
            <Tile icon={<CalendarClock size={15} className="text-tint-fg-amber" />} tint="bg-tint-amber"
              value={ledger.by.expiring ?? 0} label="Expiring" sub="inside the warning window" />
            <Tile icon={<AlertTriangle size={15} className="text-tint-fg-pink" />} tint="bg-tint-pink"
              value={ledger.by.expired ?? 0} label="Expired" sub={`${ledger.expiredOnRoster} on the active roster`} />
          </div>

          {/* ══ THE RENEWAL RAIL ══ */}
          <Card className="mt-4 p-4">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-[14px] font-bold text-text-1">The next {monthsAhead} months</h2>
                <p className="text-[11.5px] text-text-3">
                  Every certification with a readable expiry date, by the month it lands in.
                </p>
              </div>
              <span className="flex items-center gap-2 text-[11px]">
                <span className="rounded-full bg-tint-pink px-2 py-0.5 font-semibold text-tint-fg-pink">
                  {months.overdue} already past
                </span>
                {months.unreadable > 0 && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-text-3" title="No readable expiry date — left out rather than guessed into a month">
                    {months.unreadable} undated
                  </span>
                )}
              </span>
            </div>
            <div className="flex h-[104px] items-end gap-1.5">
              {months.buckets.map((b) => (
                <div key={b.key} className="flex flex-1 flex-col items-center gap-1">
                  <span className={cn('font-stat text-[11px] font-bold tabular-nums', b.n ? 'text-text-1' : 'text-text-3')}>
                    {b.n}
                  </span>
                  {/* a real zero is a sliver, not a gap: an absent bar reads as
                      missing data, and this month genuinely has none */}
                  <span
                    className={cn('w-full rounded-t-[3px]', b.n ? 'bg-tint-amber' : 'bg-border')}
                    style={{ height: Math.max(2, Math.round((b.n / months.peak) * 74)) }}
                  />
                  <span className="text-[10px] text-text-3">{b.label}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {/* ══ PER CERTIFICATION ══ */}
            <Card className="p-4">
              <h2 className="text-[14px] font-bold text-text-1">By certification</h2>
              <p className="mb-3 text-[11.5px] text-text-3">
                The active roster's {roster.length} rows, per tracked certification. The bar is the real
                proportion — a programme with two records does not get the same width as one with 321.
              </p>
              <div className="space-y-2.5">
                {byCert.map((c) => {
                  const total = c.valid + c.expiring + c.expired + c.missing
                  return (
                    <div key={c.key}>
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                        <span className="truncate font-medium text-text-1">{c.label}</span>
                        <span className="shrink-0 tabular-nums text-text-3">
                          {c.valid}/{total} valid · {c.records} record{c.records === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                        {(['valid', 'expiring', 'expired', 'missing'] as const).map((s) => {
                          const n = c[s]
                          return n ? (
                            <span key={s} className={stateBg[s]} style={{ width: `${(n / Math.max(1, total)) * 100}%` }} />
                          ) : null
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 border-t border-border pt-2.5 text-[10.5px] text-text-3">
                {(['valid', 'expiring', 'expired', 'missing'] as const).map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className={cn('h-2.5 w-2.5 rounded-full', stateBg[s])} />
                    <span className={stateFg[s]}>{s}</span>
                  </span>
                ))}
              </div>
            </Card>

            {/* ══ THE EVIDENCE GAP ══ */}
            <Card className="p-4">
              <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-text-1">
                <ScanSearch size={15} className="text-tint-fg-lavender" /> Green without evidence
              </h2>
              <p className="mb-3 text-[11.5px] leading-4 text-text-3">
                A <span className="font-semibold text-text-2">valid</span> cell on the matrix is not always proof
                that a certification exists — often it only means no exception was ever recorded. These are the
                green cells with <span className="font-semibold text-text-2">no matching record</span> in the
                ledger. On a screen somebody reads before assigning a shift, a confident green is the dangerous
                one.
              </p>
              <div className="mb-3 flex items-baseline gap-2">
                <span className="font-stat text-[30px] font-bold leading-8 text-text-1">{unbacked.without}</span>
                <span className="text-[12.5px] text-text-2">
                  of {unbacked.valid} green cells have nothing behind them
                </span>
              </div>
              <div className="rounded-xl border border-border">
                {byCert.filter((c) => c.valid > 0).sort((a, b) => b.unbacked - a.unbacked).map((c, i) => (
                  <div key={c.key} className={cn('flex items-center gap-2 px-3 py-1.5', i > 0 && 'border-t border-border/50')}>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-text-1">{c.label}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-text-3">{c.backed}/{c.valid} backed</span>
                    <span className={cn(
                      'w-[62px] shrink-0 rounded-full px-2 py-0.5 text-center text-[10.5px] font-bold tabular-nums',
                      c.unbacked === 0 ? 'bg-tint-mint text-tint-fg-mint'
                        : c.unbacked === c.valid ? 'bg-tint-pink text-tint-fg-pink'
                          : 'bg-tint-amber text-tint-fg-amber',
                    )}>
                      {c.unbacked === 0 ? 'all backed' : `${c.unbacked} bare`}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* ══ WORST FIRST ══ */}
          <Card padded={false} className="mt-4">
            <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-text-1">
                  <ShieldAlert size={15} className="text-tint-fg-pink" /> Chase these first
                </h2>
                <p className="text-[11.5px] text-text-3">
                  The active roster, ordered by how many of the eight are expired or missing.
                </p>
              </div>
              <Link to="/app/employee-tracker/roster" className="text-[11.5px] font-semibold text-primary no-underline hover:underline">
                Open the full tracker →
              </Link>
            </div>
            {!worst.length ? (
              <EmptyState title="Nobody on the roster" body="The certification matrix holds no active people yet." />
            ) : (
              <div className="divide-y divide-border/60">
                {worst.map((r) => (
                  <div key={r.name} className="flex items-center gap-3 px-4 py-2.5">
                    <DragPerson name={r.name} avatar={r.avatar} subtitle={r.role} className="min-w-0 flex-1 items-center gap-2.5">
                      <Avatar src={r.avatar} name={r.name} size="xs" />
                      <span className="min-w-0">
                        <span className="clamp-1 block text-[13px] font-medium text-text-1">{r.name}</span>
                        {r.role && <span className="clamp-1 block text-[11px] text-text-3">{r.role}</span>}
                      </span>
                    </DragPerson>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {r.bad > 0 && (
                        <span className="rounded-full bg-tint-pink px-2 py-0.5 text-[10.5px] font-bold text-tint-fg-pink">
                          {r.bad} expired or missing
                        </span>
                      )}
                      {r.soon > 0 && (
                        <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[10.5px] font-bold text-tint-fg-amber">
                          {r.soon} expiring
                        </span>
                      )}
                      {!r.bad && !r.soon && (
                        <span className="rounded-full bg-tint-mint px-2 py-0.5 text-[10.5px] font-bold text-tint-fg-mint">clear</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

/** A number the hero states inline, in the hero's own weight. */
function B({ children }: { children: React.ReactNode }) {
  return <span className="font-stat font-bold text-white">{children}</span>
}

function Legend({ tint, n, label }: { tint: string; n: number; label: string }) {
  return (
    <span className="flex items-start gap-1.5">
      <span className={cn('mt-[5px] h-2 w-2 shrink-0 rounded-full', tint)} />
      <span className="min-w-0">
        <span className="font-stat font-bold text-white">{n}</span>{' '}
        <span className="text-white/60">{label}</span>
      </span>
    </span>
  )
}

function Tile({ icon, tint, value, label, sub }: {
  icon: React.ReactNode; tint: string; value: number; label: string; sub: string
}) {
  return (
    <div className="rounded-[16px] border border-border bg-surface p-3.5">
      <span className={cn('mb-2 grid h-8 w-8 place-items-center rounded-[10px]', tint)}>{icon}</span>
      <div className="font-stat text-[22px] font-bold leading-7 text-text-1">{value}</div>
      <div className="text-[12px] font-medium text-text-1">{label}</div>
      <div className="clamp-1 text-[11px] text-text-3">{sub}</div>
    </div>
  )
}
