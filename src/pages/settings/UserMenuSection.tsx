// Settings → User menu links (anchor #usermenu) — MASTER edits, admins read.
// Manages the links every teammate sees in the topbar avatar dropdown (below the identity block, above "My asa.").
import { useEffect, useState } from 'react'
import { ohioDateTime } from '@/lib/ohio'
import { motion } from 'framer-motion'
import { ExternalLink, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { Checkbox } from '@/components/ui/checkbox'
import { useAuthStore } from '@/auth/useAuthStore'
import { pullUserMenuLinks, useUserMenuItems, useUserMenuStore, type UserMenuItem } from '@/stores/useUserMenuStore'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import RoleBadge, { BADGE_ORDER } from '@/components/shared/RoleBadge'
import { AppIcon } from '@/lib/icons'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

/** ~12 curated lucide options for the icon picker (kebab-case, verified in ICON_GROUPS). */
const ICON_OPTIONS = [
  'shield-check',
  'book-open',
  'file-text',
  'link',
  'globe',
  'heart-pulse',
  'calendar-days',
  'clipboard-list',
  'graduation-cap',
  'wallet',
  'megaphone',
  'star',
]

/** The 11 assignable badge words — MASTER is derived, never assigned. */
const ASSIGNABLE_BADGES = BADGE_ORDER.filter((b) => b !== 'MASTER')

const INPUT_CLS =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

export default function UserMenuSection() {
  const user = useAuthStore((s) => s.user)
  const isMaster = user?.isMaster === true
  const links = useUserMenuItems()
  const setLinks = useUserMenuStore((s) => s.setLinks)
  const status = useUserMenuStore((s) => s.status)
  const pullError = useUserMenuStore((s) => s.error)

  // Opening Settings ALWAYS re-reads the server list — the sign-in pull is once per token, so a tab left open all…
  useEffect(() => {
    void pullUserMenuLinks({ force: true })
  }, [])

  const [label, setLabel] = useState('')
  const [icon, setIcon] = useState('link')
  const [href, setHref] = useState('')
  const [external, setExternal] = useState(false)
  const [badges, setBadges] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const toggleBadge = (b: string) =>
    setBadges((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]))

  // Replace the WHOLE server list (that is the only write the backend offers) and mirror it locally.
  const persistList = async (next: UserMenuItem[]): Promise<boolean> => {
    // Last gate before a destructive write: the UI already hides the form until the pull lands, but this call is…
    if (useUserMenuStore.getState().status !== 'ready') {
      toast({
        type: 'warning',
        title: 'Menu links not loaded',
        body: 'The saved list has not been read from the server yet — saving now would replace it with whatever this browser holds. Retry the load first.',
      })
      return false
    }
    setSaving(true)
    try {
      const res = await gasAction<{ links?: UserMenuItem[] }>('userMenuLinksSet', { links: next })
      // The server stamps updated_at/updated_by per row; adopt its echo when it sends one, else stamp locally so…
      const stamped = Array.isArray(res?.links)
        ? res.links.map((l) => ({ ...l, badges: Array.isArray(l.badges) ? l.badges : [] }))
        : next.map((l) => ({
            ...l,
            updated_at: new Date().toISOString(),
            updated_by: user?.name ?? user?.email,
          }))
      setLinks(stamped)
      return true
    } catch (err) {
      toast({
        type: 'danger',
        title: 'Could not save the menu',
        body: err instanceof Error ? err.message : 'The server rejected the change.',
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  const submit = async () => {
    const t = label.trim()
    const h = href.trim()
    if (!t || !h) {
      toast({ type: 'warning', title: 'Label and link required', body: 'Give the menu item a label and a destination.' })
      return
    }
    if (external && !/^https?:\/\//i.test(h)) {
      toast({ type: 'warning', title: 'External links need a full URL', body: 'Start with https:// — or uncheck "Opens in a new tab" for an in-app path.' })
      return
    }
    if (!external && !h.startsWith('/')) {
      toast({ type: 'warning', title: 'In-app links start with /', body: 'e.g. /app/docs/library — or check "Opens in a new tab" for a full URL.' })
      return
    }
    const next: UserMenuItem[] = [
      ...links,
      {
        id: `um-${Date.now().toString(36)}`,
        label: t,
        icon,
        href: h,
        external,
        badges: [...badges],
        sort: links.length,
      },
    ]
    if (!(await persistList(next))) return
    toast({
      type: 'success',
      title: 'Menu link added',
      body: badges.length
        ? `"${t}" now shows in the avatar menu for ${badges.join(', ')}.`
        : `"${t}" now shows in the avatar menu for everyone.`,
    })
    setLabel('')
    setHref('')
    setExternal(false)
    setBadges([])
  }

  const removeLink = async (it: UserMenuItem) => {
    if (!(await persistList(links.filter((l) => l.id !== it.id)))) return
    toast({ type: 'info', title: 'Menu link removed', body: `"${it.label}" no longer shows in the avatar menu.` })
  }

  // the server stamps every row on each save — the first row carries the hour
  const audit = links[0]

  return (
    <motion.section
      id="usermenu"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader
          title="User menu links"
          sub="Links teammates see in their avatar menu — below the photo. One list for the whole platform; each link can be narrowed to specific badges."
          extra={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary-strong">
              <ShieldCheck size={12} /> Master only
            </span>
          }
        />

        {!isMaster && (
          <p className="mb-4 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[12px] text-text-2">
            Defined by the master for everyone.
          </p>
        )}

        {/* NOTHING before the server answers. "No links yet" over an unread
            list is the lie that costs somebody their menu — the same wait
            the badge matrix in AccessControlSection does. */}
        {status !== 'ready' ? (
          status === 'error' ? (
            <div className="space-y-3 rounded-md border border-border bg-surface-2 px-4 py-3">
              <p className="text-[13px] text-text-1">{pullError || 'Could not read the menu links.'}</p>
              <p className="text-[12px] leading-5 text-text-3">
                Editing stays closed until the saved list is on screen — every save replaces the whole list.
              </p>
              <button
                type="button"
                onClick={() => void pullUserMenuLinks({ force: true })}
                className="h-8 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-3"
              >
                Retry
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-2 py-4 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" /> Loading the menu links…
            </p>
          )
        ) : (
          <>
        {/* current items */}
        {links.length === 0 ? (
          <p className="mb-4 rounded-md border border-dashed border-border px-3 py-2.5 text-[12px] text-text-3">
            {isMaster
              ? 'No links yet — add one below and it appears in the avatar menu.'
              : 'No links yet — the master defines this list.'}
          </p>
        ) : (
          <div className="mb-4 space-y-1.5">
            {links.map((it) => (
              <div key={it.id} className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-tint-blue text-tint-fg-blue">
                  <AppIcon name={it.icon} size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="clamp-1 block text-[13px] font-semibold text-text-1">{it.label}</span>
                  <span className="clamp-1 block font-mono text-[11px] text-text-3">{it.href}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    {it.badges.length > 0 ? (
                      it.badges.map((b) => <RoleBadge key={b} label={b} size="xs" />)
                    ) : (
                      <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-3">
                        Everyone
                      </span>
                    )}
                  </span>
                </span>
                {it.external && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-text-3">
                    <ExternalLink size={10} /> New tab
                  </span>
                )}
                {isMaster && (
                  <button
                    onClick={() => void removeLink(it)}
                    disabled={saving}
                    aria-label={`Remove ${it.label}`}
                    title={`Remove ${it.label}`}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-tint-danger hover:text-tint-fg-danger disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* last save audit — the hour is shown on purpose */}
        {audit?.updated_at && (
          <p className="mb-4 text-[11px] text-text-3">
            Saved {ohioDateTime(audit.updated_at)} by {audit.updated_by ?? 'unknown'}
          </p>
        )}

        {/* add form — master only; the server 404s anyone else anyway */}
        {isMaster && (
          <div className="rounded-md border border-border bg-surface-2 p-4">
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Add a link</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-text-2">Label</span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Incident Report Form"
                  className={INPUT_CLS}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-text-2">Destination</span>
                <input
                  value={href}
                  onChange={(e) => setHref(e.target.value)}
                  placeholder={external ? 'https://…' : '/app/docs/library'}
                  spellCheck={false}
                  className={cn(INPUT_CLS, 'font-mono text-[12px]')}
                />
              </label>
            </div>

            <div className="mt-3">
              <span className="mb-1.5 block text-[12px] font-medium text-text-2">Icon</span>
              <div className="flex flex-wrap gap-1.5">
                {ICON_OPTIONS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setIcon(name)}
                    aria-pressed={icon === name}
                    title={name}
                    className={cn(
                      'grid h-8 w-8 place-items-center rounded-md border transition-colors',
                      icon === name
                        ? 'border-primary bg-tint-primary text-primary-strong'
                        : 'border-border bg-surface text-text-3 hover:border-primary/40 hover:text-text-1',
                    )}
                  >
                    <AppIcon name={name} size={15} />
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <span className="mb-1.5 block text-[12px] font-medium text-text-2">Who sees it</span>
              <div className="flex flex-wrap gap-1.5">
                {ASSIGNABLE_BADGES.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => toggleBadge(b)}
                    aria-pressed={badges.includes(b)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors',
                      badges.includes(b)
                        ? 'border-primary bg-tint-primary text-primary-strong'
                        : 'border-border bg-surface text-text-3 hover:border-primary/40 hover:text-text-1',
                    )}
                  >
                    {b}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-text-3">
                {badges.length === 0
                  ? 'No badges selected — everyone sees this link.'
                  : `Only ${badges.join(', ')} will see this link.`}
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[13px] font-medium text-text-2">
                <Checkbox checked={external} onCheckedChange={(v) => setExternal(v === true)} aria-label="Opens in a new tab" />
                Opens in a new tab (external site)
              </label>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
              >
                <Plus size={14} /> {saving ? 'Saving…' : 'Add link'}
              </button>
            </div>
          </div>
        )}
          </>
        )}
      </Card>
    </motion.section>
  )
}
