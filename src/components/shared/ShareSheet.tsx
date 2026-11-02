// ShareSheet — the platform's one share dialog, mounted once in Layout and opened from anywhere with `share({...})`…
// Shaped like the share box every desktop has: what you are sharing at the top, the link with a copy button, then…
import { useEffect, useState } from 'react'
import { Check, Copy, Download, Link2, Mail, Printer, Share2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AppIcon } from '@/lib/icons'
import { useShareStore } from '@/stores/useShareStore'
import { composeEmail } from '@/stores/useEmailComposeStore'
import { copyShare, downloadShare, nativeShareFor, printShare, shareBody, shareLink } from '@/lib/shareTargets'
import { cn } from '@/lib/utils'
import { TINT_BG_VAR, TINT_VAR } from '@/lib/tints'
import type { TintName } from '@/engine/types'

/** One share target tile. */
function Target({
  icon: Icon,
  label,
  hint,
  tint,
  onClick,
}: {
  icon: typeof Mail
  label: string
  hint?: string
  tint: TintName
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-md px-2 py-3 text-center transition-colors duration-150 hover:bg-surface-2"
    >
      <span
        className="grid h-12 w-12 place-items-center rounded-full"
        style={{ background: TINT_BG_VAR[tint], color: TINT_VAR[tint] }}
      >
        <Icon size={20} />
      </span>
      <span className="text-[12px] font-semibold leading-4 text-text-1">{label}</span>
      {hint && <span className="text-[10px] leading-3 text-text-3">{hint}</span>}
    </button>
  )
}

export default function ShareSheet() {
  const payload = useShareStore((s) => s.payload)
  const closeShare = useShareStore((s) => s.closeShare)
  const [copied, setCopied] = useState<'link' | 'text' | null>(null)

  useEffect(() => {
    if (!payload) setCopied(null)
  }, [payload])

  if (!payload) return null

  const link = shareLink(payload)
  const bodyText = shareBody(payload, link)

  const copy = async (what: 'link' | 'text', value: string) => {
    if (!(await copyShare(value))) return
    setCopied(what)
    setTimeout(() => setCopied(null), 1800)
  }

  // E-MAIL IS THE PLATFORM'S (every user sends the information they need via asa-hub, typing only WHO it goes to).
  const emailIt = () => {
    closeShare()
    composeEmail({ subject: payload.title, body: bodyText, source: payload.subtitle })
  }

  const download = (format: 'csv' | 'xlsx') => downloadShare(payload, bodyText, format)
  const print = () => printShare(payload, link)
  const nativeShare = nativeShareFor(payload, link)

  return (
    <Dialog open onOpenChange={(o) => !o && closeShare()}>
      <DialogContent
        className="z-[100] max-w-[440px] p-0"
        overlayClassName="z-[99]"
      >
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogDescription className="sr-only">
            Ways to share {payload.title}: copy the link, e-mail it, copy it as text, download it or print it.
          </DialogDescription>
          <DialogTitle className="flex items-center gap-3 text-left">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-md"
              style={{ background: TINT_BG_VAR.blue, color: TINT_VAR.blue }}
            >
              <AppIcon name={payload.icon ?? 'share-2'} size={18} />
            </span>
            <span className="min-w-0">
              <span className="clamp-1 block font-display text-[15px] font-semibold text-text-1">{payload.title}</span>
              {payload.subtitle && <span className="clamp-1 block text-[12px] font-normal text-text-3">{payload.subtitle}</span>}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 py-4">
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
            <Link2 size={14} className="shrink-0 text-text-3" />
            <span className="clamp-1 flex-1 font-mono text-[11px] text-text-2">{link}</span>
            <button
              type="button"
              onClick={() => copy('link', link)}
              className={cn(
                'flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-[11px] font-semibold transition-colors',
                copied === 'link' ? 'text-tint-fg-mint' : 'text-primary hover:bg-surface-3',
              )}
            >
              {copied === 'link' ? <Check size={12} /> : <Copy size={12} />}
              {copied === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1">
            <Target icon={Mail} label="Email" hint="from asa-hub" tint="blue" onClick={emailIt} />
            <Target
              icon={copied === 'text' ? Check : Copy}
              label={copied === 'text' ? 'Copied' : 'Copy text'}
              tint="lavender"
              onClick={() => copy('text', bodyText)}
            />
            <Target
              icon={Download}
              label="Download"
              hint={payload.rows && payload.columns ? 'CSV' : 'Text'}
              tint="mint"
              onClick={() => download('csv')}
            />
            <Target icon={Printer} label="Print" tint="peach" onClick={print} />
          </div>

          {(nativeShare || (payload.rows && payload.columns)) && (
            <div className="mt-3 flex gap-2 border-t border-border pt-3">
              {payload.rows && payload.columns && (
                <button
                  type="button"
                  onClick={() => download('xlsx')}
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
                >
                  <Download size={14} /> Excel (.xls)
                </button>
              )}
              {nativeShare && (
                <button
                  type="button"
                  onClick={nativeShare}
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
                >
                  <Share2 size={14} /> More…
                </button>
              )}
            </div>
          )}
        </div>

      </DialogContent>
    </Dialog>
  )
}
