// One house: the photo (a click opens it full size), the street, the house manager, the clients, the APP Tools, the…
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle, ArrowLeft, ChevronRight, FileText, MapPin, Phone, RefreshCw } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card, { CardHeader } from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import ImageLightbox from '@/components/shared/ImageLightbox'
import SafeImg, { IconTile } from '@/components/shared/SafeImg'
import { useCan } from '@/auth/permissions'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { openFile } from '@/stores/useFileViewerStore'
import { cn } from '@/lib/utils'
import { useEffectiveUser } from '@/lib/effectiveUser'
import {
  clientProfileHref, clientStaleLine, seesSourceHealth, shortDay, staffCaption, staleSources, type DetailView,
  type HouseDay,
} from './houseModel'
import { houseTools, policyOpen, type FileTarget, type ToolMode } from './houseTools'
import HouseFilingModal from './HouseFilingModal'

const actionBtn =
  'flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2'

export default function HouseDetail({
  view,
  mode,
  day,
  dayWhy = '',
  timeOff,
  onBack,
  onRefresh,
  loading = false,
}: {
  view: DetailView
  mode: ToolMode
  /** staff only; null while the roster is unknown */
  day?: HouseDay | null
  dayWhy?: string
  timeOff: boolean
  onBack?: () => void
  onRefresh: () => void
  loading?: boolean
}) {
  const navigate = useNavigate()
  const canOpenClients = useCan('clients.view')
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [filing, setFiling] = useState<FileTarget | null>(null)
  const stale = seesSourceHealth(useEffectiveUser()) ? staleSources(view.sources) : []
  const tools = houseTools({ code: view.code, calendar_location: view.calendarLocation }, mode, { timeOff })

  return (
    <div className="w-full px-4 py-6 sm:px-5">
      {onBack && (
        <button type="button" onClick={onBack}
          className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-2 transition-colors hover:text-text-1">
          <ArrowLeft size={15} /> All houses
        </button>
      )}
      <PageHeader
        title={view.title}
        subtitle={[view.city, view.code].filter(Boolean).join(' · ')}
        actions={
          <button type="button" onClick={onRefresh} className={actionBtn}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      {stale.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md bg-tint-amber px-3 py-2 text-[12px] leading-4 text-tint-fg-amber">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          {mode === 'client' ? (
            <p>{clientStaleLine(view.sources)}</p>
          ) : (
            <div>
              {stale.map((s) => (
                <p key={s.key}><strong>{s.label}</strong> is {s.state}{s.why ? ` — ${s.why}` : ''}.</p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card padded={false} className="overflow-hidden">
          {view.photo.src ? (
            <button type="button" onClick={() => setLightbox(view.photo.src)} className="block w-full"
              aria-label={`Open the photo of ${view.title}`}>
              <SafeImg src={view.photo.src} icon="house" shape="square" eager
                size="aspect-[4/3] w-full" className="rounded-none" alt={view.title} />
            </button>
          ) : (
            <div className="grid aspect-[4/3] w-full place-items-center bg-surface-2">
              <div className="grid justify-items-center gap-2">
                <IconTile icon="house" size={72} />
                <p className="text-[12px] text-text-3">No photo in the Image Bank</p>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Details" />
          <div className="grid gap-4">
            <div className="flex items-start gap-3">
              <MapPin size={16} className="mt-0.5 shrink-0 text-text-3" />
              {view.address ? (
                <button type="button" className="text-left text-[13.5px] text-text-1 hover:underline"
                  onClick={() => openFile({ title: view.title, subtitle: view.address, icon: 'map-pin',
                    url: `https://maps.google.com/?q=${encodeURIComponent(view.address)}` })}>
                  {view.address}
                </button>
              ) : (
                <p className="text-[13px] text-text-3">No street on file{view.addressWhy ? ` — ${view.addressWhy}` : ''}.</p>
              )}
            </div>

            <div className="grid gap-3">
              {view.managers.map((m) => (
                <div key={m.name} className="flex items-center gap-3">
                  <Avatar src={m.avatar} name={m.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <DragPerson name={m.name} type="staff" avatar={m.avatar} subtitle="House manager">
                      <p className="clamp-1 text-[14px] font-semibold text-text-1">{m.name}</p>
                    </DragPerson>
                    <p className="text-[12px] text-text-3">House manager · on the calendar {shortDay(m.last_day)}</p>
                  </div>
                  {m.phone ? (
                    <a href={`tel:${m.phone.replace(/\D/g, '')}`}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2">
                      <Phone size={13} /> {formatPhoneDisplay(m.phone)}
                    </a>
                  ) : (
                    <span className="shrink-0 text-[12px] text-text-3" title={mode === 'staff' ? m.phone_why : undefined}>
                      {m.phone_known === false ? 'Phone unknown' : mode === 'client' ? 'No phone on file' : 'No phone in People'}
                    </span>
                  )}
                </div>
              ))}
              {view.managers.length === 0 && (
                <p className="text-[13px] text-text-3">
                  {mode === 'client' ? 'No house manager on file' : 'No house manager on the hotline calendar'}
                  {view.managersWhy ? ` — ${view.managersWhy}` : ''}.
                </p>
              )}
              {view.leads.map((l) => (
                <div key={l.name} className="flex items-center gap-3">
                  <Avatar name={l.name} size="sm" />
                  <div className="min-w-0">
                    <DragPerson name={l.name} type="staff" subtitle="Team lead / director">
                      <p className="clamp-1 text-[13px] font-semibold text-text-1">{l.name}</p>
                    </DragPerson>
                    <p className="text-[12px] text-text-3">Team lead / director · last on the calendar {shortDay(l.last_day)}</p>
                  </div>
                </div>
              ))}
            </div>

            {day ? (
              <div className="flex flex-wrap gap-1.5 border-t border-border pt-3 text-[12px] text-text-2">
                <span className="rounded-full bg-surface-2 px-2.5 py-0.5">{day.today} shift{day.today === 1 ? '' : 's'} today</span>
                <span className="rounded-full bg-surface-2 px-2.5 py-0.5">{day.covered}/7 days covered</span>
                <span className="rounded-full bg-surface-2 px-2.5 py-0.5">
                  {day.onDuty.length ? `On duty now: ${day.onDuty.join(', ')}` : 'Nobody on duty right now'}
                </span>
              </div>
            ) : mode === 'staff' ? (
              <p className="border-t border-border pt-3 text-[12px] text-text-3">
                {dayWhy ? `Who is on duty is unknown — the roster could not be read: ${dayWhy}.` : 'Reading the roster…'}
              </p>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={mode === 'client' ? 'Resident' : 'Clients'} sub={view.peopleNote || undefined} />
          <div className="flex flex-wrap gap-5">
            {view.people.map((c) => {
              const link = mode === 'staff' && canOpenClients && c.client_id
              const face = (
                <span className="grid w-20 justify-items-center gap-1.5 text-center">
                  <Avatar src={c.avatar} name={c.name} size="xl" />
                  <span className="text-[12.5px] font-medium leading-4 text-text-1">{c.name}</span>
                </span>
              )
              return link ? (
                <button key={c.name} type="button" className="rounded-lg transition-opacity hover:opacity-80"
                  onClick={() => navigate(clientProfileHref(c))}>
                  <DragPerson name={c.name} id={c.client_id} type="client" avatar={c.avatar}>{face}</DragPerson>
                </button>
              ) : (
                <DragPerson key={c.name} name={mode === 'staff' ? c.name : ''} type="client" avatar={c.avatar}>{face}</DragPerson>
              )
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="APP Tools" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {tools.map((t) => (
              <button key={t.key} type="button" disabled={!t.href && !t.file}
                onClick={() => (t.file ? setFiling(t.file) : t.href && navigate(t.href))}
                className={cn('grid justify-items-center gap-2 rounded-lg border border-border p-3 text-center transition-colors',
                  t.href || t.file ? 'hover:bg-surface-2' : 'cursor-not-allowed opacity-60')}>
                <IconTile icon={t.icon} size={40} />
                <span className="text-[12.5px] font-semibold leading-4 text-text-1">{t.label}</span>
                <span className="text-[11px] text-text-3">{t.note}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className={cn('mt-4 grid gap-4', view.staff && 'lg:grid-cols-2')}>
        {view.staff && (
          <Card>
            <CardHeader title="Staff — recent months" sub={staffCaption(view.staff)} />
            <div className="grid gap-2">
              {view.staff.staff.map((s) => (
                <div key={s.name} className="flex items-center gap-3">
                  <Avatar src={s.avatar} name={s.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <DragPerson name={s.name} type="staff" avatar={s.avatar}>
                      <span className="clamp-1 text-[13px] font-semibold text-text-1">{s.name}</span>
                    </DragPerson>
                    <span className="flex flex-wrap gap-1">
                      {s.hm && <span className="rounded bg-tint-mint px-1.5 text-[10.5px] font-semibold text-tint-fg-mint">House manager</span>}
                      {s.lead && <span className="rounded bg-tint-lavender px-1.5 text-[10.5px] font-semibold text-tint-fg-lavender">Team lead / director</span>}
                    </span>
                  </div>
                  <span className="shrink-0 text-right text-[12px] text-text-2">
                    {s.shifts} shift{s.shifts === 1 ? '' : 's'}
                    <span className="block text-[11px] text-text-3">last {shortDay(s.last_day)}</span>
                  </span>
                </div>
              ))}
              {view.staff.staff.length === 0 && <p className="text-[13px] text-text-3">Nobody on record for these months.</p>}
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="Company Policies" />
          <div className="grid gap-1">
            {view.policies.map((p) => {
              const open = policyOpen(p, mode)
              return (
                <button key={p.title} type="button"
                  onClick={() => open.kind === 'in-app'
                    ? navigate(open.href)
                    : openFile({ title: p.title, subtitle: 'Company Policies', url: open.url, icon: 'file-text' })}
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2">
                  <FileText size={16} className="shrink-0 text-text-3" />
                  <span className="min-w-0 flex-1 text-[13.5px] text-text-1">{p.title}</span>
                  {open.kind === 'in-app' && <span className="text-[11px] text-text-3">Policies</span>}
                  <ChevronRight size={14} className="shrink-0 text-text-3" />
                </button>
              )
            })}
            {view.policies.length === 0 && <p className="text-[13px] text-text-3">No documents listed.</p>}
          </div>
        </Card>
      </div>

      {mode === 'staff' && (day?.roster.length || view.weekNotes.length) ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {day && day.roster.length > 0 && (
            <Card>
              <CardHeader title="Upcoming roster" />
              <div className="grid gap-1.5">
                {day.roster.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <DragPerson name={r.staff} type="staff"><span className="font-semibold text-text-1">{r.staff}</span></DragPerson>
                    <span className="text-right text-text-3">{[r.when, r.status].filter(Boolean).join(' · ')}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {view.weekNotes.length > 0 && (
            <Card>
              <CardHeader title="This week's notes" />
              <ul className="grid gap-1 text-[12.5px] text-text-2">
                {view.weekNotes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </Card>
          )}
        </div>
      ) : null}

      <ImageLightbox src={lightbox} alt={view.title} caption={view.title} onClose={() => setLightbox(null)} />
      <HouseFilingModal target={filing} address={view.address} onClose={() => setFiling(null)} />
    </div>
  )
}
