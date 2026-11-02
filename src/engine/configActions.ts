// Config-driven actions — the runner behind `rowActions` / `headerActions` / detail-footer entries that declare a…
// THE SECURITY RULE: a button is a convenience, never a lock.
import { toast } from '@/stores/useToastStore'
import { askConfirm } from '@/stores/useDialogStore'
import { useAuthStore } from '@/auth/useAuthStore'
import type { Permission } from '@/auth/types'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import { ACTIONS_CATALOGUE } from '@/lib/actions.generated'
import { ohioToday } from '@/lib/ohio'

/** The frozen vocabulary both engine and studio implement — do not drift. */
export type ConfigAction = {
  id: string
  label: string
  icon?: string
  quick?: boolean
  danger?: boolean
  bulk?: boolean
  perm?: string
  when?: { field: string; eq?: unknown; neq?: unknown; in?: unknown[] }
  confirm?: string
  kind: 'patch' | 'call' | 'link' | 'create' | 'delete' | 'navigate'
  patch?: Record<string, unknown>
  call?: string
  payload?: Record<string, unknown>
  href?: string
  toast?: string
}

export type ConfigActionCtx = {
  // Resource the action writes to — absent on surfaces that cannot know it (the detail panel mounts with a stub…
  resource?: string
  // App a `navigate` action resolves `page:` / `./` hrefs against.
  appId?: string
}

/** Dot-path walk (`guardian.name`) — missing segments resolve to undefined. */
function getPath(row: any, path: string): unknown {
  let cur: any = row
  for (const key of path.split('.')) {
    if (cur == null) return undefined
    cur = cur[key]
  }
  return cur
}

// `{row.key}` (dot paths ok) and `{today}` (OHIO's day, never UTC's).
const TOKEN = /\{\s*(row\.[\w.]+|today)\s*\}/g

function interpolateString(value: string, row: any): string {
  return value.replace(TOKEN, (_, expr: string) => {
    if (expr === 'today') return ohioToday()
    const v = getPath(row, expr.slice(4))
    return v == null ? '' : String(v)
  })
}

// Interpolate the string leaves of a value; non-strings pass through untouched.
export function interpolate(value: unknown, row: any): unknown {
  if (typeof value === 'string') return interpolateString(value, row)
  if (Array.isArray(value)) return value.map((v) => interpolate(v, row))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = interpolate(v, row)
    return out
  }
  return value
}

// Resolve a `navigate` href to an app route.
function resolveNavHref(href: string, ctx: ConfigActionCtx): string | null {
  if (href.startsWith('/')) return href
  const page = href.startsWith('page:') ? href.slice(5) : href.startsWith('./') ? href.slice(2) : null
  if (page == null) return null
  const appId = ctx.appId ?? /^#\/app\/([^/]+)/.exec(window.location.hash)?.[1]
  return appId ? `/app/${appId}/${page}` : null
}

// Row-level visibility (`when`).
export function actionVisible(a: ConfigAction, row: any): boolean {
  if (!a.when || row == null) return true
  const v = getPath(row, a.when.field)
  if ('eq' in a.when && v !== a.when.eq) return false
  if ('neq' in a.when && v === a.when.neq) return false
  if (a.when.in && !a.when.in.includes(v)) return false
  return true
}

