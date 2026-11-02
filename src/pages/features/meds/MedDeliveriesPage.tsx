// Med Deliveries — house-level delivery reconciliation (medications wave).
// Reference B: house selector cards ("12 deliveries · synced 12d ago"), a mono period line with…
import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { ArrowUpRight, House, TriangleAlert } from 'lucide-react'
import { medDeliveries, type MedDeliveryItem, type MedDeliveryPerson } from '@/lib/seed-meds'
import { toast } from '@/stores/useToastStore'
import Card from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import SearchInput from '@/components/shared/SearchInput'
import EmptyState from '@/components/shared/EmptyState'
import { staggerContainer, staggerItem } from '@/engine/motion'
import { cn } from '@/lib/utils'
import { dayOnly } from '@/lib/ohio'

type ItemOrdering = 'name' | 'most-left' | 'most-flagged'

const ORDERING_LABEL: Record<ItemOrdering, string> = {
  name: 'Name',
  'most-left': 'Most left',
  'most-flagged': 'Most flagged',
}

const HOUSE_TINTS = ['bg-tint-mint text-tint-fg-mint', 'bg-tint-blue text-tint-fg-blue', 'bg-tint-lavender text-tint-fg-lavender', 'bg-tint-peach text-tint-fg-peach']
const AVATAR_TINTS = ['bg-tint-amber text-tint-fg-amber', 'bg-tint-pink text-tint-fg-pink', 'bg-tint-mint text-tint-fg-mint', 'bg-tint-blue text-tint-fg-blue']

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((s) => s.charAt(0).toUpperCase()).join('')
}

function orderItems(items: MedDeliveryItem[], ordering: ItemOrdering): MedDeliveryItem[] {
  const out = [...items]
  if (ordering === 'name') out.sort((a, b) => a.medName.localeCompare(b.medName))
  else if (ordering === 'most-left') out.sort((a, b) => b.left - a.left)
  else out.sort((a, b) => b.flag - a.flag || a.medName.localeCompare(b.medName))
  return out
}

function FlagChip({ n }: { n: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-tint-warning px-2 py-0.5 font-stat text-[11px] font-semibold leading-4 text-tint-fg-warning">
      <TriangleAlert size={11} /> {n}
    </span>
  )
}

