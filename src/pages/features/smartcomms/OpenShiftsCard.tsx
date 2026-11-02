// Open shifts, under the Desk's black card: the relay's list (house_cal_live.open_shifts, call-offs included), live…
// Every row opens its shift on Calendar Builder → Live.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle, ChevronRight, Clock, Loader2 } from 'lucide-react'
import { ohioTime, ohioToday } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import { shiftStateWord } from '@/pages/features/shifts/requestsLogic'
import { linkForShift } from '@/pages/features/shifts/houseCalTypes'
import { useOpenShifts } from '@/pages/features/shifts/useOpenShifts'

// 'CAN - 48TH (B) - ABD1711' → '48TH (B)'.
function shortHouse(location: string): string {
  const parts = location.split(' - ')
  return parts.length >= 2 ? parts[1].trim() : location
}

/** A closing instant on Ohio's clock. */
function timeOf(iso: string): string {
  return ohioTime(iso)
}

/** 'YYYY-MM-DD' → 'Ddd Mon D', and 'Today' when it is. */
function dayLabel(iso: string, today: string): string {
  if (iso === today) return 'Today'
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default function OpenShiftsCard() {
  const navigate = useNavigate()
  // never "0 open shifts" from a failed read; `shifts` stays null until one lands
  const { shifts, failed, pool } = useOpenShifts()
  /** the first eight, then "and N more" draws the rest in place */
  const [showAll, setShowAll] = useState(false)

  // Ohio's date, not UTC's
  const today = useMemo(() => ohioToday(), [])
  const unclaimed = useMemo(
    () => (shifts ?? []).filter((s) => !s.claimed_by && s.col_iso >= today),
    [shifts, today],
  )
  const claimed = useMemo(
    () => (shifts ?? []).filter((s) => s.claimed_by && s.col_iso >= today),
    [shifts, today],
  )

  // Nothing open and nothing claimed: the card stays out of the way.
  if (!failed && shifts !== null && unclaimed.length === 0 && claimed.length === 0) return null

  return (
    <section
      aria-label="Open shifts"
      className={cn('mb-5 overflow-hidden rounded-[16px] border-2 shadow-1',
        unclaimed.length > 0 ? 'border-[#8b0000] bg-[#8b0000]/[0.04]' : 'border-border bg-surface')}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-3">
        <AlertTriangle size={15} className={unclaimed.length > 0 ? 'text-[#8b0000]' : 'text-text-3'} />
        <h2 className={cn('text-[13px] font-semibold',
          unclaimed.length > 0 ? 'text-[#8b0000]' : 'text-text-2')}>
          {shifts === null && !failed ? 'Reading the house calendars…'
            : unclaimed.length > 0
              ? `${unclaimed.length} open ${unclaimed.length === 1 ? 'shift' : 'shifts'} — nobody is on ${unclaimed.length === 1 ? 'it' : 'them'}`
              : 'Every open shift is covered'}
        </h2>
        {shifts === null && !failed && <Loader2 size={13} className="animate-spin text-text-3" />}
        {claimed.length > 0 && (
          <span className="text-[12px] text-text-3">· {claimed.length} taken</span>
        )}
      </header>

      {failed && (
        <p className="px-5 pb-3 text-[12px] leading-[17px] text-text-3">
          {shifts === null
            ? <>The house calendars could not be read ({failed}). This card is not saying there are none.</>
            : <>The last re-read did not land ({failed}) — what is below is the list as it was last read.</>}
        </p>
      )}
      {pool && !pool.readable && (
        <p className="px-5 pb-3 text-[12px] leading-[17px] text-[#8b0000]">{pool.why}</p>
      )}

      {unclaimed.length > 0 && (
        <ul className="border-t border-[#8b0000]/20">
          {(showAll ? unclaimed : unclaimed.slice(0, 8)).map((s) => (
            <li key={`${s.location}|${s.key}`}>
              <button
                onClick={() => navigate(linkForShift(s))}
                className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-[#8b0000]/[0.07]"
              >
                <span className="w-[74px] shrink-0 text-[12px] font-semibold text-[#8b0000]">
                  {dayLabel(s.col_iso, today)}
                </span>
                <span className="w-[92px] shrink-0 text-[12.5px] font-medium text-text-1">
                  {shortHouse(s.location)}
                </span>
                <span className="min-w-0 flex-1 text-[12.5px] text-text-2">
                  {s.code}
                  <span className="text-text-3"> · {s.hours}h{s.overnight ? ' · overnight' : ''}</span>
                  {s.started && (
                    <span className="block text-[11px] font-semibold leading-4 text-[#8b0000]">
                      started — nobody is on it
                    </span>
                  )}
                  {s.pool_state && !s.started && (
                    <span className="block text-[11px] leading-4 text-text-3">
                      {s.kind_of_open === 'call_off'
                        ? (s.called_off_by ? `called off by ${s.called_off_by}` : 'called off')
                        : 'open shift'}
                      {' · '}
                      {s.pool_state === 'open' && s.window?.reserved
                        ? `reserved for ${shortHouse(s.location)}'s staff until ${timeOf(s.window.closes_at)}`
                        : s.pool_state === 'open'
                          ? `open until ${timeOf(s.window?.closes_at ?? '')}`
                          : s.pool_state === 'closed'
                            ? 'closed — awaiting the house manager'
                            : s.pool_state === 'manager_only'
                              ? 'too close to the start — the house manager assigns it'
                              : 'filled'}
                      {typeof s.applicants === 'number' && s.applicants > 0
                        && ` · ${s.applicants} applied`}
                    </span>
                  )}
                </span>
                {s.pool_state && (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-text-3">
                    <Clock size={11} /> {shiftStateWord(s.pool_state, s.window)}
                  </span>
                )}
                <ChevronRight size={14} className="shrink-0 text-text-3" />
              </button>
            </li>
          ))}
          {unclaimed.length > 8 && !showAll && (
            <li>
              <button
                onClick={() => setShowAll(true)}
                className="flex w-full items-center gap-1 px-5 py-2 text-left text-[11.5px] font-semibold text-[#8b0000] transition-colors hover:bg-[#8b0000]/[0.07]"
              >
                and {unclaimed.length - 8} more — show them <ChevronRight size={12} />
              </button>
            </li>
          )}
        </ul>
      )}

      {claimed.length > 0 && (
        <ul className={cn('border-t', unclaimed.length > 0 ? 'border-[#8b0000]/20' : 'border-border')}>
          {claimed.slice(0, 4).map((s) => (
            <li key={`${s.location}|${s.key}`} className="flex items-center gap-3 px-5 py-2 text-[12px] text-text-3">
              <span className="w-[74px] shrink-0">{dayLabel(s.col_iso, today)}</span>
              <span className="w-[92px] shrink-0">{shortHouse(s.location)}</span>
              <span className="min-w-0 flex-1">
                {s.code} — <span className="font-medium text-text-2">{s.claimed_by}</span>
                {s.claimed_via && s.claimed_via !== 'app' && ` (by ${s.claimed_via})`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
