// ⌘K command palette (§7.3) — cmdk.
// 560px panel at 18vh, scrim + blur, tint-tile icons.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'framer-motion'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useShellStore } from '@/stores/useShellStore'
import { useThemeStore } from '@/stores/useThemeStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { recordSearch } from '@/lib/searchHistory'
import { allowedPages, visibleManifests } from '@/lib/audience'
import { selectAccessChecker, useBadgeRulesVersion } from '@/lib/appAccess'
import { useEffectiveIsMaster, useEffectiveRole, useEffectiveUser } from '@/lib/effectiveUser'
import { useWorldOffered } from '@/lib/worldOffered'
import { useMyAsaOffered } from '@/lib/myAsaOffered'
import { createActions, peopleMatches, settingsActions, type PaletteAction } from '@/lib/paletteActions'
import { resolveByMeaning, type ResolveChoice } from '@/lib/paletteResolve'
import { cachedUsers, fetchUsersIfStale } from '@/lib/usersDirectory'
import { settingsNavFor } from '@/lib/settingsNav'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { api, asBackground } from '@/lib/api'
import { invalidateAll } from '@/lib/apiCache'
import { selectUnreadCount } from '@/stores/useNotificationStore'
import { toast } from '@/stores/useToastStore'
import TintTile from '@/components/shared/TintTile'
import Avatar from '@/components/shared/Avatar'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { TintName } from '@/engine/types'

const RECENT_KEY = 'asa-palette-recent'

