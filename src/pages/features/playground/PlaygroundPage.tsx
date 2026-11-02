// EDIT IN PLAYGROUND — the admin's app studio (/app/playground/studio).
// Design an app: identity (name, tagline, icon, tint, category, audience) and ONE OR MORE pages — each picked from…
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Copy,
  BookOpen, Database, Download, ExternalLink, FlaskConical, LayoutGrid, Loader2, Pencil, Plus, Rocket, Sparkles, Trash2, Upload, X,
} from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import PageHeader from '@/components/shared/PageHeader'
import TintTile from '@/components/shared/TintTile'
import { Switch } from '@/components/ui/switch'
import { AppIcon } from '@/lib/icons'
import { mergedCategoryDefs } from '@/lib/categories'
import { useCan } from '@/auth/permissions'
import { useAuthStore } from '@/auth/useAuthStore'
import { badgeRuleAllows, useBadgeAccessStore } from '@/lib/badgeAccess'
import { useCategoryStore } from '@/stores/useCategoryStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { toast } from '@/stores/useToastStore'
import { askConfirm } from '@/stores/useDialogStore'
import { gasAction } from '@/features/hiring/shared'
import { loadSheetApps } from '@/lib/sheetApps'
import { loadWorldApps } from '@/stores/useRegistryStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { useWorldOffered } from '@/lib/worldOffered'
import { api, asBackground } from '@/lib/api'
import {
  ensurePlaygroundAppsRegistered,
  playgroundResource,
  playgroundSlug,
  usePlaygroundStore,
  type PlaygroundApp,
  type PlaygroundDraftPage,
} from '@/stores/usePlaygroundStore'
import { cn } from '@/lib/utils'
import { ohioDayYear } from '@/lib/ohio'
import PlaygroundPreview from './PlaygroundPreview'
import BundleGallery from './BundleGallery'
import PlaygroundManual from './PlaygroundManual'
import PlaygroundIntro from './PlaygroundIntro'
import { DEFAULT_TOGGLES, applyRearrange } from './rearrange'
import { PAGE_TYPES, STARTER_CONFIGS, pretty, starterRows } from './starters'
import { checkBundle, checkConfig, checkRows, type PlaygroundBundle } from './validation'
import { checkSchema, configKeyRefs, isBoundResource, listBindableResources } from './datasource'
import { generateRows } from './generate'
import { draftFromPrompt } from './draftFromPrompt'
import { refineDraft } from './refine'
import ConfigBuilder, { RowsBuilder } from './builders'
import {
  IconGrid,
  ModeToggle,
  TintDots,
  ValidityDot,
} from './builders/shared'
import { inputCls, textareaCls, type EditorMode } from './builders/utils'
import type { AppManifest, PageType, TintName } from '@/engine/types'

const AUDIENCE_ROLES = ['admin', 'manager', 'staff', 'client'] as const
type AudienceRole = (typeof AUDIENCE_ROLES)[number]

/** The most pages the server accepts per app (APP_BUILDER_MAX_PAGES). */
const MAX_PAGES = 12
/** The most characters a resource (tab) name may hold server-side. */
const MAX_RESOURCE_CHARS = 48

/** Which half of each editor the admin last used — Visual is the default. */
type PageModes = { config: EditorMode; rows: EditorMode }
const DEFAULT_MODES: PageModes = { config: 'visual', rows: 'visual' }

/** One bound resource's live-row probe (schema check): keys, or why there are none. */
type LiveKeys = { state: 'loading' } | { state: 'empty' } | { state: 'error' } | { state: 'ok'; keys: string[] }

/** A draft page plus the dirty flags that guard the starter prefill swaps. */
type EditablePage = PlaygroundDraftPage & { configDirty: boolean; rowsDirty: boolean }

function newEditablePage(id: string): EditablePage {
  return {
    id,
    type: 'sheet',
    title: id === 'main' ? 'Main' : 'New page',
    resource: '',
    configText: pretty(STARTER_CONFIGS.sheet),
    rowsText: pretty(starterRows('sheet')),
    toggles: { ...DEFAULT_TOGGLES },
    configDirty: false,
    rowsDirty: false,
  }
}

/** config.columns → the [{key,label,kind}] the server declares the tab with. */
function columnsFromConfig(config: Record<string, unknown>) {
  const cols = config.columns
  if (!Array.isArray(cols)) return undefined
  const out = cols
    .filter((c): c is { key: string; label?: unknown; kind?: unknown } =>
      Boolean(c) && typeof c === 'object' && typeof (c as { key?: unknown }).key === 'string')
    .map((c) => ({
      key: c.key,
      label: typeof c.label === 'string' && c.label ? c.label : c.key,
      kind: typeof c.kind === 'string' && c.kind ? c.kind : 'text',
    }))
  return out.length ? out : undefined
}

/** gasAction throws for transport blips AND server refusals — tell them apart. */
function isTransportError(message: string): boolean {
  return (
    message === 'timeout' ||
    message.startsWith('Network error') ||
    message.startsWith('The backend answered')
  )
}

/** What the server answers to appBuilderUpsert. */
type BuilderUpsertResult = {
  id: string
  pages: number
  tabs: { resource: string; state: 'created' | 'exists' | 'coded'; seeded: number }[]
}

// What the server answers to playgroundGenerate — already validated and coerced server-side (AppBuilder.gs); the…
type PlaygroundGenerateResult = {
  via: string
  warnings: string[]
  draft: {
    name: string
    tagline: string
    icon: string
    accent: string
    category: string
    pages: { id: string; type: string; title: string; config: Record<string, unknown>; rows: Record<string, unknown>[] }[]
  }
}

