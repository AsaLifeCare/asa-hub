// CURATED BUNDLE — House Supplies Inventory.
// A sheet of stock per house (low stock reads as a chip) plus a dashboard that surfaces what needs reordering…
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoDay } from './shared'

export const houseSupplies: CuratedBundle = {
  id: 'house-supplies',
  blurb: 'Stock and par levels per house, with a dashboard that flags what to reorder.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'House Supplies',
      tagline: 'Stock levels, par levels and reorder flags for every house.',
      icon: 'package',
      accent: 'amber',
      category: 'Operations',
      audience: ['admin', 'manager', 'staff'],
      pages: [
        {
          id: 'supplies',
          type: 'sheet',
          title: 'Supplies',
          resource: '',
          config: {
            entity: ['supply', 'supplies'],
            searchable: true,
            selectable: true,
            densityToggle: true,
            columns: [
              { key: 'item', label: 'Item', kind: 'text' },
              { key: 'house', label: 'House', kind: 'chip', tintBy: { 'Maple House': 'mint', 'Birch House': 'blue', 'Cedar House': 'lavender' } },
              { key: 'stock', label: 'In stock', kind: 'number' },
              { key: 'par', label: 'Par level', kind: 'number' },
              { key: 'status', label: 'Status', kind: 'chip', tintBy: { 'In stock': 'mint', Low: 'amber', 'Order now': 'pink' } },
              { key: 'updated', label: 'Checked', kind: 'date' },
            ],
            headerActions: [
              { id: 'add-item', label: 'Add item', icon: 'plus', kind: 'create', perm: 'inventory.edit',
                payload: { item: 'New item', house: 'Maple House', stock: 0, par: 1, status: 'Low', updated: '{today}' },
                toast: 'Item added — set its name and par level.' },
            ],
            rowActions: [
              // Restock tops the shelf back up to par — the patch interpolates {row.par} off the row itself, so one…
              { id: 'restock', label: 'Restock to par', icon: 'package-plus', quick: true, kind: 'patch',
                when: { field: 'status', in: ['Low', 'Order now'] },
                patch: { stock: '{row.par}', status: 'In stock', updated: '{today}' },
                toast: '{row.item} restocked.' },
              { id: 'flag-reorder', label: 'Flag for reorder', icon: 'shopping-cart', kind: 'patch',
                when: { field: 'status', eq: 'Low' },
                patch: { status: 'Order now', updated: '{today}' },
                toast: '{row.item} is on the order list.' },
              { id: 'discontinue', label: 'Discontinue item', icon: 'trash-2', danger: true, kind: 'delete', perm: 'inventory.edit',
                confirm: 'Discontinue {row.item} ({row.house})? It leaves the sheet for everyone.',
                toast: '{row.item} discontinued.' },
            ],
          },
          rows: [
            { id: 'row-1', item: 'Nitrile gloves (M)', house: 'Maple House', stock: 340, par: 200, status: 'In stock', updated: isoDay(0) },
            { id: 'row-2', item: 'Hand soap refill', house: 'Maple House', stock: 4, par: 6, status: 'Low', updated: isoDay(0) },
            { id: 'row-3', item: 'Laundry detergent', house: 'Birch House', stock: 2, par: 4, status: 'Order now', updated: isoDay(-1) },
            { id: 'row-4', item: 'Toilet paper', house: 'Birch House', stock: 48, par: 24, status: 'In stock', updated: isoDay(-1) },
            { id: 'row-5', item: 'Incontinence pads (L)', house: 'Cedar House', stock: 90, par: 60, status: 'In stock', updated: isoDay(-2) },
            { id: 'row-6', item: 'Disinfectant wipes', house: 'Cedar House', stock: 3, par: 8, status: 'Order now', updated: isoDay(-2) },
          ],
        },
        {
          id: 'overview',
          type: 'dashboard',
          title: 'Overview',
          resource: '',
          config: {
            greeting: { name: 'Supplies', subtitle: 'What every house has, and what runs out next.' },
            widgets: [
              { kind: 'stat', label: 'Items tracked', value: '6', delta: '+1', deltaLabel: 'this week', tint: 'mint', spark: [4, 5, 5, 6, 6, 6, 6] },
              { kind: 'stat', label: 'To reorder', value: '2', tint: 'amber', spark: [1, 1, 2, 2, 1, 2, 2] },
              { kind: 'donut', title: 'By status', slices: [
                { label: 'In stock', value: 3, tint: 'mint' },
                { label: 'Low', value: 1, tint: 'amber' },
                { label: 'Order now', value: 2, tint: 'pink' },
              ], centerLabel: 'items' },
              { kind: 'note', title: 'Reorder day', tint: 'blue', text: 'Deliveries land on Thursdays — add anything below par to the order by Wednesday noon.' },
            ],
          },
          rows: [
            { id: 'row-1', name: 'Nitrile gloves (M)', status: 'In stock', owner: 'Maple House', updated: isoDay(0), score: 4 },
            { id: 'row-2', name: 'Hand soap refill', status: 'Low', owner: 'Maple House', updated: isoDay(0), score: 2 },
            { id: 'row-3', name: 'Laundry detergent', status: 'Order now', owner: 'Birch House', updated: isoDay(-1), score: 1 },
            { id: 'row-4', name: 'Disinfectant wipes', status: 'Order now', owner: 'Cedar House', updated: isoDay(-2), score: 1 },
          ],
        },
      ],
    },
  },
}
