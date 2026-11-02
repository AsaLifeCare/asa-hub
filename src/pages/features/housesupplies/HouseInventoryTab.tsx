// INVENTORY — every house Locations opens to this reader, each drawn as Locations › Supplies draws it: the consumables
// ledger and the house's assets (houseSuppliesInventory, Python's door). Read-only here; a house's name opens its
// Supplies tab in Locations, where counts, deliveries and assets are recorded.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { gasAction } from '@/features/hiring/shared'
import { locationHref, suppliesOf, type LocationSupplies } from '@/pages/features/locations/locationModel'
import { LocationViewerContext } from '@/pages/features/locations/useLocation'
import { SuppliesView } from '@/pages/features/locations/tabs/Supplies'

type InventoryHouse = { code: string; title: string; supplies: LocationSupplies | null; why: string }

export function inventoryOf(raw: unknown): InventoryHouse[] {
  const houses = (raw as { houses?: unknown[] } | null)?.houses ?? []
  return houses.map((h) => {
    const r = (h ?? {}) as Record<string, unknown>
    return {
      code: String(r.code ?? ''), title: String(r.title ?? r.code ?? ''),
      supplies: r.supplies ? suppliesOf(r.supplies) : null, why: String(r.why ?? ''),
    }
  }).filter((h) => h.code)
}

const READ_ONLY = { writes: false, cut: false }
const noop = () => {}

export default function HouseInventoryTab() {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'failed'; houses: InventoryHouse[]; error: string }>(
    { status: 'loading', houses: [], error: '' })
  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: s.houses.length ? 'ready' : 'loading' }))
    try {
      setState({ status: 'ready', houses: inventoryOf(await gasAction<unknown>('houseSuppliesInventory', {})), error: '' })
    } catch (err) {
      setState((s) => ({ ...s, status: 'failed', error: err instanceof Error ? err.message : String(err) }))
    }
  }, [])
  useEffect(() => { void load() }, [load])

  if (state.status === 'loading') return <Skeleton className="h-[320px] w-full rounded-lg" />
  if (state.status === 'failed' && !state.houses.length) {
    return <EmptyState title="The inventory could not be read" body={state.error} action={{ label: 'Try again', onClick: () => void load() }} />
  }
  if (!state.houses.length) {
    return <EmptyState title="No house to show" body="Locations opens no house to this account." />
  }
  const held = (h: InventoryHouse) => (h.supplies?.consumables.length ?? 0) + (h.supplies?.assets.length ?? 0)
  const withRows = state.houses.filter((h) => held(h) > 0 || h.why)
  const empty = state.houses.filter((h) => held(h) === 0 && !h.why)
  return (
    <div className="grid gap-6" data-inventory="">
      {withRows.map((h) => (
        <section key={h.code} data-inventory-house={h.code}>
          <h2 className="mb-2 font-display text-[15px] font-semibold">
            <Link to={locationHref(h.code, 'supplies')} className="text-primary hover:underline">{h.title}</Link>
          </h2>
          {h.why && <p className="mb-2 text-[12.5px] text-[var(--warning)]">{h.why}</p>}
          {h.supplies && (
            <LocationViewerContext.Provider value={READ_ONLY}>
              <SuppliesView supplies={{ status: 'ready', data: h.supplies, error: '', refreshing: false }} onAsk={noop} onRetry={noop} />
            </LocationViewerContext.Provider>
          )}
        </section>
      ))}
      {empty.length > 0 && (
        <p className="text-[12.5px] text-text-3" data-inventory-empty="">
          No consumable counted and no asset listed yet at{' '}
          {empty.map((h, i) => (
            <span key={h.code}>{i > 0 && ', '}<Link to={locationHref(h.code, 'supplies')} className="text-primary hover:underline">{h.title}</Link></span>
          ))}.
        </p>
      )}
    </div>
  )
}
