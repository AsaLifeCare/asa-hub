// MY CERTIFICATIONS — the REAL certification tracker, through the door that knows who is asking (Certs.gs…
// An own answer is this account's rows under its roster name, so all of it is shown whatever name the account…
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { BadgeCheck, RotateCw } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { gasAction } from '@/features/hiring/shared'
import { trackerRowsOf, uploadsRefusalOf, type TrackerAnswer } from '@/lib/certUploads'
import { sameName } from '@/lib/nameMatch'
import { dayOnly } from '@/lib/ohio'
import { TINT_PAIR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { CertsRead } from './MyAsaHero'

/** The four states the chip can wear — the resource's own vocabulary. */
export type StaffCertStatus = 'valid' | 'expiring' | 'expired' | 'missing'

export type StaffCert = {
  id: string
  personName: string
  certName: string
  status: StaffCertStatus
  expiresAt: string
}

// A known status word passes; anything else derives from the expiry date — a vocabulary the sheet grows must…
function certStatusOf(status: string, expiresAt: string): StaffCertStatus {
  const s = status.trim().toLowerCase()
  if (s === 'valid' || s === 'expiring' || s === 'expired' || s === 'missing') return s
  const t = Date.parse(expiresAt)
  if (Number.isNaN(t)) return expiresAt ? 'valid' : 'missing'
  if (t < Date.now()) return 'expired'
  if (t < Date.now() + 30 * 86_400_000) return 'expiring'
  return 'valid'
}

const CERT_CHIP: Record<StaffCertStatus, string> = {
  valid: TINT_PAIR('mint'),
  expiring: TINT_PAIR('amber'),
  expired: TINT_PAIR('pink'),
  missing: TINT_PAIR('slate'),
}

// An expiry is a calendar day.
function expiryDate(v: string): Date {
  const day = dayOnly(v)
  if (!day) return new Date(v)
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

export type MyCerts = {
  /** this person's rows — empty unless `read` is 'ready' */
  certs: StaffCert[]
  read: CertsRead
  /** why a failed read failed, when there is more to say than that it did */
  reason: string
  /** ask again; the card and the header go back to "reading" */
  retry: () => void
}

type Answer = { who: string; read: 'ready' | 'failed'; reason: string; rows: StaffCert[] }

/** The sheet is matched by name: with no name there is nothing to read, and waiting would never end. */
export const CERTS_NO_NAME = 'there is no name to match the certifications sheet against'

/** The certifications on file for one person, read once per identity. */
export function useMyCerts(id: string, name: string): MyCerts {
  // the identity the answer is kept for: a new id or a new name is a new read
  const who = name ? `${id}\u0000${name}` : ''
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!who) return
    let alive = true
    // the tracker's own door says whose rows it answered (Certs.gs certTrackerList)
    gasAction<TrackerAnswer>('certTrackerList', { view: 'certs' })
      .then((got) => {
        if (!alive) return
        const rows = trackerRowsOf(got)
        // an own answer is this account's rows under its roster name, whatever name the account shows
        const mine = got?.scope === 'own'
          ? rows
          // the whole tracker: forgiving on spelling, strict on identity (lib/nameMatch)
          : rows.filter((r) => sameName(String(r.personName ?? ''), name))
        setAnswer({
          who,
          read: 'ready',
          reason: '',
          rows: mine.map((r, i) => ({
            id: String(r.id ?? `cert-${i}`),
            personName: String(r.personName ?? ''),
            certName: String(r.certName ?? 'Certification'),
            status: certStatusOf(String(r.status ?? ''), String(r.expiresAt ?? '')),
            expiresAt: String(r.expiresAt ?? ''),
          })),
        })
      })
      .catch((e: unknown) => {
        if (!alive) return
        // a refusal about this account says why; a transport failure has nothing more to say
        const refusal = uploadsRefusalOf(e)
        const why = refusal.state === 'unreadable' && refusal.scope === 'own' ? refusal.why.replace(/\.\s*$/, '') : ''
        setAnswer({ who, read: 'failed', reason: why, rows: [] })
      })
    return () => { alive = false }
  }, [who, name, nonce])

  const retry = () => {
    setAnswer(null)
    setNonce((n) => n + 1)
  }
  // no name: a read that cannot start is a failure now, not "reading" for ever
  if (!who) return { certs: [], read: 'failed', reason: CERTS_NO_NAME, retry }
  // an answer read for somebody else is no answer for this person
  const own = answer && answer.who === who ? answer : null
  return {
    certs: own && own.read === 'ready' ? own.rows : [],
    read: own ? own.read : 'loading',
    reason: own ? own.reason : '',
    retry,
  }
}

export default function MyCertsCard({ certs, read, reason, onRetry, visiting }: {
  certs: StaffCert[]
  read: CertsRead
  /** why a failed read failed (MyCerts.reason) */
  reason?: string
  onRetry: () => void
  /** somebody else's corner — the record is theirs, not the viewer's */
  visiting?: boolean
}) {
  const sub = read === 'loading'
    ? 'Reading the certifications…'
    : read === 'failed'
      ? 'Could not be read'
      : certs.length ? `${certs.length} on file` : 'Compliance at a glance.'
  return (
    <Card>
      <CardHeader
        title="My certifications"
        sub={sub}
        extra={<BadgeCheck size={16} className="text-text-3" />}
      />
      {read === 'loading' ? (
        <p className="text-[13px] leading-5 text-text-3">Reading the certifications…</p>
      ) : read === 'failed' ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px] leading-5 text-text-2">
          <span>
            {reason
              ? `The certifications could not be read — ${reason}. This is not an empty record.`
              : 'The certifications could not be read — this is not an empty record.'}
          </span>
          {/* asking again cannot supply a missing name */}
          {reason !== CERTS_NO_NAME && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[12px] font-semibold text-text-1 hover:bg-surface-2"
            >
              <RotateCw size={11} /> Try again
            </button>
          )}
        </div>
      ) : certs.length === 0 ? (
        <p className="text-[13px] leading-5 text-text-3">
          No certifications on file under {visiting ? 'this' : 'your'} name yet — they appear here once HR records them.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {certs.map((c) => (
            <span
              key={c.id}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
                CERT_CHIP[c.status],
              )}
              title={
                c.expiresAt
                  ? `${c.status === 'expired' ? 'Expired' : 'Expires'} ${format(expiryDate(c.expiresAt), 'MMM d, yyyy')}`
                  : c.status === 'missing'
                    ? 'Not issued'
                    : 'No expiry'
              }
            >
              {c.certName}
              <span className="font-medium opacity-75">
                {c.status === 'missing'
                  ? 'not issued'
                  : c.expiresAt
                    ? `${c.status === 'expired' ? 'expired' : 'exp'} ${format(expiryDate(c.expiresAt), 'MMM d')}`
                    : c.status}
              </span>
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}
