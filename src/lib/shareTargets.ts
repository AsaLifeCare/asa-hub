// What a share can do with a payload — the link, the text, a download, a print and the system's own share.
// The ShareSheet draws these as tiles; a side panel draws the same targets without a dialog.
import type { SharePayload } from '@/stores/useShareStore'
import { exportRows, type ExportFormat } from '@/lib/exportTable'
import { toast } from '@/stores/useToastStore'
import { COPYRIGHT } from '@/components/shared/SiteFooter'

/** The link people expect: the document itself when there is one, otherwise this page inside the platform. */
export function shareLink(payload: SharePayload): string {
  const appUrl =
    typeof window !== 'undefined' && window.location
      ? `${window.location.origin}${payload.appHref ?? `${window.location.pathname}${window.location.search}`}`
      : (payload.appHref ?? '')
  return payload.url || appUrl
}

/** The plain-text rendition: title, subtitle, the text, then the link. */
export function shareBody(payload: SharePayload, link: string): string {
  return [payload.title, payload.subtitle, '', payload.text, '', link].filter((l) => l != null).join('\n')
}

/** Copies to the clipboard; false (and a toast) when the browser refuses. */
export async function copyShare(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    toast({
      type: 'danger',
      title: 'Copy failed',
      body: 'The browser blocked clipboard access — select the link and copy it by hand.',
    })
    return false
  }
}

/** The rows as a file when the share carries a table, otherwise the text as a .txt. */
export function downloadShare(payload: SharePayload, bodyText: string, format: ExportFormat): void {
  if (payload.rows && payload.columns) {
    exportRows(payload.filename ?? payload.title, payload.columns, payload.rows, format)
  } else {
    const blob = new Blob([bodyText], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(payload.filename ?? payload.title).replace(/[^\w.-]+/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  toast({ type: 'success', title: 'Download started' })
}

/** Print just this record: a clean sheet, not the whole app chrome. */
export function printShare(payload: SharePayload, link: string): void {
  const w = window.open('', '_blank', 'width=760,height=900')
  if (!w) {
    toast({ type: 'warning', title: 'Pop-up blocked', body: 'Allow pop-ups for this site to print.' })
    return
  }
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
  w.document.write(
    `<!doctype html><meta charset="utf-8"><title>${esc(payload.title)}</title>` +
      `<style>body{font:14px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#14171f;margin:48px;max-width:640px}` +
      `h1{font-size:20px;margin:0 0 2px}h2{font-size:13px;font-weight:500;color:#6b7280;margin:0 0 24px}` +
      `pre{white-space:pre-wrap;font:inherit;margin:0}a{color:#2563eb}` +
      `footer{margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af}</style>` +
      `<h1>${esc(payload.title)}</h1>` +
      (payload.subtitle ? `<h2>${esc(payload.subtitle)}</h2>` : '') +
      `<pre>${esc(payload.text ?? '')}</pre>` +
      `<footer>${esc(link)}<div>${esc(COPYRIGHT)}</div></footer>`,
  )
  w.document.close()
  w.focus()
  w.print()
}

/** The operating system's own share, when the browser exposes it; null otherwise. */
export function nativeShareFor(payload: SharePayload, link: string): (() => void) | null {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    ? () => {
        navigator
          .share({ title: payload.title, text: payload.text ?? payload.subtitle, url: link })
          .catch(() => undefined)
      }
    : null
}
