// Overview: the family member's details (relationship, phone, and the e-mail and address when a record holds them)…
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import { ActivePill } from '@/pages/features/locations/HouseSwitcher'
import { Pair, SectionCard } from '@/pages/features/locations/LocationParts'
import { PencilButton } from '@/pages/features/clientprofiles/ClientParts'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { useFamilyDetailsHidden } from '@/lib/stamps'
import {
  clientHref, clientLine, mailHref, overviewOf, relationshipLine, telHref, type FamilyOverview, type RosterRow,
} from '../familyModel'
import { readKey, readOverview, useFamilyRead, type ReadState } from '../useFamilyRead'
import { EmptyNote, None, ReadLine, WhyLines, linkCls } from '../FamilyParts'

export default function OverviewSection({ row, onEdit }: { row: RosterRow; onEdit?: () => void }) {
  const overview = useFamilyRead(readKey('familyProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  return <OverviewView row={row} overview={overview} onEdit={onEdit} onRetryOverview={overview.reload} />
}

export function OverviewView({ row, overview, onEdit, onRetryOverview }: {
  row: RosterRow
  overview: ReadState<FamilyOverview>
  /** the details' pencil: the master's, or a holder's of the profile edition */
  onEdit?: () => void
  onRetryOverview: () => void
}) {
  // the source line, the clients' count and their pencil: the master's, or everyone's while Settings › My Work shows them
  const bare = useFamilyDetailsHidden()
  const o = overview.data
  // the roster's own line while the overview is read
  const d = o?.family ?? null
  const phone = d ? d.phone : row.phone
  const email = d ? d.email : row.email
  const relationship = o ? relationshipLine(d, o.clients) : row.relationship
  const address = d?.address ?? ''
  return (
    <div className="grid gap-5" data-overview="">
      <SectionCard title="Family Details"
        extra={o && onEdit ? <PencilButton label="Edit family details" onClick={onEdit} /> : null}>
        <ReadLine state={overview} what="the family member" onRetry={onRetryOverview} />
        <dl data-family-details="">
          <Pair label="Relationship">{relationship || <None />}</Pair>
          <Pair label="Phone" last={!email && !address}>
            {phone ? <a href={telHref(phone)} className={linkCls}>{formatPhoneDisplay(phone)}</a> : <None />}
          </Pair>
          {email && <Pair label="Email" last={!address}><a href={mailHref(email)} className={linkCls}>{email}</a></Pair>}
          {address && <Pair label="Address" last>{address}</Pair>}
        </dl>
        {!bare && d && d.sources.length > 0 && (
          <p className="mt-3 text-[11.5px] text-text-3" data-sources="">Named in: {d.sources.join(' · ')}</p>
        )}
        {o && <div className="mt-3"><WhyLines why={o.why} degraded={o.degraded} /></div>}
      </SectionCard>

      <SectionCard title="Associated clients"
        sub={o && !bare ? `${o.clients.length} client${o.clients.length === 1 ? '' : 's'} whose records name ${row.name} as family.`
          : undefined}
        extra={!bare && o && o.clients.length > 0 && onEdit ? <PencilButton label="Edit relationships" onClick={onEdit} /> : null}>
        {!o && overview.status !== 'failed' && <ReadLine state={overview} what="the clients" onRetry={onRetryOverview} />}
        {o && o.clients.length === 0 && <EmptyNote>No client record or plan names {row.name} as family.</EmptyNote>}
        {o && o.clients.length > 0 && (
          <ul className="divide-y divide-border" data-clients="">
            {o.clients.map((c) => (
              <li key={c.client_key} data-client={c.client_key}>
                <Link to={clientHref(c.client_key)} data-client-link={c.client_key}
                  className="flex items-center gap-3 py-3 transition-colors hover:bg-surface-2/60">
                  <Avatar src={c.avatar} name={c.name} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-semibold text-primary">{c.name}</span>
                      {c.status === 'inactive' && <ActivePill active={false} />}
                    </span>
                    <span className="clamp-1 mt-0.5 block text-[12px] text-text-3">{clientLine(c)}</span>
                  </span>
                  <ArrowRight size={15} className="shrink-0 text-text-3" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}
