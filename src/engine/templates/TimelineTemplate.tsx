// TIMELINE — a page type for "what happened to this person / client / house".
// The estate answers that question today by opening five tabs and sorting by hand: a hire date here, a certificate…
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, Search } from 'lucide-react'
import type { TemplateProps } from '@/engine/PageRenderer'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
// day groups and clocks wear Ohio wall-clock, not the viewer's — an audit trail read from two timezones must not…
import { dayOnly, ohioDayYear, ohioTime } from '@/lib/ohio'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// An event's time field is one of two different animals.
function parseEventTime(raw: string): { t: number; label: string; clock: string } {
  const bare = dayOnly(raw)
  if (bare) {
    const [y, m, d] = bare.split('-').map(Number)
    const month = MONTHS_SHORT[m - 1]
    if (month) {
      return { t: new Date(y, m - 1, d, 12, 0, 0).getTime(), label: `${month} ${d}, ${y}`, clock: '' }
    }
  }
  const d = new Date(raw)
  if (isNaN(d.getTime())) return { t: NaN, label: 'No date', clock: '' }
  return { t: d.getTime(), label: ohioDayYear(d), clock: ohioTime(d) }
}

export default function TimelineTemplate({ config, data, schema }: TemplateProps) {
  const timeKey = (config.timeKey as string) ?? 'at'
  const titleKey = (config.titleKey as string) ?? 'title'
  const bodyKey = (config.bodyKey as string) ?? 'detail'
  const actorKey = (config.actorKey as string) ?? 'actor'
  const kindKey = (config.kindKey as string) ?? 'kind'
  const kindTints = (config.kindTints ?? {}) as Record<string, TintName>
  const subjectKey = config.subjectKey as string | undefined

  const [q, setQ] = useState('')
  const [subject, setSubject] = useState('all')

  const subjects = useMemo(() => {
    if (!subjectKey) return []
    const set = new Map<string, number>()
    data.forEach((r) => {
      const v = String(r[subjectKey] ?? '').trim()
      if (v) set.set(v, (set.get(v) ?? 0) + 1)
    })
    return [...set.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
  }, [data, subjectKey])

  // Newest first, grouped by calendar day.
  const days = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = data.filter((r) => {
      if (subject !== 'all' && subjectKey && String(r[subjectKey] ?? '') !== subject) return false
      if (!needle) return true
      return JSON.stringify(r).toLowerCase().includes(needle)
    })
    const withTime = rows
      .map((r) => ({ r, ...parseEventTime(String(r[timeKey] ?? '')) }))
      .sort((a, b) => (isNaN(b.t) ? -1 : b.t) - (isNaN(a.t) ? -1 : a.t))

    const map = new Map<string, { r: TemplateProps['data'][number]; clock: string }[]>()
    withTime.forEach(({ r, label, clock }) => {
      // the label carries the year, so it doubles as the group key: one calendar day, one group — and a day-only…
      if (!map.has(label)) map.set(label, [])
      map.get(label)!.push({ r, clock })
    })
    return [...map.entries()]
  }, [data, q, subject, subjectKey, timeKey])

  const count = days.reduce((n, [, rows]) => n + rows.length, 0)

  return (
    <div className="mx-auto max-w-[840px]">
      <PageHeader
        title={schema.title}
        subtitle={`${count} event${count === 1 ? '' : 's'}`}
        actions={
          <>
            {subjects.length > 1 && (
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="h-9 max-w-[220px] rounded-md border border-border bg-surface px-2.5 text-[13px] font-medium text-text-1 outline-none focus:border-primary"
              >
                <option value="all">Everyone</option>
                {subjects.map(([s, n]) => (
                  <option key={s} value={s}>
                    {s} ({n})
                  </option>
                ))}
              </select>
            )}
            <span className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search events…"
                className="h-9 w-[220px] rounded-md border border-border bg-surface pl-8 pr-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
              />
            </span>
          </>
        }
      />

      {count === 0 ? (
        <Card>
          <EmptyState title="Nothing here yet" body={(config.emptyText as string) ?? 'Events appear as they happen.'} />
        </Card>
      ) : (
        <div className="grid gap-4">
          {days.map(([day, rows], gi) => (
            <div key={day}>
              <p className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-text-3">
                <CalendarDays size={13} /> {day}
              </p>
              <div className="relative pl-5">
                {/* the spine */}
                <span aria-hidden className="absolute bottom-2 left-[7px] top-2 w-px bg-border" />
                <div className="grid gap-2">
                  {rows.map(({ r, clock }, i) => {
                    const kind = String(r[kindKey] ?? '').trim()
                    const tint = kindTints[kind]
                    return (
                      <motion.div
                        key={String(r.id ?? `${gi}-${i}`)}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2, ease: EASE_OUT_EXPO, delay: Math.min(i, 10) * 0.02 }}
                        className="relative rounded-md border border-border bg-surface px-3.5 py-2.5"
                      >
                        <span
                          aria-hidden
                          className="absolute -left-[18px] top-4 grid h-[13px] w-[13px] place-items-center rounded-full border-2 border-surface"
                          style={{ background: tint ? TINT_FG[tint] : 'var(--border-strong)' }}
                        />
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-semibold text-text-1">
                              {String(r[titleKey] ?? '—')}
                            </span>
                            {r[bodyKey] && (
                              <span className="mt-0.5 block text-[12.5px] leading-5 text-text-2">
                                {String(r[bodyKey])}
                              </span>
                            )}
                            <span className="mt-1 flex flex-wrap items-center gap-2">
                              {kind && (
                                <span
                                  className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                                  style={
                                    tint
                                      ? { background: TINT_BG[tint], color: TINT_FG[tint] }
                                      : { background: 'var(--surface-2)', color: 'var(--text-3)' }
                                  }
                                >
                                  {kind}
                                </span>
                              )}
                              {r[actorKey] && (
                                // the actor is a PERSON — every name on every page is a tracker handle (house law)
                                <DragPerson name={String(r[actorKey])} className="inline-flex">
                                  <span className="text-[11.5px] text-text-3">{String(r[actorKey])}</span>
                                </DragPerson>
                              )}
                            </span>
                          </span>
                          {clock && (
                            <span className={cn('shrink-0 font-mono text-[11px] text-text-3')}>
                              {clock}
                            </span>
                          )}
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
