// Medications — EVERY client's real med list.
// The ISP is where the medications of every client are found, drawn in exactly this layout with the same medicine…
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, FileText, Loader2, Pencil, Plus, Printer, Share2, X } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { api } from '@/lib/api'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import PageHeader from '@/components/shared/PageHeader'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { useContextStore } from '@/stores/useContextStore'
import { share } from '@/stores/useShareStore'
import Card from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import SafeImg, { tintForName } from '@/components/shared/SafeImg'
import SearchInput from '@/components/shared/SearchInput'
import ContextBanner from '@/components/shared/ContextBanner'
import EmptyState from '@/components/shared/EmptyState'
import { medImageFor } from '@/lib/medImages'
import { EASE_OUT_EXPO, staggerContainer, staggerItem } from '@/engine/motion'
import { cn } from '@/lib/utils'

type LiveMed = {
  /** the eMAR row's own Id - Auto — what add/delete edit at the source */
  id: string
  name: string
  dose: string
  route: string
  times: string[]
  prn: boolean
  freq: string
  image: string
  source: 'emar' | 'mars' | 'isp'
}
type LiveClient = { client: string; isp_year: string; isp_text: string; meds: LiveMed[] }

// One raw row of the `medications` resource — the eMAR mirror's own header names, intranet vocabulary kept verbatim…
type MedRow = Record<string, unknown>

// One imported eMAR pass — header-keyed text off mar_entries, dates as the sheet wrote them (yyyy-MM-dd, lexically…
type MarRow = {
  id: string; client: string; medication: string; schedule: string
  administeredBy: string; status: string; date: string
}

// One formulary row off `medCatalog` — the medicine cabinet with nobody's name on it, carrying the review workflow.
type CatalogMed = {
  id: string; name: string; strengths: string; forms: string
  instructions: string; is_controlled: string; prn: string; image: string
  seen_count: string; review_state: string
}

type MedOrdering = 'name-asc' | 'name-desc' | 'dose'

const ORDERING_LABEL: Record<MedOrdering, string> = {
  'name-asc': 'Name A→Z',
  'name-desc': 'Name Z→A',
  dose: 'Dose',
}

function doseValue(dose: string): number {
  const n = parseFloat(dose.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function orderMeds(meds: LiveMed[], ordering: MedOrdering): LiveMed[] {
  const out = [...meds]
  if (ordering === 'name-asc') out.sort((a, b) => a.name.localeCompare(b.name))
  else if (ordering === 'name-desc') out.sort((a, b) => b.name.localeCompare(a.name))
  else out.sort((a, b) => doseValue(a.dose) - doseValue(b.dose) || a.name.localeCompare(b.name))
  return out
}

function initialsOf(name: string): string {
  return name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase()
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim())

// The slice rows → per-client charts, the SAME reading rules Meds.gs applies on the live path (skip Discountinued…
function rowsToClients(rows: MedRow[]): LiveClient[] {
  const byClient = new Map<string, LiveClient>()
  for (const r of rows) {
    if (str(r['Discountinued'])) continue
    const client = str(r['Client'])
    const name = str(r['PrescriptionName'])
    if (!client || !name) continue
    const times = (str(r['AdministrationTimes']).match(/\d{3,4}/g) ?? [])
      .map((t) => `${t.slice(0, -2).padStart(2, '0')}:${t.slice(-2)}`)
    const prnText = str(r['PRN'])
    const med: LiveMed = {
      id: str(r['Id - Auto']),
      name,
      dose: str(r['Dosage']),
      route: str(r['MedType']),
      times,
      prn: /prn|as needed/i.test(prnText),
      freq: prnText,
      image: (str(r['med_pictures']).match(/https?:\/\/\S+/) ?? [''])[0],
      source: 'emar',
    }
    const entry = byClient.get(client) ?? { client, isp_year: '', isp_text: '', meds: [] }
    entry.meds.push(med)
    byClient.set(client, entry)
  }
  return [...byClient.values()].sort((a, b) => a.client.localeCompare(b.client))
}

/** Green dose chip — semantic status-green tokens (soft bg / strong fg). */
function DoseChip({ dose }: { dose: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--status-green-soft)] px-2 py-0.5 font-stat text-[11px] font-semibold leading-4 text-[var(--status-green)]">
      {dose}
    </span>
  )
}

function StatChip({ n, label, tone }: { n: number; label: string; tone: 'primary' | 'plain' | 'warning' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 font-stat text-[11px] font-semibold uppercase tracking-[0.08em]',
        tone === 'primary' && 'text-primary',
        tone === 'plain' && 'text-text-2',
        tone === 'warning' && 'border-warning/30 bg-tint-warning text-tint-fg-warning',
      )}
    >
      <span
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          tone === 'primary' ? 'bg-primary' : tone === 'warning' ? 'bg-warning' : 'bg-text-3',
        )}
      />
      {n} {label}
    </span>
  )
}

// The photo for a med: OUR absorbed copy first, the row's old URL only as a fallback while the old platform's…
const medPhoto = (m: { name: string; image?: string }): string | null =>
  medImageFor(m.name) ?? (m.image || null)

