// NO CV ON FILE — the mark, and the one fact behind it.
// Every ACTIVE user with no resume loaded on the platform wears this symbol in front of their name.
import { useEffect, useState } from 'react'
import { Upload } from 'lucide-react'
import { readSlice } from '@/lib/snapshotClient'
import { TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'

type CoverageRow = { person_key: string; name?: string; sources?: string }

/** `clientNameKey_` (Clients.gs) — the platform's own flattened name. */
const keyOf = (v: string): string => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')

let pending: Promise<Set<string>> | null = null

function loadCoverage(): Promise<Set<string>> {
  if (!pending) {
    pending = readSlice<CoverageRow>('resumeCoverage')
      .then((rows) => new Set((rows ?? []).map((r) => keyOf(r.person_key || r.name || ''))))
      // A refusal is not an answer.
      .catch(() => { pending = null; throw new Error('coverage unavailable') })
  }
  return pending
}

export function useResumeCoverage(): { ready: boolean; hasCv: (name: string) => boolean } {
  const [have, setHave] = useState<Set<string> | null>(null)
  useEffect(() => {
    let alive = true
    loadCoverage().then((s) => { if (alive) setHave(s) }).catch(() => { /* stays silent */ })
    return () => { alive = false }
  }, [])
  return {
    ready: have != null,
    hasCv: (name: string) => (have ? have.has(keyOf(name)) : true),
  }
}

// The mark itself.
export function NoResumeBadge({ name, active = true, className }: {
  name: string
  /** false for somebody who no longer works here — a leaver owes nothing */
  active?: boolean
  className?: string
}) {
  const { ready, hasCv } = useResumeCoverage()
  if (!ready || !active || !name.trim() || hasCv(name)) return null
  return (
    <span
      title={`No CV on file for ${name.trim()} — the platform holds no resume for them. A resume is filed during hiring, so this is usually a gap in our records rather than anything about this person.`}
      aria-label={`No resume on file for ${name.trim()}`}
      style={{ border: '1px dashed var(--tint-pink-fg)' }}
      className={cn('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-transparent',
        TINT_FG.pink, className)}
    >
      <Upload size={10} strokeWidth={2.4} />
    </span>
  )
}
