// Shared plumbing for the hiring modals (AddCandidate / ResumeUpload / CjisUpload).
// - `gasAction` — POST {token, action, payload} to the Hub's Google Apps Script /exec endpoint.
import { useRef, useState } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
import { DEFAULT_EXEC_URL, useApiConfigStore } from '@/stores/useApiConfigStore'
// safe: useWorldStore reaches gasAction only through a dynamic import — this static edge points one way, and the…
import { activeWorldId } from '@/stores/useWorldStore'
import { activeTenantId } from '@/stores/useTenantStore'
import { activeMemberId } from '@/stores/useMemberStore'
import { AppIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024 // 15MB decoded cap (backend enforced too)

export const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

// POST {token, action, payload} to the Hub's GAS /exec endpoint.
import { noteWrite, onAnyLiveEvent } from '@/lib/snapshotClient'
import { noteDoorAnswer } from '@/lib/hubStatus'
import { ACTION_INVALIDATES } from '@/lib/invalidates.generated'
import { READ_ACTIONS, WRITE_TOUCHES } from '@/lib/keptReads.generated'

// THE LAST COPY, FOR EVERY READ.
const KEPT_FRESH_MS = 3 * 60_000
const KEPT_MAX = 400
type KeptCopy = { at: number; text: string; ring: string; action: string }
const keptCopies = new Map<string, KeptCopy>()
let keptWroteAt = 0
let keptHeard = false

function keptKey(action: string, payload: unknown): string {
  try {
    return JSON.stringify([useAuthStore.getState().token ?? '', action, payload ?? null,
      activeWorldId() || '', activeTenantId() || '', activeMemberId() || ''])
  } catch {
    return ''
  }
}

function keptHeld(key: string): { data: unknown } | null {
  const hit = keptCopies.get(key)
  if (!hit) return null
  keptCopies.delete(key)
  if (Date.now() - hit.at >= KEPT_FRESH_MS || hit.at < keptWroteAt) return null
  try {
    const data = JSON.parse(hit.text) as unknown
    keptCopies.set(key, hit)
    return { data }
  } catch {
    return null
  }
}

function keptTake(key: string, action: string, ring: string, data: unknown, askedAt: number): void {
  if (askedAt < keptWroteAt) return
  let text: string
  try {
    text = JSON.stringify(data ?? null)
  } catch {
    return
  }
  if (!keptHeard) {
    keptHeard = true
    onAnyLiveEvent((name) => {
      if (name === 'open' || name === 'close') {
        keptCopies.clear()
        return
      }
      for (const [k, c] of [...keptCopies]) if (c.ring === name) keptCopies.delete(k)
    })
  }
  keptCopies.delete(key)
  keptCopies.set(key, { at: askedAt, text, ring, action })
  for (const k of keptCopies.keys()) {
    if (keptCopies.size <= KEPT_MAX) break
    keptCopies.delete(k)
  }
}

function keptWritten(action: string): void {
  const touches = WRITE_TOUCHES[action]
  if (touches) {
    for (const [k, c] of [...keptCopies]) if (touches.includes(c.action)) keptCopies.delete(k)
    return
  }
  keptWroteAt = Date.now()
  keptCopies.clear()
}

// WHAT THIS ACTION MADE STALE — read from the contract, not remembered.
export function noteActionWrite(action: string): void {
  for (const resource of ACTION_INVALIDATES[action] ?? []) noteWrite(resource)
}


// THE RELAY'S RECEIPT IS NOT THE PLATFORM'S ANSWER.
const RECEIPT_KEYS: ReadonlySet<string> = new Set(['accepted', 'queued', 'confirmed', 'deduplicated', 'running', 'message'])
export function isRelayReceipt(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const d = data as Record<string, unknown>
  return d.accepted === true && Object.keys(d).every((k) => RECEIPT_KEYS.has(k))
}

// The sentence a 401 throws.
export const SESSION_EXPIRED = 'Session expired — sign in again.'

export async function gasAction<T>(action: string, payload?: unknown,
  opts?: { timeoutMs?: number; retry?: boolean },
  retried = false,
): Promise<T> {
  const readLane = READ_ACTIONS.has(action)
  const kept = readLane ? keptKey(action, payload) : ''
  if (kept && !retried) {
    const held = keptHeld(kept)
    if (held) return held.data as T
  }
  const askedAt = Date.now()
  const url = useApiConfigStore.getState().execUrl || DEFAULT_EXEC_URL
  const controller = opts?.timeoutMs ? new AbortController() : undefined
  const timer = controller ? setTimeout(() => controller.abort(), opts!.timeoutMs) : undefined
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'body=' + encodeURIComponent(JSON.stringify({
        token: useAuthStore.getState().token ?? undefined,
        action,
        payload,
        // USER WORLDS: the active world rides every envelope.
        world: activeWorldId() || undefined,
    // the place narrows every NAMED action too (Tenant.gs)
    tenant: activeTenantId() || undefined,
    // the PERSON being visited (Members.gs): their badge and their own work answer; absent means nobody is being…
    member: activeMemberId() || undefined,
      })),
      signal: controller?.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('timeout')
    }
    throw new Error('Network error — could not reach the server.')
  } finally {
    if (timer) clearTimeout(timer)
  }
  // our own /gas answering as if the relay were not there raises the strip at the top (lib/hubStatus); the relay's…
  noteDoorAnswer(url, res)
  let env: { status: number; data?: unknown; message?: string }
  try {
    env = await res.json()
    // Any envelope AT ALL proves the live path answers — an admin living in the modals heals the pink badge…
    const cfg = useApiConfigStore.getState()
    if (cfg.demoFallback) cfg.setDemoFallback(false)
  } catch {
    // Not our envelope — Google served its anonymous-POST interstitial at the redirect target instead of the…
    if (opts?.retry === false) {
      throw new Error('The backend answered with something we could not read, and this '
        + 'write is not safe to send again on its own.')
    }
    if (retried) throw new Error('The backend answered with something we could not read. Please try again.')
    await new Promise((r) => setTimeout(r, 400))
    return gasAction<T>(action, payload, opts, true)
  }
  if (env.status === 401) {
    keptCopies.clear()
    useAuthStore.getState().clearSession()
    throw new Error(SESSION_EXPIRED)
  }
  if (env.status >= 400) {
    // THE ENVELOPE SURVIVES THE THROW.
    const loose = env as unknown as { error?: unknown }
    const said = env.message || (typeof loose.error === 'string' ? loose.error : '')
    const err = new Error(said || `Error ${env.status}`) as Error & {
      status?: number
      envelope?: Record<string, unknown>
    }
    err.status = env.status
    err.envelope = env as unknown as Record<string, unknown>
    throw err
  }
  if (kept) {
    const ring = typeof res.headers?.get === 'function' ? res.headers.get('x-kept-ring') : null
    if (ring && !isRelayReceipt(env.data)) keptTake(kept, action, ring, env.data, askedAt)
  } else if (!readLane) keptWritten(action)
  // The write landed.
  noteActionWrite(action)
  return env.data as T
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/** Lowercase extension of a filename ('' when none). */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

