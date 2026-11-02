// PSI Log › Staff, Clients, Places & codes: everything PsiAnywhere answered about them, as the collection keeps it
// (app/psi_harvest.py, /hub-lanes/psi-log/data). One kind at a time — each a PsiAnywhere read — with every column it
// carries; a row opens whole in the side panel. Secrets reach here as their markers, never their values. App
// Control's psi-log.collection row opens it (the master's alone until he names a badge), never the clock's.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { Loader2, Search } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import SidePanel from '@/components/shared/SidePanel'
import { relayLane } from '@/lib/noticesApi'
import { cn } from '@/lib/utils'

export type PsiKind = { kind: string; label: string; method: string; of: string; rows: number; seenAt: string }
export type PsiRow = Record<string, unknown>
export type PsiData = { page: string; kinds: PsiKind[]; kind: string; label: string; total: number; columns: string[]; rows: PsiRow[] }

const TITLES: Record<string, [string, string]> = {
  staff: ['PSI staff', 'Everything PsiAnywhere answers about employees, users and supervisors.'],
  clients: ['PSI clients', 'Everything PsiAnywhere answers about the people we serve.'],
  other: ['PSI places & codes', 'Locations, residences, work codes, call-off reasons and scheduling periods.'],
}
const text = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : String(v))

/** The lane's answer as this screen draws it; null when it is not the collection. */
export function psiDataFrom(raw: unknown): PsiData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  if (!Array.isArray(d.kinds)) return null
  return {
    page: text(d.page), kind: text(d.kind), label: text(d.label), total: Number(d.total) || 0,
    kinds: d.kinds.map((k) => {
      const r = (k ?? {}) as Record<string, unknown>
      return { kind: text(r.kind), label: text(r.label), method: text(r.method), of: text(r.of),
        rows: Number(r.rows) || 0, seenAt: text(r.seenAt) }
    }).filter((k) => k.kind),
    columns: Array.isArray(d.columns) ? d.columns.map(text).filter((c) => c && !c.startsWith('_')) : [],
    rows: Array.isArray(d.rows) ? (d.rows as PsiRow[]) : [],
  }
}

function seen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'never collected'
    : `collected ${d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
}

const chip = 'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold'
const SHOWN = 10

export default function PsiDataPage() {
  const { pageId } = useParams()
  const page = pageId === 'clients' || pageId === 'other' ? pageId : 'staff'
  const [data, setData] = useState<PsiData | null>(null)
  const [why, setWhy] = useState('')
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const [asked, setAsked] = useState('')
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<PsiRow | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (k: string, query: string) => {
    setBusy(true)
    try {
      const qs = new URLSearchParams({ page, ...(k ? { kind: k } : {}), ...(query ? { q: query } : {}) })
      const got = psiDataFrom(await relayLane<unknown>(`/hub-lanes/psi-log/data?${qs}`))
      if (!got) throw new Error('the server answered something that is not the collection')
      setData(got)
      setKind(got.kind)
      setWhy('')
    } catch (e) {
      setWhy(e instanceof Error ? e.message : 'the collection could not be read')
    } finally {
      setBusy(false)
    }
  }, [page])

  useEffect(() => { setKind(''); setQ(''); setAsked(''); setData(null); void load('', '') }, [page, load])
  useEffect(() => {
    const t = window.setTimeout(() => { if (q !== asked) { setAsked(q); void load(kind, q) } }, 350)
    return () => window.clearTimeout(t)
  }, [q, asked, kind, load])

  const cols = useMemo(() => (all ? data?.columns ?? [] : (data?.columns ?? []).slice(0, SHOWN)), [data, all])

  const [title, subtitle] = TITLES[page]
  const current = data?.kinds.find((k) => k.kind === kind)

  return (
    <div className="w-full">
      <PageHeader title={title} subtitle={subtitle} />
      {why && (
        <div className="mb-3 rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12.5px] leading-[19px] text-text-1">
          {why}
          <button type="button" onClick={() => void load(kind, q)} className="ml-2 font-semibold underline">Try again</button>
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        {(data?.kinds ?? []).map((k) => (
          <button key={k.kind} type="button" onClick={() => { setKind(k.kind); void load(k.kind, q) }}
            className={cn(chip, k.kind === kind ? 'border-primary bg-surface-2 text-text-1' : 'border-border bg-surface text-text-2 hover:bg-surface-2')}>
            {k.label} <span className="text-text-3">{k.rows}</span>
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-surface-2 px-3">
            <Search size={15} className="text-text-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find anything in these rows…"
              className="h-10 w-full bg-transparent text-[14px] text-text-1 outline-none placeholder:text-text-3" />
          </div>
          {busy && <Loader2 size={15} className="animate-spin text-text-3" />}
          <div className="text-[12.5px] text-text-3">
            {current ? `${data?.total ?? 0} row${data?.total === 1 ? '' : 's'} · ${seen(current.seenAt)}` : ''}
          </div>
          {(data?.columns.length ?? 0) > SHOWN && (
            <button type="button" onClick={() => setAll((v) => !v)} className="text-[12.5px] font-semibold text-primary">
              {all ? 'Fewer columns' : `All ${data?.columns.length} columns`}
            </button>
          )}
        </div>
        {!data && !why ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading…</div>
        ) : (data?.rows.length ?? 0) === 0 ? (
          <div className="py-8 text-center text-[13px] text-text-3">
            {current && !current.rows ? 'Not collected yet — start a collection in PSI Log › Collection.' : 'No row matches.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-text-3">
                  {cols.map((c) => <th key={c} className="whitespace-nowrap px-2 py-2 font-semibold">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((r, i) => (
                  <tr key={text(r._key) || i} onClick={() => setOpen(r)}
                    className="cursor-pointer border-b border-border text-text-1 hover:bg-surface-2">
                    {cols.map((c) => <td key={c} className="max-w-[260px] truncate px-2 py-1.5">{text(r[c])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {(data?.total ?? 0) > (data?.rows.length ?? 0) && (
              <div className="pt-3 text-[12.5px] text-text-3">Showing {data?.rows.length} of {data?.total} — narrow it with the search.</div>
            )}
          </div>
        )}
      </div>

      <SidePanel open={!!open} onClose={() => setOpen(null)} label={current?.label ?? 'PSI'} title={text(open?._item) || text(open?._key)}>
        {open && (
          <dl className="mt-1 divide-y divide-border text-[13px]">
            {Object.entries(open).filter(([k]) => !k.startsWith('_') || k === '_of').map(([k, v]) => (
              <div key={k} className="grid grid-cols-[150px_1fr] gap-3 py-1.5">
                <dt className="break-words text-text-3">{k}</dt>
                <dd className="break-words text-text-1">{text(v)}</dd>
              </div>
            ))}
            <div className="grid grid-cols-[150px_1fr] gap-3 py-1.5">
              <dt className="text-text-3">PsiAnywhere answered</dt>
              <dd className="text-text-1">{seen(text(open._seenAt))}</dd>
            </div>
          </dl>
        )}
      </SidePanel>
    </div>
  )
}
