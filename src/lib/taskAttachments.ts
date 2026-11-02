// TASK ATTACHMENTS: images and PDFs on the personal Task Board's cards.
// The list lives as a JSON string in the task row's `attachments` cell and travels on the SAME generic tasks write…
import { gasAction } from '@/features/hiring/shared'
import { openFile } from '@/stores/useFileViewerStore'
import { toast } from '@/stores/useToastStore'

export type TaskAttachment = {
  id: string
  name: string
  url: string
  mime: string
  at: string
}

/** Tolerant parse — a cell that is not a list answers an empty one. */
export function parseAttachments(v: unknown): TaskAttachment[] {
  if (Array.isArray(v)) return v.filter((a) => a && typeof a === 'object' && (a as TaskAttachment).url) as TaskAttachment[]
  if (typeof v !== 'string' || !v.trim()) return []
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed.filter((a) => a && a.url) : []
  } catch {
    return []
  }
}

export const TASK_ATTACH_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/heic,application/pdf'
export const TASK_ATTACH_MAX = 12

/** A fresh attachment id — lives here so component code stays pure. */
export function attachmentId(): string {
  return 'ATT_' + Math.random().toString(36).slice(2, 10)
}

// A file the server keeps (Task Board on Python) is named `hubfile:…` and read through taskFile; any other url opens
// as it is (a Drive link from before).
const KEPT = 'hubfile:'

/** Opens an attachment in the platform viewer — a kept one as a blob of its bytes off the server. */
export async function openAttachment(a: TaskAttachment): Promise<void> {
  if (!a.url.startsWith(KEPT)) {
    openFile({ url: a.url, title: a.name, icon: 'file-text' })
    return
  }
  try {
    const got = await gasAction<{ b64: string; mime: string; name: string }>('taskFile', { url: a.url },
      { timeoutMs: 120000 })
    const raw = atob(got?.b64 || '')
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    const blob = new Blob([bytes], { type: got?.mime || a.mime || 'application/octet-stream' })
    openFile({ url: URL.createObjectURL(blob), title: got?.name || a.name, icon: 'file-text' })
  } catch (e) {
    toast({ type: 'danger', title: 'Not opened', body: e instanceof Error ? e.message : 'Try again.' })
  }
}