// Run one config action.
export async function runConfigAction(
  a: ConfigAction,
  row: any,
  ctx: ConfigActionCtx,
  opts?: {
    /** bulk: the selection bar confirms ONCE for the lot */
    skipConfirm?: boolean
    /** bulk: the bar owns the summary toast — per-row ones would flood */
    quietSuccess?: boolean
  },
): Promise<boolean> {
  // Permission re-check — the button was hidden/disabled upstream, but config is data and data can be stale; the…
  if (a.perm) {
    const { can, user } = useAuthStore.getState()
    if (!can(user, a.perm as Permission)) {
      toast({ type: 'warning', title: 'Not allowed', body: `Requires ${a.perm} — ask an admin.` })
      return false
    }
  }

  // A `call` to an action the resolver never declared is refused HERE, before any confirm or network hop — a typo'd…
  const catalogueEntry = a.kind === 'call' && a.call ? ACTIONS_CATALOGUE[a.call] : undefined
  if (a.kind === 'call' && !catalogueEntry) {
    toast({ type: 'warning', title: a.label, body: `"${a.call ?? ''}" is not a declared action.` })
    return false
  }

  // Confirm rules: explicit `confirm` text, `danger`, or a `call` that emits (contacts people) all stop the click…
  const emits = catalogueEntry?.emits?.length ?? 0
  const mustConfirm = a.kind === 'delete' || a.confirm || a.danger || (a.kind === 'call' && emits > 0)
  if ((a.kind === 'delete' || !opts?.skipConfirm) && mustConfirm) {
    // The config author's text is the question when there is one; otherwise the button's own label asks, and the…
    const authored = a.confirm ? (interpolate(a.confirm, row) as string) : null
    const ok = await askConfirm({
      title: authored ?? `${a.label}?`,
      body: authored
        ? undefined
        : emits > 0
          ? 'This contacts people.'
          : a.kind === 'delete'
            ? 'This removes the record.'
            : undefined,
      confirmLabel: a.label,
      tone: a.danger || a.kind === 'delete' || emits > 0 ? 'danger' : undefined,
    })
    if (!ok) return false
  }

  try {
    if (a.kind === 'patch') {
      if (!ctx.resource || row?.id == null) {
        // patch without a resource/row would be a guess about WHERE to write — the one thing this runner is never…
        toast({ type: 'warning', title: a.label, body: 'This action needs a record row on a page with a data resource.' })
        return false
      }
      await api.update(ctx.resource as never, String(row.id), interpolate(a.patch ?? {}, row) as never)
      if (!opts?.quietSuccess) toast({ type: 'success', title: (a.toast ? (interpolate(a.toast, row) as string) : undefined) ?? 'Updated.' })
      return true
    }
    if (a.kind === 'call') {
      await gasAction(a.call!, interpolate(a.payload ?? {}, row))
      if (!opts?.quietSuccess) toast({ type: 'success', title: (a.toast ? (interpolate(a.toast, row) as string) : undefined) ?? 'Done.' })
      return true
    }
    if (a.kind === 'create') {
      if (!ctx.resource) {
        // same rule as patch: never guess WHERE a write lands
        toast({ type: 'warning', title: a.label, body: 'This action needs a page with a data resource.' })
        return false
      }
      await api.create(ctx.resource as never, interpolate(a.payload ?? {}, row) as never)
      if (!opts?.quietSuccess) toast({ type: 'success', title: (a.toast ? (interpolate(a.toast, row) as string) : undefined) ?? 'Created.' })
      return true
    }
    if (a.kind === 'delete') {
      if (!ctx.resource || row?.id == null) {
        toast({ type: 'warning', title: a.label, body: 'This action needs a record row on a page with a data resource.' })
        return false
      }
      await api.remove(ctx.resource as never, String(row.id))
      if (!opts?.quietSuccess) toast({ type: 'success', title: (a.toast ? (interpolate(a.toast, row) as string) : undefined) ?? 'Deleted.' })
      return true
    }
    if (a.kind === 'navigate') {
      // client-side only — HashRouter hears the hash change, so this works from a plain function with no hook in…
      const target = a.href ? resolveNavHref(interpolate(a.href, row) as string, ctx) : null
      if (!target) {
        toast({ type: 'warning', title: a.label, body: 'This action needs an app route (page:<pageId>, ./<pageId> or /…).' })
        return false
      }
      window.location.hash = `#${target}`
      return true
    }
    // link — no success toast: the opened tab IS the feedback.
    if (a.href) window.open(interpolate(a.href, row) as string, '_blank', 'noopener,noreferrer')
    return true
  } catch (err) {
    // The server's own words, verbatim — a paraphrased refusal teaches nothing.
    toast({ type: 'warning', title: a.label, body: err instanceof Error ? err.message : 'Please try again.' })
    return false
  }
}