// Compact med row — the 44px rounded pill thumb (the REAL photo where one exists; icon-tile fallback otherwise)…
function MedCard({ med, index }: { med: LiveMed; index: number }) {
  const sub = [med.route, med.times.join(' · '), !med.times.length ? med.freq : '']
    .filter(Boolean).join(' · ')
  return (
    <motion.div
      initial={index < 12 ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.03, duration: 0.22, ease: EASE_OUT_EXPO }}
    >
      <Card hover className="flex items-center gap-3 p-3">
        <SafeImg
          src={medPhoto(med)}
          icon="pill"
          tint={tintForName(med.name)}
          shape="square"
          size={44}
          className="rounded-lg"
          alt={med.name}
        />
        <span className="min-w-0 flex-1">
          <span className="clamp-1 block text-[13px] font-semibold text-text-1">{med.name}</span>
          {sub && <span className="clamp-1 block text-[11px] text-text-3">{sub}</span>}
        </span>
        {med.dose && <DoseChip dose={med.dose} />}
      </Card>
    </motion.div>
  )
}

// ONE PERSON'S WHOLE CHART IN THE RAIL — all of it, for everybody, inside the horizontal scroll, with no click…
function PersonRailCard({ c, active, onOpen }: { c: LiveClient; active: boolean; onOpen: () => void }) {
  const prnCount = c.meds.filter((m) => m.prn).length
  const shown = orderMeds(c.meds, 'name-asc')
  return (
    <div
      className={cn(
        'w-[340px] max-w-[85vw] shrink-0 snap-start rounded-xl border bg-surface transition-colors duration-150',
        active ? 'border-primary shadow-sm' : 'border-border hover:border-border-strong',
      )}
    >
      <button onClick={onOpen} className="flex w-full items-center gap-2.5 px-4 pb-2 pt-3.5 text-left">
        <span
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
            active ? 'bg-primary text-on-primary' : 'bg-tint-mint text-tint-fg-mint',
          )}
        >
          {initialsOf(c.client)}
        </span>
        <span className="min-w-0 flex-1">
          <DragPerson name={c.client} type="client" title={`Drag ${c.client} to the top-left to focus the workspace`}>
            <span className={cn('clamp-1 block text-[14px] font-bold', active ? 'text-primary-strong' : 'text-text-1')}>
              {c.client}
            </span>
          </DragPerson>
          <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">
            {c.meds.length} meds · {c.meds.length - prnCount} scheduled · {prnCount} prn
            {!c.meds.length && c.isp_text ? ' · isp words' : ''}
          </span>
        </span>
      </button>
      <div className="scroll-thin max-h-[300px] space-y-1 overflow-y-auto px-3 pb-3">
        {shown.map((m) => (
          <div key={m.id || m.name} className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5">
            <SafeImg src={medPhoto(m)} icon="pill" tint={tintForName(m.name)} shape="square" size={30} className="rounded-md" alt={m.name} />
            <span className="min-w-0 flex-1">
              <span className="clamp-1 block text-[12px] font-semibold text-text-1">{m.name}</span>
              {(m.times.length > 0 || m.freq) && (
                <span className="clamp-1 block text-[10px] text-text-3">{m.times.join(' · ') || m.freq}</span>
              )}
            </span>
            {m.prn && <span className="shrink-0 rounded-full bg-tint-warning px-1.5 py-0.5 text-[9px] font-bold text-tint-fg-warning">PRN</span>}
            {m.dose && <span className="shrink-0 font-stat text-[10.5px] font-semibold text-[var(--status-green)]">{m.dose}</span>}
          </div>
        ))}
        {shown.length === 0 && (
          <p className="px-1 py-3 text-[11.5px] italic leading-5 text-text-3">
            {c.isp_text ? 'No structured rows — the ISP’s own words are the record (open the chart).' : 'No medication record found.'}
          </p>
        )}
      </div>
    </div>
  )
}

