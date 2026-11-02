// A referral that arrives complete may start at Onboarding: a REFERRAL can be registered straight into Onboarding…
// WHAT IS SKIPPED IS THE QUEUE, NOT THE CHECKS.
import { ArrowRightToLine, UserRoundCheck } from 'lucide-react'
import { inputCls } from './shared'
import DragPerson from '@/components/shared/DragPerson'
import { cn } from '@/lib/utils'

const NAME_PART = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\- ]*$/
const PLACEHOLDER_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'mail.example', 'test.com',
  'test.test', 'email.com', 'none.com', 'noemail.com', 'no.com', 'na.com',
  'nomail.com', 'domain.com', 'sample.com',
])
// Company/test lines identify nobody — mirrors SHARED_LINE_DIGITS.
const SHARED_LINES = new Set(['3307544040', '3309195558', '3309195559'])

const namePart = (v: string) => {
  const s = v.trim()
  return s.length >= 2 && NAME_PART.test(s)
}

export type FastLaneInput = {
  source: string
  firstName: string
  lastName: string
  phone: string
  email: string
  referredBy: string
}

/** Every reason at once — a form that reveals one at a time gets abandoned. */
export function fastLaneReasons(i: FastLaneInput): string[] {
  const out: string[] = []
  if (!/referral/i.test(i.source)) out.push('the source must be Referral')
  if (!namePart(i.firstName) || !namePart(i.lastName)) out.push('a full name — first and last, letters only')
  const digits = i.phone.replace(/\D/g, '').replace(/^1/, '')
  if (digits.length !== 10) out.push('a complete 10-digit phone number')
  else if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) out.push('a dialable phone number — that area code or prefix cannot exist')
  else if (SHARED_LINES.has(digits)) out.push('a personal phone number — that is one of our own lines')
  const email = i.email.toLowerCase().trim()
  const domain = email.includes('@') ? email.slice(email.indexOf('@') + 1) : ''
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email) || email.includes('..')) {
    out.push('a valid email address')
  } else if (PLACEHOLDER_DOMAINS.has(domain)) {
    out.push(`a real email address — ${domain} is a placeholder`)
  }
  if (!namePart(i.referredBy)) out.push('the name of whoever referred them')
  return out
}

/** The stages a candidate can be inserted at — Hired is not one of them. */
export const FAST_LANE_STAGES: Record<string, string> = {
  'phone-screen': 'Phone Screen',
  interview: 'In Person',
  onboarding: 'Onboarding',
}

export function ReferralFastLane({
  input,
  stage,
  onReferredBy,
  value,
  onChange,
}: {
  input: FastLaneInput
  /** Which band the "+" was pressed on — the stage being offered. */
  stage?: string
  onReferredBy: (v: string) => void
  /** Start this candidate at `stage` instead of New. */
  value: boolean
  onChange: (v: boolean) => void
}) {
  const stageLabel = stage ? FAST_LANE_STAGES[stage] : ''
  const reasons = fastLaneReasons(input)
  // The referrer is asked for as soon as the source is Referral — it belongs on the row whether or not anybody…
  const missing = reasons.filter((r) => r !== 'the name of whoever referred them')
  const qualifies = reasons.length === 0

  return (
    <div className={cn('rounded-lg border p-3 transition-colors', qualifies && value ? 'border-primary bg-primary-soft' : 'border-border bg-surface')}>
      <label className="grid gap-1.5">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-text-2">
          <UserRoundCheck size={13} /> Referred by
        </span>
        <input
          value={input.referredBy}
          onChange={(e) => onReferredBy(e.target.value)}
          placeholder="Who vouched for them"
          className={inputCls}
        />
      </label>

      {!stageLabel ? null : qualifies ? (
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 border-t border-border pt-3">
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-text-1">
              <ArrowRightToLine size={13} /> Start at {stageLabel}
            </span>
            <span className="mt-0.5 block text-[12px] leading-5 text-text-3">
              Name, phone and email are all complete and{' '}
              {/* the referrer, not the candidate — the chip carries the full name, the sentence the first */}
              <DragPerson name={input.referredBy.trim()}>
                {input.referredBy.trim().split(/\s+/)[0]}
              </DragPerson>{' '}
              vouched for them — the card can start at {stageLabel}.
            </span>
            {value && (
              <span className="mt-1.5 block rounded-sm bg-tint-amber px-2 py-1 text-[11px] leading-4 text-tint-fg-amber">
                The stages before {stageLabel} are recorded as <b>skipped by decision</b>, naming you and the
                referral — never as completed. Everything from {stageLabel} on is still owed in full.
              </span>
            )}
          </span>
        </label>
      ) : (
        <p className="mt-2.5 border-t border-border pt-2.5 text-[12px] leading-5 text-text-3">
          {missing.length === 0
            ? `Add who referred them and this candidate can start at ${stageLabel}.`
            : `They start at New — starting at ${stageLabel} needs ${missing.join(', ')}.`}
        </p>
      )}
    </div>
  )
}
