import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Mono JSON block with copy button (§11 — App Hub / About-this-app drawer). */
export default function SchemaPreview({ schema, className }: { schema: unknown; className?: string }) {
  const [copied, setCopied] = useState(false)
  const text = JSON.stringify(schema, null, 2)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard unavailable in some contexts */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-border bg-surface-2', className)}>
      <button
        onClick={copy}
        aria-label="Copy schema"
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-sm bg-surface text-text-3 shadow-1 transition-colors hover:text-text-1"
      >
        {copied ? <Check size={13} className="text-primary" /> : <Copy size={13} />}
      </button>
      <pre className="scroll-thin max-h-[320px] overflow-auto p-4 font-mono text-[12px] leading-5 text-text-2">
        {text}
      </pre>
    </div>
  )
}