export default function PlaygroundPage() {
  const canManage = useCan('apps.manage')
  // USER WORLDS: inside a world this same screen is the WORLD STUDIO.
  const worldActive = useWorldStore((s) => Boolean(s.currentWorldId))
  // The studio rule only narrows: apps.manage decides first, an empty rule changes nothing, the master is never narrowed.
  const playgroundRule = useBadgeAccessStore((s) => s.configRules['playground'])
  const me = useAuthStore((s) => s.user)
  // A non-admin still gets the studio, but publishes to their own world (`worldAppUpsert`), never the company registry.
  const bookAuthor = canManage || badgeRuleAllows(playgroundRule, me)
  // with no world to publish to, a non-admin's studio is not offered either
  const worldOn = useWorldOffered()
  const isAdmin = worldActive || canManage || (bookAuthor && worldOn)
  // Where a publish lands: the company registry for an admin, your own world for everybody else — including inside…
  const toWorld = worldActive || !canManage
  const navigate = useNavigate()

  // re-register persisted playground apps into the live registry (store isn't persisted)
  useEffect(() => { ensurePlaygroundAppsRegistered() }, [])

  /* ---------------- editor state ---------------- */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [icon, setIcon] = useState('rocket')
  const [accent, setAccent] = useState<TintName>('lavender')
  const [category, setCategory] = useState('Workspace')
  const [audience, setAudience] = useState<AudienceRole[]>([])
  const [pages, setPages] = useState<EditablePage[]>(() => [newEditablePage('main')])
  const [activePageId, setActivePageId] = useState('main')
  const [gasOpen, setGasOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  /** App ids the server knows (from `appsBuilt`) — drives the server/local badge. */
  const [serverIds, setServerIds] = useState<Set<string>>(new Set())
  /** Last-used editor mode per page (component state only — Visual is the default). */
  const [modes, setModes] = useState<Record<string, PageModes>>({})
  /** Page id the resource picker is open for (existing-resource mode before a pick). */
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null)
  /** Filter text inside the resource picker. */
  const [resourceQuery, setResourceQuery] = useState('')
  /** Live-row keys per bound resource (schema check cache; 'empty'/'error' degrade quietly). */
  const [liveKeys, setLiveKeys] = useState<Record<string, LiveKeys>>({})
  /** My playground apps: source filter chips. */
  const [appFilter, setAppFilter] = useState<'all' | 'server' | 'local'>('all')
  /** Import bundle modal. */
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const importFileRef = useRef<HTMLInputElement>(null)
  /** Curated bundle gallery ("Start from a template"). */
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  // "Describe your app" — the AI draft box.
  const [genPrompt, setGenPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genWarnings, setGenWarnings] = useState<string[]>([])
  const [genVia, setGenVia] = useState<string | null>(null)
  /** Honest progress lines while the GAS lane works — stages, never fake tokens. */
  const [genLog, setGenLog] = useState<string[]>([])
  /** Seconds since the ask went out — the wait is real, so it is shown. */
  const [genElapsed, setGenElapsed] = useState(0)
  const pageModes = modes[activePageId] ?? DEFAULT_MODES
  const setPageMode = (part: keyof PageModes, m: EditorMode) =>
    setModes((cur) => ({ ...cur, [activePageId]: { ...(cur[activePageId] ?? DEFAULT_MODES), [part]: m } }))

  // one fetch on mount: which of my playground apps already live on the sheet?
  useEffect(() => {
    let alive = true
    gasAction<{ apps?: { id?: string }[] }>(toWorld ? 'worldAppsList' : 'appsBuilt', {})
      .then((res) => {
        if (alive) setServerIds(new Set((res.apps ?? []).map((a) => String(a.id))))
      })
      .catch(() => { /* offline/demo — every badge reads "local", which is true */ })
    return () => { alive = false }
  }, [worldActive])

  const publishedApps = usePlaygroundStore((s) => s.apps)
  const saveApp = usePlaygroundStore((s) => s.saveApp)
  const removeApp = usePlaygroundStore((s) => s.removeApp)
  const duplicateApp = usePlaygroundStore((s) => s.duplicateApp)
  const customCategories = useCategoryStore((s) => s.customCategories)
  const labelOverrides = useCategoryStore((s) => s.labelOverrides)
  const categoryOrder = useCategoryStore((s) => s.categoryOrder)
  const catDefs = useMemo(() => mergedCategoryDefs(customCategories, labelOverrides, categoryOrder), [customCategories, labelOverrides, categoryOrder])

  const slug = playgroundSlug(name || 'my-app')
  const baseSlug = editingId ? editingId.replace(/^custom-/, '') : slug

  const activeIndex = Math.max(0, pages.findIndex((p) => p.id === activePageId))
  const activePage = pages[activeIndex] ?? pages[0]
  /** A non-`pg_` draft resource is a BINDING to a resource the registry already serves. */
  const activeBound = isBoundResource(activePage.resource)
  const activeResource = activeBound ? activePage.resource : playgroundResource(baseSlug, activeIndex, activePage.id)

  /** Resources the live registry already serves — the bind targets (never `pg_*`). */
  const registryApps = useRegistryStore((s) => s.apps)
  const bindable = useMemo(() => listBindableResources(registryApps), [registryApps])
  const filteredBindable = useMemo(() => {
    const q = resourceQuery.trim().toLowerCase()
    if (!q) return bindable
    return bindable.filter((b) => b.resource.toLowerCase().includes(q) || b.usedBy.some((n) => n.toLowerCase().includes(q)))
  }, [bindable, resourceQuery])

  const configCheck = useMemo(() => checkConfig(activePage.configText), [activePage.configText])
  const rowsCheck = useMemo(() => checkRows(activePage.rowsText), [activePage.rowsText])
  /** Row ids of the active page — lets the videos builder offer featuredId as a select. */
  const activeRowIds = rowsCheck.ok ? rowsCheck.rows.map((r) => String(r.id)) : []

  /**
   * Schema check: one debounced live read per bound resource (cached), then a
   * pure comparison re-run on every config edit. asBackground keeps a failed
   * probe from raising the global badge or a toast — an unreachable resource
   * simply skips the check.
   */
  const live = activeBound ? liveKeys[activePage.resource] : undefined
  useEffect(() => {
    if (!activeBound) return
    const resource = activePage.resource
    if (liveKeys[resource]) return
    let alive = true
    const t = setTimeout(() => {
      setLiveKeys((c) => (c[resource] ? c : { ...c, [resource]: { state: 'loading' } }))
      asBackground(() => api.list<Record<string, unknown>>(resource, { limit: 1 }))
        .then((rows) => {
          if (!alive) return
          setLiveKeys((c) => ({
            ...c,
            [resource]: rows.length ? { state: 'ok', keys: Object.keys(rows[0]) } : { state: 'empty' },
          }))
        })
        .catch(() => {
          if (alive) setLiveKeys((c) => ({ ...c, [resource]: { state: 'error' } }))
        })
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [activeBound, activePage.resource, liveKeys])

  /** The verdict — null when there is nothing to say (unbound, unreadable, or a key-free template). */
  const schemaVerdict = useMemo(() => {
    if (!activeBound || !configCheck.ok || live?.state !== 'ok') return null
    if (!configKeyRefs(activePage.type, configCheck.config).length) return null
    return checkSchema(activePage.type, configCheck.config, live.keys)
  }, [activeBound, activePage.type, configCheck, live])

  /** My playground apps, freshest first, narrowed by the source filter chips. */
  const visibleApps = useMemo(() => {
    const sorted = [...publishedApps].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (appFilter === 'all') return sorted
    return sorted.filter((a) => (appFilter === 'server') === serverIds.has(a.manifest.id))
  }, [publishedApps, appFilter, serverIds])

  /* ---------------- page list ops ---------------- */
  const updatePage = (pid: string, patch: Partial<EditablePage>) =>
    setPages((cur) => cur.map((p) => (p.id === pid ? { ...p, ...patch } : p)))

  const addPage = () => {
    if (pages.length >= MAX_PAGES) {
      toast({ type: 'info', title: `An app holds at most ${MAX_PAGES} pages.`, body: 'That is the server’s ceiling, not the studio’s.' })
      return
    }
    const ids = new Set(pages.map((p) => p.id))
    let n = pages.length + 1
    while (ids.has(`page-${n}`)) n++
    const page = newEditablePage(`page-${n}`)
    setPages((cur) => [...cur, page])
    setActivePageId(page.id)
  }

  const removePage = (pid: string) => {
    if (pages.length <= 1) return
    const next = pages.filter((p) => p.id !== pid)
    setPages(next)
    if (activePageId === pid) setActivePageId(next[0].id)
  }

  const movePage = (pid: string, dir: -1 | 1) =>
    setPages((cur) => {
      const i = cur.findIndex((p) => p.id === pid)
      const j = i + dir
      if (i < 0 || j < 0 || j >= cur.length) return cur
      const next = [...cur]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const onTypeChange = (t: PageType) => {
    // swap the prefill only where the admin hasn't typed anything of their own
    updatePage(activePage.id, {
      type: t,
      ...(activePage.configDirty ? {} : { configText: pretty(STARTER_CONFIGS[t]) }),
      ...(activePage.rowsDirty ? {} : { rowsText: pretty(starterRows(t)) }),
    })
  }

  // "Generate rows" — deterministic rows shaped from the CURRENT config (columns, stages, collections…).
  const generateSampleRows = async () => {
    if (
      activePage.rowsDirty &&
      !(await askConfirm({
        title: `Replace the rows of “${activePage.title || activePage.id}” with generated ones?`,
        body: 'The rows you edited by hand are lost.',
        confirmLabel: 'Replace',
        tone: 'danger',
      }))
    ) {
      return
    }
    const config = configCheck.ok ? configCheck.config : {}
    const rows = generateRows(activePage.type, config)
    updatePage(activePage.id, { rowsText: pretty(rows), rowsDirty: true })
    toast({ type: 'success', title: `${rows.length} rows generated`, body: 'Shaped from the current config — tweak them in the grid or in Advanced mode.' })
  }

  const resetForm = () => {
    setEditingId(null)
    setName(''); setTagline(''); setIcon('rocket'); setAccent('lavender')
    setCategory('Workspace'); setAudience([])
    setPages([newEditablePage('main')])
    setActivePageId('main')
  }

  const loadApp = (app: PlaygroundApp) => {
    const m = app.manifest
    setEditingId(m.id)
    setName(m.name); setTagline(m.tagline); setIcon(m.icon); setAccent(m.accent)
    setCategory(m.category)
    setAudience((m.audience ?? []).filter((a): a is AudienceRole => (AUDIENCE_ROLES as readonly string[]).includes(a)))
    setPages(app.pages.map((p) => ({ ...p, configDirty: true, rowsDirty: true })))
    setActivePageId(app.pages[0]?.id ?? 'main')
    toast({ type: 'info', title: `Editing “${m.name}”`, body: 'Publish again to overwrite it in the hub.' })
  }

  /* ---------------- publish ---------------- */
  const publish = async () => {
    if (publishing) return
    if (!name.trim()) {
      toast({ type: 'warning', title: 'Name your app first.', body: 'The App Identity card is where the hub listing starts.' })
      return
    }
    // validate EVERY page before anything is written; jump to the offender
    const parsed: { config: Record<string, unknown>; rows: Record<string, unknown>[] }[] = []
    for (const p of pages) {
      const c = checkConfig(p.configText)
      if (!c.ok) {
        setActivePageId(p.id)
        toast({ type: 'warning', title: `The config of “${p.title || p.id}” is invalid.`, body: c.message })
        return
      }
      const r = checkRows(p.rowsText)
      if (!r.ok) {
        setActivePageId(p.id)
        toast({ type: 'warning', title: `The sample data of “${p.title || p.id}” is invalid.`, body: r.message })
        return
      }
      if (r.rows.length === 0) {
        setActivePageId(p.id)
        toast({ type: 'warning', title: `“${p.title || p.id}” needs at least one sample row.`, body: 'An empty feed renders an empty page.' })
        return
      }
      parsed.push({ config: c.config, rows: r.rows })
    }

    // unique app id: keep when editing, otherwise custom-<slug> (+ -2, -3…)
    let id = editingId ?? `custom-${slug}`
    if (!editingId) {
      const taken = new Set(publishedApps.map((a) => a.manifest.id))
      let n = 2
      while (taken.has(id)) id = `custom-${slug}-${n++}`
    }
    const base = id.replace(/^custom-/, '')

    // A page bound to an existing resource keeps it verbatim (the backend treats coded resources as bindings — it…
    const pageResource = (p: EditablePage, i: number) =>
      isBoundResource(p.resource) ? p.resource : playgroundResource(base, i, p.id)

    // resource names become spreadsheet tabs — refuse at home what the server would refuse on the road (length…
    for (let i = 0; i < pages.length; i++) {
      if (isBoundResource(pages[i].resource)) continue
      const res = playgroundResource(base, i, pages[i].id)
      if (res.length > MAX_RESOURCE_CHARS) {
        setActivePageId(pages[i].id)
        toast({ type: 'warning', title: `The resource of “${pages[i].title || pages[i].id}” is too long.`, body: `${res} is ${res.length} characters; a tab name holds ${MAX_RESOURCE_CHARS}. Shorten the app name.` })
        return
      }
    }

    const existing = publishedApps.find((a) => a.manifest.id === id)
    const now = new Date().toISOString()

    const draftPages: PlaygroundDraftPage[] = pages.map((p, i) => ({
      id: p.id,
      type: p.type,
      title: p.title.trim() || name.trim(),
      resource: pageResource(p, i),
      configText: p.configText,
      rowsText: p.rowsText,
      toggles: p.toggles,
    }))
    const manifest: AppManifest = {
      id,
      name: name.trim(),
      tagline: tagline.trim() || 'Built in the playground.',
      icon,
      accent,
      category,
      version: existing ? bumpPatch(existing.manifest.version) : '0.1.0',
      isNew: true,
      enabled: existing ? existing.manifest.enabled : true,
      // ticked roles TIGHTEN visibility (lib/audience.ts: 'all' is the legacy-open entry) — prepending 'all' would…
      audience: audience.length ? [...audience] : ['all'],
      pages: draftPages.map((p, i) => ({
        id: p.id,
        type: p.type,
        title: p.title,
        icon,
        dataSource: { resource: p.resource },
        config: applyRearrange(parsed[i].config, p.toggles, p.type, p.resource),
      })),
    }

    // local save always lands — it is the studio's draft and the offline copy
    saveApp({ manifest, pages: draftPages, createdAt: existing?.createdAt ?? now, updatedAt: now })

    // server publish: the app_builder rows + one data tab per page
    const serverApp = {
      id: manifest.id,
      name: manifest.name,
      tagline: manifest.tagline,
      icon: manifest.icon,
      accent: manifest.accent,
      category: manifest.category,
      audience: manifest.audience,
      enabled: manifest.enabled,
      pages: manifest.pages.map((mp, i) => ({
        id: mp.id,
        type: mp.type,
        title: mp.title,
        resource: mp.dataSource.resource,
        columns: columnsFromConfig(mp.config),
        options: mp.config,
        rows: parsed[i].rows,
      })),
    }

    setPublishing(true)
    try {
      // the same grammar, two destinations: the company's app_builder sheet, or — inside a world — the user's own…
      const res = await gasAction<BuilderUpsertResult>(toWorld ? 'worldAppUpsert' : 'appBuilderUpsert', { app: serverApp })
      setServerIds((prev) => new Set(prev).add(id))
      // pull the sheet manifest (source:'sheet') into the registry now, so the app routes through the live…
      if (worldActive) void loadWorldApps(true)
      else void loadSheetApps(true)
      const seeded = (res.tabs ?? []).filter((t) => t.seeded > 0).length
      toast({
        type: 'success',
        // WHERE IT LANDED, not where you are standing: a non-admin publishing from headquarters lands in their own…
        title: toWorld ? 'App published to your world' : 'App published to the hub',
        body: `“${manifest.name}” is ${toWorld ? 'live in your world' : 'live for every browser'} — ${res.tabs?.length ?? pages.length} data tab(s) ready${seeded ? `, ${seeded} seeded with your sample rows` : ''}.`,
        action: { label: 'Open app', href: `/app/${manifest.id}/${manifest.pages[0]?.id ?? 'main'}` },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (isTransportError(msg)) {
        toast({
          type: 'warning',
          title: 'Published locally only',
          body: `The server could not be reached — “${manifest.name}” lives in this browser until a publish reaches the sheet.`,
        })
      } else {
        // a refusal names what was wrong — show it verbatim
        toast({
          type: 'warning',
          title: 'The server refused the publish',
          body: `${msg} A local copy stays in this browser.`,
        })
      }
    } finally {
      setPublishing(false)
    }
    setEditingId(manifest.id)
    navigate(`/app/${manifest.id}/${manifest.pages[0]?.id ?? 'main'}`)
  }

  /* ---------------- delete ---------------- */
  const deleteApp = async (a: PlaygroundApp) => {
    const id = a.manifest.id
    const serverBacked = serverIds.has(id)
    removeApp(id)
    if (editingId === id) setEditingId(null)
    if (!serverBacked) {
      toast({ type: 'info', title: `“${a.manifest.name}” deleted`, body: 'It left the hub and the sidebar.' })
      return
    }
    try {
      await gasAction(toWorld ? 'worldAppDelete' : 'appDelete', { id })
      if (worldActive) void loadWorldApps(true)   // the world registry drops it too
      setServerIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      toast({
        type: 'success',
        title: `“${a.manifest.name}” deleted`,
        body: 'Removed from the server and this browser. Its data tabs stay on the sheet — destroying data is a human decision.',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast({ type: 'warning', title: 'Deleted locally; the server copy resisted', body: msg })
    }
  }

  /* ---------------- export / import ---------------- */
  const exportApp = (a: PlaygroundApp) => {
    // parsed objects, not editor texts — a bundle opens anywhere, no studio needed
    const parse = (text: string, fallback: unknown) => {
      try { return JSON.parse(text) } catch { return fallback }
    }
    const bundle = {
      kind: 'asa-playground-app',
      version: 1,
      exportedAt: new Date().toISOString(),
      app: {
        name: a.manifest.name,
        tagline: a.manifest.tagline,
        icon: a.manifest.icon,
        accent: a.manifest.accent,
        category: a.manifest.category,
        audience: (a.manifest.audience ?? []).filter((x) => x !== 'all'),
        pages: a.pages.map((p) => ({
          id: p.id,
          type: p.type,
          title: p.title,
          resource: p.resource,
          config: parse(p.configText, {}),
          rows: parse(p.rowsText, []),
          toggles: p.toggles,
        })),
      },
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }))
    const el = document.createElement('a')
    el.href = url
    el.download = `asa-app-${a.manifest.id.replace(/^custom-/, '')}.json`
    el.click()
    URL.revokeObjectURL(url)
  }

  // A bundle lands as a NEW DRAFT, never as an overwrite: editingId stays null so publish mints a fresh…
  const importBundle = (bundle: PlaygroundBundle) => {
    const a = bundle.app
    const KNOWN_ACCENTS: TintName[] = ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber', 'green']
    const used = new Set<string>()
    const imported: EditablePage[] = a.pages.map((p, i) => {
      let id = playgroundSlug(p.id || `page-${i + 1}`)
      while (used.has(id)) id = `${id}-${i + 1}`
      used.add(id)
      return {
        id,
        type: p.type,
        title: p.title || `Page ${i + 1}`,
        resource: p.resource.startsWith('pg_') ? '' : p.resource,
        configText: pretty(p.config),
        rowsText: pretty(p.rows),
        toggles: { ...DEFAULT_TOGGLES, ...(p.toggles ?? {}) },
        configDirty: true,
        rowsDirty: true,
      }
    })
    setEditingId(null)
    setName(a.name)
    setTagline(a.tagline ?? '')
    setIcon(a.icon ?? 'rocket')
    setAccent(KNOWN_ACCENTS.includes(a.accent as TintName) ? (a.accent as TintName) : 'lavender')
    setCategory(catDefs.some((d) => d.id === a.category) ? (a.category as string) : 'Workspace')
    setAudience((a.audience ?? []).filter((x): x is AudienceRole => (AUDIENCE_ROLES as readonly string[]).includes(x)))
    setPages(imported)
    setActivePageId(imported[0].id)
    setImportOpen(false)
    setImportText('')
    toast({
      type: 'success',
      title: 'Imported — review and publish',
      body: `“${a.name}” is a fresh draft with ${imported.length} page(s). Publish mints its own data tabs — the exported app is untouched.`,
    })
  }

  // Gallery install — a curated bundle travels the EXACT path a file import takes: re-validated by checkBundle (the…
  const installBundle = (bundle: PlaygroundBundle) => {
    const res = checkBundle(JSON.stringify(bundle))
    if (!res.ok) {
      toast({ type: 'warning', title: 'The bundle is not valid', body: res.message })
      return
    }
    setGalleryOpen(false)
    importBundle(res.bundle)
  }

  // A generated draft lands like an import: NEW DRAFT, editingId stays null, every page's resource stays empty, so…
  const applyGeneratedDraft = (res: PlaygroundGenerateResult) => {
    // THE STANDARD PASS: whatever the model — or the local keyword lane — answered is refined deterministically…
    const { draft: d, notes: refineNotes } = refineDraft(res.draft)
    const KNOWN_ACCENTS: TintName[] = ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber', 'green']
    const knownTypes = new Set(PAGE_TYPES.map((t) => t.id))
    const used = new Set<string>()
    const generated: EditablePage[] = d.pages.map((p, i) => {
      let id = playgroundSlug(p.id || `page-${i + 1}`)
      while (used.has(id)) id = `${id}-${i + 1}`
      used.add(id)
      return {
        id,
        type: knownTypes.has(p.type as PageType) ? (p.type as PageType) : 'sheet',
        title: p.title || `Page ${i + 1}`,
        resource: '',
        configText: pretty(p.config),
        rowsText: pretty(p.rows),
        toggles: { ...DEFAULT_TOGGLES },
        configDirty: true,
        rowsDirty: true,
      }
    })
    // a draft with zero pages would crash the studio below (activePage.type) — leave the editor untouched instead…
    if (generated.length === 0) {
      toast({ type: 'warning', title: 'The model produced no pages', body: 'Rephrase and try again.' })
      return
    }
    setEditingId(null)
    setName(d.name)
    setTagline(d.tagline ?? '')
    setIcon(d.icon || 'rocket')
    setAccent(KNOWN_ACCENTS.includes(d.accent as TintName) ? (d.accent as TintName) : 'lavender')
    setCategory(catDefs.some((cd) => cd.id === d.category) ? d.category : 'Workspace')
    setAudience([])
    setPages(generated)
    setActivePageId(generated[0].id)
    setGenWarnings([...refineNotes, ...(res.warnings ?? [])])
    setGenVia(res.via || null)
    toast({
      type: 'success',
      title: 'Draft loaded — review and publish',
      body: `“${d.name}” arrived with ${generated.length} page(s). Nothing was published — tweak anything, then hit Publish app.`,
    })
  }

  // "Generate draft" — one sentence becomes a whole app draft, via the GAS playgroundGenerate action (the Groq…
  const generateDraft = async () => {
    if (generating) return
    const prompt = genPrompt.trim()
    if (!prompt) {
      toast({ type: 'warning', title: 'Describe the app first.', body: 'One sentence is enough — the model designs pages, configs and sample rows from it.' })
      return
    }
    // a dirty editor is somebody's work — never replace it without asking (same confirm the "Generate rows"…
    if (
      (editingId || pages.some((p) => p.configDirty || p.rowsDirty)) &&
      !(await askConfirm({
        title: 'Replace the current draft with the generated one?',
        body: 'The unsaved edits in the studio are lost.',
        confirmLabel: 'Replace',
        tone: 'danger',
      }))
    ) {
      return
    }
    setGenerating(true)
    setGenElapsed(0)
    setGenLog(['Brief sent — the platform asks the model rotation.'])
    const t0 = Date.now()
    const stages: [number, string][] = [
      [8, 'The model is designing pages, configs and sample rows…'],
      [30, 'Still writing — a whole app arrives in one answer, not a stream.'],
      [60, 'A minute in — the rotation may be falling to a spare key…'],
    ]
    const timer = setInterval(() => {
      const s = (Date.now() - t0) / 1000
      setGenElapsed(Math.floor(s))
      for (const [at, line] of stages) {
        if (s >= at) setGenLog((cur) => (cur.includes(line) ? cur : [...cur, line]))
      }
    }, 1000)
    try {
      const res = await gasAction<PlaygroundGenerateResult>('playgroundGenerate', { prompt }, { timeoutMs: 120_000 })
      applyGeneratedDraft(res)
      setGenLog([])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // NO MODEL, NO PROBLEM — use the AI when there is one, and this method when there is not.
      if (/no model answered/i.test(msg) || isTransportError(msg)) {
        applyGeneratedDraft({ via: 'local keywords', warnings: [], draft: draftFromPrompt(prompt) })
        setGenLog([])
        toast({
          type: 'info',
          title: 'No model answered — drafted locally',
          body: 'Your keywords became pages, configs and sample rows. When a model answers again, Generate draft gives the full treatment.',
        })
      } else {
        toast({ type: 'warning', title: 'The model did not produce a draft', body: msg })
      }
    } finally {
      clearInterval(timer)
      setGenerating(false)
    }
  }

  // DISCARD AND RETRY — chosen over re-reading the current draft into the templates, because explicit beats clever.
  const discardDraft = async () => {
    if (
      await askConfirm({
        title: 'Discard the current draft?',
        body: 'Everything in the studio is cleared so you can describe a new app and try again.',
        confirmLabel: 'Discard',
        tone: 'danger',
      })
    ) {
      resetForm()
      setGenPrompt('')
      setGenLog([])
      setGenWarnings([])
      setGenVia(null)
    }
  }
  /** A blank studio has nothing to discard. */
  const draftPristine =
    !editingId && !name && pages.length === 1 && !pages[0].configDirty && !pages[0].rowsDirty

  /* ---------------- gate ---------------- */
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-[520px] pt-16">
        <EmptyState
          title="The playground is an admin tool"
          body="Ask an administrator to design and publish apps — anything they ship appears in your App Hub."
          action={{ label: 'Browse the App Hub', href: '/apps' }}
        />
      </div>
    )
  }

  return (
    <div className="w-full">
      <PageHeader
        title="Playground"
        subtitle="Design an app, feed it sample JSON, publish it to the hub."
        actions={
          <>
            {editingId && (
              <button
                onClick={resetForm}
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                <Plus size={14} /> New app
              </button>
            )}
            {/* THE MANUAL IS A COMPANION, NOT A DETOUR:
                it toggles a docked side panel with no backdrop, so people flip
                it open and shut the whole time they build — the studio stays
                clickable underneath and the panel keeps its scroll position. */}
            <button
              onClick={() => setManualOpen((v) => !v)}
              title={manualOpen ? 'Close the manual (Esc)' : 'How to use the Playground — opens beside your work'}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md border px-3 text-[13px] font-semibold transition-colors',
                manualOpen
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-surface text-text-1 hover:bg-surface-2',
              )}
            >
              <BookOpen size={14} /> Manual
            </button>
            <button
              onClick={() => setGalleryOpen(true)}
              title="Install a curated, ready-made app as a fresh draft"
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <LayoutGrid size={14} /> Gallery
            </button>
            <button
              onClick={() => setImportOpen(true)}
              title="Import an exported app bundle (asa-app-*.json)"
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <Upload size={14} /> Import
            </button>
            <button
              onClick={publish}
              disabled={publishing}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
            >
              <Rocket size={14} /> {publishing ? 'Publishing…' : editingId ? 'Publish changes' : 'Publish app'}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,46%)_minmax(0,54%)]">
        {/* ================= left: editors ================= */}
        <div className="flex min-w-0 flex-col gap-5">
          {/* ---- 0 · describe your app (AI draft) ---- */}
          <Card>
            <CardHeader
              title="Describe your app"
              sub="One sentence — the model drafts the identity, pages, configs and sample rows. It loads as an unsaved draft: review everything, then publish."
            />
            <textarea
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="e.g. A fleet tracker with vehicles, mileage logs and a maintenance checklist"
              className={textareaCls}
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={generateDraft}
                // THE MODEL IS ADMIN-ONLY ON THE SERVER (playgroundGenerate, roles: ['admin']).
                disabled={generating || !genPrompt.trim() || !canManage}
                title={canManage
                  ? 'Ask the model to design the whole app (can take a minute)'
                  : 'Designing an app with the model is the platform owner\'s — build your pages by hand here, and they publish to your world.'}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
              >
                {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {generating ? 'Generating…' : 'Generate draft'}
              </button>
              <button
                onClick={discardDraft}
                disabled={generating || draftPristine}
                title="Throw away the current draft and start over"
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-2 transition-colors hover:bg-surface-2 hover:text-tint-fg-pink disabled:opacity-40"
              >
                <Trash2 size={14} /> Discard
              </button>
              {genVia && !generating && (
                <span className="text-[11px] text-text-3">generated via {genVia}</span>
              )}
            </div>
            {/* the generation watch — honest stages and elapsed time while
                the GAS lane works; the answer arrives whole, never streamed */}
            {(generating || genLog.length > 0) && (
              <div className="mt-3 rounded-md border border-border bg-surface-2 px-2.5 py-2">
                <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.05em] text-text-3">
                  {generating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  <span className="flex-1">
                    {generating ? `Creating your app… ${genElapsed}s` : 'The last ask, as it went'}
                  </span>
                  {!generating && (
                    <button
                      onClick={() => setGenLog([])}
                      title="Dismiss"
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
                <ul className="mt-1 space-y-0.5 text-[11.5px] leading-4 text-text-2">
                  {genLog.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            {/* server-side coercion notes — amber, dismissible, never a gate */}
            {genWarnings.length > 0 && (
              <div className="mt-3 rounded-md bg-tint-amber px-2.5 py-2">
                <div className="flex items-start gap-1">
                  <p className="flex flex-1 items-center gap-1 text-[11px] font-bold uppercase tracking-[0.05em] text-tint-fg-amber">
                    <AlertTriangle size={11} /> The model adjusted {genWarnings.length} thing(s)
                  </p>
                  <button
                    onClick={() => setGenWarnings([])}
                    title="Dismiss"
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-sm text-tint-fg-amber transition-colors hover:bg-surface"
                  >
                    <X size={11} />
                  </button>
                </div>
                <ul className="mt-0.5 space-y-0.5 text-[11.5px] leading-4 text-text-2">
                  {genWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {/* ---- 1 · app identity ---- */}
          <Card>
            <CardHeader title="App identity" sub="How the app introduces itself in the hub, sidebar and ⌘K." />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fleet Tracker" className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Tagline</span>
                <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="One calm sentence" className={inputCls} />
              </label>
            </div>

            <div className="mt-4">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Icon</span>
              <IconGrid value={icon} onChange={setIcon} />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Accent tint</span>
                <TintDots value={accent} onChange={setAccent} />
              </div>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Category</span>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                  {catDefs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}{d.custom ? ' (custom)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Audience</span>
              <div className="flex flex-wrap gap-3">
                {AUDIENCE_ROLES.map((r) => (
                  <label key={r} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-text-1">
                    <input
                      type="checkbox"
                      checked={audience.includes(r)}
                      onChange={(e) =>
                        setAudience((cur) => (e.target.checked ? [...cur, r] : cur.filter((x) => x !== r)))
                      }
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="capitalize">{r}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] leading-4 text-text-3">
                No boxes ticked → visible to everyone. Ticking role names tightens visibility to those roles.
              </p>
            </div>
          </Card>

          {/* ---- 2 · pages ---- */}
          <Card>
            <CardHeader
              title="Pages"
              sub="Every page is a template + its own config, sample rows and toggles. The first page is where the app opens."
            />
            <div className="divide-y divide-border">
              {pages.map((p, i) => (
                <div
                  key={p.id}
                  className={cn(
                    'flex items-center gap-2 py-2 first:pt-0 last:pb-0',
                    p.id === activePage.id && 'text-text-1',
                  )}
                >
                  <button
                    onClick={() => setActivePageId(p.id)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors',
                      p.id === activePage.id ? 'bg-primary-soft' : 'hover:bg-surface-2',
                    )}
                  >
                    <span className="w-4 shrink-0 text-center font-mono text-[10px] text-text-3">{i + 1}</span>
                    <span className={cn('min-w-0 flex-1 truncate text-[13px] font-semibold', p.id === activePage.id ? 'text-primary-strong' : 'text-text-1')}>
                      {p.title || p.id}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-text-3">{p.type}</span>
                  </button>
                  <IconBtn title="Move up" onClick={() => movePage(p.id, -1)} icon={<ArrowUp size={13} />} />
                  <IconBtn title="Move down" onClick={() => movePage(p.id, 1)} icon={<ArrowDown size={13} />} />
                  <IconBtn
                    title={pages.length <= 1 ? 'An app needs at least one page' : 'Remove page'}
                    danger
                    onClick={() => removePage(p.id)}
                    icon={<X size={13} />}
                  />
                </div>
              ))}
            </div>
            <button
              onClick={addPage}
              className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
            >
              <Plus size={13} /> Add page
            </button>
          </Card>

          {/* ---- 3 · page schema (active page) ---- */}
          <Card>
            <CardHeader
              title={`Page schema — ${activePage.title || activePage.id}`}
              sub="Pick a template, then shape its config visually — nobody needs to write JSON. Advanced mode is the raw config, handed to the template unchanged."
            />

            {/* template gallery: the 11 engine page types as selectable cards */}
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Page type</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PAGE_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onTypeChange(t.id)}
                  title={t.hint}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-md border p-2.5 text-left transition-colors',
                    activePage.type === t.id
                      ? 'border-primary bg-primary-soft ring-1 ring-primary'
                      : 'border-border bg-surface hover:bg-surface-2',
                  )}
                >
                  <span
                    className={cn(
                      'flex items-center gap-1.5 text-[12.5px] font-semibold',
                      activePage.type === t.id ? 'text-primary-strong' : 'text-text-1',
                    )}
                  >
                    <AppIcon name={t.icon} size={14} /> {t.label}
                  </span>
                  <span className="text-[10.5px] leading-[1.35] text-text-3">{t.hint}</span>
                </button>
              ))}
            </div>

            <label className="mt-3 block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Page title</span>
              <input value={activePage.title} onChange={(e) => updatePage(activePage.id, { title: e.target.value })} className={inputCls} />
            </label>

            {/* data source: mint a fresh tab at publish, or bind a resource the registry already serves */}
            <div className="mt-4">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Data source</span>
              <div className="flex items-center rounded-md bg-surface-2 p-0.5">
                {(
                  [
                    ['new', 'New tab'],
                    ['existing', 'Existing resource'],
                  ] as const
                ).map(([m, label]) => {
                  const on = m === 'existing' ? activeBound || pickerOpenFor === activePage.id : !activeBound && pickerOpenFor !== activePage.id
                  return (
                    <button
                      key={m}
                      onClick={() => {
                        if (m === 'new') {
                          updatePage(activePage.id, { resource: '' })
                          setPickerOpenFor(null)
                        } else {
                          setPickerOpenFor(activePage.id)
                          setResourceQuery('')
                        }
                      }}
                      className={cn(
                        'rounded-[5px] px-2.5 py-1 text-[11px] font-semibold transition-colors',
                        on ? 'bg-surface text-text-1 shadow-1' : 'text-text-3 hover:text-text-2',
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
                {!activeBound && pickerOpenFor !== activePage.id && (
                  <span className="ml-2 truncate font-mono text-[10px] text-text-3">{activeResource}</span>
                )}
              </div>

              {(activeBound || pickerOpenFor === activePage.id) && (
                <div className="mt-2">
                  <input
                    value={resourceQuery}
                    onChange={(e) => setResourceQuery(e.target.value)}
                    placeholder="Search resources or apps…"
                    className={inputCls}
                  />
                  <div className="scroll-thin mt-1.5 max-h-44 overflow-y-auto rounded-md border border-border">
                    {filteredBindable.length === 0 ? (
                      <p className="px-3 py-2.5 text-[12px] text-text-3">No resource matches — the list comes from the live registry.</p>
                    ) : (
                      filteredBindable.map((b) => (
                        <button
                          key={b.resource}
                          onClick={() => {
                            updatePage(activePage.id, { resource: b.resource })
                            setPickerOpenFor(null)
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2',
                            activePage.resource === b.resource && 'bg-primary-soft',
                          )}
                        >
                          <Database size={12} className={cn('shrink-0', activePage.resource === b.resource ? 'text-primary-strong' : 'text-text-3')} />
                          <span className={cn('min-w-0 flex-1 truncate font-mono text-[12px]', activePage.resource === b.resource ? 'font-semibold text-primary-strong' : 'text-text-1')}>
                            {b.resource}
                          </span>
                          <span className="shrink-0 truncate text-[10.5px] text-text-3">{b.usedBy.join(', ')}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* schema check — a warning, never a gate */}
              {activeBound && (
                <div className="mt-2">
                  {(!live || live.state === 'loading') && (
                    <p className="text-[11.5px] text-text-3">Checking the live schema…</p>
                  )}
                  {live?.state === 'error' && (
                    <p className="text-[11.5px] text-text-3">
                      Live rows are unreachable right now — schema check skipped; publish is unaffected.
                    </p>
                  )}
                  {live?.state === 'empty' && (
                    <p className="text-[11.5px] text-text-3">
                      “{activePage.resource}” answered with no rows yet — nothing to compare the config against.
                    </p>
                  )}
                  {schemaVerdict?.state === 'clean' && (
                    <p className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-tint-fg-mint">
                      <Check size={12} /> Schema matches the live rows.
                    </p>
                  )}
                  {schemaVerdict?.state === 'missing' && (
                    <div className="rounded-md bg-tint-amber px-2.5 py-2">
                      <p className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.05em] text-tint-fg-amber">
                        <AlertTriangle size={11} /> {schemaVerdict.missing.length} config key(s) missing from the live rows
                      </p>
                      <ul className="space-y-0.5 text-[11.5px] leading-4 text-text-2">
                        {schemaVerdict.missing.map((m) => (
                          <li key={m.where}>{m.where} has no match in the live rows</li>
                        ))}
                      </ul>
                      <p className="mt-1.5 font-mono text-[10px] leading-4 text-text-3">
                        live keys: {schemaVerdict.liveKeys.join(', ')}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mb-2 mt-4 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Config</span>
              <div className="flex items-center gap-2">
                {pageModes.config === 'json' ? (
                  <ValidationChip ok={configCheck.ok} message={configCheck.ok ? undefined : configCheck.message} line={configCheck.ok ? undefined : configCheck.line} okLabel="Valid JSON" />
                ) : (
                  <ValidityDot ok={configCheck.ok} title={configCheck.ok ? 'Valid JSON' : `${configCheck.message}${configCheck.line ? ` · line ${configCheck.line}` : ''}`} />
                )}
                <ModeToggle mode={pageModes.config} onChange={(m) => setPageMode('config', m)} />
              </div>
            </div>
            {pageModes.config === 'json' ? (
              <textarea
                value={activePage.configText}
                onChange={(e) => updatePage(activePage.id, { configText: e.target.value, configDirty: true })}
                rows={15}
                spellCheck={false}
                className={cn(textareaCls, configCheck.ok ? 'border-border' : 'border-tint-fg-pink')}
              />
            ) : (
              <ConfigBuilder
                type={activePage.type}
                configText={activePage.configText}
                rowIds={activeRowIds}
                onChange={(next) => updatePage(activePage.id, { configText: pretty(next), configDirty: true })}
              />
            )}
          </Card>

          {/* ---- 4 · sample data (active page) ---- */}
          <Card>
            <CardHeader
              title={`Sample data — ${activePage.title || activePage.id}`}
              sub="The rows this page renders until a live backend takes over. On first publish they seed the server tab. Every row needs a unique string id."
            />
            {activeBound && (
              <p className="mb-2 rounded-md bg-tint-amber px-2.5 py-1.5 text-[11.5px] leading-4 text-tint-fg-amber">
                Sample rows are preview-only — the live page reads real data from <span className="font-mono">{activePage.resource}</span>.
              </p>
            )}
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Rows</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void generateSampleRows()}
                  title="Generate plausible rows from the current config"
                  className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[11px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
                >
                  <Sparkles size={12} /> Generate rows
                </button>
                {pageModes.rows === 'json' ? (
                  <ValidationChip ok={rowsCheck.ok} message={rowsCheck.ok ? undefined : rowsCheck.message} line={rowsCheck.ok ? undefined : rowsCheck.line} okLabel={rowsCheck.ok ? `Valid · ${rowsCheck.rows.length} rows` : undefined} />
                ) : (
                  <ValidityDot ok={rowsCheck.ok} title={rowsCheck.ok ? `Valid · ${rowsCheck.rows.length} rows` : `${rowsCheck.message}${rowsCheck.line ? ` · line ${rowsCheck.line}` : ''}`} />
                )}
                <ModeToggle mode={pageModes.rows} onChange={(m) => setPageMode('rows', m)} />
              </div>
            </div>
            {pageModes.rows === 'json' ? (
              <textarea
                value={activePage.rowsText}
                onChange={(e) => updatePage(activePage.id, { rowsText: e.target.value, rowsDirty: true })}
                rows={13}
                spellCheck={false}
                className={cn(textareaCls, rowsCheck.ok ? 'border-border' : 'border-tint-fg-pink')}
              />
            ) : (
              <RowsBuilder
                rowsText={activePage.rowsText}
                onChange={(text) => updatePage(activePage.id, { rowsText: text, rowsDirty: true })}
              />
            )}
          </Card>

          {/* ---- 5 · rearrange controls (active page) ---- */}
          <Card>
            <CardHeader
              title={`Rearrange controls — ${activePage.title || activePage.id}`}
              sub="Per page: you decide what end users can rearrange on the published page. Compiles straight into the schema config."
            />
            <div className="divide-y divide-border">
              <ToggleRow
                label="Allow row ordering"
                hint="Sheet: alpha/manual drag ordering. Pipeline & board: drag cards between stages."
                checked={activePage.toggles.ordering}
                onChange={(v) => updatePage(activePage.id, { toggles: { ...activePage.toggles, ordering: v } })}
              />
              <ToggleRow
                label="Allow export"
                hint="Sheet toolbar: CSV / Excel / TXT download menu."
                checked={activePage.toggles.export}
                onChange={(v) => updatePage(activePage.id, { toggles: { ...activePage.toggles, export: v } })}
              />
              <ToggleRow
                label="Allow inline edit"
                hint="Sheet rows open an edit form (synthesized from your columns)."
                checked={activePage.toggles.inlineEdit}
                onChange={(v) => updatePage(activePage.id, { toggles: { ...activePage.toggles, inlineEdit: v } })}
              />
              <ToggleRow
                label="Allow create records"
                hint="Sheet header shows a primary “New record” action."
                checked={activePage.toggles.create}
                onChange={(v) => updatePage(activePage.id, { toggles: { ...activePage.toggles, create: v } })}
              />
            </div>
          </Card>

          {/* ---- 6 · apps script feed ---- */}
          <Card>
            <button onClick={() => setGasOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
              {gasOpen ? <ChevronDown size={15} className="text-text-3" /> : <ChevronRight size={15} className="text-text-3" />}
              <span className="font-display text-[15px] font-bold text-text-1">Feeding this page from an automation</span>
              <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-3">{activeResource}</span>
            </button>
            {gasOpen && (
              <div className="mt-3 space-y-3">
                <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-5 text-text-2">
                  <li>Hit <b>Publish</b> — the server writes the app to the <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">app_builder</code> tab and creates each page's data tab automatically (header row = <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">id</code> + your declared columns). Sample rows seed a tab only the first time it is created.</li>
                  <li>To hand-feed or inspect the data, open the spreadsheet tab named <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">{activeResource}</code> — edits there are live on the next read.</li>
                  <li>Re-publishing over an app that already has real rows never touches them: existing tabs are left exactly as they stand.</li>
                </ol>
                <div className="relative rounded-md border border-border bg-bg p-3 font-mono text-[11.5px] leading-5 text-text-2">
                  <pre className="whitespace-pre-wrap break-all">{gasSnippet(activeResource)}</pre>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(gasSnippet(activeResource))
                      toast({ type: 'success', title: 'Copied the snippet' })
                    }}
                    className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-sm border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2"
                    title="Copy"
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </div>
            )}
          </Card>

          {/* ---- 7 · my playground apps ---- */}
          <Card>
            <CardHeader title="My playground apps" sub="Published from this studio. “server” lives on the sheet for every browser; “local” is this browser only." />
            {publishedApps.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-text-3">
                Nothing published yet. Design above, hit <b>Publish app</b>, and it lands here — and in the hub.
              </p>
            ) : (
              <>
                <div className="mb-2 flex gap-1.5">
                  {(['all', 'server', 'local'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setAppFilter(f)}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors',
                        appFilter === f ? 'bg-primary text-on-primary' : 'bg-surface-2 text-text-2 hover:bg-surface',
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                {visibleApps.length === 0 ? (
                  <p className="py-4 text-center text-[13px] text-text-3">No {appFilter} apps.</p>
                ) : (
              <div className="divide-y divide-border">
                {visibleApps.map((a) => (
                  <div key={a.manifest.id} className="flex items-center gap-3 py-2.5">
                    <TintTile icon={a.manifest.icon} tint={a.manifest.accent} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-text-1">
                        {a.manifest.name}
                        <span className="ml-2 font-mono text-[10px] font-normal text-text-3">v{a.manifest.version} · {a.manifest.id}</span>
                        <span
                          className={cn(
                            'ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em]',
                            serverIds.has(a.manifest.id) ? 'bg-tint-mint text-tint-fg-mint' : 'bg-surface-2 text-text-3',
                          )}
                        >
                          {serverIds.has(a.manifest.id) ? 'server' : 'local'}
                        </span>
                      </p>
                      <p className="truncate text-[11px] text-text-3">
                        {a.manifest.pages.length} page(s): {a.manifest.pages.map((p) => p.type).join(', ')} · updated {ohioDayYear(a.updatedAt)}
                      </p>
                    </div>
                    <IconBtn title="Open" onClick={() => navigate(`/app/${a.manifest.id}/${a.manifest.pages[0]?.id ?? 'main'}`)} icon={<ExternalLink size={13} />} />
                    <IconBtn title="Edit in studio" onClick={() => loadApp(a)} icon={<Pencil size={13} />} />
                    <IconBtn title="Duplicate" onClick={() => {
                      const copy = duplicateApp(a.manifest.id)
                      if (copy) toast({ type: 'success', title: `Duplicated as “${copy.manifest.name}”`, body: 'The copy is local — publish it to give it server tabs of its own.' })
                    }} icon={<Copy size={13} />} />
                    <IconBtn title="Export as JSON bundle" onClick={() => exportApp(a)} icon={<Download size={13} />} />
                    <IconBtn title={serverIds.has(a.manifest.id) ? 'Delete (server + local)' : 'Delete'} danger onClick={() => void deleteApp(a)} icon={<Trash2 size={13} />} />
                  </div>
                ))}
              </div>
                )}
              </>
            )}
          </Card>
        </div>

        {/* ================= right: live preview ================= */}
        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-border bg-bg/60 p-3">
            <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
              <FlaskConical size={12} /> Live preview
            </div>
            {pages.length > 1 && (
              <div className="mb-2 flex flex-wrap gap-1 px-1">
                {pages.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => setActivePageId(p.id)}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
                      p.id === activePage.id ? 'bg-primary text-on-primary' : 'bg-surface-2 text-text-2 hover:bg-surface',
                    )}
                  >
                    {i + 1} · {p.title || p.id}
                  </button>
                ))}
              </div>
            )}
            <PlaygroundPreview
              key={activePage.id}
              name={name}
              tagline={tagline}
              icon={icon}
              accent={accent}
              pageType={activePage.type}
              pageTitle={activePage.title}
              configText={activePage.configText}
              rowsText={activePage.rowsText}
              toggles={activePage.toggles}
              resource={activeResource}
            />
          </div>
        </div>
      </div>

      {/* ---- curated bundle gallery: install a ready-made app as a draft ---- */}
      <BundleGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} onInstall={installBundle} />

      {/* ---- the manual: a docked panel that coexists with the editor ---- */}
      <PlaygroundManual open={manualOpen} onClose={() => setManualOpen(false)} />

      {/* ---- the studio's own first visit: five ideas, shown once ---- */}
      <PlaygroundIntro />

      {/* ---- import bundle modal: paste JSON or pick an asa-app-*.json file ---- */}
      {importOpen && (
        <div
          onClick={() => setImportOpen(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-[2px]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Import app bundle"
            className="scroll-thin max-h-[88vh] w-full max-w-[520px] overflow-y-auto rounded-xl bg-surface p-5 shadow-3"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-[17px] font-bold text-text-1">Import an app bundle</h2>
                <p className="mt-0.5 text-[12.5px] text-text-2">
                  Paste the JSON or pick an <span className="font-mono text-[11.5px]">asa-app-*.json</span> file. It lands as a fresh draft — nothing is overwritten.
                </p>
              </div>
              <button
                onClick={() => setImportOpen(false)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2"
                title="Close"
              >
                <X size={13} />
              </button>
            </div>

            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={10}
              spellCheck={false}
              placeholder='{ "kind": "asa-playground-app", … }'
              className={textareaCls}
            />

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => importFileRef.current?.click()}
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                <Upload size={14} /> Choose file
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  void file.text().then(setImportText)
                }}
              />
              <button
                onClick={() => {
                  const res = checkBundle(importText)
                  if (!res.ok) {
                    toast({ type: 'warning', title: 'The bundle is not valid', body: `${res.message}${res.line ? ` (line ${res.line})` : ''}` })
                    return
                  }
                  importBundle(res.bundle)
                }}
                disabled={!importText.trim()}
                className="ml-auto flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
              >
                <Check size={14} /> Load into studio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- bits ---------------- */

function ValidationChip({ ok, message, line, okLabel = 'Valid JSON' }: { ok: boolean; message?: string; line?: number; okLabel?: string }) {
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-tint-mint px-2 py-0.5 text-[10px] font-bold text-tint-fg-mint">
        <Check size={10} /> {okLabel}
      </span>
    )
  }
  return (
    <span
      title={message}
      className="inline-flex max-w-[70%] items-center gap-1 truncate rounded-full bg-tint-pink px-2 py-0.5 text-[10px] font-bold text-tint-fg-pink"
    >
      <AlertTriangle size={10} className="shrink-0" />
      <span className="truncate">{message}{line ? ` · line ${line}` : ''}</span>
    </span>
  )
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-text-1">{label}</p>
        <p className="text-[11px] leading-4 text-text-3">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}

function IconBtn({ title, onClick, icon, danger = false }: { title: string; onClick: () => void; icon: ReactNode; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-border bg-surface transition-colors hover:bg-surface-2',
        danger ? 'text-tint-fg-pink' : 'text-text-2',
      )}
    >
      {icon}
    </button>
  )
}

function bumpPatch(version: string): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return version
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
}

function gasSnippet(resource: string): string {
  return [
    `# The Hub's own door — one endpoint, one tab per resource, signed in with your session`,
    `# List the rows feeding this page:`,
    `POST /gas   body={"token": "<your session>", "resource": "${resource}", "action": "list"}`,
    `# → { "status": 200, "data": [ { "id": "row-1", … } ] }`,
    `#`,
    `# Actions: list, get, create, update, delete.`,
    `# Tab "${resource}": created by Publish; header row = field names, first column "id".`,
  ].join('\n')
}
