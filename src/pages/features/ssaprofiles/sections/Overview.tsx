// Overview: the SSA's details (county and agency, phone, e-mail, office address), the clients whose records name…
// Settings › My Work hides the Updated stamps, the county, the clients count and each client's role from every…
import { Link } from 'react-router'
import { ArrowRight, Pencil } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import { ActivePill } from '@/pages/features/locations/HouseSwitcher'
import { Pair, SectionCard } from '@/pages/features/locations/LocationParts'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import {
  clientHref, clientLine, countyAgency, mailHref, overviewOf, ssaCountyHidden, ssaForUsersLine, ssaHiddenFor,
  telHref, type RosterRow, type SsaOverview,
} from '../ssaModel'
import { readKey, readOverview, useSsaRead, type ReadState } from '../useSsaRead'
import { EmptyNote, None, ReadLine, WhyLines, linkCls } from '../SsaParts'

export default function OverviewSection({ row, onEdit }: { row: RosterRow; onEdit?: () => void }) {
  const overview = useSsaRead(readKey('ssaProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  return <OverviewView row={row} overview={overview} onRetryOverview={overview.reload} onEdit={onEdit} />
}

export function OverviewView({ row, overview, onRetryOverview, master, onEdit }: {
  row: RosterRow
  overview: ReadState<SsaOverview>
  onRetryOverview: () => void
  /** the master in its own session; the session's own when not given */
  master?: boolean
  /** opens the details' edit panel, for the master or a holder of the edition */
  onEdit?: () => void
}) {
  const sessionMaster = useEffectiveIsMaster()
  const isMaster = master ?? sessionMaster
  const o = overview.data
  const hidden = ssaHiddenFor(isMaster, o?.hidden)
  const stampHidden = hidden.updated
  // the roster's own line while the overview is read
  const d = o?.ssa ?? null
  const phone = d ? d.phone : row.phone
  const email = d ? d.email : row.email
  const place = countyAgency(d ?? row, ssaCountyHidden(isMaster, o))
  const address = d?.office_address ?? ''
  const forUsers = ssaForUsersLine(isMaster, o?.hidden)
  return (
    <div className="grid gap-5" data-overview="">
      {forUsers && <p className="text-[12px] leading-[1.5] text-text-3" data-for-users="">{forUsers}</p>}
      <SectionCard title="SSA Details" extra={onEdit && (
        <button type="button" onClick={onEdit} data-edit-details="" aria-label="Edit the SSA details" title="Edit the SSA details"
          className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1">
          <Pencil size={14} />
        </button>
      )}>
        <ReadLine state={overview} what="the SSA" onRetry={onRetryOverview} stamp={!stampHidden} />
        <dl data-ssa-details="">
          <Pair label="County / Agency">{place || <None />}</Pair>
          <Pair label="Phone">{phone ? <a href={telHref(phone)} className={linkCls}>{formatPhoneDisplay(phone)}</a> : <None />}</Pair>
          <Pair label="Email">{email ? <a href={mailHref(email)} className={linkCls}>{email}</a> : <None />}</Pair>
          <Pair label="Office address" last>{address || <None />}</Pair>
        </dl>
        {o && <div className="mt-3"><WhyLines why={o.why} degraded={o.degraded} /></div>}
      </SectionCard>

      <SectionCard title="Associated clients"
        sub={o && !hidden.count ? `${o.clients.length} client${o.clients.length === 1 ? '' : 's'} whose record names this SSA.` : undefined}>
        {!o && overview.status !== 'failed' && <ReadLine state={overview} what="the clients" onRetry={onRetryOverview} />}
        {o && o.clients.length === 0 && <EmptyNote>No client record names {row.name} as its SSA.</EmptyNote>}
        {o && o.clients.length > 0 && (
          <ul className="divide-y divide-border" data-clients="">
            {o.clients.map((c) => {
              const line = clientLine(c, hidden.role)
              return (
                <li key={c.client_key} data-client={c.client_key}>
                  <Link to={clientHref(c.client_key)} data-client-link={c.client_key}
                    className="flex items-center gap-3 py-3 transition-colors hover:bg-surface-2/60">
                    <Avatar src={c.avatar} name={c.name} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-primary">{c.name}</span>
                        {c.status === 'inactive' && <ActivePill active={false} />}
                      </span>
                      {line && <span className="clamp-1 mt-0.5 block text-[12px] text-text-3" data-client-line="">{line}</span>}
                    </span>
                    <ArrowRight size={15} className="shrink-0 text-text-3" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

    </div>
  )
}
