// Information: the candidate as the hiring record holds them — full name, stage, phone, e-mail, source, applied…
// Every value says where it came from; the hiring record wins when both hold one.
import type { ReactNode } from 'react'
import { BriefcaseBusiness, GraduationCap, Pencil } from 'lucide-react'
import { Pair, SectionCard } from '@/pages/features/locations/LocationParts'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'
import {
  ARCHIVED_META, INFO_SOURCE_LABEL, dateWords, jobLine, knownDetails, mailHref, mayEdit, overviewOf, resumeFilled, resumeOf, spanOf,
  stageMeta, telHref, type CandidateAsk, type CandidateOverview, type CandidateResume, type InfoSource, type InfoValue, type Reach,
  type RosterRow,
} from '../candidateModel'
import { readKey, readOverview, readResume, useCandidateRead, type ReadState } from '../useCandidateRead'
import { EmptyNote, None, Pill, ReadLine, WhyLines, linkCls } from '../CandidateParts'

export default function InformationSection({ row, onAsk, reach }: {
  row: RosterRow
  onAsk?: (ask: CandidateAsk) => void
  /** what this reader may do: the pencil for whom editionsMine names Information */
  reach?: Reach
}) {
  const overview = useCandidateRead(readKey('candidateProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  const resume = useCandidateRead(readKey('candidateProfileResume', row.key), () => readResume(row.key), resumeOf)
  const onEdit = onAsk && reach && mayEdit(reach, 'information') ? () => onAsk({ kind: 'edit', section: 'information' }) : undefined
  return <InformationView row={row} overview={overview} onRetry={overview.reload} resume={resume} onResumeRetry={resume.reload}
    onEdit={onEdit} />
}

/** The section's pencil: opens the edition's panel. */
export function EditButton({ label, onClick, what }: { label: string; onClick: () => void; what: string }) {
  return (
    <button type="button" onClick={onClick} data-edit={what}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
      <Pencil size={13} /> {label}
    </button>
  )
}

/** Where a value came from, said small beside it. */
function From({ source, note = '' }: { source: InfoSource | ''; note?: string }) {
  if (!source) return null
  return (
    <span data-from={source}
      className={cn('ml-1.5 inline-flex whitespace-nowrap rounded-full px-1.5 py-px align-middle text-[10.5px] font-semibold',
        source === 'resume' ? 'bg-tint-lavender text-tint-fg-lavender' : 'bg-surface-2 text-text-3')}>
      {INFO_SOURCE_LABEL[source]}{note ? ` · ${note}` : ''}
    </span>
  )
}

const valueOf = (v: InfoValue): ReactNode => (v.value ? <>{v.value}<From source={v.source} note={v.note} /></> : <None />)

export function InformationView({ row, overview, onRetry, resume, onResumeRetry, onEdit }: {
  row: RosterRow
  overview: ReadState<CandidateOverview>
  onRetry: () => void
  /** the resume read; absent, the record's lines alone */
  resume?: ReadState<CandidateResume>
  onResumeRetry?: () => void
  /** the edition's panel, for whom it opens */
  onEdit?: () => void
}) {
  const o = overview.data
  const d = knownDetails(row, o)
  const r = resume?.data ?? null
  const filled = resumeFilled(d, r)
  const record = (v: ReactNode, has: boolean): ReactNode => (has ? <>{v}<From source="record" /></> : <None />)
  const fields: [string, ReactNode][] = [
    ['Full name', record(d.name, !!d.name)],
    ['Stage', d.archived ? <Pill meta={ARCHIVED_META} /> : d.stage ? <Pill meta={stageMeta(d.stage)} /> : <None />],
    ['Phone', record(<a href={telHref(d.phone)} className={linkCls}>{formatPhoneDisplay(d.phone)}</a>, !!d.phone)],
    ['E-mail', record(<a href={mailHref(d.email)} className={cn(linkCls, 'break-all')}>{d.email}</a>, !!d.email)],
    ['Source', record(d.source, !!d.source)],
    ['Applied', record(dateWords(d.applied), !!dateWords(d.applied))],
    ['Position', record(d.position, !!d.position)],
    ['Availability', valueOf(filled.availability)],
    ['Experience', valueOf(filled.experience)],
    ['Preferred location', valueOf(filled.preferred_location)],
    ['Earliest start', valueOf(filled.earliest_start)],
    ['Recruiter', record(d.recruiter, !!d.recruiter)],
  ]
  return (
    <div className="grid gap-5">
      <SectionCard title="Information" sub="As the hiring record holds it; a line the record leaves empty is filled from the resume and says so."
        extra={onEdit ? <EditButton label="Edit" onClick={onEdit} what="information" /> : undefined}>
        <div className="grid gap-2">
          <ReadLine state={overview} what="the candidate" onRetry={onRetry} />
          {o && <WhyLines why={o.why} degraded={o.degraded} />}
          <dl className="grid gap-x-8 sm:grid-cols-2" data-information="">
            {fields.map(([label, value], i) => <Pair key={label} label={label} last={i >= fields.length - 2}>{value}</Pair>)}
          </dl>
        </div>
      </SectionCard>
      {resume && <ResumeCard name={row.name} resume={resume} onRetry={onResumeRetry ?? (() => {})} />}
    </div>
  )
}

function Chips({ items, what }: { items: string[]; what: string }) {
  return (
    <ul className="flex flex-wrap gap-1.5" data-resume-chips={what}>
      {items.map((x) => (
        <li key={x} className="max-w-full break-words rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[12px] text-text-1">{x}</li>
      ))}
    </ul>
  )
}

function Block({ title, what, children }: { title: string; what: string; children: ReactNode }) {
  return (
    <div className="grid gap-2" data-resume-block={what}>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{title}</h3>
      {children}
    </div>
  )
}

/** What the resume says, block by block; a block it does not answer says so. */
export function ResumeCard({ name, resume, onRetry }: { name: string; resume: ReadState<CandidateResume>; onRetry: () => void }) {
  const r = resume.data
  const empty = (what: string) => <p className="text-[12.5px] text-text-3">The resume names no {what}.</p>
  return (
    <SectionCard title="From the resume" sub={r?.on_file ? 'Read from the resume on file and the analysis that scored it.' : undefined}>
      <div className="grid gap-4" data-resume="">
        <ReadLine state={resume} what="the resume" onRetry={onRetry} />
        {r && <WhyLines why={r.why} degraded={r.degraded} />}
        {r && !r.on_file && <EmptyNote>No resume is on file for {name}.</EmptyNote>}
        {r && r.on_file && (
          <>
            <Block title="Summary" what="summary">
              {r.summary ? <p className="text-[13px] leading-5 text-text-1">{r.summary}</p> : empty('summary')}
            </Block>
            <Block title="Work history" what="work">
              {r.work.length === 0 ? empty('job') : (
                <ul className="grid gap-2.5">
                  {r.work.map((j, i) => (
                    <li key={`${j.role}|${j.employer}|${i}`} className="flex min-w-0 gap-3" data-job="">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tint-blue text-tint-fg-blue"><BriefcaseBusiness size={14} /></span>
                      <span className="min-w-0">
                        <span className="block break-words text-[13px] font-medium text-text-1">{jobLine(j)}</span>
                        {spanOf(j.from, j.to) && <span className="block text-[12px] text-text-3">{spanOf(j.from, j.to)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
            <Block title="Education" what="education">
              {r.education.length === 0 ? empty('school') : (
                <ul className="grid gap-2.5">
                  {r.education.map((e, i) => (
                    <li key={`${e.school}|${e.degree}|${i}`} className="flex min-w-0 gap-3" data-school="">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tint-mint text-tint-fg-mint"><GraduationCap size={14} /></span>
                      <span className="min-w-0">
                        <span className="block break-words text-[13px] font-medium text-text-1">{[e.degree, e.school].filter(Boolean).join(' · ')}</span>
                        {(e.place || e.year) && <span className="block text-[12px] text-text-3">{[e.place, e.year].filter(Boolean).join(' · ')}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
            <Block title="Certifications & licenses" what="certifications">
              {r.certifications.length ? <Chips items={r.certifications} what="certifications" /> : empty('certification or license')}
            </Block>
            <Block title="Skills" what="skills">
              {r.skills.length ? <Chips items={r.skills} what="skills" /> : empty('skill')}
            </Block>
            <Block title="Languages" what="languages">
              {r.languages.length ? <Chips items={r.languages} what="languages" /> : empty('language')}
            </Block>
            {r.analysis.length > 0 && (
              <Block title="From the resume analysis" what="analysis">
                <dl className="grid gap-x-8 sm:grid-cols-2">
                  {r.analysis.map((l, i) => (
                    <Pair key={l.label} label={l.label} last={i >= r.analysis.length - (r.analysis.length % 2 === 0 ? 2 : 1)}>{l.value}</Pair>
                  ))}
                </dl>
              </Block>
            )}
          </>
        )}
      </div>
    </SectionCard>
  )
}
