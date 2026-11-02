// "Phone Screen done" at intake.
// Somebody gets screened by voice before they ever exist on the board — the call comes first, the paperwork after.
import { useEffect, useState } from 'react'
import { BadgeCheck, PhoneCall } from 'lucide-react'
import { gasAction } from './shared'
import DragPerson from '@/components/shared/DragPerson'
import { cn } from '@/lib/utils'

type Probe = {
  recognised: boolean
  matched_by: string
  screen_exists: boolean
  screen_status: string
  candidate_name: string
  may_attest: boolean
}

const MATCH_WORDS: Record<string, string> = {
  phone: 'the phone number',
  email: 'the e-mail',
  name: 'the name',
  'new-hire-packet': 'their New Hire packet',
}

export function PhoneScreenDoneField({
  firstName,
  lastName,
  email,
  phone,
  live,
  value,
  note,
  onChange,
  onNote,
}: {
  firstName: string
  lastName: string
  email: string
  phone: string
  live: boolean
  value: boolean
  note: string
  onChange: (v: boolean) => void
  onNote: (v: string) => void
}) {
  const [probe, setProbe] = useState<Probe | null>(null)

  useEffect(() => {
    if (!live) return
    const name = `${firstName} ${lastName}`.trim()
    const enough = name.split(/\s+/).filter(Boolean).length >= 2 || phone.replace(/\D/g, '').length >= 10
    if (!enough) { setProbe(null); return }
    let cancelled = false
    const t = setTimeout(() => {
      gasAction<Probe>('screenProbe', { first_name: firstName, last_name: lastName, email, phone })
        .then((r) => { if (!cancelled) setProbe(r) })
        .catch(() => { if (!cancelled) setProbe(null) })
    }, 600)
    return () => { cancelled = true; clearTimeout(t) }
  }, [firstName, lastName, email, phone, live])

  // Never offered on a guess: either we recognised them, or the recruiter has given us enough to be accountable for…
  const offer = !!probe && (probe.recognised || probe.may_attest)
  useEffect(() => { if (!offer && value) onChange(false) }, [offer, value, onChange])
  if (!offer) return null

  return (
    <div className={cn('rounded-lg border p-3 transition-colors', value ? 'border-primary bg-primary-soft' : 'border-border bg-surface')}>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-text-1">
            <PhoneCall size={13} /> Phone Screen already done
          </span>
          <span className="mt-0.5 block text-[12px] leading-5 text-text-3">
            {probe?.screen_exists
              ? (
                <>
                  A screening is already on file for{' '}
                  <DragPerson name={probe.candidate_name || ''}>
                    {probe.candidate_name || 'this person'}
                  </DragPerson>{' '}
                  ({probe.screen_status || 'recorded'}).
                </>
              )
              : probe?.recognised
                ? `Recognised by ${MATCH_WORDS[probe.matched_by] ?? 'their details'}. Tick this if the call has already happened.`
                : 'Tick this if you have already screened them by voice — the card starts at Phone Screen.'}
          </span>
          {probe?.recognised && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-tint-mint px-2 py-0.5 text-[10px] font-semibold text-tint-fg-mint">
              <BadgeCheck size={11} /> We know this person
            </span>
          )}
        </span>
      </label>

      {value && (
        <>
          <textarea
            value={note}
            onChange={(e) => onNote(e.target.value)}
            rows={2}
            placeholder="How the call went, what was agreed… (optional)"
            className="mt-2.5 w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary"
          />
          <p className="mt-1.5 text-[11px] leading-4 text-text-3">
            This records the call, not the decision — Advance or Decline stays yours to make on the card.
          </p>
        </>
      )}
    </div>
  )
}
