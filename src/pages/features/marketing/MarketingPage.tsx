// MARKETING — competitors, Hub skin.
// Names, links and treated figures come from the Hub tab.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Briefcase, Building2, ChevronDown, Globe, Loader2, RefreshCw, Share2,
  BarChart3,
  Plus,
} from 'lucide-react'
import { useNavigate } from 'react-router'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import SearchInput from '@/components/shared/SearchInput'
import { Badge } from '@/components/shared/Badge'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { marketingFresh, useMarketingCache } from '@/stores/useMarketingCache'
import { cn } from '@/lib/utils'
import { TIER_LABEL, TIER_TINT, type CompetitorTier } from './competitorIntel'

type PersonRow = { status?: string; role?: string }
type ClientRow = { id?: string; name?: string }

type Competitor = {
  id?: string
  name: string
  type?: string
  tier?: CompetitorTier | string
  site?: string
  facebook?: string
  linkedin?: string
  location?: string
  founded?: string
  revenue?: string
  staff?: string
  served?: string
  services?: string
  funding?: string
  note?: string
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((n) => n[0]).join('').toUpperCase()
}

function typeTint(t: string): 'mint' | 'amber' | 'pink' | 'lavender' {
  const k = t.toLowerCase()
  if (k.includes('nonprofit')) return 'mint'
  if (k.includes('for-profit')) return 'amber'
  if (k.includes('group')) return 'pink'
  return 'lavender'
}

function splitServices(raw?: string): string[] {
  return String(raw || '').split('|').map((s) => s.trim()).filter(Boolean)
}

function asTier(v?: string): CompetitorTier {
  if (v === 'large' || v === 'mid' || v === 'peer') return v
  return 'peer'
}