export default function MedicationsPage() {
  const focus = useContextStore((s) => s.focus)
  const canEdit = useAuthStore((st) => ['admin', 'manager'].includes(String(st.user?.role)))

  // TWO SOURCES, SHELF FIRST.
  const [ispClients, setIspClients] = useState<LiveClient[] | null>(null)
  const [rowClients, setRowClients] = useState<LiveClient[] | null>(null)
  const [liveClients, setLiveClients] = useState<LiveClient[] | null>(null)
  const [sliceRows, setSliceRows] = useState<MedRow[] | null>(null)
  const [liveFailed, setLiveFailed] = useState(false)
  const [rowsFailed, setRowsFailed] = useState(false)
  const [ispFailed, setIspFailed] = useState(false)

  // the FIRST paint — the clients slice's ISP-derived chips + narrative, on screen in the first second while the…
  useEffect(() => {
    api.list<{ name?: string; medications?: string[]; medications_text?: string; isp_year?: string }>('clients')
      .then((rows) => setIspClients((rows ?? [])
        .filter((r) => String(r.name || '').trim())
        .map((r) => ({
          client: String(r.name).trim(),
          isp_year: String(r.isp_year || ''),
          isp_text: String(r.medications_text || ''),
          meds: (r.medications ?? []).map((chip) => ({
            id: '', name: String(chip), dose: '', route: '', times: [],
            prn: false, freq: '', image: '', source: 'isp' as const,
          })),
        }))
        .sort((a, b) => a.client.localeCompare(b.client))))
      .catch(() => setIspFailed(true))
  }, [])
  useEffect(() => {
    api.list<MedRow>('medications')
      .then((rows) => { setSliceRows(rows ?? []); setRowClients(rowsToClients(rows ?? [])) })
      .catch(() => setRowsFailed(true))
  }, [])
  const loadLive = () => gasAction<{ clients: LiveClient[] }>('clientMedsIsp', {}, { timeoutMs: 60000 })
    .then((d) => setLiveClients(d.clients ?? []))
    .catch(() => setLiveFailed(true))
  useEffect(() => { void loadLive() }, [])

  const data = liveClients ?? rowClients ?? ispClients
  const failed = liveFailed && rowsFailed && ispFailed

  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [ordering, setOrdering] = useState<MedOrdering>('name-asc')
  const [showIsp, setShowIsp] = useState(false)
  const [tab, setTab] = useState<'people' | 'allmeds' | 'sheet'>('people')

  /** Chart / History / Editor — the per-person panel's own views. */
  const [view, setView] = useState<'chart' | 'history' | 'editor'>('chart')
  const [busy, setBusy] = useState('')

  // The administration HISTORY — lazily fetched once per visit and NEVER kept in browser storage: clinical rows…
  const [marRows, setMarRows] = useState<MarRow[] | null>(null)
  const [marBusy, setMarBusy] = useState(false)
  const [marError, setMarError] = useState('')
  useEffect(() => {
    if (view !== 'history' || tab !== 'people' || marRows !== null || marBusy) return
    setMarBusy(true)
    api.list<MarRow>('marEntries')
      .then((rows) => { setMarRows(rows ?? []); setMarError('') })
      .catch((e) => setMarError(e instanceof Error ? e.message : 'The pass log did not answer.'))
      .finally(() => setMarBusy(false))
  }, [view, tab, marRows, marBusy])

  // The formulary — every drug, no client (the medCatalog resource with its review workflow) — lazily on the All…
  const [catalog, setCatalog] = useState<CatalogMed[] | null>(null)
  const [catalogError, setCatalogError] = useState('')
  useEffect(() => {
    if (tab !== 'allmeds' || catalog !== null) return
    api.list<CatalogMed>('medCatalog')
      .then((rows) => { setCatalog(rows ?? []); setCatalogError('') })
      .catch((e) => setCatalogError(e instanceof Error ? e.message : 'The formulary did not answer.'))
  }, [tab, catalog])

  const [draft, setDraft] = useState({ name: '', dose: '', times: '', route: 'Tablet', prn: false })
  const removeMed = async (m: LiveMed) => {
    if (!m.id || busy) return
    setBusy(m.id)
    try {
      await gasAction('emarMedDelete', { id: m.id })
      await loadLive()
      toast({ type: 'success', title: `${m.name} removed`, body: 'The eMAR chart itself was edited.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not removed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }
  const addMed = async (client: string) => {
    if (!draft.name.trim() || busy) return
    setBusy('add')
    try {
      await gasAction('emarMedAdd', {
        client, name: draft.name.trim(), dose: draft.dose.trim(),
        times: draft.times, route: draft.route, prn: String(draft.prn),
      })
      setDraft({ name: '', dose: '', times: '', route: 'Tablet', prn: false })
      await loadLive()
      toast({ type: 'success', title: 'Medicine added to the chart', body: 'The eMAR workbook itself gained the row.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not added', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const lockedClient = focus?.type === 'client'
    ? (data ?? []).find((c) => c.client === focus.name)
    : undefined

  const selected = lockedClient
    ?? (data ?? []).find((c) => c.client === selectedName)
    ?? (data ?? [])[0]

  const railClients = useMemo(() => {
    const list = data ?? []
    if (!q) return list
    const needle = q.toLowerCase()
    return list.filter((c) =>
      c.client.toLowerCase().includes(needle) ||
      c.meds.some((m) => m.name.toLowerCase().includes(needle)))
  }, [data, q])

  const scheduled = useMemo(
    () => orderMeds((selected?.meds ?? []).filter((m) => !m.prn), ordering),
    [selected, ordering],
  )
  const prn = useMemo(
    () => orderMeds((selected?.meds ?? []).filter((m) => m.prn), ordering),
    [selected, ordering],
  )
  const sources = useMemo(() => {
    const label = { emar: 'eMAR', mars: 'MARS OCR', isp: 'ISP' } as const
    const set = new Set<string>((selected?.meds ?? []).map((m) => label[m.source] ?? m.source))
    if (selected?.isp_text) set.add(`ISP${selected.isp_year ? ' ' + selected.isp_year : ''}`)
    return [...set]
  }, [selected])

  // The consolidated Sheet rows — reference, read-only (the eMAR mirror as it stands, discontinued rows included…
  const sheetRows = useMemo(() => (sliceRows ?? [])
    .filter((r) => str(r['Client']) && str(r['PrescriptionName']))
    .map((r) => ({
      client: str(r['Client']),
      medication: str(r['PrescriptionName']),
      dosage: str(r['Dosage']),
      type: str(r['MedType']),
      prn: /prn|as needed/i.test(str(r['PRN'])) ? 'PRN' : 'Scheduled',
      instructions: str(r['PrescriptionInstructions']),
      controlled: str(r['controlled_status']),
      discontinued: str(r['Discountinued']) ? 'yes' : '',
    }))
    .sort((a, b) => a.client.localeCompare(b.client) || a.medication.localeCompare(b.medication)),
    [sliceRows])

  // PDF + share (top of the page).
  const sharePayload = () => {
    if (tab === 'sheet') {
      return {
        title: 'Medications — consolidated sheet',
        subtitle: `${sheetRows.length} rows · ${new Set(sheetRows.map((r) => r.client)).size} clients`,
        rows: sheetRows,
        columns: [
          { key: 'client', label: 'Client' }, { key: 'medication', label: 'Medication' },
          { key: 'dosage', label: 'Dosage' }, { key: 'type', label: 'Type' },
          { key: 'prn', label: 'PRN' }, { key: 'instructions', label: 'Instructions' },
          { key: 'controlled', label: 'Controlled' }, { key: 'discontinued', label: 'Discontinued' },
        ],
        filename: 'medications-sheet', icon: 'pill',
      }
    }
    if (tab === 'allmeds') {
      const rows = catalog ?? []
      return {
        title: 'Medication formulary — every drug',
        subtitle: `${rows.length} medicines, no client attached`,
        rows,
        columns: [
          { key: 'name', label: 'Name' }, { key: 'strengths', label: 'Strengths' },
          { key: 'forms', label: 'Forms' }, { key: 'prn', label: 'PRN' },
          { key: 'instructions', label: 'Instructions' }, { key: 'review_state', label: 'Review' },
        ],
        filename: 'medication-formulary', icon: 'pill',
      }
    }
    const c = selected
    return {
      title: c ? `Medications — ${c.client}` : 'Medications',
      subtitle: c ? `${c.meds.length} meds · ${c.meds.filter((m) => !m.prn).length} scheduled · ${c.meds.filter((m) => m.prn).length} PRN` : undefined,
      rows: (c?.meds ?? []).map((m) => ({
        name: m.name, dose: m.dose, route: m.route,
        times: m.times.join(' · ') || m.freq, prn: m.prn ? 'PRN' : 'Scheduled',
      })),
      columns: [
        { key: 'name', label: 'Medication' }, { key: 'dose', label: 'Dose' },
        { key: 'route', label: 'Type' }, { key: 'times', label: 'Times' }, { key: 'prn', label: 'PRN' },
      ],
      text: c?.isp_text ? `ISP${c.isp_year ? ' ' + c.isp_year : ''} — its own words:\n${c.isp_text}` : undefined,
      filename: c ? `medications-${c.client.toLowerCase().replace(/\s+/g, '-')}` : 'medications',
      icon: 'pill',
    }
  }

  if (failed) {
    return (
      <div className="w-full">
        <EmptyState
          title="The medication record did not answer"
          body="Neither the snapshot shelf nor the live record answered — nothing here is invented, so nothing is shown until one of them does."
        />
      </div>
    )
  }
  if (data === null) {
    return (
      <p className="flex items-center gap-2 py-10 text-[13px] text-text-3">
        <Loader2 size={14} className="animate-spin" /> Reading every client's medication record…
      </p>
    )
  }

  const countsLabel = {
    people: `By Person · ${(data ?? []).length}`,
    allmeds: catalog ? `All Meds · ${catalog.length}` : 'All Meds',
    sheet: `Sheet · ${sheetRows.length}`,
  }

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="w-full">
      <PageHeader
        title="Medications"
        subtitle="Per-person med charts, the whole-drug formulary and the consolidated sheet — eMAR, MARS OCR and the ISPs, photos served from the platform's own copies."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => share(sharePayload())}
              title="Print / save as PDF"
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2"
            >
              <Printer size={14} className="text-text-2" /> PDF
            </button>
            <button
              onClick={() => share(sharePayload())}
              title="Share — copy, email, download"
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2"
            >
              <Share2 size={14} className="text-text-2" /> Share
            </button>
          </div>
        }
      />

      <div className="mb-4 mt-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          tabs={[
            { id: 'people', label: countsLabel.people },
            { id: 'allmeds', label: countsLabel.allmeds },
            { id: 'sheet', label: countsLabel.sheet },
          ]}
          value={tab}
          onChange={(id) => setTab(id as 'people' | 'allmeds' | 'sheet')}
        />
        {tab !== 'sheet' && (
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder={tab === 'people' ? 'Search clients or medicines…' : 'Search medication…'}
            className="w-[260px] max-w-full"
          />
        )}
        {liveClients === null && !liveFailed && (
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">
            <Loader2 size={11} className="animate-spin" /> enriching from the live record…
          </span>
        )}
      </div>

      {tab === 'sheet' ? (
        <SheetView rows={sheetRows} loading={sliceRows === null && !rowsFailed} />
      ) : tab === 'allmeds' ? (
        <AllMedsGrid
          catalog={catalog}
          error={catalogError}
          q={q}
          canEdit={canEdit}
          onChanged={() => setCatalog(null)}
        />
      ) : (
        <>
          {lockedClient && <ContextBanner filtered />}

          {/* THE RAIL — every person, every med, no click required */}
          {!lockedClient && (
            <motion.div variants={staggerItem} className="scroll-fade mb-5 flex snap-x items-stretch gap-3 overflow-x-auto pb-2">
              {railClients.map((c) => (
                <PersonRailCard
                  key={c.client}
                  c={c}
                  active={c.client === selected?.client}
                  onOpen={() => setSelectedName(c.client)}
                />
              ))}
              {railClients.length === 0 && (
                <span className="py-4 text-[13px] text-text-3">No clients match “{q}”.</span>
              )}
            </motion.div>
          )}

          {!selected ? (
            <EmptyState title="No clients on the record yet" body="The eMAR mirror, MARS OCR and ISP loads fill this." />
          ) : (
            <>
              {/* header card for the person in focus */}
              <motion.div variants={staggerItem}>
                <Card className="mb-4 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <DragPerson name={selected.client} type="client">
                      <h2 className="font-display text-[22px] font-bold leading-[28px] tracking-[-0.015em] text-text-1">
                        {selected.client}
                      </h2>
                    </DragPerson>
                    <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
                      {sources.length > 0 ? `From ${sources.join(' · ')}` : 'No medication record found'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatChip n={selected.meds.length} label="Meds" tone="primary" />
                    <StatChip n={scheduled.length} label="Scheduled" tone="plain" />
                    <StatChip n={prn.length} label="PRN" tone={prn.length > 0 ? 'warning' : 'plain'} />
                  </div>
                </Card>
              </motion.div>

              {/* toolbar row */}
              <motion.div variants={staggerItem} className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-text-2">
                    Current Medications
                  </span>
                  <span className="rounded-full bg-surface-3 px-2 py-0.5 font-stat text-[11px] font-semibold text-text-2">
                    {selected.meds.length} total
                  </span>
                </div>
                {/* Chart = what is prescribed · History = what was actually given ·
                    Editor = change the source (admin/manager) */}
                <SegmentedTabs
                  tabs={[
                    { id: 'chart', label: 'Chart' },
                    { id: 'history', label: 'History' },
                    ...(canEdit ? [{ id: 'editor', label: 'Chart Editor' }] : []),
                  ]}
                  value={view}
                  onChange={(id) => setView(id as 'chart' | 'history' | 'editor')}
                />
                {selected.isp_text && (
                  <button
                    onClick={() => setShowIsp((v) => !v)}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2"
                  >
                    <FileText size={14} className="text-text-2" />
                    {showIsp ? 'Hide the ISP words' : `ISP${selected.isp_year ? ' ' + selected.isp_year : ''} — its own words`}
                  </button>
                )}
              </motion.div>

              {/* THE ISP'S OWN WORDS — narrative, shown as narrative, never
                  parsed into fake rows. For clients the eMAR does not cover,
                  this IS the medication record. */}
              {showIsp && selected.isp_text && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
                  <Card className="border-l-2 border-l-primary">
                    <p className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-text-3">
                      The ISP's medications section, verbatim
                    </p>
                    <p className="whitespace-pre-wrap text-[13px] leading-6 text-text-2">{selected.isp_text}</p>
                  </Card>
                </motion.div>
              )}

              {view === 'history' ? (
                <MarHistory
                  client={selected.client}
                  rows={marRows}
                  busy={marBusy}
                  error={marError}
                />
              ) : view === 'editor' ? (
                <Card>
                  <p className="mb-3 text-[13px] font-bold text-text-1">
                    Chart Editor — <DragPerson name={selected.client} type="client">{selected.client}</DragPerson>
                  </p>
                  <div className="mb-4 space-y-1">
                    {selected.meds.map((m) => (
                      <div key={m.id || m.name} className="flex items-center gap-2.5 rounded-md border border-border/70 px-3 py-2 text-[12.5px]">
                        <span className="min-w-0 flex-1">
                          <span className="clamp-1 block font-semibold text-text-1">{m.name}</span>
                          <span className="text-[11px] text-text-3">{[m.dose, m.route, m.times.join(' · ') || m.freq].filter(Boolean).join(' · ')}</span>
                        </span>
                        {m.prn && <span className="shrink-0 rounded-full bg-tint-warning px-2 py-0.5 text-[10px] font-bold text-tint-fg-warning">PRN</span>}
                        <button onClick={() => void removeMed(m)} disabled={!m.id || busy === m.id}
                          title="Delete from the eMAR chart itself"
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-danger disabled:opacity-40">
                          {busy === m.id ? <Loader2 size={12} className="animate-spin" /> : <X size={13} />}
                        </button>
                      </div>
                    ))}
                    {selected.meds.length === 0 && (
                      <p className="py-3 text-center text-[12px] italic text-text-3">
                        No rows on the chart for <DragPerson name={selected.client} type="client">{selected.client}</DragPerson> yet.
                      </p>
                    )}
                  </div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-text-3">Add a medicine — this writes the eMAR chart itself</p>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_100px_130px_110px_auto_auto]">
                    <input value={draft.name} placeholder="Prescription name" onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
                    <input value={draft.dose} placeholder="Dose" onChange={(e) => setDraft((d) => ({ ...d, dose: e.target.value }))}
                      className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
                    <input value={draft.times} placeholder="Times: 0800 2000" onChange={(e) => setDraft((d) => ({ ...d, times: e.target.value }))}
                      className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
                    <select value={draft.route} onChange={(e) => setDraft((d) => ({ ...d, route: e.target.value }))}
                      className="h-9 rounded-md border border-border bg-surface px-2 text-[13px] text-text-1 outline-none">
                      {['Tablet', 'Capsule', 'Liquid', 'Injection', 'Cream', 'Other'].map((r) => <option key={r}>{r}</option>)}
                    </select>
                    <label className="flex items-center gap-1.5 text-[12px] font-semibold text-text-2">
                      <input type="checkbox" checked={draft.prn} onChange={(e) => setDraft((d) => ({ ...d, prn: e.target.checked }))} /> PRN
                    </label>
                    <button onClick={() => void addMed(selected.client)} disabled={!draft.name.trim() || busy === 'add'}
                      className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-40">
                      {busy === 'add' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
                    </button>
                  </div>
                </Card>
              ) : selected.meds.length === 0 ? (
                <Card>
                  <p className="py-6 text-center text-[13px] leading-6 text-text-3">
                    The eMAR and MARS records hold no structured rows for{' '}
                    <DragPerson name={selected.client} type="client">{selected.client}</DragPerson>.
                    {selected.isp_text
                      ? ' The ISP’s own words above are the record.'
                      : ' No ISP medications section was found either.'}
                  </p>
                </Card>
              ) : (
                <>
                  {/* scheduled grid */}
                  <motion.div variants={staggerItem} className="mb-2 flex items-center justify-between gap-3">
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-text-3">
                      Scheduled · {scheduled.length}
                    </span>
                    <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                      Ordering
                      <select
                        value={ordering}
                        onChange={(e) => setOrdering(e.target.value as MedOrdering)}
                        className="h-8 rounded-sm border border-border bg-surface px-2 text-[12px] font-medium normal-case tracking-normal text-text-1 outline-none focus:border-border-strong"
                      >
                        {(Object.keys(ORDERING_LABEL) as MedOrdering[]).map((k) => (
                          <option key={k} value={k}>
                            {ORDERING_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </motion.div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {scheduled.map((m, i) => (
                      <MedCard key={m.name + i} med={m} index={i} />
                    ))}
                  </div>

                  {/* PRN section */}
                  {prn.length > 0 && (
                    <>
                      <div className="mb-2 mt-6 flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-tint-fg-warning">
                          PRN · {prn.length}
                        </span>
                        <span className="text-[11px] text-text-3">as-needed — not on the scheduled grid</span>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {prn.map((m, i) => (
                          <MedCard key={m.name + i} med={m} index={i} />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </motion.div>
  )
}

// ALL MEDS — the formulary as photo cards.
function AllMedsGrid({ catalog, error, q, canEdit, onChanged }: {
  catalog: CatalogMed[] | null; error: string; q: string; canEdit: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState({ strengths: '', instructions: '' })
  const [saving, setSaving] = useState('')
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState({ name: '', strengths: '', instructions: '', prn: false })

  const shown = useMemo(() => {
    const list = catalog ?? []
    const needle = q.trim().toLowerCase()
    const filtered = needle ? list.filter((m) => (m.name || '').toLowerCase().includes(needle)) : list
    return [...filtered].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [catalog, q])

  const truthy = (v: string) => /^(1|true|yes|y)/i.test(String(v || '').trim())

  const save = async (m: CatalogMed) => {
    setSaving(m.id)
    try {
      await api.update('medCatalog', m.id, { strengths: edit.strengths, instructions: edit.instructions })
      setEditing(null)
      onChanged()
      toast({ type: 'success', title: `${m.name} updated` })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setSaving('') }
  }
  const approve = async (m: CatalogMed) => {
    setSaving(m.id)
    try {
      await api.update('medCatalog', m.id, { review_state: 'approved' })
      onChanged()
      toast({ type: 'success', title: `${m.name} approved`, body: 'Reviewed into the formulary.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not approved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setSaving('') }
  }
  const addNew = async () => {
    if (!addDraft.name.trim()) return
    setSaving('add')
    try {
      await api.create('medCatalog', {
        name: addDraft.name.trim(), strengths: addDraft.strengths.trim(),
        instructions: addDraft.instructions.trim(), prn: addDraft.prn ? '1' : '',
        review_state: 'approved',
      })
      setAddDraft({ name: '', strengths: '', instructions: '', prn: false })
      setAdding(false)
      onChanged()
      toast({ type: 'success', title: 'Medicine added to the formulary' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not added', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setSaving('') }
  }

  if (error) return <Card><p className="py-4 text-[13px] text-danger">{error}</p></Card>
  if (catalog === null) {
    return (
      <p className="flex items-center gap-2 py-8 text-[13px] text-text-3">
        <Loader2 size={14} className="animate-spin" /> Reading the formulary…
      </p>
    )
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-text-2">
          Medication formulary — every drug · {shown.length} · photo + details, no client
        </span>
        {canEdit && (
          <button
            onClick={() => setAdding((v) => !v)}
            className="flex h-9 items-center gap-1.5 rounded-md border border-primary/40 bg-primary-soft px-3 text-[12.5px] font-semibold text-primary-strong hover:bg-primary-soft/70"
          >
            <Plus size={13} /> Add med
          </button>
        )}
      </div>

      {adding && (
        <Card className="mb-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_160px_minmax(0,3fr)_auto_auto]">
            <input value={addDraft.name} placeholder="Medicine name" onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))}
              className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
            <input value={addDraft.strengths} placeholder="Strengths (500mg…)" onChange={(e) => setAddDraft((d) => ({ ...d, strengths: e.target.value }))}
              className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
            <input value={addDraft.instructions} placeholder="Instructions" onChange={(e) => setAddDraft((d) => ({ ...d, instructions: e.target.value }))}
              className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-text-2">
              <input type="checkbox" checked={addDraft.prn} onChange={(e) => setAddDraft((d) => ({ ...d, prn: e.target.checked }))} /> PRN
            </label>
            <button onClick={() => void addNew()} disabled={!addDraft.name.trim() || saving === 'add'}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-40">
              {saving === 'add' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
            </button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((m, i) => {
          const isEditing = editing === m.id
          const unreviewed = (m.review_state || 'unreviewed') !== 'approved'
          return (
            <motion.div
              key={m.id || m.name}
              initial={i < 12 ? { opacity: 0, y: 10 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.02, duration: 0.2, ease: EASE_OUT_EXPO }}
            >
              <Card hover className="flex h-full flex-col gap-2.5 p-3.5">
                <div className="flex items-start gap-3">
                  <SafeImg
                    src={medImageFor(m.name) ?? (m.image || null)}
                    icon="pill"
                    tint={tintForName(m.name || '?')}
                    shape="square"
                    size={52}
                    className="rounded-lg"
                    alt={m.name}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="clamp-1 text-[13.5px] font-bold text-text-1">{m.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {truthy(m.prn) ? (
                        <span className="rounded-full bg-tint-warning px-1.5 py-0.5 text-[9px] font-bold uppercase text-tint-fg-warning">PRN</span>
                      ) : (
                        <span className="rounded-full bg-[var(--status-green-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--status-green)]">Scheduled</span>
                      )}
                      {(m.forms || '').split(/[,;·]/).map((f) => f.trim()).filter(Boolean).slice(0, 2).map((f) => (
                        <span key={f} className="rounded-full border border-border bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold uppercase text-text-2">{f}</span>
                      ))}
                      {truthy(m.is_controlled) && (
                        <span className="rounded-full bg-tint-pink px-1.5 py-0.5 text-[9px] font-bold uppercase text-tint-fg-pink">Controlled</span>
                      )}
                      {unreviewed && (
                        <span className="rounded-full border border-warning/40 px-1.5 py-0.5 text-[9px] font-bold uppercase text-tint-fg-warning">{m.review_state || 'unreviewed'}</span>
                      )}
                    </div>
                  </div>
                  {canEdit && !isEditing && (
                    <button
                      onClick={() => { setEditing(m.id); setEdit({ strengths: m.strengths || '', instructions: m.instructions || '' }) }}
                      title="Edit this medicine"
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1"
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <input value={edit.strengths} placeholder="Strengths" onChange={(e) => setEdit((d) => ({ ...d, strengths: e.target.value }))}
                      className="h-8 w-full rounded-md border border-border bg-surface px-2.5 text-[12px] text-text-1 outline-none focus:border-primary" />
                    <textarea value={edit.instructions} placeholder="Instructions" rows={2} onChange={(e) => setEdit((d) => ({ ...d, instructions: e.target.value }))}
                      className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] leading-5 text-text-1 outline-none focus:border-primary" />
                    <div className="flex items-center gap-2">
                      <button onClick={() => void save(m)} disabled={saving === m.id}
                        className="flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-[12px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-40">
                        {saving === m.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
                      </button>
                      <button onClick={() => setEditing(null)} className="h-8 rounded-md border border-border px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {(m.strengths || '').split(/[,;·]/).map((s) => s.trim()).filter(Boolean).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(m.strengths || '').split(/[,;·]/).map((s) => s.trim()).filter(Boolean).slice(0, 4).map((s) => (
                          <span key={s} className="rounded-md bg-surface-3 px-1.5 py-0.5 font-stat text-[10.5px] font-semibold text-text-2">{s}</span>
                        ))}
                      </div>
                    )}
                    {m.instructions && (
                      <p className="clamp-3 text-[11.5px] leading-5 text-text-3">{m.instructions}</p>
                    )}
                    {canEdit && unreviewed && (
                      <button onClick={() => void approve(m)} disabled={saving === m.id}
                        className="mt-auto flex h-8 w-fit items-center gap-1.5 rounded-md border border-[var(--status-green)]/40 bg-[var(--status-green-soft)] px-2.5 text-[11.5px] font-semibold text-[var(--status-green)] disabled:opacity-40">
                        {saving === m.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve into the formulary
                      </button>
                    )}
                  </>
                )}
              </Card>
            </motion.div>
          )
        })}
      </div>
      {shown.length === 0 && (
        <Card><p className="py-6 text-center text-[13px] text-text-3">No medicines match.</p></Card>
      )}
    </>
  )
}

// THE SHEET — the consolidated reference table, the eMar administration records.
function SheetView({ rows, loading }: {
  rows: { client: string; medication: string; dosage: string; type: string; prn: string; instructions: string; controlled: string; discontinued: string }[]
  loading: boolean
}) {
  const clients = useMemo(() => new Set(rows.map((r) => r.client)).size, [rows])
  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-[13px] text-text-3">
        <Loader2 size={14} className="animate-spin" /> Reading the consolidated sheet…
      </p>
    )
  }
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-[13px] font-bold text-text-1">eMAR · administration records</span>
        <span className="font-stat text-[12px] font-semibold text-text-2">{rows.length} meds · {clients} clients</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-3">
              <th className="px-4 py-2.5 font-semibold">Client</th>
              <th className="px-3 py-2.5 font-semibold">Medication</th>
              <th className="px-3 py-2.5 font-semibold">Dosage</th>
              <th className="px-3 py-2.5 font-semibold">Type</th>
              <th className="px-3 py-2.5 font-semibold">PRN</th>
              <th className="px-3 py-2.5 font-semibold">Instructions</th>
              <th className="px-3 py-2.5 font-semibold">Controlled</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={cn('border-b border-border/50', r.discontinued && 'opacity-45')}>
                <td className="px-4 py-2 font-medium text-text-1">
                  <DragPerson name={r.client} type="client">{r.client}</DragPerson>
                </td>
                <td className="px-3 py-2 text-text-1">
                  {r.medication}
                  {r.discontinued && <span className="ml-1.5 rounded bg-surface-3 px-1 text-[9px] font-bold uppercase text-text-3">discontinued</span>}
                </td>
                <td className="px-3 py-2">
                  {r.dosage && <span className="rounded-md bg-surface-3 px-1.5 py-0.5 font-stat text-[11px] font-semibold text-text-2">{r.dosage}</span>}
                </td>
                <td className="px-3 py-2 text-text-2">{r.type}</td>
                <td className="px-3 py-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold',
                    r.prn === 'PRN' ? 'bg-tint-warning text-tint-fg-warning' : 'bg-[var(--status-green-soft)] text-[var(--status-green)]')}>
                    {r.prn}
                  </span>
                </td>
                <td className="max-w-[300px] px-3 py-2 text-[11.5px] leading-5 text-text-3">
                  <span className="clamp-2 block">{r.instructions}</span>
                </td>
                <td className="px-3 py-2 text-[11px] text-text-3">{r.controlled || '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[13px] text-text-3">The mirror holds no rows.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// Schedule chips wear the eMAR's own measured vocabulary; anything else is neutral.
const SCHEDULE_TINT: Record<string, string> = {
  '8:00 AM': 'bg-tint-mint text-tint-fg-mint',
  '2:00 PM': 'bg-tint-amber text-tint-fg-amber',
  '4:00 PM': 'bg-tint-amber text-tint-fg-amber',
  '5:00 PM': 'bg-tint-amber text-tint-fg-amber',
  '8:00 PM': 'bg-tint-lavender text-tint-fg-lavender',
}
const PASS_TINT: Record<string, string> = {
  Pass: 'bg-tint-mint text-tint-fg-mint',
  Cancel: 'bg-tint-amber text-tint-fg-amber',
  Discontinued: 'bg-tint-pink text-tint-fg-pink',
}

// THE HISTORY VIEW — the administration pass log for the selected client.
function MarHistory({ client, rows, busy, error }: {
  client: string; rows: MarRow[] | null; busy: boolean; error: string
}) {
  const key = client.trim().toLowerCase()
  const mine = useMemo(() => (rows ?? [])
    .filter((r) => String(r.client || '').trim().toLowerCase() === key)
    .sort((a, b) => String(b.date).localeCompare(String(a.date))), [rows, key])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of mine) c[r.status || '—'] = (c[r.status || '—'] ?? 0) + 1
    return c
  }, [mine])
  const byDate = useMemo(() => {
    const m = new Map<string, MarRow[]>()
    for (const r of mine) {
      const d = r.date || '(undated)'
      const list = m.get(d)
      if (list) list.push(r)
      else m.set(d, [r])
    }
    return [...m.entries()]
  }, [mine])

  if (busy && rows === null) {
    return (
      <Card>
        <p className="flex items-center gap-2 py-6 text-center text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the pass log…
        </p>
      </Card>
    )
  }
  if (error) {
    return <Card><p className="py-4 text-[13px] text-danger">{error}</p></Card>
  }
  if (rows !== null && mine.length === 0) {
    return (
      <Card>
        <p className="py-6 text-center text-[13px] leading-6 text-text-3">
          The pass log holds no rows for{' '}
          <DragPerson name={client} type="client">{client}</DragPerson>
          {rows.length ? <> — {rows.length} passes on file belong to other clients (a name-spelling drift would land here too).</> : '.'}
        </p>
      </Card>
    )
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {Object.entries(counts).map(([st, n]) => (
          <span key={st} className={cn('rounded-full px-2.5 py-0.5 font-stat text-[11px] font-semibold',
            PASS_TINT[st] ?? 'bg-surface-3 text-text-2')}>
            {st} · {n}
          </span>
        ))}
        {mine[0]?.date && (
          <span className="text-[11px] text-text-3">latest {mine[0].date}</span>
        )}
      </div>
      <div className="space-y-3">
        {byDate.map(([d, list]) => (
          <Card key={d}>
            <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-text-3">{d}</p>
            <div className="space-y-1.5">
              {list.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className={cn('rounded px-1.5 py-0.5 font-stat text-[11px] font-semibold',
                    SCHEDULE_TINT[r.schedule] ?? 'bg-surface-3 text-text-2')}>
                    {r.schedule || '—'}
                  </span>
                  <span className="font-medium text-text-1">{r.medication || '(unnamed)'}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                    PASS_TINT[r.status] ?? 'bg-surface-3 text-text-3')}>
                    {r.status || '—'}
                  </span>
                  {/* the platform's own admin account is the importer, not a
                      DSP who passed the med — asatech is the system
                      administrator, not a caregiver */}
                  {r.administeredBy && !/asatech/i.test(r.administeredBy) && (
                    <span className="text-text-3">by {r.administeredBy}</span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}
