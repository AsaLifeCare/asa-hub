// A ROW WITH NO CALL ON THIS SCREEN — laid out whole.
// Most of the four sheets' history was filed by form or by hand, long before the hotline answered anything, and a…
import type { ReactNode } from 'react'
import { ArrowLeft, Phone } from 'lucide-react'
import type { IndexState, RecordItem, ScreenItem } from './items'
import { cell, stampLong } from './join'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { FieldList } from './RecordCards'
import { ModalityPill, NotOnFile, Pill, QuietPill, SectionLabel, WhoFace } from './ui'
import {
  LANE_FIELDS, callOffTypeTint, queueStatusTint, screenResultTint, shiftPill, urgencyTint,
} from './vocabulary'

function Shell({ face, title, sub, pills, onBack, children }: {
  face: ReactNode
  title: string
  sub: string
  pills: ReactNode
  onBack: () => void
  children: ReactNode
}) {
  return (
    <div>
      <div className="px-5 pb-4 pt-4 sm:px-6 sm:pt-5">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-2 lg:hidden"
        >
          <ArrowLeft size={13} /> Back to the list
        </button>
        <div className="flex items-start gap-3.5">
          {face}
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[18px] font-semibold leading-6 text-text-1">{title}</h2>
            <p className="mt-0.5 font-stat text-[12.5px] text-text-3">{sub}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">{pills}</div>
      </div>
      {children}
    </div>
  )
}

function Section({ children }: { children: ReactNode }) {
  return <div className="border-t border-border px-5 py-4 sm:px-6">{children}</div>
}

/** The end of "Filed from call AC… —", by where the calls index stands. */
const CALL_NOT_OPEN: Record<IndexState, string> = {
  live: 'that call is not in the calls index, so its summary and words cannot be shown here.',
  kept: 'it is not in the copy this browser kept, which holds the newest calls only. It may open once the calls index answers.',
  loading: 'the calls index has not answered yet, so this call cannot be opened. It opens here once the index answers.',
  failed: 'the calls index could not be read just now, so this call cannot be opened. It opens here once the index answers.',
  refused: 'the calls are not open to this session, so this call cannot be opened here.',
}

function CallNotOpen({ callKey, indexState }: { callKey: string; indexState: IndexState }) {
  return (
    <p className="flex items-start gap-2 rounded-[12px] border border-dashed border-border px-3 py-2 text-[12.5px] leading-[1.55] text-text-3">
      <Phone size={13} className="mt-[3px] shrink-0" />
      <span className="min-w-0 break-words">
        Filed from call <span className="font-stat text-text-2">{callKey.replace(/^ac/, 'AC').replace(/^ca/, 'CA')}</span> —{' '}
        {CALL_NOT_OPEN[indexState]}
      </span>
    </p>
  )
}

export function RecordPanel({ item, indexState, onBack }: { item: RecordItem; indexState: IndexState; onBack: () => void }) {
  const { rec } = item
  const r = rec.row
  const phone = cell(r, 'requestor_phone') || cell(r, 'caller_phone')

  let pills: ReactNode
  if (rec.lane === 'queue') {
    pills = (
      <>
        <ModalityPill modality="queue" />
        <QuietPill label={cell(r, 'type_of_request') || 'Not typed'} />
        {cell(r, 'urgency') && <Pill label={`${cell(r, 'urgency')} urgency`} tint={urgencyTint(cell(r, 'urgency'))} />}
        {cell(r, 'status') && <Pill label={cell(r, 'status')} tint={queueStatusTint(cell(r, 'status'))} />}
      </>
    )
  } else if (rec.lane === 'calloffs') {
    pills = (
      <>
        <ModalityPill modality="calloffs" />
        <Pill label={cell(r, 'type') || 'Not typed'} tint={callOffTypeTint(cell(r, 'type'))} />
      </>
    )
  } else if (rec.note) {
    pills = (
      <>
        <ModalityPill modality="notes" />
        <QuietPill label={cell(r, 'kind_label')} />
        {rec.note.client && <QuietPill label={rec.note.client} />}
        {cell(r, 'category_label') && <QuietPill label={cell(r, 'category_label')} />}
        {shiftPill(rec.note.shift) && <QuietPill label={shiftPill(rec.note.shift)} />}
      </>
    )
  } else {
    pills = (
      <>
        <ModalityPill modality={rec.lane} />
        {cell(r, 'client_name') && <QuietPill label={cell(r, 'client_name')} />}
        {cell(r, 'incident_category') && <QuietPill label={cell(r, 'incident_category')} />}
      </>
    )
  }

  return (
    <Shell
      face={<WhoFace name={item.who} source={item.face} size="md" />}
      title={item.who}
      sub={[stampLong(rec.stamp) || 'No readable date', phone ? formatPhoneDisplay(phone) : ''].filter(Boolean).join(' · ')}
      pills={pills}
      onBack={onBack}
    >
      <Section>
        {rec.callKey ? (
          <CallNotOpen callKey={rec.callKey} indexState={indexState} />
        ) : (
          <NotOnFile>Filed by form or by hand — no call behind this row.</NotOnFile>
        )}
      </Section>
      <Section>
        <SectionLabel>The row</SectionLabel>
        <FieldList row={r} fields={LANE_FIELDS[rec.lane]} />
      </Section>
    </Shell>
  )
}

export function ScreenPanel({ item, indexState, onBack }: { item: ScreenItem; indexState: IndexState; onBack: () => void }) {
  const { screen } = item
  const r = screen.row
  const result = cell(r, 'final_result')
  const manual = /^true$/i.test(cell(r, 'manual_screen'))
  const cand = screen.candidate
  return (
    <Shell
      face={<WhoFace name={item.who} source={cand ? 'record' : 'unknown'} size="md" />}
      title={item.who}
      sub={[stampLong(screen.stamp) || 'No readable date', cell(cand, 'phone') ? formatPhoneDisplay(cell(cand, 'phone')) : ''].filter(Boolean).join(' · ')}
      pills={(
        <>
          <ModalityPill modality="screening" label="Phone screen" />
          <Pill label={result || 'No result written'} tint={screenResultTint(result)} />
          {cell(r, 'qualification') && <QuietPill label={cell(r, 'qualification')} />}
          {cell(r, 'screen_score') && <QuietPill label={`Score ${cell(r, 'screen_score')}`} />}
        </>
      )}
      onBack={onBack}
    >
      <Section>
        {manual ? (
          <NotOnFile>A manual screen — a recruiter screened this candidate by voice, outside the screening line. No call behind this row.</NotOnFile>
        ) : screen.callKey ? (
          <CallNotOpen callKey={screen.callKey} indexState={indexState} />
        ) : (
          <NotOnFile>Filed by hand — no call behind this screen.</NotOnFile>
        )}
      </Section>
      <Section>
        <SectionLabel>The screen</SectionLabel>
        <FieldList
          row={r}
          fields={LANE_FIELDS.screening}
          extra={[
            { label: 'Candidate', value: cell(cand, 'name') },
            { label: 'Stage', value: cell(cand, 'stage') },
          ]}
        />
      </Section>
    </Shell>
  )
}