export default function MarketingPage() {
  const held = useMarketingCache((s) => s.competitors)
  const put = useMarketingCache((s) => s.put)
  // PAINTED BEFORE ANYTHING IS ASKED — the page was loading from scratch on every visit.
  const [rows, setRows] = useState<Competitor[] | null>((held?.data as Competitor[]) ?? null)
  const [sheetErr, setSheetErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(!held)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>('__asa__')
  const [staffN, setStaffN] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()
  const [clientN, setClientN] = useState<number | null>(null)

  const loadSheet = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setSheetErr(null)
    try {
      const data = await gasAction<{ competitors?: Competitor[] }>('marketingCompetitors', {})
      const list = Array.isArray(data?.competitors) ? data!.competitors! : []
      if (!list.length) throw new Error('The Hub marketing tab is empty.')
      setRows(list)
      put('competitors', list)
    } catch (e) {
      // A QUIET REFRESH THAT FAILS LEAVES THE PAGE ALONE.
      if (!quiet) {
        setSheetErr(e instanceof Error ? e.message : 'The Hub marketing sheet could not be read.')
        setRows(null)
      }
    } finally {
      setLoading(false)
    }
  }, [put])

  useEffect(() => {
    // Held and young: the tab cannot have changed by the platform's own rule, and asking would spend an execution…
    if (marketingFresh(held)) return
    void loadSheet(Boolean(held))
  }, [loadSheet])

  // One door, and the sheet's answer is what the list adopts — a row that looks added and was refused is the…
  const addCompetitor = async () => {
    if (saving) return
    setSaving(true)
    try {
      await gasAction('marketingCompetitorAdd', draft, { timeoutMs: 60_000 })
      toast({ type: 'success', title: `${draft.name} added`, body: 'It is on the Hub tab now.' })
      setDraft({}); setAdding(false)
      await loadSheet()
    } catch (e) {
      toast({ type: 'danger', title: 'Not added', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    api.list<PersonRow>('people' as never)
      .then((list) => {
        const n = (Array.isArray(list) ? list : []).filter((r) => {
          const st = String(r.status ?? '').toLowerCase()
          const role = String(r.role ?? '').toLowerCase()
          if (st !== 'active') return false
          if (role === 'entity' || role === 'guardian' || role === 'client') return false
          return true
        }).length
        setStaffN(n)
      })
      .catch(() => setStaffN(null))
    api.list<ClientRow>('clients' as never)
      .then((list) => setClientN(Array.isArray(list) ? list.length : 0))
      .catch(() => setClientN(null))
  }, [])

  const filtered = useMemo(() => {
    const list = rows ?? []
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter((c) =>
      [c.name, c.type, c.location, c.funding, c.note, c.services].join(' ').toLowerCase().includes(needle),
    )
  }, [rows, q])

  const toggle = (key: string) => setOpen((cur) => (cur === key ? null : key))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Marketing"
        subtitle="Competitive intelligence — copied into the Hub Drive folder, treated on our sheet."
        actions={
          <button
            type="button"
            onClick={() => void loadSheet()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search competitors…" className="min-w-[220px] flex-1" />
        <span className="text-[11px] tabular-nums text-text-3">
          {filtered.length}/{rows?.length ?? 0}
        </span>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
        >
          <Plus size={14} /> Add a competitor
        </button>
        <button
          type="button"
          onClick={() => navigate('/app/marketing/analytics')}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
        >
          <BarChart3 size={14} /> Analysis & strategy
        </button>
      </div>

      {/**
        * ADDING A RIVAL — a field on the first page for adding further
        * companies, the competitors.
        *
        * The name is the only thing demanded, because the only thing worse
        * than a thin record is nobody writing one down. Everything else is
        * optional and the analysis says out loud how many rows it could not
        * read a number from, so a half-filled entry weakens nothing quietly.
        */}
      {adding && (
        <div className="mb-4 rounded-md border border-border bg-surface p-4">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ['name', 'Name *', 'Legal or trading name'],
              ['location', 'Location', 'City, ST'],
              ['type', 'Type', 'Provider group, agency…'],
              ['site', 'Website', 'https://…'],
              ['served', 'People served', 'a number, if known'],
              ['staff', 'Staff', 'a number, if known'],
              ['revenue', 'Revenue', 'e.g. ~$4.2M (2025)'],
              ['services', 'Services', 'Residential | Day | Transport'],
              ['note', 'Note', 'what makes them worth watching'],
            ] as const).map(([field, label, ph]) => (
              <label key={field} className="grid gap-1">
                <span className="text-[11.5px] font-medium text-text-2">{label}</span>
                <input
                  value={draft[field] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                  placeholder={ph}
                  className="h-9 rounded-md border border-border bg-surface px-2.5 text-[13px] text-text-1 outline-none focus:border-primary"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={!draft.name?.trim() || saving}
              onClick={() => void addCompetitor()}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add to the list
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setDraft({}) }}
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-text-3 hover:text-text-1"
            >
              Cancel
            </button>
            <span className="text-[11.5px] text-text-3">
              It lands on the Hub&rsquo;s own <code>marketing_competitors</code> tab and stays — the estate
              seed only fills an empty list.
            </span>
          </div>
        </div>
      )}

      {sheetErr && (
        <p className="mb-4 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px] text-text-2">
          {sheetErr}
        </p>
      )}

      {loading && !rows && (
        <div className="flex items-center gap-2 py-10 text-[13px] text-text-3">
          <Loader2 size={16} className="animate-spin" /> Copying the competitor sheet into Hub…
        </div>
      )}

      {!loading && !sheetErr && filtered.length === 0 && (
        <EmptyState title="No competitor matches" body={`Nothing in the tracked set matches “${q}”.`} />
      )}

      <div className="flex flex-col gap-2">
        <Accordion
          open={open === '__asa__'}
          onToggle={() => toggle('__asa__')}
          left={
            <>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint-mint text-[10px] font-bold text-tint-fg-mint">
                ASA
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-text-1">ASA Lifecare — where we stand</div>
                <div className="text-[11px] text-text-3">our own position vs the tracked set, from Hub directories</div>
              </div>
            </>
          }
          right={<Badge label="US" tint="mint" />}
        >
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric label="Active people" value={staffN == null ? '—' : String(staffN)} />
            <Metric label="Clients" value={clientN == null ? '—' : String(clientN)} />
            <Metric label="Market" value="Stark County / Ohio DODD waivers" />
          </div>
          <p className="border-t border-border pt-3 text-[13px] leading-relaxed text-text-2">
            Small-to-mid for-profit IDD / home-care provider in the same Ohio DODD waiver
            market as the six tracked rivals. By scale we sit below the mid-size nonprofits
            (Siffrin, TWi) and the Midwest group. The counts above are this platform's
            directories — not a copied census.
          </p>
        </Accordion>

        {filtered.map((c) => (
          <CompetitorRow
            key={c.id || c.name}
            c={c}
            open={open === c.name}
            onToggle={() => toggle(c.name)}
          />
        ))}
      </div>

      <p className="mt-5 text-[11px] text-text-3">
        Sources: org websites, IRS Form 990 (ProPublica / CauseIQ) for the nonprofits,
        chamber &amp; Ohio DODD listings (2026-06). Treated on the Hub marketing sheet.
        Private agencies that do not disclose figures are marked as such.
      </p>
    </div>
  )
}

function CompetitorRow({
  c, open, onToggle,
}: {
  c: Competitor
  open: boolean
  onToggle: () => void
}) {
  const tier = asTier(c.tier)
  const services = splitServices(c.services)
  return (
    <Accordion
      open={open}
      onToggle={onToggle}
      left={
        <>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-[11px] font-bold text-text-1">
            {initials(c.name) || <Building2 size={14} />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-text-1" title={c.name}>{c.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <Badge label={c.type || 'Listed'} tint={typeTint(c.type || '')} />
              <Badge label={TIER_LABEL[tier]} tint={TIER_TINT[tier]} />
            </div>
          </div>
        </>
      }
      right={
        <span className="mr-1 text-[12px] tabular-nums text-text-2">{c.revenue || '—'}</span>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label="Revenue" value={c.revenue || '—'} />
        <Metric label="Staff" value={c.staff || '—'} />
        <Metric label="Founded" value={c.founded || '—'} />
        <Metric label="Location" value={c.location || '—'} />
        {c.served && c.served !== '—' && <Metric label="Served" value={c.served} />}
      </div>
      {services.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {services.map((s) => (
            <span key={s} className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-text-2">{s}</span>
          ))}
        </div>
      )}
      <div className="space-y-1.5 border-t border-border pt-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-3">Funding</div>
        <div className="text-[13px] text-text-2">{c.funding || '—'}</div>
        {c.note && <p className="text-[13px] italic text-text-3">{c.note}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {c.site && <LinkChip href={c.site} icon={Globe} label="Site" />}
          {c.linkedin && <LinkChip href={c.linkedin} icon={Briefcase} label="LinkedIn" />}
          {c.facebook && <LinkChip href={c.facebook} icon={Share2} label="Facebook" />}
        </div>
      </div>
    </Accordion>
  )
}

function Accordion({
  open, onToggle, left, right, children,
}: {
  open: boolean
  onToggle: () => void
  left: ReactNode
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={cn('rounded-lg border bg-surface', open ? 'border-border-strong' : 'border-border')}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">{left}</div>
        {right}
        <ChevronDown
          size={16}
          className={cn('shrink-0 text-text-3 transition-transform', open ? 'rotate-0' : '-rotate-90')}
        />
      </button>
      {open && <div className="border-t border-border px-4 pb-4 pt-3">{children}</div>}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-3">{label}</div>
      <div className="mt-0.5 truncate text-[13px] text-text-1" title={value}>{value}</div>
    </div>
  )
}

function LinkChip({ href, icon: Icon, label }: { href: string; icon: typeof Globe; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-text-2 no-underline hover:bg-surface-2"
    >
      <Icon size={11} /> {label}
    </a>
  )
}