function PersonSection({
  person,
  houseName,
  tint,
  q,
  ordering,
  onOrdering,
}: {
  person: MedDeliveryPerson
  houseName: string
  tint: string
  q: string
  ordering: ItemOrdering
  onOrdering: (o: ItemOrdering) => void
}) {
  const items = useMemo(() => {
    const filtered = q ? person.items.filter((i) => i.medName.toLowerCase().includes(q)) : person.items
    return orderItems(filtered, ordering)
  }, [person, q, ordering])

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          {/* type client: these are the residents the meds are delivered for, not staff */}
          <DragPerson name={person.name} type="client" subtitle={houseName} className="flex items-center gap-2.5">
            <span className={cn('grid h-8 w-8 place-items-center rounded-full text-[11px] font-semibold', tint)}>
              {initials(person.name)}
            </span>
            <span className="text-[14px] font-semibold text-text-1">{person.name}</span>
          </DragPerson>
          <span className="font-stat text-[12px] text-text-3">{person.medsCount} meds</span>
          <span className={cn('font-stat text-[12px]', person.flaggedCount > 0 ? 'font-semibold text-tint-fg-warning' : 'text-text-3')}>
            · {person.flaggedCount} flagged
          </span>
        </div>
        <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
          Ordering
          <select
            value={ordering}
            onChange={(e) => onOrdering(e.target.value as ItemOrdering)}
            className="h-8 rounded-sm border border-border bg-surface px-2 text-[12px] font-medium normal-case tracking-normal text-text-1 outline-none focus:border-border-strong"
          >
            {(Object.keys(ORDERING_LABEL) as ItemOrdering[]).map((k) => (
              <option key={k} value={k}>
                {ORDERING_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {items.length === 0 ? (
        <EmptyState title={`No meds match “${q}”`} body="Try a different search term." />
      ) : (
        <div className="divide-y divide-border">
          {items.map((item, i) => (
            <motion.div
              key={item.id}
              initial={i < 10 ? { opacity: 0, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 10) * 0.02, duration: 0.18 }}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium tracking-[0.02em] text-text-1">
                {item.medName}
              </span>
              <span className="shrink-0 text-right font-stat text-[12px] text-text-2">
                {item.left.toLocaleString()} left · {item.dispensed.toLocaleString()} disp
              </span>
              <span className="w-[64px] shrink-0 text-right">{item.flag > 0 && <FlagChip n={item.flag} />}</span>
            </motion.div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default function MedDeliveriesPage() {
  const [houseId, setHouseId] = useState(medDeliveries[0]?.id)
  const [qRaw, setQ] = useState('')
  const [orderings, setOrderings] = useState<Record<string, ItemOrdering>>({})

  const house = medDeliveries.find((h) => h.id === houseId) ?? medDeliveries[0]
  const q = qRaw.trim().toLowerCase()

  // A bare `yyyy-MM-dd` through `new Date()` is UTC midnight — the previous evening in Ohio — so the period…
  const periodDay = (v: string): Date => {
    const day = dayOnly(v)
    if (!day) return new Date(v)
    const [y, m, d] = day.split('-').map(Number)
    return new Date(y, m - 1, d, 12)
  }
  const period = `${format(periodDay(house.periodStart), 'MMM dd, yyyy')} → ${format(periodDay(house.periodEnd), 'MMM dd, yyyy')}`

  const filteredPeople = useMemo(
    () =>
      house.persons
        .map((p) => ({ ...p, matchCount: q ? p.items.filter((i) => i.medName.toLowerCase().includes(q)).length : p.items.length }))
        .filter((p) => p.matchCount > 0),
    [house, q],
  )

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="w-full">
      {/* house selector cards */}
      <motion.div variants={staggerItem} className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {medDeliveries.map((h, i) => {
          const active = h.id === house.id
          return (
            <button key={h.id} onClick={() => setHouseId(h.id)} className="text-left">
              <Card
                hover
                className={cn(
                  'h-full transition-colors duration-150',
                  active && 'border-primary ring-1 ring-primary/40',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className={cn('grid h-9 w-9 place-items-center rounded-md', HOUSE_TINTS[i % HOUSE_TINTS.length])}>
                      <House size={16} />
                    </span>
                    <div>
                      <p className={cn('text-[14px] font-semibold', active ? 'text-primary-strong' : 'text-text-1')}>
                        {h.houseName}
                      </p>
                      <p className="mt-0.5 font-stat text-[11px] text-text-3">
                        {h.deliveries} deliveries · synced {h.syncedAgo} ago
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center">
                  {h.persons.slice(0, 4).map((p, k) => (
                    <DragPerson key={p.id} name={p.name} type="client" subtitle={h.houseName}>
                      <span
                        className={cn(
                          'grid h-7 w-7 place-items-center rounded-full border-2 border-surface text-[10px] font-semibold',
                          k > 0 && '-ml-2',
                          AVATAR_TINTS[(i + k) % AVATAR_TINTS.length],
                        )}
                        title={p.name}
                      >
                        {initials(p.name)}
                      </span>
                    </DragPerson>
                  ))}
                </div>
              </Card>
            </button>
          )
        })}
      </motion.div>

      {/* period line + search */}
      <motion.div variants={staggerItem} className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[12px] tracking-[0.02em] text-text-2">
          {period} · {house.itemCount} items · {house.peopleCount} people ·{' '}
          <span className="inline-flex items-center gap-1 font-semibold text-tint-fg-warning">
            <TriangleAlert size={12} /> {house.flaggedCount} flagged
          </span>{' '}
          ·{' '}
          <button
            onClick={() => toast({ type: 'info', title: 'Delivery source', body: 'These rows are entered on the platform. No pharmacy portal is connected to it.' })}
            className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
          >
            source <ArrowUpRight size={12} />
          </button>
        </p>
        <SearchInput value={qRaw} onChange={setQ} placeholder="Filter med names…" className="w-[260px] max-w-full" />
      </motion.div>

      {/* per-person sections */}
      <motion.div variants={staggerItem} className="space-y-4">
        {filteredPeople.map((p, i) => (
          <PersonSection
            key={p.id}
            person={p}
            houseName={house.houseName}
            tint={AVATAR_TINTS[(medDeliveries.indexOf(house) + i) % AVATAR_TINTS.length]}
            q={q}
            ordering={orderings[p.id] ?? 'name'}
            onOrdering={(o) => setOrderings((m) => ({ ...m, [p.id]: o }))}
          />
        ))}
        {filteredPeople.length === 0 && (
          <Card>
            <EmptyState
              title={`No meds match “${qRaw}” at ${house.houseName}`}
              body="Try a different search term."
              action={{ label: 'Clear search', onClick: () => setQ('') }}
            />
          </Card>
        )}
      </motion.div>
    </motion.div>
  )
}
