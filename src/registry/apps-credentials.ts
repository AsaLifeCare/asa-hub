// CREDENTIALS — the company's accounts list (the "Address and Email Updates" book's Change of Address tab), kept in
// Postgres (app/sheet_resources.py `credentials`) and shown to the master alone: MASTER_ONLY_APPS here, and the server's
// master_only gate on the rows whatever App Control says. The usernames, passwords and password manager are never in
// the Hub — the copy withholds them — so the table lists every account without them.
import type { AppManifest, PageSchema } from '@/engine/types'

const FLAGS = ['X', '']
const FIELDS = [
  { key: 'Business', label: 'Business', required: true },
  { key: 'Website', label: 'Website' },
  { key: 'Category', label: 'Category' },
  { key: 'Owner', label: 'Owner' },
  { key: 'Sender', label: 'Sender / account' },
  { key: 'Note', label: 'Note', type: 'textarea' },
  { key: 'Physical', label: 'Physical' },
  { key: 'Gen', label: 'Gen', type: 'select', options: FLAGS },
  { key: 'ABD', label: 'ABD', type: 'select', options: FLAGS },
  { key: 'MC', label: 'MC', type: 'select', options: FLAGS },
  { key: 'Realty', label: 'Realty', type: 'select', options: FLAGS },
  { key: 'Junk', label: 'Junk', type: 'select', options: FLAGS },
]

const accountsPage: PageSchema = {
  id: 'accounts',
  type: 'sheet',
  title: 'Credentials',
  icon: 'key-round',
  dataSource: { resource: 'credentials' as PageSchema['dataSource']['resource'] },
  config: {
    entity: ['account', 'accounts'],
    searchable: true,
    searchPlaceholder: 'Search accounts, sites, owners…',
    primaryAction: { label: 'Add account', icon: 'plus', form: {
      title: 'Add account', resource: 'credentials', perm: 'people.edit', wide: true, fields: FIELDS } },
    editForm: { title: 'Edit account', resource: 'credentials', perm: 'people.edit', fields: FIELDS },
    rowDelete: { perm: 'people.edit' },
    columns: [
      { key: 'Business', label: 'Business', kind: 'chip', sortable: true },
      { key: 'Sender', label: 'Account', kind: 'text', sortable: true, width: 240 },
      { key: 'Website', label: 'Website', kind: 'text', width: 280 },
      { key: 'Category', label: 'Category', kind: 'text', sortable: true },
      { key: 'Owner', label: 'Owner', kind: 'text', sortable: true },
      { key: 'Note', label: 'Note', kind: 'text', width: 240 },
      { key: 'Physical', label: 'Physical', kind: 'text' },
      { key: 'Gen', label: 'Gen', kind: 'text' },
      { key: 'ABD', label: 'ABD', kind: 'text' },
      { key: 'MC', label: 'MC', kind: 'text' },
      { key: 'Realty', label: 'Realty', kind: 'text' },
    ],
    rowActions: [
      { id: 'edit', label: 'Edit account', icon: 'pencil' },
      { id: 'delete', label: 'Remove account', icon: 'trash-2' },
    ],
    pagination: { pageSize: 50 },
  },
}

// The second tab: any account's password set to the workspace default or a typed one, chosen anew at the next sign-in
// (/hub-lanes/credentials-resets, the master's alone) — bespoke, AppRoutePage CUSTOM_PAGES resolves
// 'credentials/resets' to PasswordResetsPage
const resetsPage: PageSchema = {
  id: 'resets',
  type: 'dashboard',
  title: 'Password resets',
  icon: 'rotate-ccw',
  dataSource: { resource: 'activity' },
  config: { widgets: [] },
}

export const credentialsManifests: AppManifest[] = [
  {
    id: 'credentials',
    name: 'Credentials',
    tagline: "The company's accounts — sites, owners and notes; the master's alone",
    icon: 'key-round',
    accent: 'lavender',
    category: 'Manage',
    version: '1.0.0',
    audience: ['admin'],
    isNew: true,
    enabled: true,
    pages: [accountsPage, resetsPage],
  },
]
