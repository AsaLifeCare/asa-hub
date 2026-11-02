// What ELSE the platform knows about the focused person or client.
// The filter has to go DEEPER into the person and their relations whenever the drag-and-drop filter at the top…
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { format } from 'date-fns'
import { api } from '@/lib/api'
import { readerSentence } from '@/lib/readerError'
import { asList } from '@/lib/asList'
import { ohioWall } from '@/lib/ohio'
import { recordMatchesFocus } from '@/lib/focus'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { useContextStore, type Focus } from '@/stores/useContextStore'
import Avatar from '@/components/shared/Avatar'
import { TintChip } from '@/pages/features/clientops/OpsPageShell'
import type { ExtendedTintName } from '@/lib/tints'

type Row = Record<string, any>

const str = (v: unknown) => String(v ?? '').trim()

/** Resources read per focus type — kept small on purpose: these are slices. */
const STAFF_FEEDS = ['people', 'shifts', 'staffCerts', 'callOffs', 'uiIncidents'] as const
const CLIENT_FEEDS = ['clients', 'isps', 'uiIncidents', 'drAppointments', 'workOrders'] as const

/** `why`: the sentence under a figure that never landed (its value is an em dash) */
type Fact = { label: string; value: string; tint: ExtendedTintName; href?: string; why?: string }

export default function FocusRelations({ type }: { type: 'staff' | 'client' }) {
  const focus = useContextStore((s) => s.focus)
  const [feeds, setFeeds] = useState<Record<string, Row[]>>({})
  /** feeds refused with a sentence for the reader (lib/readerError) — said, never read as "no rows" */
  const [refused, setRefused] = useState<Record<string, string>>({})

  const names = (type === 'staff' ? STAFF_FEEDS : CLIENT_FEEDS) as readonly string[]
  const key = focus && focus.type === type ? `${type}:${focus.id}` : ''

  useEffect(() => {
    if (!key) return
    let alive = true
    names.forEach((n) => {
      api
        .list<Row>(n as never)
        .then((rows) => {
          if (!alive) return
          setFeeds((f) => ({ ...f, [n]: Array.isArray(rows) ? rows : [] }))
          setRefused((r) => (n in r ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== n)) : r))
        })
        .catch((e) => {
          if (!alive) return
          setFeeds((f) => ({ ...f, [n]: [] }))
          const why = readerSentence(e)
          if (why) setRefused((r) => ({ ...r, [n]: why }))
        })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!focus || focus.type !== type) return null

  const f = (n: string) => feeds[n] ?? []
  const match = (v: unknown) => recordMatchesFocus(v, focus as Focus)

  const facts: Fact[] = []
  let subtitle = focus.subtitle ?? ''

  if (type === 'staff') {
    const person = f('people').find((p) => match(p.name))
    if (person) {
      subtitle = [str(person.role), str(person.status)].filter(Boolean).join(' · ') || subtitle
      if (str(person.start_date)) {
        // Ohio's clock, both ways: a bare `yyyy-mm-dd` start date through plain `new Date()` is UTC midnight and…
        const d = ohioWall(str(person.start_date))
        if (d) facts.push({ label: 'Started', value: format(d, 'MMM yyyy'), tint: 'slate' })
      }
      if (str(person.phone)) facts.push({ label: 'Phone', value: formatPhoneDisplay(str(person.phone)), tint: 'slate' })
    }
    const myShifts = f('shifts').filter((s) => match(s.staff))
    if (myShifts.length) {
      const houses = new Set(myShifts.map((s) => str(s.house)).filter(Boolean))
      facts.push({ label: 'Rostered', value: `${myShifts.length} shifts · ${houses.size} houses`, tint: 'blue', href: '/app/calendarbuilder/cards' })
    }
    const certs = f('staffCerts').filter((c) => match(c.personName))
    const expired = certs.filter((c) => str(c.status).toLowerCase().includes('expir'))
    if (refused.staffCerts) {
      facts.push({ label: 'Certifications', value: '—', tint: 'slate', why: refused.staffCerts })
    } else if (certs.length) {
      facts.push({
        label: 'Certifications',
        value: expired.length ? `${expired.length} expiring/expired of ${certs.length}` : `${certs.length} current`,
        tint: expired.length ? 'warning' : 'mint',
        href: '/app/employee-tracker/roster',
      })
    }
    const offs = f('callOffs').filter((c) => match(c.employee_name))
    if (offs.length) facts.push({ label: 'Call-offs on record', value: String(offs.length), tint: 'amber', href: '/app/call-offs/log' })
    const inc = f('uiIncidents').filter(
      (i) => match(i.your_name) || asList(i.employees_involved).some((n) => match(n)),
    )
    if (inc.length) facts.push({ label: 'UI reports involved', value: String(inc.length), tint: 'pink', href: '/app/ui-incidents/log' })
  } else {
    const client = f('clients').find((c) => match(c.name) || match(c.client_name))
    if (client) subtitle = [str(client.house_name || client.houseName), str(client.status)].filter(Boolean).join(' · ') || subtitle
    const plans = f('isps').filter((p) => match(p.client_name) || match(p.name))
    if (plans.length) facts.push({ label: 'Service plans', value: String(plans.length), tint: 'lavender', href: '/app/isp/library' })
    const inc = f('uiIncidents').filter((i) => match(i.client_name))
    if (inc.length) {
      const cats = new Set(inc.flatMap((i) => asList(i.incident_category)))
      facts.push({ label: 'UI reports', value: `${inc.length} · ${[...cats].slice(0, 2).join(', ') || 'uncategorised'}`, tint: 'pink', href: '/app/ui-incidents/log' })
    }
    const dr = f('drAppointments').filter((a) => match(a.client))
    if (dr.length) {
      const now = ohioWall(new Date()) as Date
      const next = dr
        .map((a) => ohioWall(str(a.next_visit)))
        .filter((d): d is Date => d != null && d >= now)
        .sort((a, b) => a.getTime() - b.getTime())[0]
      facts.push({ label: 'Doctors', value: next ? `${dr.length} · next ${format(next, 'MMM d')}` : String(dr.length), tint: 'blue', href: '/app/dr-appointments/upcoming' })
    }
    const repairs = f('workOrders').filter((w) => match(w.select_address_vehicle))
    if (repairs.length) facts.push({ label: 'House repairs', value: String(repairs.length), tint: 'peach', href: '/app/house-repair/orders' })
  }

  if (facts.length === 0) return null

  return (
    <div className="mb-4 rounded-md border border-border bg-surface p-3.5">
      <div className="flex items-center gap-3">
        <Avatar src={focus.avatar} name={focus.name} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold text-text-1">{focus.name}</p>
          {subtitle && <p className="truncate text-[11.5px] text-text-3">{subtitle}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {facts.map((x) =>
          x.href ? (
            <Link key={x.label} to={x.href} title={`${x.label}: ${x.value}`}>
              <TintChip label={`${x.label}: ${x.value}`} tint={x.tint} className="normal-case" />
            </Link>
          ) : (
            <span key={x.label} title={x.why ? `${x.label}: ${x.why}` : undefined}>
              <TintChip label={`${x.label}: ${x.value}`} tint={x.tint} className="normal-case" />
            </span>
          ),
        )}
      </div>
      {facts.filter((x) => x.why).map((x) => (
        <p key={`${x.label}-why`} className="mt-2 text-[11.5px] leading-4 text-text-3">{x.label}: — {x.why}</p>
      ))}
    </div>
  )
}
