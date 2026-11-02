// Information: the referral as the Potential Clients file holds it — full name, stage, phone, e-mail, source…
// The file's own row answers at once; the overview fills in what only it knows.
import type { ReactNode } from 'react'
import { Pair, SectionCard } from '@/pages/features/locations/LocationParts'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'
import {
  dateWords, knownDetails, mailHref, mayEdit, overviewOf, ratingWords, reachOf, stageMeta, telHref, windowMeta,
  type CandidateAsk, type CandidateEdition, type CandidateOverview, type RosterRow,
} from '../candidateModel'
import { readKey, readOverview, useCandidateRead, type ReadState } from '../useCandidateRead'
import { EditButton, None, Pill, ReadLine, WhyLines, linkCls } from '../CandidateParts'

export default function InformationSection({ row, onAsk, editions = [] }: {
  row: RosterRow
  onAsk?: (ask: CandidateAsk) => void
  /** the editions this reader makes here: the pencil for whom editionsMine names Information */
  editions?: readonly CandidateEdition[]
}) {
  const overview = useCandidateRead(readKey('clientCandidateOverview', row.key), () => readOverview(row.key), overviewOf)
  const onEdit = onAsk && mayEdit(reachOf(false, editions), 'information')
    ? () => onAsk({ kind: 'edit', section: 'information' }) : undefined
  return <InformationView row={row} overview={overview} onRetry={overview.reload} onEdit={onEdit} />
}

export function InformationView({ row, overview, onRetry, onEdit }: {
  row: RosterRow
  overview: ReadState<CandidateOverview>
  onRetry: () => void
  /** the edition's panel, for whom it opens */
  onEdit?: () => void
}) {
  const o = overview.data
  const d = knownDetails(row, o)
  const fields: [string, ReactNode][] = [
    ['Full name', d.name || <None />],
    ['Stage', d.stage ? <Pill meta={stageMeta(d.stage)} /> : <None />],
    ['Phone', d.phone ? <a href={telHref(d.phone)} className={linkCls}>{formatPhoneDisplay(d.phone)}</a> : <None />],
    ['E-mail', d.email ? <a href={mailHref(d.email)} className={cn(linkCls, 'break-all')}>{d.email}</a> : <None />],
    ['Source', d.source || <None />],
    ['Referred', dateWords(d.referred) || <None />],
    ['Service requested', d.service ? <span className="whitespace-pre-line">{d.service}</span> : <None />],
    ['Location / county', d.location || <None />],
    ['Family / guardian', d.family || <None />],
    ['Important to me', d.important || <None />],
    ['Preferred start', dateWords(d.preferred_start) || <None />],
    ['Intake coordinator', d.owner || <None />],
  ]
  const closes = windowMeta(d.expires)
  const referral: [string, ReactNode][] = [
    ['Diagnosis', d.diagnosis ? <span className="whitespace-pre-line">{d.diagnosis}</span> : <None />],
    ['Frequency', d.frequency || <None />],
    ['Age', d.age || <None />],
    ['Gender', d.gender || <None />],
    ['Funding source', d.funding || <None />],
    ['Referral number', d.referral || <None />],
    ['Referral window', d.expires ? <span className="flex flex-wrap items-center gap-2">{dateWords(d.expires)}{closes && <Pill meta={closes} />}</span> : <None />],
    ['AI rating', ratingWords(d.rating) || <None />],
  ]
  return (
    <div className="grid gap-5">
      <SectionCard title="Information" sub="As the Potential Clients file holds it."
        extra={onEdit ? <EditButton label="Edit" onClick={onEdit} what="information" /> : undefined}>
        <div className="grid gap-2">
          <ReadLine state={overview} what="the referral" onRetry={onRetry} />
          {o && <WhyLines why={o.why} degraded={o.degraded} />}
          <dl className="grid gap-x-8 sm:grid-cols-2" data-information="">
            {fields.map(([label, value], i) => <Pair key={label} label={label} last={i >= fields.length - 2}>{value}</Pair>)}
          </dl>
        </div>
      </SectionCard>
      <SectionCard title="Referral" sub="What the referral itself says, as the Potential Clients lead page shows it.">
        <dl className="grid gap-x-8 sm:grid-cols-2" data-referral-fields="">
          {referral.map(([label, value], i) => <Pair key={label} label={label} last={i >= referral.length - 2}>{value}</Pair>)}
        </dl>
      </SectionCard>
    </div>
  )
}
