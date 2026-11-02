// Related Clients: every client this person worked with at least once (a punch naming them, or a past shift at the home
// they alone live in), as a table — the first and the last day worked with them and the latest IST, which the master or
// a holder of staff.ist edits on its record, or records when there is none; each opens in Clients.
// All of it is staffProfileOverview's.
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import {
  IST_META, clientProfileHref, dateWords, istLatest, overviewOf, staffCan, type RosterRow, type StaffAsk, type StaffIst,
  type StaffOverview,
} from '../staffModel'
import { readKey, readOverview, useStaffRead, type ReadState } from '../useStaffRead'
import { EditPencil, EmptyNote, Pill, ReadLine, WhyNote, linkCls } from '../StaffParts'
import { useStaffViewer } from '../staffViewer'

const TH = 'whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const TD = 'whitespace-nowrap px-3 py-2.5 tabular-nums text-text-2'

export default function RelatedClientsSection({ row, onAsk }: { row: RosterRow; onAsk?: (ask: StaffAsk) => void }) {
  const viewer = useStaffViewer()
  const overview = useStaffRead(readKey('staffProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  return <RelatedClientsView overview={overview} onRetry={overview.reload} onAsk={staffCan(viewer, 'staff.ist') ? onAsk : undefined} />
}

/** The record the IST column edits: the client's latest trained one, else its owed one. */
export function istRecordOf(ist: StaffIst[], clientKey: string): StaffIst | null {
  const mine = ist.filter((r) => clientKey && r.client_key === clientKey && r.id)
  return mine.filter((r) => r.trained_at).sort((a, b) => a.trained_at.localeCompare(b.trained_at)).pop() ?? mine[0] ?? null
}

export function RelatedClientsView({ overview, onRetry, onAsk }: {
  overview: ReadState<StaffOverview>
  onRetry: () => void
  /** given to the master and to a holder of staff.ist: the IST column's pencil, or Record IST where none is held */
  onAsk?: (ask: StaffAsk) => void
}) {
  const o = overview.data
  return (
    <SectionCard title="Related Clients" sub="The clients this person worked with at least once: a punch names them, or a shift at the home they alone live in.">
      <div className="grid gap-3" data-related-clients="">
        <ReadLine state={overview} what="the related clients" onRetry={onRetry} />
        {o && <WhyNote why={o.why} degraded={o.degraded} />}
        {o && o.clients.length === 0 && <EmptyNote>No punch names a client this person worked with, nor a shift at a client's own home.</EmptyNote>}
        {o && o.clients.length > 0 && (
          <div className="scroll-thin overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[600px] border-collapse text-[13px]">
              <thead className="bg-surface-2/60">
                <tr>
                  <th className={`${TH} w-14`}><span className="sr-only">Photo</span></th>
                  <th className={TH}>Client Name</th>
                  <th className={TH}>First Date</th>
                  <th className={TH}>Last Date</th>
                  <th className={TH}>IST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {o.clients.map((c) => {
                  const rec = istRecordOf(o.ist, c.client_key)
                  const trained = istLatest(o.ist, c.client_key)
                  return (
                    <tr key={c.client_key || c.name} data-client={c.client_key} className="hover:bg-surface-2/60">
                      <td className="px-3 py-2"><Avatar src={c.avatar} name={c.name} size="sm" /></td>
                      <td className="px-3 py-2.5">
                        <DragPerson name={c.name} id={c.client_id || undefined} type="client" avatar={c.avatar}>
                          {c.client_key ? (
                            <Link to={clientProfileHref(c.client_key)} className={`${linkCls} font-semibold`}>{c.name}</Link>
                          ) : <span className="font-semibold text-text-1">{c.name}</span>}
                        </DragPerson>
                      </td>
                      <td className={TD}>{dateWords(c.first_day) || '—'}</td>
                      <td className={TD}>{dateWords(c.last_day) || '—'}</td>
                      <td className={`${TD} py-1.5`} data-ist-latest="">
                        <span className="inline-flex items-center gap-1.5">
                          {trained ? <span>{dateWords(trained) || trained}</span> : rec?.status === 'owed' ? (
                            <>
                              <Pill meta={IST_META.owed} />
                              {rec.due && <span className="text-[12px] text-text-3">due {dateWords(rec.due) || rec.due}</span>}
                            </>
                          ) : <span>—</span>}
                          {onAsk && rec && <EditPencil section="ist" id={rec.id} label={c.name} onAsk={onAsk} />}
                          {onAsk && !rec && c.client_key && (
                            <button type="button" onClick={() => onAsk({ kind: 'istadd', client: c.client_key })} data-ist-add={c.client_key}
                              aria-label={`Record IST for ${c.name}`} title="Record IST"
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-3 hover:bg-primary-soft hover:text-primary">
                              <Plus size={14} />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  )
}
