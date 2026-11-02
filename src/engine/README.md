# asa. — Page-Type Engine Contracts

Everything a **page agent** needs to add a screen. A page is pure config: write a
`PageSchema`, register it on an `AppManifest`, route `/app/:appId/:pageId` does the rest.

## PageSchema

```ts
type PageSchema = {
  id: string
  type: 'dashboard' | 'sheet' | 'pipeline' | 'documents' | 'videos' | 'schedule' | 'detail'
  title: string
  icon?: string                       // lucide kebab name ("git-branch")
  dataSource: { resource: ResourceName; action?: string; params?: Record<string, unknown> }
  config: Record<string, unknown>     // per-type options, passed to the template unchanged
}

type ResourceName = 'people' | 'candidates' | 'documents' | 'videos' | 'events'
                  | 'notifications' | 'apps' | 'activity'
type TintName = 'mint' | 'peach' | 'lavender' | 'pink' | 'blue' | 'amber' | 'green'
```

`<PageRenderer schema>` (src/engine/PageRenderer.tsx):
1. `api.list(dataSource.resource, dataSource.params)` → `data: T[]`
2. loading → layout-matched skeletons · error → retry card · empty → `EmptyState`
   (CTA from `config.emptyAction: { label, href? }`)
3. mounts `TEMPLATES[schema.type]` with **TemplateProps**: `{ config, data, schema }`.
   `detail` additionally receives `record` when hosted in the right panel.

Every template is a default export in `src/engine/templates/<Name>Template.tsx`.

## Template configs (summary — full spec in design/page-types.md)

- **dashboard** — `{ greeting?: {name, subtitle}, widgets: Widget[] }`. Widget kinds:
  `stat` `{label, value, delta?, deltaLabel?, spark?, tint, href?}` ·
  `area` `{title, series: {name, points, color}[], span?: 2}` ·
  `donut` `{title, slices: {label, value, tint}[], centerLabel?}` ·
  `list` `{title, items: {icon?, avatar?, tint?, title, meta, href?}[], viewAllHref?}` ·
  `events` `{title, events: {time, title, tint, attendees?: personId[]}[]}` ·
  `feed` `{title}` (renders `data` = activity) ·
  `ring` `{title, percent, tint, caption}` ·
  `actions` `{title, actions: {icon, label, tint, href}[]}`.
- **sheet** — `{ columns: {key, label, kind: 'text'|'avatar+text'|'chip'|'date'|'number'|'progress',
  subKey?, width?, sortable?, tintBy?}[], rowHeight?, selectable?, searchable?,
  filters?: {key, label, options}[], bulkActions?, rowActions?, primaryAction?,
  detailPanel?: DetailConfig, pagination?: {pageSize} }`. Row click opens the detail panel.
- **pipeline** — `{ stages: {id, label, tint, description?, limit?}[], stageField,
  cardFields: {title, subtitle, avatar?, tags?{key}, meta?: ('source'|'daysInStage')[],
  score?{key,max}}, allowDrag, showRail?, detailPanel? }`.
  Drag between stages → optimistic `api.update(resource, id, {stageField: stageId})` + toast.
- **documents** — `{ collections: {id, label, icon, tint}[], cardStyle: 'cover'|'minimal',
  reader: {showToc, showMeta, allowPrint?} }`. Records need `body: DocBlock[]`
  (`h2/h3 {text,id}` · `p` · `callout {tint}` · `code`) for reader + TOC.
- **videos** — `{ channels: {id, label, tint}[], featuredId?, player: {showPlaylist, showProgress} }`.
- **schedule** — `{ view: 'week', resources: {id, name, avatar, role}[], timeRange: [8,19],
  slotMinutes, eventTypes: Record<id,{label,tint}>, showMiniMonth?, showNowLine? }`.
  Events: `{personId, date: 'yyyy-mm-dd', start: 'HH:mm', durationMin, type, attendees: personId[]}`.
- **detail** — `{ header: {avatar, title, subtitle, statusChip?: {label,tint} | {field, tintBy},
  actions?}, stats?: {label, value, icon, tint}[], sections: Section[] }` where Section =
  `fields {icon,label,value,href?}[]` | `chart {type:'area', points, tint}` |
  `list {icon?|avatar?, title, meta}[]` | `timeline {time, text, tint}[]`.
  Any string `value` matching a record key is resolved from the record.

## Opening the right detail panel from anywhere

```ts
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
openDetail({ config: DetailConfig, record })   // renders DetailTemplate in the 384px panel
closeDetail()
```

## Stores (zustand)

| Store | State/actions |
|---|---|
| `useThemeStore` | `mode: 'light'|'dark'|'system'|'auto'` (default **auto**: dark 19:00–07:00), `resolved`, `setMode`, `cycle()`, `refresh()`; `initTheme()` once at boot. Persisted `localStorage["asa-theme"]`. |
| `useRegistryStore` | `apps: AppManifest[]`, `toggleEnabled(id)` (toast + system notification side effects), `getApp(id)`, selector `selectEnabledApps`. |
| `useNotificationStore` | `items`, `fetchAll()` (idempotent), `markRead(id)` / `markAllRead()` (optimistic), `push(n)` (high priority also toasts), `arrivalTick` (bell wiggle), selector `selectUnreadCount`. |
| `useApiConfigStore` | `driver: 'mock'|'apps-script'`, `execUrl`, `setDriver/setExecUrl` (persisted `asa-api-driver`/`asa-api-url`), `demoFallback` → "Demo data" badge. |
| `useToastStore` | `toasts`, `push`, `dismiss`; plain-fn `toast({type:'success'|'info'|'warning'|'danger', title, body?, action?{label,href}})`. |
| `useDetailPanelStore` | `panel`, `openDetail({config, record?})`, `closeDetail()`. |

## API layer

```ts
api.list(resource, { q?, limit?, offset?, filters? }?) → T[]
api.get(resource, id) → T
api.create(resource, payload) → T
api.update(resource, id, payload) → T
api.remove(resource, id)
```

Mock driver: 250–600ms latency, in-memory seeded data (src/lib/seed.ts).
Apps Script driver: GET `{url}?resource=&action=` / POST `text/plain` `{resource,action,payload}`,
envelope `{status, data|message}`; on error → danger toast + per-call mock fallback + `demoFallback`.

## Rules for page agents

- **Tokens only** — classes like `bg-surface text-text-1 border-border`, tints via
  `TINT_BG/TINT_FG/TINT_VAR` from `@/lib/tints`, icons via `<AppIcon name="kebab"/>`.
  No hex, no `dark:` variants — dark mode is automatic.
- Templates render correctly in both themes with zero conditional logic.
- Shared components live in `src/components/shared/` (Card, PageHeader, StatCard,
  DeltaPill, TintTile, Avatar(+Stack), SearchInput, SegmentedTabs, FilterChips,
  EmptyState, Badge/CountPill/Dot, ProgressBar, Skeleton, charts, SchemaPreview).
- Motion: use `staggerContainer/staggerItem/EASE_OUT_EXPO` from `@/engine/motion`;
  cap 8 staggered children per viewport.
- Main scroll container id is `main-scroll` (needed for scroll-spy / sticky offsets).