/** file.type when the browser knows it, otherwise inferred from the extension. */
export function inferMime(file: File): string {
  return file.type || MIME_BY_EXT[extOf(file.name)] || 'application/octet-stream'
}

/** Human-readable file size (B / KB / MB). */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** FileReader → base64 payload (data: URI prefix stripped). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

// Drag-and-drop zone + click-to-pick.
export function FileDropZone({
  accept,
  hint,
  disabled,
  onFile,
  multiple,
  onFiles,
  headline,
}: {
  /** input `accept` attr, e.g. ".pdf,.doc,.docx" */
  accept: string
  /** helper line under the headline, e.g. "PDF, DOC or DOCX · up to 15MB" */
  hint: string
  disabled?: boolean
  onFile?: (file: File) => void
  multiple?: boolean
  onFiles?: (files: File[]) => void
  headline?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const pick = () => {
    if (!disabled) inputRef.current?.click()
  }
  const hand = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? [])
    if (!files.length) return
    if (multiple && onFiles) onFiles(files)
    else onFile?.(files[0])
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const list = e.target.files
          hand(list)
          e.target.value = ''
        }}
      />
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={pick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            pick()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (disabled) return
          hand(e.dataTransfer.files)
        }}
        className={cn(
          'grid cursor-pointer place-items-center gap-1 rounded-lg border-2 border-dashed px-4 py-8 text-center outline-none transition-colors duration-150 focus-visible:border-primary',
          dragging ? 'border-primary bg-primary-soft' : 'border-border bg-surface-2/50 hover:border-border-strong hover:bg-surface-2',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className="grid h-10 w-10 place-items-center rounded-full bg-tint-blue text-tint-fg-blue">
          <AppIcon name="file-plus" size={18} />
        </span>
        <span className="text-[13px] font-semibold text-text-1">
          {headline ?? (multiple ? 'Drop the files here, or ' : 'Drop the file here, or ')}
          <span className="text-primary">{headline ? '' : 'browse'}</span>
        </span>
        <span className="text-[11px] text-text-3">{hint}</span>
      </div>
    </>
  )
}

/** Picked-file summary card: doc icon · name · human size · remove ✕. */
export function SelectedFileCard({
  file,
  disabled,
  onRemove,
}: {
  file: File
  disabled?: boolean
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface p-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint-lavender text-tint-fg-lavender">
        <AppIcon name="file-text" size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="clamp-1 text-[13px] font-semibold text-text-1">{file.name}</p>
        <p className="text-[11px] tabular-nums text-text-3">{humanSize(file.size)}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${file.name}`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <AppIcon name="x" size={14} />
      </button>
    </div>
  )
}
