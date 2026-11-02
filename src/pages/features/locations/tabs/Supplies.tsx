// House Supplies: the consumables ledger (what is in stock against its par level, when it was last counted, and how…
// Counts, deliveries and par levels are recorded in the panel; the house's assets are edited and added there too.
import { ClipboardList, Plus, SlidersHorizontal, Truck } from 'lucide-react'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import { TintChip } from '@/pages/features/clientops/OpsPageShell'
import {
  assetColumns, columnLabel, consumptionLine, countWords, dayWords, isAssetRow, suppliesOf, supplyTint,
  type LocationSupplies, type PanelAsk,
} from '../locationModel'
import { readKey, readSupplies, useCan, useLocationRead, type ReadState } from '../useLocation'
import { ReadLine, SectionCard } from '../LocationParts'
import HouseMedications from './HouseMedications'

export default function Supplies({ house, onAsk }: { house: HouseRow; onAsk: (ask: PanelAsk) => void }) {
  const supplies = useLocationRead(readKey('locationSupplies', house.code), () => readSupplies(house.code), suppliesOf)
  return (
    <div className="grid gap-5">
      <SuppliesView supplies={supplies} onAsk={onAsk} onRetry={supplies.reload} />
      <HouseMedications house={house.code} />
    </div>
  )
}

const TH = 'whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const ACTION = 'inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-40'

export function SuppliesView({ supplies, onAsk, onRetry }: {
  supplies: ReadState<LocationSupplies>
  onAsk: (ask: PanelAsk) => void
  onRetry: () => void
}) {
  // the counts, deliveries and corrections are the house's edition; the assets are their own
  const writes = useCan('locations.house')
  const assetsWrite = useCan('locations.assets')
  const items = supplies.data?.consumables ?? []
  const assets = supplies.data?.assets ?? []
  const cols = assetColumns(assets)
  const shut = !!supplies.data && !supplies.data.ledgerReady
  return (
    <div className="grid gap-5">
      <SectionCard title="House Supplies" sub="Consumables: counted in stock against the par level, and what was used since the last delivery."
        extra={writes ? (
          <>
            <button type="button" className={ACTION} disabled={shut} onClick={() => onAsk({ kind: 'supply', entry: 'count', item: '' })}>
              <ClipboardList size={14} /> Record count
            </button>
            <button type="button" className={ACTION} disabled={shut} onClick={() => onAsk({ kind: 'supply', entry: 'delivery', item: '' })}>
              <Truck size={14} /> Record delivery
            </button>
            <button type="button" className={ACTION} disabled={shut} onClick={() => onAsk({ kind: 'supply', entry: 'par', item: '' })}>
              <SlidersHorizontal size={14} /> Set par level
            </button>
          </>
        ) : undefined}>
        <ReadLine state={supplies} what="the house supplies" onRetry={onRetry} />
        {shut && (
          <p className="mb-3 text-[12.5px] text-[var(--warning)]" data-ledger="not-set-up">
            Not set up{supplies.data?.ledgerWhy ? `: ${supplies.data.ledgerWhy}` : ''}.{writes ? ' Nothing can be recorded until it is.' : ''}
          </p>
        )}
        {!shut && supplies.data?.ledgerWhy && <p className="mb-3 text-[12.5px] text-[var(--warning)]">{supplies.data.ledgerWhy}</p>}
        {supplies.data && !shut && items.length === 0 && (
          <p className="text-[13px] text-text-3">
            No consumable is counted for this house yet.{writes ? ' Record a count or a delivery to start the list.' : ''}
          </p>
        )}
        {items.length > 0 && (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13px]" data-consumables="">
              <thead>
                <tr className="border-b border-border">
                  <th className={TH}>Item</th>
                  <th className={TH}>Category</th>
                  <th className={TH}>In stock</th>
                  <th className={TH}>Par level</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Checked</th>
                  <th className={TH}>Used since delivery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((c) => (
                  <tr key={c.item} data-item={c.item} className={writes ? 'cursor-pointer hover:bg-surface-2/60' : undefined}
                    onClick={writes ? () => onAsk({ kind: 'supply', entry: 'count', item: c.item }) : undefined}>
                    <td className="px-3 py-3 font-medium text-text-1">{c.item}</td>
                    <td className="px-3 py-3 text-text-2">{c.category || '—'}</td>
                    <td className="px-3 py-3 text-text-2">{countWords(c.onHand)}</td>
                    <td className="px-3 py-3 text-text-2">{countWords(c.par)}</td>
                    <td className="px-3 py-3">{c.status ? <TintChip label={c.status} tint={supplyTint(c.status)} /> : <span className="text-text-3">—</span>}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-text-2">{dayWords(c.checked) || '—'}</td>
                    <td className={c.consumption === null ? 'px-3 py-3 text-text-3' : 'px-3 py-3 text-text-2'} data-used="">
                      {consumptionLine(c)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="House assets" sub="The house's rows in the House Supplies app's inventory."
        extra={assetsWrite && supplies.data && !supplies.data.why ? (
          <button type="button" className={ACTION} onClick={() => onAsk({ kind: 'asset-add' })} data-asset-add-open="">
            <Plus size={14} /> Add asset
          </button>
        ) : undefined}>
        {supplies.data?.why && <p className="mb-3 text-[12.5px] text-[var(--warning)]">{supplies.data.why}</p>}
        {supplies.data && !supplies.data.why && assets.length === 0 && (
          <p className="text-[13px] text-text-3">
            No asset is listed for this house in the inventory.{assetsWrite ? ' Add one to start the list.' : ''}
          </p>
        )}
        {assets.length > 0 && (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-[13px]" data-assets="">
              <thead>
                <tr className="border-b border-border">{cols.map((k) => <th key={k} className={TH}>{columnLabel(k)}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {assets.map((a, i) => (
                  <tr key={a.id || `${a.item}-${i}`} data-asset={a.id}
                    className={assetsWrite && isAssetRow(a.id) ? 'cursor-pointer hover:bg-surface-2/60' : undefined}
                    onClick={assetsWrite && isAssetRow(a.id) ? () => onAsk({ kind: 'asset', id: a.id }) : undefined}>
                    {cols.map((k) => <td key={k} className="px-3 py-2.5 text-text-2">{a[k] || '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
