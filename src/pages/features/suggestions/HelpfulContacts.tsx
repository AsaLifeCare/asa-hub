// HELPFUL CONTACTS — the numbers a shift actually dials.
// It sits at the bottom of the Suggestions app, in this platform's own style — the old platform's contacts block…
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { activeTenantId } from '@/stores/useTenantStore'
import { activeWorldId } from '@/stores/useWorldStore'
import { AppIcon } from '@/lib/icons'
import DragPerson from '@/components/shared/DragPerson'
import { Phone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phoneFormat'

export type Contact = { name: string; note?: string; phone: string }
export type Group = { id: string; label: string; icon: string; chip: string; contacts: Contact[] }

export const DEFAULT_GROUPS: Group[] = [
  {
    id: 'emergency', label: 'Emergency', icon: 'siren',
    chip: 'bg-tint-pink text-tint-fg-pink',
    contacts: [
      { name: 'Police, Fire, Medical', phone: '911' },
      { name: 'Canton Police', note: 'Non-Emergency', phone: '(330) 649-5800' },
      { name: 'Crisis Center', note: 'Coleman', phone: '(330) 452-6000' },
      { name: 'Stark County UI/MUI Reporting Line', phone: '(330) 477-4477' },
      { name: 'Stark County UI/MUI Reporting Line', phone: '(330) 489-3400' },
    ],
  },
  {
    id: 'hospitals', label: 'Hospitals', icon: 'hospital',
    chip: 'bg-tint-blue text-tint-fg-blue',
    contacts: [
      { name: 'Aultman Hospital', phone: '(330) 452-9911' },
      { name: 'Cleveland Clinic Mercy Hospital', phone: '(330) 489-1000' },
    ],
  },
  {
    id: 'agencies', label: 'Stark County agencies', icon: 'building-2',
    chip: 'bg-tint-amber text-tint-fg-amber',
    contacts: [
      { name: 'Stark County Board of DD', phone: '(330) 477-5200' },
      { name: 'Stark County Health Department', phone: '(330) 493-9904' },
      { name: 'Stark County Job and Family Services', phone: '(330) 452-4661' },
    ],
  },
  {
    id: 'team', label: 'ASA team', icon: 'users',
    chip: 'bg-tint-mint text-tint-fg-mint',
    contacts: [
      { name: 'Ty Bond', note: 'Administrator', phone: '(330) 919-7779' },
      { name: 'Brittany Anderson', note: 'HR / Administration', phone: '(330) 919-7595' },
      { name: 'Natalie Darnell', note: 'Finance', phone: '(330) 605-6497' },
      { name: 'Stephanie Inman', note: 'Division Supervisor', phone: '(330) 639-8665' },
      { name: 'Tieara Kennemore', note: 'Division Supervisor', phone: '(330) 344-0430' },
    ],
  },
]

const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

/** A stored row: one contact, with the group it belongs to. */
type ContactRow = { id?: string; group?: string; name?: string; note?: string; phone?: string; order?: number | string }

const GROUP_META: Record<string, { label: string; icon: string; chip: string }> = {
  emergency: { label: 'Emergency', icon: 'siren', chip: 'bg-tint-pink text-tint-fg-pink' },
  hospitals: { label: 'Hospitals', icon: 'hospital', chip: 'bg-tint-blue text-tint-fg-blue' },
  agencies: { label: 'Agencies', icon: 'building-2', chip: 'bg-tint-amber text-tint-fg-amber' },
  team: { label: 'Team', icon: 'users', chip: 'bg-tint-mint text-tint-fg-mint' },
}

// THE NUMBERS BELONG TO THE PLACE — a list of phones that is none of a franchise's business, and where every…
export default function HelpfulContacts() {
  // KEPT-COPY PAINT, KEYED BY PLACE: the block used to render null until the read answered and then pop in whole…
  const keptKey = `asa:helpfulContacts:${activeWorldId() || activeTenantId() || 'home'}`
  const [rows, setRows] = useState<ContactRow[]>(() => {
    try { return (JSON.parse(localStorage.getItem(keptKey) || 'null') as ContactRow[] | null) ?? [] }
    catch { return [] }
  })
  useEffect(() => {
    let alive = true
    api.list<ContactRow>('helpfulContacts')
      .then((r) => {
        if (!alive) return
        const list = Array.isArray(r) ? r : []
        setRows(list)
        try { localStorage.setItem(keptKey, JSON.stringify(list)) } catch { /* quota — the paint stands */ }
      })
      .catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groups: Group[] = useMemo(() => {
    const by = new Map<string, Contact[]>()
    rows.forEach((r) => {
      const gid = String(r.group ?? '').trim() || 'team'
      const phone = String(r.phone ?? '').trim()
      if (!phone) return
      const list = by.get(gid) ?? []
      // a contact saved without a name carries its number as the name
      list.push({ name: formatPhoneDisplay(r.name) || formatPhoneDisplay(phone), note: String(r.note ?? '').trim() || undefined, phone })
      by.set(gid, list)
    })
    return [...by.entries()].map(([id, contacts]) => ({
      id,
      label: GROUP_META[id]?.label ?? id,
      icon: GROUP_META[id]?.icon ?? 'phone',
      chip: GROUP_META[id]?.chip ?? 'bg-surface-2 text-text-2',
      contacts,
    }))
  }, [rows])

  if (groups.length === 0) return null

  return (
    <section className="mt-5">
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">
        Helpful contacts — the numbers this workspace dials. Tap one to call.
      </p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-2">
        {groups.map((g) => (
          <div key={g.id} className="rounded-lg border border-border bg-surface shadow-1">
            <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
              <span className={cn('grid h-7 w-7 place-items-center rounded-md', g.chip)}>
                <AppIcon name={g.icon} size={14} />
              </span>
              <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-text-1">{g.label}</h3>
            </header>
            <div className="divide-y divide-border/60">
              {g.contacts.map((c, i) => (
                <div key={`${c.phone}-${i}`} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className="min-w-0 flex-1">
                    {/* Only the TEAM group holds people — emergency lines,
                        hospitals and agencies are organisations, and an
                        organisation dropped on the tracker focuses nobody. */}
                    <DragPerson
                      name={g.id === 'team' ? c.name : ''}
                      subtitle={c.note || undefined}
                      className="block min-w-0"
                    >
                      <span className="clamp-1 block text-[13px] font-medium text-text-1">{c.name}</span>
                    </DragPerson>
                    {c.note && (
                      <span className="block text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-3">
                        {c.note}
                      </span>
                    )}
                  </span>
                  <a
                    href={tel(c.phone)}
                    className={cn(
                      'flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[12px] font-semibold transition-colors',
                      c.phone === '911'
                        ? 'border-tint-fg-pink/40 bg-tint-pink text-tint-fg-pink hover:bg-tint-pink/80'
                        : 'border-border bg-surface-2 text-text-1 hover:bg-surface-3',
                    )}
                  >
                    <Phone size={12} /> {formatPhoneDisplay(c.phone)}
                  </a>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