export default function CommandPalette() {
  const { paletteOpen: open, setPaletteOpen: setOpen } = useShellStore()
  const apps = useRegistryStore((s) => s.apps)
  const { setMode, resolved } = useThemeStore()
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const unread = useNotificationStore(selectUnreadCount)
  const logout = useAuthStore((s) => s.logout)
  // EFFECTIVE, not signed-in: the palette lists what this workspace reaches, and inside a member visit that is…
  const isMaster = useEffectiveIsMaster()
  const navigate = useNavigate()
  // The search text lives HERE now, not inside the input: People and the meaning leg are computed from it, and a…
  const [search, setSearch] = useState('')
  useEffect(() => {
    if (!open) return
    const seed = useShellStore.getState().paletteSeed
    setSearch(seed)
    if (seed) useShellStore.getState().setPaletteSeed('')
  }, [open])
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    } catch {
      return []
    }
  })

  // ⌘K / ctrl+K global shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!useShellStore.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  // audience filter by role (onboarding allow-list, caregiver tightening) + badge rules + personal denials…
  const role = useEffectiveRole()
  const badgeVersion = useBadgeRulesVersion()
  const enabled = useMemo(
    () => visibleManifests(apps, { role }, selectAccessChecker(apps, role)).filter((a) => a.enabled),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- badgeVersion re-runs this when the badge matrix changes
    [apps, role, badgeVersion],
  )

  const go = (href: string, label: string) => {
    const next = [label, ...recent.filter((r) => r !== label)].slice(0, 4)
    setRecent(next)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    // the star's trail: what was typed, where it led
    recordSearch(String(me?.id ?? ''), { q: search.trim(), title: label, href })
    setOpen(false)
    navigate(href)
  }

  // One way to perform a palette entry: a destination is walked to, a verb is done and said.
  const run = (a: PaletteAction) => {
    setOpen(false)
    if (a.href) {
      go(a.href, a.label)
      return
    }
    a.run?.()
    if (a.toast) toast({ type: 'success', title: a.toast })
  }

  // THE SHELL'S OWN VERBS — the things no screen can do for you.
  const bookmarksOffered = useMyAsaOffered()
  const shellActions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [
      {
        id: 'theme',
        label: resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        icon: 'moon-star', tint: 'lavender', keywords: 'theme dark light appearance',
        run: () => setMode(resolved === 'dark' ? 'light' : 'dark'),
        toast: resolved === 'dark' ? 'Switched to light mode' : 'Switched to dark mode',
      },
      {
        id: 'notifications-read',
        label: 'Mark all notifications read',
        hint: unread > 0 ? `${unread} unread` : undefined,
        icon: 'check-check', tint: 'mint', keywords: 'notifications clear unread inbox',
        run: markAllRead,
        toast: 'All notifications marked read',
      },
      {
        id: 'notifications-open',
        label: 'Notifications',
        icon: 'bell', tint: 'amber', keywords: 'alerts feed',
        href: '/notifications',
      },
      {
        id: 'apps',
        label: 'App Hub',
        icon: 'layout-grid', tint: 'blue', keywords: 'apps install library hub',
        href: '/apps',
      },
      {
        id: 'bookmarks',
        label: 'Bookmarks',
        icon: 'bookmark', tint: 'peach', keywords: 'saved starred',
        href: '/bookmarks',
      },
      {
        id: 'copy-link',
        label: 'Copy a link to this screen',
        icon: 'link', tint: 'blue', keywords: 'share url address copy',
        run: () => {
          // A share nobody can paste is not a share: when the clipboard is refused (an insecure origin, a browser…
          void navigator.clipboard?.writeText(window.location.href).then(
            () => toast({ type: 'success', title: 'Link copied' }),
            () => toast({ type: 'warning', title: 'Your browser would not let me copy', body: window.location.href }),
          )
        },
      },
      {
        id: 'refresh',
        label: 'Re-read everything from the server',
        icon: 'refresh-cw', tint: 'mint', keywords: 'refresh reload cache stale data',
        run: () => {
          invalidateAll()
          window.setTimeout(() => window.location.reload(), 150)
        },
        toast: 'Cached copies forgotten — reloading',
      },
      {
        id: 'sign-out',
        label: 'Sign out',
        icon: 'log-out', tint: 'pink', keywords: 'logout leave exit',
        run: () => {
          logout()
          navigate('/login')
        },
      },
    ]
    return bookmarksOffered ? list : list.filter((a) => a.id !== 'bookmarks')
  }, [resolved, setMode, markAllRead, unread, logout, navigate, bookmarksOffered])

  const creates = useMemo(() => createActions(enabled), [enabled])
  const configRules = useBadgeAccessStore((s) => s.configRules)
  const me = useEffectiveUser()
  // settingsNavFor reads the account's own world answer; a change to it redraws the list
  const worldOn = useWorldOffered()
  const settings = useMemo(
    () => settingsActions(settingsNavFor(apps, { isAdmin: role === 'admin', isMaster, configRules, user: me })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apps, role, isMaster, configRules, me, worldOn],
  )

  // PEOPLE — the search has to find people, too.
  const [directory, setDirectory] = useState<Record<string, unknown>[]>(() => cachedUsers() ?? [])
  useEffect(() => {
    if (!open) return
    // Refresh on OPEN, throttled to the directory's 60s freshness law — picking a person used to land on "No…
    fetchUsersIfStale().then(setDirectory).catch(() => {})
  }, [open])
  const canOpenAccounts = useMemo(() => enabled.some((a) => a.id === 'users'), [enabled])
  // CLIENTS ARE PEOPLE TOO: a client with no user profile is sent to the client profile instead.
  const canOpenClients = useMemo(() => enabled.some((a) => a.id === 'clients'), [enabled])
  const [clientRows, setClientRows] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (!open || !canOpenClients || clientRows.length) return
    void asBackground(() => api.list<{ id?: unknown; name?: unknown }>('clients'))
      .then((rows) => setClientRows((Array.isArray(rows) ? rows : [])
        .map((r) => ({ id: String(r.id ?? ''), name: String(r.name ?? '').trim() }))
        .filter((r) => r.id && r.name)))
      .catch(() => {})
  }, [open, canOpenClients, clientRows.length])

  const people = useMemo(() => peopleMatches(directory, search), [directory, search])
  const clientHits = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 2) return []
    const accountNames = new Set(people.map((p) => p.name.trim().toLowerCase()))
    return clientRows
      .filter((c) => c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
      .filter((c) => !accountNames.has(c.name.trim().toLowerCase()))
      .slice(0, 4)
  }, [clientRows, search, people])

  // THE MEANING LEG.
  const literalHits = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return 1
    const has = (s: string) => s.toLowerCase().includes(q)
    const inApps = enabled.filter((a) => has(a.name) || has(a.category)).length
    const inPages = enabled.flatMap((a) => allowedPages(a, role, selectAccessChecker(apps, role))).filter((p) => has(p.title)).length
    const inRest = [...creates, ...shellActions, ...settings].filter((a) => has(a.label) || has(a.keywords ?? '')).length
    return inApps + inPages + inRest + people.length + clientHits.length
  }, [search, enabled, role, apps, creates, shellActions, settings, people.length, clientHits.length])

  const [aiIds, setAiIds] = useState<string[]>([])
  const [aiAsking, setAiAsking] = useState(false)
  useEffect(() => {
    const q = search.trim()
    if (!open || literalHits > 0 || q.length < 3) { setAiIds([]); return }
    // Only for a phrase somebody has STOPPED typing: a call per keystroke would spend an execution on every prefix…
    let alive = true
    const t = window.setTimeout(() => {
      const choices: ResolveChoice[] = [
        ...settings.map((s) => ({ id: s.href ?? '', label: s.label, note: 'Settings' })),
        ...enabled.flatMap((a) =>
          allowedPages(a, role, selectAccessChecker(apps, role))
            .map((p) => ({ id: `/app/${a.id}/${p.id}`, label: p.title, note: a.name })),
        ),
      ].filter((c) => c.id)
      setAiAsking(true)
      void resolveByMeaning(q, choices)
        .then((ids) => { if (alive) setAiIds(ids) })
        .finally(() => { if (alive) setAiAsking(false) })
    }, 450)
    return () => { alive = false; window.clearTimeout(t) }
  }, [search, open, literalHits, settings, enabled, role, apps])

  /** The AI leg answers with hrefs; this turns them back into rows to draw. */
  const aiMatches = useMemo(() => {
    if (!aiIds.length) return []
    const byHref = new Map<string, { label: string; hint: string; icon: string; tint: TintName }>()
    for (const s of settings) if (s.href) byHref.set(s.href, { label: s.label, hint: 'Settings', icon: s.icon, tint: s.tint })
    for (const a of enabled) {
      for (const p of allowedPages(a, role, selectAccessChecker(apps, role))) {
        byHref.set(`/app/${a.id}/${p.id}`, { label: p.title, hint: a.name, icon: p.icon ?? a.icon, tint: a.accent })
      }
    }
    return aiIds.map((href) => ({ href, ...(byHref.get(href) as { label: string; hint: string; icon: string; tint: TintName }) }))
      .filter((m) => m.label)
  }, [aiIds, settings, enabled, role, apps])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
            className="mx-auto mt-[8vh] w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-lg border border-border bg-surface shadow-3 sm:mt-[18vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* `shouldFilter={false}` for the People and Meaning groups alone
                would not be possible — cmdk filters the whole list — so the
                two derived groups pre-filter themselves and carry a `value`
                the current search matches, which keeps cmdk's own matching
                honest for everything else. */}
            <Command label="Command palette" loop>
              <div className="border-b border-border px-4">
                <PaletteInput value={search} onChange={setSearch} />
              </div>
              <Command.List className="scroll-thin max-h-[320px] overflow-y-auto p-2">
                <Command.Empty className="py-8 text-center text-[13px] text-text-3">
                  {aiAsking ? 'Nothing matches those words — looking for what you mean…' : 'No results found.'}
                </Command.Empty>

                {/* PEOPLE — accounts first, then clients without one. */}
                {(people.length > 0 || clientHits.length > 0) && (
                  <Command.Group heading={<GroupHead label="People" />}>
                    {people.map((p) => (
                      <PaletteItem
                        key={p.id}
                        value={`${p.name} ${p.email ?? ''} ${p.title ?? ''}`}
                        onSelect={() => go(
                          canOpenAccounts
                            ? `/app/users/profile?u=${encodeURIComponent(p.id)}`
                            : `/app/chat/messages?with=${encodeURIComponent(p.id)}`,
                          p.name,
                        )}
                      >
                        <Avatar name={p.name} size="sm" />
                        <span>{p.name}</span>
                        <span className="ml-auto text-[11px] text-text-3">
                          {p.active === false ? 'Deactivated' : (p.title || (canOpenAccounts ? 'Open profile' : 'Message'))}
                        </span>
                      </PaletteItem>
                    ))}
                    {clientHits.map((c) => (
                      <PaletteItem
                        key={`c-${c.id}`}
                        value={c.name}
                        onSelect={() => go(`/app/clients/unique?record=${encodeURIComponent(c.id)}`, c.name)}
                      >
                        <Avatar name={c.name} size="sm" />
                        <span>{c.name}</span>
                        <span className="ml-auto text-[11px] text-text-3">Client</span>
                      </PaletteItem>
                    ))}
                  </Command.Group>
                )}

                {/* WHAT YOU MEANT — only ever ids the list above offered. */}
                {aiMatches.length > 0 && (
                  <Command.Group heading={<GroupHead label="Probably what you meant" />}>
                    {aiMatches.map((m) => (
                      <PaletteItem key={m.href} value={search} onSelect={() => go(m.href, m.label)}>
                        <TintTile icon={m.icon} tint={m.tint} size="sm" />
                        <span>{m.label}</span>
                        <span className="ml-auto text-[11px] text-text-3">{m.hint}</span>
                      </PaletteItem>
                    ))}
                  </Command.Group>
                )}

                {recent.length > 0 && (
                  <Command.Group heading={<GroupHead label="Recent" />}>
                    {recent.map((r) => {
                      const hit = enabled
                        .flatMap((a) => allowedPages(a, role, selectAccessChecker(apps, role)).map((p) => ({ a, p })))
                        .find(({ p }) => p.title === r)
                      if (!hit) return null
                      return (
                        <PaletteItem key={r} onSelect={() => go(`/app/${hit.a.id}/${hit.p.id}`, hit.p.title)}>
                          <TintTile icon={hit.a.icon} tint={hit.a.accent} size="sm" />
                          <span>{r}</span>
                        </PaletteItem>
                      )}
                    )}
                  </Command.Group>
                )}

                <Command.Group heading={<GroupHead label="Apps" />}>
                  {enabled.map((a) => (
                    <PaletteItem key={a.id} onSelect={() => go(`/app/${a.id}/${a.pages[0]?.id ?? ''}`, a.pages[0]?.title ?? a.name)}>
                      <TintTile icon={a.icon} tint={a.accent} size="sm" />
                      <span>{a.name}</span>
                      <span className="ml-auto text-[11px] text-text-3">{a.category}</span>
                    </PaletteItem>
                  ))}
                </Command.Group>

                <Command.Group heading={<GroupHead label="Pages" />}>
                  {enabled.flatMap((a) =>
                    allowedPages(a, role, selectAccessChecker(apps, role)).map((p) => (
                      <PaletteItem key={`${a.id}-${p.id}`} onSelect={() => go(`/app/${a.id}/${p.id}`, p.title)}>
                        <TintTile icon={p.icon ?? a.icon} tint={a.accent} size="sm" />
                        <span>{p.title}</span>
                        <span className="ml-auto text-[11px] text-text-3">{a.name}</span>
                      </PaletteItem>
                    )),
                  )}
                </Command.Group>

                {/* CREATE — the doors, derived from the registry itself, so
                    installing an app brings its own verb along. */}
                {creates.length > 0 && (
                  <Command.Group heading={<GroupHead label="Create" />}>
                    {creates.map((a) => (
                      <PaletteItem key={a.id} value={`${a.label} ${a.keywords ?? ''}`} onSelect={() => run(a)}>
                        <TintTile icon={a.icon} tint={a.tint} size="sm" />
                        <span>{a.label}</span>
                        {a.hint && <span className="ml-auto text-[11px] text-text-3">{a.hint}</span>}
                      </PaletteItem>
                    ))}
                  </Command.Group>
                )}

                <Command.Group heading={<GroupHead label="Actions" />}>
                  {shellActions.map((a) => (
                    <PaletteItem key={a.id} value={`${a.label} ${a.keywords ?? ''}`} onSelect={() => run(a)}>
                      <TintTile icon={a.icon} tint={a.tint} size="sm" />
                      <span>{a.label}</span>
                      {a.hint && <span className="ml-auto text-[11px] text-text-3">{a.hint}</span>}
                    </PaletteItem>
                  ))}
                </Command.Group>

                {/* SETTINGS — every section this person actually has, from the
                    one declared list the settings nav itself reads. */}
                {settings.length > 0 && (
                  <Command.Group heading={<GroupHead label="Settings" />}>
                    {settings.map((a) => (
                      <PaletteItem key={a.id} value={`${a.label} ${a.keywords ?? ''}`} onSelect={() => run(a)}>
                        <TintTile icon={a.icon} tint={a.tint} size="sm" />
                        <span>{a.label}</span>
                        {a.hint && <span className="ml-auto text-[11px] text-text-3">{a.hint}</span>}
                      </PaletteItem>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function GroupHead({ label }: { label: string }) {
  return <span className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{label}</span>
}

function PaletteItem({ children, onSelect, value }: { children: React.ReactNode; onSelect: () => void; value?: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-[13px] font-medium text-text-1 transition-colors duration-100 aria-selected:bg-surface-2"
    >
      {children}
    </Command.Item>
  )
}

// The palette's input, mounted fresh each open — which is what lets it start from the assist bar's handed-over text…
function PaletteInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Command.Input
      autoFocus
      value={value}
      onValueChange={onChange}
      placeholder="Search apps, pages, actions…"
      className="h-12 w-full bg-transparent text-[14px] text-text-1 outline-none placeholder:text-text-3"
    />
  )
}
