// THE SMART COMMS DESK — a proper interface for Smart Comms, which until now was an app without one.
// Until today the app existed only as a Settings section — the settings ARE the same tab this screen edits…
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import {
  AlertTriangle, Bell, BookOpen, BrainCircuit, Check, ChevronRight, Clock, FlaskConical, Inbox, Layers, Loader2,
  MessageSquare, Pencil, PhoneOff, Radio, RefreshCw, ShieldAlert, Table2, X, Zap, type LucideIcon,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import { Badge } from '@/components/shared/Badge'
import { Switch } from '@/components/ui/switch'
import SidePanel from '@/components/shared/SidePanel'
import { gasAction, isRelayReceipt } from '@/features/hiring/shared'
import { onWriteRefused } from '@/lib/streamFrames'
import { dropAlertsCache, fetchAlerts } from '@/lib/hiringAlerts'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { depositTab, readSlice, readSliceFloor } from '@/lib/snapshotClient'
import { useAuthStore } from '@/auth/useAuthStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { activeWorldId } from '@/stores/useWorldStore'
import { activeTenantId } from '@/stores/useTenantStore'
import AiLaneTest from '@/components/shared/AiLaneTest'
import { toast } from '@/stores/useToastStore'
import { TINT_BG, TINT_FG, TINT_VAR, heroBand } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import OpenShiftsCard from './OpenShiftsCard'
import { callOffsAhead, linkForCallOff, linkForShift } from '@/pages/features/shifts/houseCalTypes'
import { dayLabel, shiftStateWord } from '@/pages/features/shifts/requestsLogic'
import { useOpenShifts } from '@/pages/features/shifts/useOpenShifts'
import { EASE_OUT_EXPO } from '@/engine/motion'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'
import { accountText, downText, type DownStatus, type TyStatus } from '@/pages/features/smartcomms/psiAccount'
// WHO `to` AND `cc` REACH.
import {
  AddressChip, AudienceChip, AudienceLine, AudienceNote, FloorLine, FloorNote, KeywordHint,
  cellEntries, readFloor, readRowAddresses,
  type FloorBook, type FloorSeen, type KeywordAudience, type KeywordBook, type TeamFloor,
} from '@/pages/features/smartcomms/toAddress'
import {
  confirmationLost, patchCells, readSenderLine, rowPatch, senderChoice, senderNames, senderOptions, withPatch,
  type DeskLine, type RowPatch,
} from '@/pages/features/smartcomms/deskWrites'

type Sit = Record<string, string> & { id: string }
type Delivery = { situation: string; person: string; expires: string; channel: string; at: string }
type DueRow = { situation: string; name: string; credential: string; expires: string; days_left: number; preview?: string }

// WHAT THE TRAIL READ ANSWERS.
type HistoryReply = {
  deliveries?: Delivery[]
  test_mode?: { on?: boolean; sms?: string[]; emails?: string[] }
}
type TestMode = { on: boolean; sms: string[]; emails: string[] }

const INPUT = 'h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong'
const AREA = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong'

/** A row's species, normalised once — blank means the oldest species, a reminder. */
const kindOf = (s: Sit): string => String(s.kind || 'reminder').trim().toLowerCase()

// HAS THIS SITUATION ANYTHING TO SAY, AND ON WHICH LEG?
const wordsByChannel = (s: Sit) => ({
  sms: !!String(s.sms_text ?? '').trim(),
  // A subject with no body still sends, and a body with no subject still sends.
  email: !!(String(s.email_subject ?? '').trim() || String(s.email_text ?? '').trim()),
})

// THE SPECIES, IN ONE PLACE.
type Species = {
  id: string; title: string; icon: LucideIcon; tint: TintName
  // WHETHER THIS DESK'S OWN PREVIEW MEASURES THE SPECIES AT ALL.
  measured: boolean
  /** The chip a card wears where a "people due now" count cannot honestly go. */
  drives: string
  why: string
}
// RESCUED FROM THE RETIRED SETTINGS SECTION.
const EVENT_SENTENCE: Record<string, string> = {
  // ---- the New Hire packet, the oldest three ------------------------------
  packet_missing: 'The moment onboarding ends without the signed packet — the same moment the card goes amber',
  packet_day_elapsed: 'When the candidate’s own day to produce the packet runs out (Settings → packet hold hours)',
  deadline_extended_expired: 'When a deadline a PERSON extended by hand expires — the card is red',
  hiring_packet_request: 'When a card arrives at Onboarding without the packet — the one hiring message that reaches the applicant',
  // ---- the rest of the hiring funnel --------------------------------------
  hiring_date_accepted: 'When every reading of the accepted in-person date fails (fired by the screening)',
  hiring_hired_complete: 'When a card reaches Hired with everything green (fired by the graduation sweep)',
  hiring_hired_missing: 'When a card reaches Hired still owing items (fired by the graduation sweep)',
  hiring_ready_to_start: 'When hiring finishes — the account is armed and the Employee Database is written',
  hiring_event_scheduled: 'When an appointment is scheduled — the calendar letter, fired by the scheduler',
  hiring_phone_collect: 'While a card at New has an e-mail and no phone — asked by letter for a number, seven times, every two hours',
  hiring_phone_confirm: 'The moment a phone number arrives by letter — the confirmation text until they reply YES, seven times, every two hours',
  hiring_contact_failed: 'When the phone could not be collected or confirmed after every try — the team is told once',
  hiring_referral_contact: 'While a referred candidate has no working contact — the referrer is asked, seven times on day one and seven more the next Ohio morning',
  hiring_screen_report: 'The moment the phone-screening transcript is analyzed — score, qualification and the AI report, to the team',
  interview_slots_ask: 'When a card reaches Interview — the interviewer is asked for slots with date AND time: three first, six if none work',
  hiring_scorecard_report: 'The moment the interviewer signs the scorecard — score, comments and decision, to the team',
  hiring_cjis_gate: 'When somebody passes the interview with no CJIS on the card — the team decides whether onboarding proceeds',
  hiring_onboarding_finish: 'While an onboarding was begun and abandoned — finish-it letters with the login inside, seven times, every two hours',
  hiring_onboarding_stalled: 'When the finish-it letters run out unanswered — the team is told; a "tente mais" restarts them next morning',
  hiring_hired_congrats: 'The moment a card reaches Hired with everything the rules require — the candidate is congratulated',
  interview_days_ask: 'When a card reaches Interview with nothing booked — the interviewer is asked which days she can take, seven times, every half hour, until she picks',
  hiring_screen_redo: 'When a screening call is cut short — the candidate is asked for one more try, once per dropped call',
  hiring_screen_call: 'While somebody stands at Phone Screen with no screening recorded — asked to call the line themselves, seven times, a day apart',
  hiring_first_contact: 'The first time we speak to somebody standing at New — {opening} greets them by how they reached us: an application, a résumé, the store, or a referral',
  hiring_unreachable_archived: 'When the outreach tries run out and the card is still at New — the platform archives them and tells you',
  onboarding_report: 'When a new hire finishes their onboarding — the visit writes the report, this is what sends it',
  // ---- the interview scheduler, in the order it happens --------------------
  interview_invite: 'When the recruiter sends the interview link — the candidate picks their own time',
  interview_supervisor_ask: 'When a candidate picks a time — the supervisor is asked to confirm it',
  interview_supervisor_slots_request: 'When the supervisor answers NO — she is asked for three times of her own',
  interview_slots_offer: 'When the supervisor gives three times — the candidate chooses one of them',
  hiring_welcome: 'When somebody presses Welcome on a card — the greeting, both channels',
  hiring_ask: 'When the store lane opens — the deciders are asked whether we are hiring (step 0)',
  hiring_shortlist: 'When the ranked shortlist is sent to the deciders',
  hiring_outreach: 'When a person or the walk presses Outreach on a store candidate — retried by the book, seven times',
  hiring_cjis_request: 'When the CJIS is asked from the team — the folders are read first',
  hiring_decision_ask: 'When the screening is done — the deciders are asked to release the candidate to the interview',
  hiring_resume_request: 'When a referred person is asked for a phone number or a resume — re-asked on the configured clock',
  interview_candidate_confirmed: 'The moment the candidate\'s pick lands on the Calendar — they are told date and time, letter and text',
  interview_confirmed: 'When the interview is booked — the receipt, back to the supervisor',
  // ---- SCREEN COPY: a switch that paints words, and never sends ------------
  referral_no_contact: 'Never sent — these are the words the login page shows when a referral carries no contact',
  referral_already_known: 'Never sent — these are the words the login page shows when the referred person is already on file',
  // ---- the other lanes that live on this same screen ------------------------
  hotline_call_off: 'When a DSP calls off through the hotline — one message per call',
  call_off_acknowledged: 'The one word back to the person who called off, so she knows it landed and nobody chases her — never to a Late Show, who worked',
  // WRITTEN AGAINST `commCallOffOfferSend_`, AND EVERY CLAUSE OF IT USED TO BE FALSE.
  call_off_cover_offer: 'When a call-off is recorded — the house managers and Ty Bond are told a shift needs cover. It names the house, a call-off in the night waits for 08:00 (and goes only if the shift has not ended), and who SHOULD cover is not ranked in this build',
  call_off_house_manager: 'When a call-off is recorded — the house manager the hotline resolved for that shift is told the staff member will not be in; in the night, at 08:00, if the shift has not ended',
  // THE AUDIENCE IS THE RESOLVER'S, AND THE RESOLVER READS `status`.
  call_off_everyone: 'When a call-off leaves a shift open — every active member of staff this platform can text is asked at once whether anybody can take it: URGENT OPEN SHIFT, with the house, the hour, the day, the street and the reason (a value that cannot be found leaves its sentence out)',
  /* openShiftCoveredOne_ (CommOpenShiftCovered.gs) */
  open_shift_covered: 'When a call-off’s open shift is filled on Requests — the people that call-off’s URGENT OPEN SHIFT reached are told it is covered, once, and nobody else; never why it was open or who called off',
  /* server/recruit_book.py plans these three; CommRecruit.gs says them */
  hiring_screen_day_reminder: 'On the morning of an in-person screen on the recruiters’ book — from 08:00 until the screen starts, the candidate is reminded of the time, the place and the house manager, once per screen',
  hiring_onboarding_start: 'When a candidate passes on the recruiters’ book (Hire ? turns Yes, or a new Onboarding Checklist row reads Pending) — they are told the screening went well and asked for their best e-mail address, once, within 72 hours',
  hiring_bci_howto: 'When a new hire on the recruiters’ book has not done the BCI background check (Pending or Yes, Background Check n) — the True Hire how-to, on a weekday in its walk-in hours, once unless this row asks again',
  // ---- the shift flow, planned by the relay against the roster, the time clock, the call-off books, the SMS ear's…
  shift_confirm_ask: 'Thirty minutes before each roster shift — the staff member is asked, from the 5558, whether they are all set; they reply YES or NO',
  shift_confirm_again: 'Every ten minutes after the first ask, while nobody replied and no punch is known — until thirty minutes after the start',
  shift_no_show_house_manager: 'Thirty minutes after the start, when nobody replied and no punch is known — the house manager is told the person did not go to work (or, when PsiAnywhere cannot be read, that they did not reply and the clock could not be checked)',
  shift_confirm_no_house_manager: 'The moment the staff member answers the ask with NO — the house manager is told, and nothing more goes to the person about that shift',
  late_call_house_manager: 'When a call-off book says the person called to say they would be late — the house manager is told, once per person per shift day',
  daily_note_due: 'When a shift ends without its Daily Note — the staff member is reminded 30 and 10 minutes before the end, 10 after, then every two hours 08:00–20:00 for up to 48 hours, at most 12 times, until the note is on the hotline',
  shift_login_before: 'Five minutes before each roster shift, to somebody who answered the ask with YES — the staff member is reminded to clock in on PsiAnywhere, unless a call-off names them or the clock already shows them in',
  shift_login_missing: 'Every half hour after a PsiAnywhere check finds no clock-in for the shift, to a YES or after the house manager was told nobody came — the staff member is told they have not logged in, until they clock in, reply, or the shift has been over for an hour; from the roster alone when PsiAnywhere cannot be read',
  shift_early_in: 'When a PsiAnywhere collection shows somebody clocked in more than fifteen minutes before their shift — the house manager of that house is told, once per person per shift',
  // ---- the PsiAnywhere proof, said to the ONE caller who asked -------------- The ids read backwards until you…
  psyanywhere_false_message: 'When somebody calls about PSI Anywhere and the check made during that call finds it up — she is told it is working normally and asked to reply if she still cannot get in, once per call. Her request is on the Support Queue either way, and nobody else is told',
  psyanywhere_true_message: 'When somebody calls about PSI Anywhere and the check made during that call finds it down — she is told her report is filed and that the team is being told, and the people in “Goes to” are paged once per outage hour, so a second caller inside that hour is answered without paging them again',
  contact_window_ask: 'When somebody has no answering window on file — asked for one, paced by the window lane',
  travel_outcome_missing: 'When a trip has been home three days with no outcome written',
  shopper_worth_checking: 'When a watched item is worth checking — only its own owner hears',
  truelink_run: 'When a TrueLink card sync finishes — one telling per run',
  ist_due: 'When an employee still owes IST on a client — addressed to the employee',
  questionnaire_due: 'When a questionnaire is still unanswered — addressed to the employee',
  finance_receipts_missing: 'When a client ledger still owes receipts for the month',
  recon_errors_found: 'When a time-reconciliation run finds errors — one telling per run',
  recon_punch_reminder: 'When somebody queues a punch reminder — addressed to the employee',
  guardian_alert: 'When the environment needs a person — at most once a day',
}

// THE NAME A WRITTEN SENTENCE IS FILED UNDER, and it is not one column.
const sentenceKey = (s: Sit): string => String(s.event ?? '').trim() || s.id

// WHO EACH LANE-SENT ROW'S OWN SENDER REACHES — AND WHETHER THE CELL DECIDES IT.
type SenderReach = {
  /** Who this row's sender resolves, in words. */
  who: string
  /** `cell`: it reads `Goes to`. `code`: it never looks at that cell. */
  from: 'cell' | 'code'
  /** For a `code` row: why an empty cell is right and no count belongs here. */
  resolved?: string
  // A SECOND LEG ON THE SAME ROW, addressed from the cell while `who` above is resolved in code.
  also?: { who: string; note: string }
  // WHAT THE CLOCK DOES TO IT, in the words somebody arming it needs: a row that defers to the morning and a row…
  clock: string
  // SOMETHING TRUE ABOUT THIS ROW THAT DECIDES WHETHER ARMING IT IS SAFE, and that nothing else on the screen would…
  caution?: string
  /** What this sender does or does not ask before it sends. */
  gate: string
}

// AND `who` IS WORDS, NEVER A CELL VALUE.

const SENDER_REACH: Record<string, SenderReach> = {
  call_off_acknowledged: {
    who: 'the person who called off, and nobody else',
    from: 'code',
    resolved: 'The lane resolves her from the call it is answering, so “Goes to” stays empty and ' +
      'there is nobody to count in advance — it is one person, whoever rang.',
    clock: 'The quiet hours defer it to the morning; they never drop it.',
    gate: 'This is the one leg that goes through the whole ladder: consent, the route, the ' +
      'opt-out list and the quiet hours, which defer it rather than drop it.',
  },
  call_off_house_manager: {
    who: 'the house manager the hotline resolved for that shift',
    from: 'code',
    resolved: 'Known only at the moment it sends, out of the location the caller named — no cell ' +
      'can hold a different manager per house, so “Goes to” stays empty on purpose and there is ' +
      'no count to draw. No manager resolved means NO SEND, with the reason on the call-off row.',
    clock: 'Nothing leaves 21:31–07:59 New York: a call-off in the night reaches her at 08:00, ' +
      'and only if the shift has not ended.',
    // THE ONE THING THIS SCREEN KNEW AND DID NOT SAY.
    caution: 'The hotline’s own Call Off Processor already texts this lead when a call-off is ' +
      'recorded. Until that send is retired, or until it can be read per call-off, arming this ' +
      'row means she hears about the same absence twice.',
    gate: 'It does not wait for the ladder’s quiet hours, but the send door’s quiet window ' +
      '(21:31–07:59 New York) holds it: a call-off recorded in the night is told at 08:00 if the ' +
      'shift has not ended.',
  },
  call_off_cover_offer: {
    who: 'the house managers on the hotline calendar, and Ty Bond',
    from: 'cell',
    clock: 'It does not wait for the weekend or anybody’s own window; nothing leaves 21:31–07:59 ' +
      'New York, and a call-off in the night is offered at 08:00 if the shift has not ended.',
    gate: 'It does not ask the weekend or anybody’s own window, and it names ' +
      'the house. The shift’s own manager is dropped out of it, so she hears about this call-off ' +
      'once. Who SHOULD cover is not ranked in this build.',
  },
  call_off_everyone: {
    who: 'every active member of staff this platform can text',
    from: 'cell',
    clock: 'Nothing leaves 21:31–07:59 New York: a call-off in the night is blasted at 08:00, ' +
      'and only if the shift it is about has not ended.',
    // THE OVERRIDE, SAID WHERE THE SWITCH IS: the URGENT OPEN SHIFT layout names the house, its street and the…
    caution: 'In the URGENT layout it names the house, its street and the call-off’s own reason to ' +
      'every member of staff it reaches — a standing order, overriding the older rule that kept a ' +
      'house’s place out of company-wide texts.',
    gate: 'The quiet window (21:31–07:59 New York) holds it until 08:00, and it cannot know who ' +
      'is already at work. The ' +
      'person who called off is never in it — by name and by her number, so a colleague who ' +
      'shares her phone cannot put that handset back in the list — and neither is anybody this ' +
      'same call-off has already reached, starting with her own acknowledgement. So what goes ' +
      'is the count beside the switch, less those.',
  },
  /* audience is the URGENT OPEN SHIFT's own list, so `Goes to` and `Cc` stay empty */
  open_shift_covered: {
    who: 'the people that call-off’s URGENT OPEN SHIFT reached, and nobody else',
    from: 'code',
    resolved: 'The blast keeps who it reached on the call-off row; this row texts that list and never ' +
      'reads the staff list again, so nobody hired since, and nobody the blast never got to, is told about ' +
      'a shift they were never asked to take. An ask that reached nobody is followed by nothing.',
    clock: 'Nothing leaves 21:31–07:59 New York: a shift filled in the night is told after 08:00 if it has ' +
      'not ended — and one filled while its URGENT OPEN SHIFT was still held for 08:00 drops that ask instead.',
    gate: 'Once per shift (the platform’s ledger and the call-off row’s own claim). The dial, test mode, the ' +
      'opt-out list and the quiet window bind it through the one send door; {reason} and {employee} are ' +
      'taken out of the words whatever the cell says.',
  },
  /* each reaches only the candidate on the book's row, so `Goes to` and `Cc` stay empty */
  hiring_screen_day_reminder: {
    who: 'the candidate whose in-person screen is today, from the recruiters’ book',
    from: 'code',
    resolved: 'The platform reads the recruiters’ book through a house of ours and finds each screen of the day with a ' +
      'phone, a time, a place and a screener. Nobody on the Hub’s hiring board is texted from the book — their own ' +
      'lanes do that — and a shared line or one of ours never is.',
    clock: 'From 08:00 New York until the screen starts; nothing leaves 21:31–07:59, and a screen that has begun is ' +
      'not reminded.',
    gate: 'Once per screen (the phone, the day and the time). Leaves from the line in “Sends from” so a reply reaches ' +
      'the recruiter. The dial, test mode and the opt-out list bind it through the one send door.',
  },
  hiring_onboarding_start: {
    who: 'the candidate who just passed, from the recruiters’ book',
    from: 'code',
    resolved: 'A change the platform sees happening — Hire ? turning Yes, or a new Pending row on the Onboarding ' +
      'Checklist. Everybody already there the day the lane began was written down and told nothing.',
    clock: 'Nothing leaves 21:31–07:59; told within 72 hours of the book saying so, or never — never a week late.',
    gate: 'Once per person (the phone). Leaves from “Sends from”, so the e-mail address it asks for comes back to the ' +
      'recruiter. The dial, test mode and the opt-out list bind it through the one send door.',
  },
  hiring_bci_howto: {
    who: 'the new hire whose BCI background check the recruiters’ book says is not done',
    from: 'code',
    resolved: 'Onboarding Checklist rows at Pending or Yes whose Background Check reads n. Never to somebody on the ' +
      'Hub’s hiring board, a shared line or one of ours.',
    clock: 'Weekdays 08:00–17:00 New York only — True Hire takes walk-ins Mon–Fri 8A–5P and the text asks for it today.',
    gate: 'Once per person unless Max # of attempts and Frequency on this row ask again — and only while the book ' +
      'still says n. The dial, test mode and the opt-out list bind it through the one send door.',
  },
  // RULE 13 (StaffAlerts.gs staffShiftReminder).
  shift_login_before: {
    who: 'the staff member on that roster shift, if they answered the ask with YES',
    from: 'code',
    resolved: 'Resolved per shift from the People house: on staff, with a number the platform may ' +
      'text. Only after a YES to the ask, so nobody is texted twice about one shift in half an ' +
      'hour; nobody a call-off book names for that day, and nobody the clock already shows in.',
    clock: 'Never inside 21:31–07:59 (21:30 is allowed). A reminder that falls inside is not sent ' +
      'late; the 08:00 re-check speaks instead, if a check shows the person still not logged in.',
    gate: 'The sending dial is obeyed in the door (off: nothing; record: a rehearsal row); the ' +
      'opt-out list and test mode bind it through the one send door; the door refuses any row ' +
      'that arrives inside the quiet window.',
  },
  shift_login_missing: {
    who: 'the staff member on that roster shift',
    from: 'code',
    resolved: 'The same person as the reminder before it — to a YES, or after the house manager ' +
      'was told nobody came. It goes only after a PsiAnywhere check finds no clock-in — or, when ' +
      'PsiAnywhere cannot be read, from the roster, and then the words say no check stands ' +
      'behind them.',
    clock: 'Every 30 minutes while the check keeps finding nothing, never inside 21:31–07:59; ' +
      'at 08:00 it goes once if it is still true. It stops at a clock-in, a reply, or an hour ' +
      'after the shift ends (a day at most).',
    gate: 'The dial, the opt-out list and test mode bind it; a reply from the phone it went to ' +
      'stops it.',
  },
  shift_early_in: {
    who: 'the house manager of the roster house',
    from: 'code',
    resolved: 'The hotline calendar’s ** row for the house on the roster — found by the house ' +
      'code the roster and the calendar both spell; no cell can hold a different manager per ' +
      'house, so “Goes to” stays empty. No manager with a number means no send.',
    clock: 'Never inside 21:31–07:59; one found overnight is told at 08:00 if the entry is still there.',
    gate: 'Once per person per shift. An entry that is the previous shift still running is a ' +
      'double, not an early clock-in, and says nothing.',
  },
  // THE SHIFT FLOW (StaffAlerts.gs staffShiftReminder, planned by server/psi_reminders.py): the ask and its repeats…
  shift_confirm_ask: {
    who: 'the staff member on that roster shift',
    from: 'code',
    resolved: 'Resolved per shift from the People house, and sent from the 5558 — the SMS ear ' +
      'hears the reply there. YES / Y / SIM / OK is a yes; NO / N / NAO or a plain refusal (“nope”, ' +
      '“can’t make it”, “not coming”, “calling off”, “I’m sick”) a no; “running late” a late call; ' +
      'anything else is a human answering and stops the asks.',
    clock: 'Thirty minutes before the start. Never inside 21:31–07:59 (21:30 is allowed — the ask ' +
      'before a 22:00 shift, offered from 21:25 so one slow minute cannot lose it); one that falls ' +
      'inside goes at 08:00 only if the shift still has a slot for it.',
    gate: 'The dial is obeyed in the door; nobody a call-off book names, nobody already on the ' +
      'clock, nobody the clock does not know.',
  },
  shift_confirm_again: {
    who: 'the staff member on that roster shift',
    from: 'code',
    resolved: 'The same person as the first ask.',
    clock: 'Every ten minutes after the first ask, until thirty minutes after the start — then the ' +
      'house manager is told instead. Never inside 21:31–07:59.',
    gate: 'A reply of any kind stops it, and so does a punch.',
  },
  shift_no_show_house_manager: {
    who: 'the house manager of the roster house',
    from: 'code',
    resolved: 'The hotline calendar’s ** row for the house on the roster, found by its code. No ' +
      'manager with a number means no send.',
    clock: 'Thirty minutes after the start. From PsiAnywhere it waits for a read made at that ' +
      'minute or later (the platform collects for it); from the calendar it goes at once and says ' +
      'the clock could not be checked — and never once the shift is over. Held inside ' +
      '21:31–07:59 and sent at 08:00 if still true.',
    caution: 'It is only ever said of somebody an ask REACHED who did not reply, or whom a read of ' +
      'the clock found missing — never of a person nobody could reach. When the asks went only ' +
      'into the rehearsal book, this message goes there too, and to no manager.',
    gate: 'Once per shift. After it, the person is sent “not logged in”.',
  },
  shift_confirm_no_house_manager: {
    who: 'the house manager of the roster house',
    from: 'code',
    resolved: 'The hotline calendar’s ** row for the house on the roster, found by its code.',
    clock: 'At once when the NO arrives — held inside 21:31–07:59 like every staff message.',
    gate: 'Once per shift; the asks stop, and nothing more goes to the person about that shift.',
  },
  late_call_house_manager: {
    who: 'the house manager of the roster house',
    from: 'code',
    resolved: 'The hotline calendar’s ** row for the house on the roster, found by its code. The ' +
      'late call is read off the call-off books — a Late Show on the tracker, or a hotline call whose ' +
      'own words say the person will be late, from a caller whose whole name is theirs (a shared ' +
      'first or last name names nobody) — or from their own reply to the ask.',
    clock: 'When it was learned before the start or within 30 minutes after it, while the shift ' +
      'is not over and the person is not on the clock yet. Held inside 21:31–07:59.',
    gate: 'Once per person per shift day.',
  },
  daily_note_due: {
    who: 'the staff member who worked the shift',
    from: 'code',
    resolved: 'Resolved per shift from the People house. One message per slot for a person, however ' +
      'many notes they owe — the slots of every shift they owe are merged.',
    clock: '30 and 10 minutes before the end, 10 after, then every two hours 08:00–20:00, for up to ' +
      '48 hours after the end, at most 12 times per shift and 6 per person per day. What falls inside ' +
      '21:31–07:59 goes once at 08:00.',
    gate: 'It stops the moment a Daily Note from that person is on the hotline after the shift began — ' +
      'under the name as the caller spoke it, so a near spelling counts. A notes book the platform cannot ' +
      'read reminds nobody.',
  },
  // THE PSI PAIR (CommPsi.gs), AND THE SECOND ONE SPEAKS TWICE.
  psyanywhere_false_message: {
    who: 'the one caller who asked, and nobody else',
    from: 'code',
    resolved: 'The lane resolves her from the call it is answering, so “Goes to” stays empty on ' +
      'purpose. There is nobody else on this row and nothing to count in advance.',
    clock: 'It answers while the call is still warm and asks no window — a caller who rang at ' +
      'three in the morning is answered at three in the morning.',
    gate: 'Once per call, and only when the check DECIDED: a check that could not decide says ' +
      'nothing at all, because “we could not tell” is not worth a text and “it is working” is ' +
      'not something to say when nobody knows.',
  },
  psyanywhere_true_message: {
    who: 'the caller who rang',
    from: 'code',
    resolved: 'Her leg never reads “Goes to” — the cell on this row is the escalation’s, not ' +
      'hers, and she is answered whether or not anybody is named in it.',
    also: {
      who: 'the people who can act on an outage',
      note: 'Paged ONCE PER OUTAGE HOUR, not once per caller: the second and third callers ' +
        'inside that hour are answered and page nobody, and the copy carries the proof line ' +
        'first so they can see what she was told.',
    },
    clock: 'It answers while the call is still warm and asks no window — at whatever hour the ' +
      'phone rang.',
    gate: 'Once per call for her, once per outage hour for them, and only when the check ' +
      'DECIDED: a check that could not decide says nothing at all.',
  },
}

// AND THE ONE NUMBER BEHIND THIS TABLE THAT IS MEASURED RATHER THAN WRITTEN.
type ReachCount = {
  call_offs?: number; resolved?: number; no_house_manager?: number; why?: string
}
type ReachBook = Record<string, ReachCount> | null

// THE HOURS A ROW KEEPS, as the backend reads them (`smartCommsGet` → `schedule`).
type ScheduleFact = {
  hours?: string[]; unreadable?: string[]; honored?: boolean
  standing?: boolean; next?: string; why?: string
}

// A DOOR THAT REACHES THE WORLD AND SAYS NOTHING (apps-script/SmartGate.gs).
export type GateFact = {
  id: string; label: string; reaches: string; costs: string
  relay: boolean; known: boolean; armed: boolean; holds_now: boolean
  person?: boolean; wired?: boolean; wired_why?: string; caveat?: string
}

/** `lag` is the backend's own sentence on when a switch takes effect; absent from an older backend. */
export type GatesRead = { lane: string; gates: GateFact[]; lag?: string }

// ONE OF THE TWO LETTERS THAT LEAVE WHILE EVERYTHING ELSE IS HELD — the password reset link and the registration…
export type AuthLetterFact = {
  kind: string; id: string; known: boolean; on: boolean
  delivered_while_held: boolean; note: string
  email_words?: string
  /** a letter that claims a kind it does not own names it; the letter needs both rows on */
  label?: string
  also_needs?: string
}

// AND THE SENDER THIS PLATFORM DOES NOT OWN.
type LegacySender = {
  name?: string; what?: string; words?: string; last_seen?: string
  proved?: string; unknown?: string; risk?: string; lifts_when?: string
}

// A COUNT IS ABOUT A ROW OR IT IS ABOUT NOTHING.
const readReach = (id: string, book: ReachBook): ReachCount | null => {
  if (!book) return null
  const hit = book[id] ?? book[id.replace(/^call_off_/, '')]
  return hit && typeof hit === 'object' ? hit : null
}

// WHERE THE PROMISE IS MADE.
const NOTE_PROMISES_REACH = /desk carries the share/i

// THAT ANSWER, BESIDE THE SWITCH AND BESIDE THE CELL.
function SenderReachLine(
  { sit, reach = null, sentBy = null, compact = false }:
  { sit: Sit; reach?: ReachBook; sentBy?: LegacySender | null; compact?: boolean },
) {
  const r = SENDER_REACH[sit.id]
  if (!r) return null
  // THE OTHER SENDER IS THE BACKEND'S DECLARATION WHERE THERE IS ONE, and this screen's own sentence only where…
  const other = r.caution && sentBy && (sentBy.risk || sentBy.name) ? sentBy : null
  const named = cellEntries(sit.to).length + cellEntries(sit.cc).length
  // THE ONE STATE THAT IS A WARNING: a sender that reads the cell, and a cell with nothing in it.
  const silent = named === 0 && (r.from === 'cell' || !!r.also)
  const counted = readReach(sit.id, reach)
  const promised = NOTE_PROMISES_REACH.test(String(sit.note ?? ''))
  const share = counted && typeof counted.call_offs === 'number' && counted.call_offs > 0
    ? `${counted.resolved ?? 0} of ${counted.call_offs} recorded call-off${counted.call_offs === 1 ? '' : 's'} resolved a manager this row could tell`
    : counted
      ? 'no call-off has reached this row yet, so its reach is not measured — it is the share of callers who name a house the hotline can match'
      : ''
  if (compact) {
    return (
      <>
        <p className={cn('mt-2 text-[11.5px] leading-[17px]', silent ? TINT_FG.peach : 'text-text-3')}>
          <span className="font-semibold text-text-2">Who hears it:</span> {r.who}
          {r.from === 'code'
            ? <>. This row’s sender resolves them itself{r.also ? '' : ' — “Goes to” stays empty'}.</>
            : silent
              ? <> — but this row’s sender reads “Goes to”, and that cell is EMPTY,
                  so it reaches nobody until somebody names them there.</>
              : <>, from whatever “Goes to” names — this row’s sender reads that cell.</>}
          {r.also ? (
            silent
              ? <> And {r.also.who} hear it from “Goes to”, WHICH IS EMPTY — she is
                  still answered, and nobody who can act on it is told.</>
              : <> And {r.also.who} hear it too, from “Goes to”.</>
          ) : null}
        </p>
        {share ? (
          <p className="mt-1 text-[11.5px] leading-[17px] text-text-3">
            <span className="font-semibold text-text-2">Measured reach:</span> {share}.
          </p>
        ) : promised ? (
          <p className="mt-1 text-[11.5px] leading-[17px] text-text-3">
            <span className="font-semibold text-text-2">The share the note points at is not on
            this screen:</span> the situations read does not carry it, so nothing here says whether
            that reach is large or small.
          </p>
        ) : null}
        {other ? (
          <p className={cn('mt-1 text-[11.5px] leading-[17px]', TINT_FG.peach)}>
            <span className="font-semibold">Also sent by {other.name}</span>
            {other.risk ? ` — ${other.risk}.` : '.'}
            {other.unknown ? ` And ${other.unknown}.` : ''}
          </p>
        ) : r.caution ? (
          <p className={cn('mt-1 text-[11.5px] leading-[17px]', TINT_FG.peach)}>{r.caution}</p>
        ) : null}
      </>
    )
  }
  return (
    <div className={cn('mb-4 rounded-md border border-border px-3 py-2.5',
      silent ? TINT_BG.peach : 'bg-surface-2')}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
        Who this row’s own sender reaches
      </p>
      <p className={cn('mt-1 text-[11.5px] leading-[17px]', silent ? TINT_FG.peach : 'text-text-2')}>
        <span className="font-semibold">{r.who}</span>
        {r.from === 'code' ? '.' : silent
          ? ' — and this row’s sender reads “Goes to”, which is EMPTY, so as it stands it reaches nobody.'
          : ', from what “Goes to” names below.'}
      </p>
      {r.resolved ? (
        <p className="mt-1 text-[11px] leading-4 text-text-3">{r.resolved}</p>
      ) : null}
      {r.also ? (
        <p className={cn('mt-1 text-[11px] leading-4', silent ? TINT_FG.peach : 'text-text-2')}>
          <span className="font-semibold">And {r.also.who}</span>
          {silent
            ? ' — out of “Goes to” below, WHICH IS EMPTY, so as it stands nobody who can act on it is told. '
            : ', out of “Goes to” below. '}
          {r.also.note}
        </p>
      ) : null}
      {share ? (
        <p className="mt-1 text-[11px] leading-4 text-text-3">
          <span className="font-semibold text-text-2">Measured reach:</span> {share}
          {counted?.why ? ` — ${counted.why}` : ''}.
        </p>
      ) : promised ? (
        <p className="mt-1 text-[11px] leading-4 text-text-3">
          The note below says the Desk carries the share of recent call-offs whose location did
          resolve. It does not: the situations read this desk makes does not carry that count, and
          the door that does count it is not one this screen calls. The reach of this row is the
          share of callers who name a house the hotline can match, and this screen cannot say today
          how large that is.
        </p>
      ) : null}
      {other ? (
        <p className={cn('mt-1 text-[11px] leading-4', TINT_FG.peach)}>
          <span className="font-semibold">Also sent by {other.name}</span>
          {other.what ? ` — ${other.what}.` : '.'}
          {other.risk ? ` ${other.risk[0].toUpperCase()}${other.risk.slice(1)}.` : ''}
          {other.unknown ? ` What is not known: ${other.unknown}.` : ''}
          {other.lifts_when ? ` This comes off the card when ${other.lifts_when}.` : ''}
        </p>
      ) : r.caution ? (
        <p className={cn('mt-1 text-[11px] leading-4 font-semibold', TINT_FG.peach)}>{r.caution}</p>
      ) : null}
      {silent ? (
        <p className="mt-1 text-[11px] leading-4 text-text-2">
          Nothing writes that cell for you, and nothing should — an empty audience is an answer,
          and it means nobody has said who this row may reach. Name them in “Goes to” below; the
          words this platform resolves are listed under it.
        </p>
      ) : null}
      <p className="mt-1 text-[11px] leading-4 text-text-3">{r.gate}</p>
    </div>
  )
}

// WHAT STANDS IN FRONT OF THIS ROW TODAY — the first thing that would stop it, in one line somebody can act on.
type Brake = {
  /** The sending dial, as the backend published it. null = it was not handed over. */
  dial: string | null
  /** The transport door (`HUB_RPC_SEND`) — a different door from the dial. */
  sendingKnown: boolean
  sendingOn: boolean
  /** null = the trail did not say whether the test redirect is on. Never "off". */
  testOn: boolean | null
}

function StopLine({ sit, brake }: { sit: Sit; brake: Brake }) {
  const r = SENDER_REACH[sit.id]
  if (!r) return null
  const on = sit.enabled === 'yes'
  const w = wordsByChannel(sit)
  const named = String(sit.channels ?? '').toLowerCase()
  const wantsSms = named.includes('sms')
  const wantsEmail = named.includes('email')
  // A row that names no channel hands the door its own (the call-off lane and the obligations lane both do), so…
  const mute = wantsSms || wantsEmail
    ? !((wantsSms && w.sms) || (wantsEmail && w.email))
    : !(w.sms || w.email)
  const readsCell = r.from === 'cell' || !!r.also
  const empty = readsCell && cellEntries(sit.to).length + cellEntries(sit.cc).length === 0
  const held: string[] = []
  const unread: string[] = []
  if (brake.dial && brake.dial !== 'send') held.push(`the sending dial at ${brake.dial}`)
  else if (!brake.dial) unread.push('the sending dial')
  if (brake.testOn === true) held.push('test mode')
  else if (brake.testOn === null) unread.push('test mode')
  if (brake.sendingKnown && !brake.sendingOn) held.push('the transport door, which is off')
  else if (!brake.sendingKnown) unread.push('the transport door')
  const list = (xs: string[]) =>
    xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
  const ownFault = on && (mute || empty)
  let says: string
  if (!on) {
    says = 'it is switched off, so nothing fires it whatever else is true — the switch is at the ' +
      'top of this card.'
  } else if (mute) {
    says = 'every channel it names is blank, and the one send door skips a blank channel — write ' +
      'the words in Edit and it has something to say.'
  } else if (empty && r.from === 'cell') {
    says = '“Goes to” is empty and this row’s own sender reads it, so it would reach nobody even ' +
      'with every brake off — name them in Edit.'
  } else if (empty) {
    says = '“Goes to” is empty, so the caller is answered and nobody who can act on it is told — ' +
      'name them in Edit.'
  } else if (held.length && unread.length) {
    // BOTH HALVES, BECAUSE ONE OF THEM ALONE IS THE WRONG ANSWER.
    says = `nothing of its own — what holds it is ${list(held)}, and ${list(unread)} ` +
      `${unread.length === 1 ? 'is' : 'are'} not in what this desk read at all. ` +
      `${held.length + unread.length === 2 ? 'Both are' : 'They are'} named at the top of this ` +
      'screen.'
  } else if (held.length) {
    says = `nothing of its own — what holds it is ${list(held)}, said in full at the top of this ` +
      'screen.'
  } else if (unread.length) {
    says = `nothing of its own, and ${list(unread)} ${unread.length === 1 ? 'is' : 'are'} not in ` +
      'what this desk read — so this screen cannot say on its own that nothing leaves.'
  } else {
    says = 'nothing — the next time it fires, these words go to the people named above.'
  }
  return (
    <p className={cn('mt-1 text-[11.5px] leading-[17px]', ownFault ? TINT_FG.peach : 'text-text-3')}>
      <span className="font-semibold text-text-2">What stops it today:</span> {says} {r.clock}
    </p>
  )
}

// IS THIS DESK ARMED, OR IS IT REHEARSING?
function BrakesPanel({ dial, onChanged }: { dial: string; onChanged: () => void }) {
  const [cfg, setCfg] = useState<Record<string, string> | null>(null)
  const [busy, setBusy] = useState('')
  const [why, setWhy] = useState('')
  // TYPED, NOT SAVED ON EVERY KEYSTROKE.
  const [draft, setDraft] = useState<Record<string, string>>({})

  const read = useCallback(async () => {
    try {
      const got = await fetchAlerts({ force: true })
      const values = (got && typeof got === 'object' ? (got as Record<string, unknown>) : {})
      const flat: Record<string, string> = {}
      Object.keys(values).forEach((k) => { flat[k] = String((values as Record<string, unknown>)[k] ?? '') })
      setCfg(flat)
      setWhy('')
    } catch (err) {
      setCfg(null)
      setWhy(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { void read() }, [read])

  const save = async (key: string, value: string) => {
    setBusy(key)
    try {
      await gasAction('hiringAlertsSet', { values: { [key]: value } })
      dropAlertsCache()
      await read()
      onChanged()
      toast({ type: 'success', title: `Saved — ${key} is now “${value || 'empty'}”.` })
    } catch (err) {
      toast({ type: 'danger', title: `Could not save ${key}`,
              body: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy('')
    }
  }

  const paused = String(cfg?.messages_paused ?? '').trim().toLowerCase()
  const isPaused = paused === 'on' || paused === 'true' || paused === 'yes' || paused === '1'
  const mode = String(cfg?.test_mode ?? '').trim().toLowerCase()
  // EVERY ON WORD IS ONE POSITION NOW — nothing leaves in any of them — so the select shows two, and `On` saves the…
  const testOn = ['on', 'true', '1', 'test', 'sheet', 'rehearsal', 'paper'].includes(mode)
  const testOff = ['off', 'false', '0', 'production'].includes(mode)

  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-semibold text-text-1">The brakes — every message this platform sends</p>
        <p className="text-[11.5px] text-text-3">
          They used to be edited under Hiring. They are the messages lane’s, so they are here.
        </p>
      </div>

      {why ? (
        <p className="mt-2 text-[12px] text-text-3">The config could not be read: {why}</p>
      ) : null}

      {/* TEST MODE FIRST: it is the one switch and the emergency stop. The
          pause beside it is an EXTRA brake on the send door alone — several
          senders never pass that door (the team notices, the platform
          mailbox's direct letters, the hiring simulator's actors), so it is
          labelled for what it holds and never called a stop. */}
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
            Test mode — the one switch, and the emergency stop
          </p>
          <select
            value={testOn ? 'sheet' : testOff ? 'off' : ''}
            disabled={!cfg || busy === 'test_mode'}
            onChange={(e) => void save('test_mode', e.target.value)}
            className={INPUT + ' mt-1.5'}
          >
            <option value="">{cfg ? '(never set)' : 'reading…'}</option>
            <option value="off">Off — real people are reached</option>
            <option value="sheet">On — nothing leaves, every message is a row in the mock</option>
          </select>
          <p className="mt-1.5 text-[11.5px] leading-[17px] text-text-3">
            On is the emergency stop: nothing reaches anybody, testers included, and every message is
            written into the mock outbox. The only letters that still leave are a password reset and an
            invitation a person has just asked for.
          </p>
        </div>

        <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
            Extra brake — the send door only
          </p>
          <button
            type="button"
            disabled={!cfg || busy === 'messages_paused'}
            onClick={() => void save('messages_paused', isPaused ? 'off' : 'on')}
            className={cn(
              'mt-1.5 inline-flex h-8 items-center rounded-md border px-3 text-[12px] font-semibold transition-colors',
              isPaused
                ? 'border-primary bg-surface text-text-1'
                : 'border-border bg-surface text-text-2 hover:bg-surface-2',
            )}
          >
            {isPaused ? 'Paused — the send door holds' : 'Pause the send door'}
          </button>
          <p className="mt-1.5 text-[11.5px] leading-[17px] text-text-3">
            Not the emergency stop: it holds only what passes the send door, and the team notices, the
            platform mailbox’s direct letters and the hiring simulator do not. To stop everything, turn
            test mode on.
          </p>
        </div>

        <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
            The sending dial — follows test mode
          </p>
          <p className="mt-1.5 text-[13px] font-semibold text-text-1">{dial || 'not read'}</p>
          <p className="mt-1.5 text-[11.5px] leading-[17px] text-text-3">
            Read-only, and not a second switch: test mode on sets it to{' '}
            <span className="font-semibold text-text-2">record</span>, off sets it to{' '}
            <span className="font-semibold text-text-2">send</span>. It reads{' '}
            <span className="font-semibold text-text-2">off</span> only when test mode could not be
            read, and then nothing leaves either.
          </p>
        </div>
      </div>

      {/* THE WORDS EVERY EAR READS, and the two switches beside them. They
          were edited on Settings > Hiring rules, under a heading that said
          "platform-wide" because there was nowhere else to put them — and the
          sentence on that panel was true: a phrase list typed in REPLACES the
          shipped words rather than adding to them, and both ears read it, the
          hiring sweep and this lane's. They belong with the brakes, so they
          are here, editing the same cells. */}
      <div className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
          The words every ear reads
        </p>
        <p className="mt-1 text-[11.5px] leading-[17px] text-text-3">
          What an answer has to say, whole, for the platform to act on it. Leave a field empty and the
          shipped list stands; type into it and yours REPLACES the shipped one — so a list of one word
          is a platform that hears one word.
        </p>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          {([
            ['opt_out_phrases', 'Means STOP', 'stop, unsubscribe, pare, parar, nao quero…'],
            ['opt_in_phrases', 'Means START again', 'start, unstop, resume, voltar…'],
            ['wrong_number_phrases', 'Means WRONG NUMBER', 'wrong number, not me, pessoa errada…'],
          ] as const).map(([key, label, hint]) => (
            <div key={key}>
              <p className="text-[11.5px] font-semibold text-text-2">{label}</p>
              <input
                value={draft[key] ?? cfg?.[key] ?? ''}
                disabled={!cfg || busy === key}
                placeholder={cfg ? hint : 'reading…'}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                onBlur={() => {
                  const now = draft[key]
                  if (now === undefined || now === (cfg?.[key] ?? '')) return
                  void save(key, now)
                }}
                className={INPUT + ' mt-1'}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-[11.5px] font-semibold text-text-2">The clock the whole platform reads</p>
            <input
              value={draft.hiring_timezone ?? cfg?.hiring_timezone ?? ''}
              disabled={!cfg || busy === 'hiring_timezone'}
              placeholder={cfg ? 'empty = America/New_York' : 'reading…'}
              onChange={(e) => setDraft((d) => ({ ...d, hiring_timezone: e.target.value }))}
              onBlur={() => {
                const now = draft.hiring_timezone
                if (now === undefined || now === (cfg?.hiring_timezone ?? '')) return
                void save('hiring_timezone', now)
              }}
              className={INPUT + ' mt-1'}
            />
          </div>
          <div>
            <p className="text-[11.5px] font-semibold text-text-2">May the platform send e-mail as itself?</p>
            <select
              value={['yes', 'no'].includes(String(cfg?.platform_email_enabled ?? '').trim().toLowerCase())
                ? String(cfg?.platform_email_enabled).trim().toLowerCase() : ''}
              disabled={!cfg || busy === 'platform_email_enabled'}
              onChange={(e) => void save('platform_email_enabled', e.target.value)}
              className={INPUT + ' mt-1'}
            >
              <option value="">{cfg ? '(not yes or no)' : 'reading…'}</option>
              <option value="yes">Yes</option>
              <option value="no">No — every letter is refused at the door</option>
            </select>
          </div>
        </div>
      </div>

      {cfg && testOn ? (
        <p className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-[11.5px] leading-[17px] text-text-3">
          While test mode is <span className="font-semibold text-text-2">on</span>, no message reaches
          anybody — not the people it names and not the testers. Each one is a row in the mock outbox:
          who it would have gone to, the words, and what held it. Turn test mode off and everything
          flows, with no second step.
        </p>
      ) : null}
    </Card>
  )
}

function DialBanner({ dial }: { dial: string }) {
  return (
    <div
      className={cn(
        'mb-4 flex items-start gap-2.5 rounded-[14px] border px-4 py-3 text-[12.5px] leading-[1.45]',
        !dial
          ? 'border-transparent bg-tint-amber text-tint-fg-amber'
          : dial === 'send'
            ? 'border-border bg-surface text-text-2'
            : 'border-transparent bg-tint-mint text-tint-fg-mint',
      )}
    >
      {dial
        ? <ShieldAlert size={15} className="mt-[1px] shrink-0" />
        : <AlertTriangle size={15} className="mt-[1px] shrink-0" />}
      <p className="min-w-0">
        {dial === 'record' ? (
          <>
            <span className="font-semibold">Test mode is on — the sending dial follows it at
            “record”.</span>{' '}
            A row that fires today is worked out in full: who it would reach, how many of them and
            in which words. Nobody is contacted. The ending, the count and the reason are written
            onto the row that triggered it, and the message itself goes to the mock outbox and the
            rehearsal book — which is what you read before turning test mode off. The rehearsal book
            keeps the newest passes whole and retires the oldest as it fills, so read it the day you
            rehearse rather than a fortnight later. The day test mode goes off, every row switched on
            below becomes real at once — there is no second switch.
          </>
        ) : dial === 'off' ? (
          <>
            <span className="font-semibold">Test mode could not be read, so the sending dial is off.</span>{' '}
            A row that fires is refused and the refusal is written down. Nobody is contacted, and
            nothing here is queued for later.
          </>
        ) : dial === 'send' ? (
          <>
            <span className="font-semibold">Test mode is off — the sending dial follows it at “send”.</span>{' '}
            A row that fires is handed over for real. What each row still has to pass is on its own
            card.
          </>
        ) : (
          <>
            <span className="font-semibold">The sending dial is not in what this desk read.</span>{' '}
            It follows test mode — on is “record”, off is “send” — so read the test mode switch in the
            brakes panel: that is the one that decides.
          </>
        )}
      </p>
    </div>
  )
}

// TODAY, UNDER THE SUMMARY — right under the black card, today's CALL-OFFS in RED and the NO CALL NO SHOW: who did…
type TodayRow = {
  row_kind: string
  id: string
  person: string
  house: string
  house_name?: string
  day: string
  shift_at: string
  verdict: string
  checked_at?: string
  told_source?: string
  told_kind?: string
  told_at?: string
  late_call?: boolean
  late_call_at?: string
  hm_no_show_at?: string
  confirm?: string
  mode?: string
  clock_state?: string
  /** the status row's: which PsiAnywhere account the relay reads as, Ty's day, DOWN */
  account?: string
  ty?: TyStatus
  down?: DownStatus | null
}

const TODAY_RESOURCE = 'commPunchBoard'

/** Today's date in New York, the clock the roster is kept in. */
const nyToday = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

/** "8:00 AM" from an instant, read in Ohio. */
const shiftClock = (iso: string): string => {
  const d = new Date(iso || '')
  return Number.isNaN(d.getTime())
    ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
}

/** When the platform learned it: an instant as "9:20 AM", a bare day as the day. */
const learnedText = (raw: string): string => {
  if (!raw) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw === nyToday() ? 'today' : raw
  const d = new Date(raw)
  return Number.isNaN(d.getTime())
    ? raw : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                                        timeZone: 'America/New_York' })
}

// The board's word for a shift held only by a hotline caller's name no key could hold (psi_attendance's loose rows).
const LOOSE_SOURCE = "the line (a caller's name)"

const SOURCE_WORDS: Record<string, string> = {
  tracker: 'Call Off Tracker',
  live_queue: 'hotline queue',
  retired_book: 'retired call-off book',
  'live_queue+retired_book': 'hotline queue + retired book',
  [LOOSE_SOURCE]: 'hotline call',
}

/** Somebody the clock shows at work is nobody's call-off today. */
const ON_THE_CLOCK = new Set(['punched_on_time', 'late'])

// Today's call-offs, from the books: every shift a book names the person for — before it starts too — that is not a…
const isTodayCallOff = (r: TodayRow): boolean =>
  !!r.told_source && r.told_source !== LOOSE_SOURCE && !r.late_call &&
  r.told_kind !== 'no_show' && !ON_THE_CLOCK.has(r.verdict)

const todayHouse = (r: TodayRow) => r.house_name || r.house || '—'
const callOffSource = (r: TodayRow) => {
  const book = SOURCE_WORDS[r.told_source || ''] || r.told_source || 'a call-off book'
  const kind = r.told_kind && r.told_kind !== 'call_off' && r.told_kind !== 'reported_call_off'
    ? ` · ${r.told_kind.replace('_', ' ')}` : ''
  return `${book}${kind}`
}
const ncnsSource = (r: TodayRow) =>
  r.told_kind === 'no_show'
    ? `${SOURCE_WORDS[r.told_source || ''] || r.told_source || 'a call-off book'} · typed as a no-show`
    : r.hm_no_show_at
      ? (r.verdict === 'no_punch' ? 'no reply to the ask · the time clock has no punch'
        : r.verdict === 'not_entered_yet' ? 'no reply to the ask · no time entry typed yet'
          : 'no reply to the ask · house manager told')
      : 'the time clock: no punch, and no call-off on record'

// Today's no-call-no-shows: a read while the shift ran found no punch and no book names the person, the house…
const isNoCallNoShow = (r: TodayRow): boolean =>
  (r.verdict === 'no_punch' && !r.told_source) || !!r.hm_no_show_at || r.told_kind === 'no_show'

// Today's shifts that are over with no time entry yet — the board's `not_entered_yet`, a read an hour past the end…
const isNoEntryYet = (r: TodayRow): boolean =>
  r.verdict === 'not_entered_yet' && !r.told_source && !r.hm_no_show_at && r.told_kind !== 'no_show'

/** One list of today's people; with `linkOf` each row opens its shift on Calendar Builder → Live. */
function TodayList({ items, tone, empty, source, when, linkOf }: {
  items: TodayRow[]
  tone: 'danger' | 'amber' | 'slate'
  empty: string
  source: (r: TodayRow) => string
  when: (r: TodayRow) => string
  linkOf?: (r: TodayRow) => string
}) {
  const navigate = useNavigate()
  if (!items.length) return <p className="px-1 py-2 text-[12px] text-text-3">{empty}</p>
  return (
    <ul className="divide-y divide-border">
      {items.map((r) => {
        const body = (
          <>
            <span className={cn('min-w-0 truncate text-[13px] font-semibold', TINT_FG[tone])}>{r.person}</span>
            <span className="flex items-center gap-1 font-stat text-[12.5px] text-text-1">
              {shiftClock(r.shift_at) || '—'}
              {linkOf && <ChevronRight size={12} className="text-text-3" />}
            </span>
            <span className="min-w-0 truncate text-[11.5px] text-text-3">{todayHouse(r)} · {source(r)}</span>
            <span className="text-right text-[11.5px] text-text-3">learned {learnedText(when(r))}</span>
          </>
        )
        return (
          <li key={r.id}>
            {linkOf ? (
              <button onClick={() => navigate(linkOf(r))}
                title="Open this shift on Calendar Builder → Live"
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 rounded-md py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">
                {body}
              </button>
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Call-offs for tomorrow and later, from the shared open-shifts read; an unread pool is said. */
function CallOffsAhead({ today }: { today: string }) {
  const navigate = useNavigate()
  const { shifts, failed, pool } = useOpenShifts()
  const ahead = callOffsAhead(shifts, today)
  if (shifts === null) {
    return failed
      ? <p className="px-1 pt-2 text-[11.5px] text-text-3">The call-offs for the days ahead could not be read ({failed}) — not a zero.</p>
      : null
  }
  return (
    <>
      <p className={cn('mb-1 mt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em]', TINT_FG.danger)}>
        Called off for the days ahead <span className="font-stat">{ahead.length}</span>
      </p>
      {pool && !pool.readable && <p className="px-1 text-[11.5px] text-text-3">{pool.why}</p>}
      {!ahead.length ? (
        <p className="px-1 py-2 text-[12px] text-text-3">No call-off on the books for the days ahead.</p>
      ) : (
        <ul className="divide-y divide-border">
          {ahead.map((s) => (
            <li key={s.ref || `${s.location}|${s.key}`}>
              <button onClick={() => navigate(linkForShift(s))}
                title="Open this shift on Calendar Builder → Live"
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 rounded-md py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">
                <span className={cn('min-w-0 truncate text-[13px] font-semibold', TINT_FG.danger)}>
                  {s.called_off_by || 'Somebody called off'}
                </span>
                <span className="flex items-center gap-1 font-stat text-[12.5px] text-text-1">
                  {dayLabel(s.col_iso, today)} · {s.code}
                  <ChevronRight size={12} className="text-text-3" />
                </span>
                <span className="min-w-0 truncate text-[11.5px] text-text-3">
                  {s.location.split(' - ')[1]?.trim() || s.location}
                  {s.claimed_by ? ` · given to ${s.claimed_by}` : ''}
                </span>
                <span className="text-right text-[11.5px] text-text-3">
                  {s.pool_state ? shiftStateWord(s.pool_state, s.window) : ''}
                  {typeof s.applicants === 'number' && s.applicants > 0 ? ` · ${s.applicants} applied` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function TodayAbsences() {
  /** null is "not read", never "nobody". */
  const [rows, setRows] = useState<TodayRow[] | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let live = true
    readSlice<TodayRow>(TODAY_RESOURCE)
      .then((got) => { if (live) { setRows(got); setLoaded(true) } })
      .catch(() => { if (live) { setRows(null); setLoaded(true) } })
    return () => { live = false }
  }, [])

  const today = nyToday()
  const status = (rows ?? []).find((r) => r.row_kind === 'status') ?? null
  const shifts = (rows ?? []).filter((r) => r.row_kind === 'shift' && r.day === today)
  const byTime = (a: TodayRow, b: TodayRow) => (a.shift_at || '').localeCompare(b.shift_at || '')
  const callOffs = shifts.filter(isTodayCallOff).sort(byTime)
  const heldByName = shifts.filter((r) => r.told_source === LOOSE_SOURCE && !ON_THE_CLOCK.has(r.verdict)).length
  const noCallNoShow = shifts.filter(isNoCallNoShow).sort(byTime)
  const noEntryYet = shifts.filter(isNoEntryYet).sort(byTime)
  const lateCalls = shifts.filter((r) => r.late_call).sort(byTime)

  const ncnsWhen = (r: TodayRow) => r.hm_no_show_at || r.checked_at || r.told_at || ''
  // each call-off row opens its red cell, else the caller's own cell
  const { shifts: openShifts } = useOpenShifts()
  const callOffLink = (r: TodayRow) =>
    linkForCallOff(openShifts, { house: r.house, day: r.day, person: r.person })

  return (
    <div className="mb-5 rounded-[16px] border border-border bg-surface p-4 shadow-1 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-text-1">
          <PhoneOff size={14} className={TINT_FG.danger} />
          Today — who is not coming
        </h2>
        <p className="text-[11.5px] text-text-3">
          From the punch board: the call-off books, the time clock and the shift flow’s own asks.
          {status?.mode === 'calendar' && ' PsiAnywhere cannot be read right now, so a no-show is only named when nobody answered the ask.'}
        </p>
        {status && (downText(status.down) || accountText(status)) && (
          <p className="basis-full text-[11.5px] text-text-3">
            {downText(status.down) && <span className={cn('mr-1', TINT_FG.danger)}>{downText(status.down)}</span>}
            {accountText(status)}
          </p>
        )}
      </div>
      {!loaded ? (
        <p className="text-[12px] text-text-3"><Loader2 size={12} className="mr-1 inline animate-spin" />Reading the punch board…</p>
      ) : rows === null ? (
        <p className="rounded-md bg-tint-amber px-3 py-2 text-[12px] text-tint-fg-amber">
          The punch board did not answer — nothing below is a zero, it is unread.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className={cn('rounded-[12px] px-3 pb-2 pt-2.5', TINT_BG.danger)}>
            <p className={cn('mb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em]', TINT_FG.danger)}>
              Call-offs today <span className="font-stat">{callOffs.length}</span>
            </p>
            <TodayList items={callOffs} tone="danger" empty="No call-off on the books for today."
                       source={callOffSource} when={(r) => r.told_at || ''} linkOf={callOffLink} />
            {heldByName > 0 && (
              <p className="px-1 pt-1 text-[11.5px] text-text-3">
                {heldByName} more {heldByName === 1 ? 'shift is' : 'shifts are'} held by a hotline call whose
                caller could not be tied to one person — a shared name holds a shift, it never names anybody.
              </p>
            )}
            <CallOffsAhead today={today} />
          </div>
          <div className="rounded-[12px] border border-border px-3 pb-2 pt-2.5">
            <p className={cn('mb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em]', TINT_FG.danger)}>
              No call, no show <span className="font-stat">{noCallNoShow.length}</span>
            </p>
            <TodayList items={noCallNoShow} tone="danger" empty="Nobody is missing without a word today."
                       source={ncnsSource} when={ncnsWhen} />
            {lateCalls.length > 0 && (
              <>
                <p className={cn('mb-1 mt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em]', TINT_FG.amber)}>
                  Called to say they will be late <span className="font-stat">{lateCalls.length}</span>
                </p>
                <TodayList items={lateCalls} tone="amber" empty="" source={callOffSource}
                           when={(r) => r.late_call_at || r.told_at || ''} />
              </>
            )}
            {noEntryYet.length > 0 && (
              <>
                <p className={cn('mb-1 mt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em]', TINT_FG.slate)}>
                  Shift over, no time entry yet <span className="font-stat">{noEntryYet.length}</span>
                </p>
                <TodayList items={noEntryYet} tone="slate" empty=""
                           source={() => 'the time clock: nothing typed an hour after the end'}
                           when={(r) => r.checked_at || ''} />
                <p className="px-1 pt-1 text-[11.5px] text-text-3">
                  Most time entries are typed after the shift, many the next day — not an absence until the entry
                  is typed or somebody says so.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const SPECIES: Species[] = [
  // THE OBLIGATIONS LANE'S OWN SPECIES (CommRecord.gs): one message carrying several owed items, chosen and paced…
  { id: 'bundle', title: 'Obligation bundles', icon: Layers, tint: 'pink', measured: false,
    drives: 'runs on its own lane',
    why: 'The obligations lane chooses who is owed what and paces the message (CommRecord). This desk\'s preview does not walk bundles, so a count here could only ever read zero — the Activity page is where its sends show.' },
  { id: 'reminder', title: 'Reminders', icon: Bell, tint: 'blue', measured: true,
    drives: '', why: '' },
  { id: 'event', title: 'Events', icon: Zap, tint: 'amber', measured: false,
    drives: 'fires on the event',
    why: 'An event row waits for something to happen and counts days from it; it reads no expiry column, so the preview has nothing to match and would report zero for every one of them.' },
  { id: 'mailbox', title: 'Mailbox watchers', icon: Inbox, tint: 'peach', measured: false,
    drives: 'waits on the mailbox',
    why: 'The platform mailbox hears a subject line and the platform’s mail sweep files it. Nothing is due until a message arrives, so a zero here would be a measurement nobody took.' },
  { id: 'digest', title: 'Digests', icon: Radio, tint: 'mint', measured: false,
    drives: 'runs on its own weekly sweep',
    why: 'A digest is not a per-person reminder — it has its own sweep and writes one row a week about everybody. The preview excludes it by name.' },
  { id: 'ai', title: 'AI requests', icon: BrainCircuit, tint: 'lavender', measured: false,
    drives: 'reaches nobody',
    why: 'An AI row carries the request a model is asked with. It names no person and sends nothing, so there is nobody for it to be due for.' },
  // THE CALL-OFF LANE'S OWN SPECIES (CommCallOff.gs).
  { id: 'call_off', title: 'Call offs', icon: PhoneOff, tint: 'green', measured: false,
    drives: 'fires on the call-off itself',
    why: 'The call-off lane decides who hears what the moment a call-off is recorded, and paces it there (CommCallOff). Nothing is due on a clock, so a count here could only ever read zero.' },
  // RULE 13'S SPECIES (StaffAlerts.gs staffShiftReminder).
  { id: 'shift_clock', title: 'Shift flow', icon: Clock, tint: 'blue', measured: false,
    drives: 'planned by the platform from the roster, the time clock, the replies and the Daily Notes',
    why: 'Who is owed the ask before a shift, a word to the house manager (nobody came, a NO, a late call, an early clock-in), a clock-in reminder, a "not logged in" or a Daily Note reminder is worked out by the platform against the roster, PsiAnywhere, the call-off books, the SMS ear and the Daily Notes, and remembered there per occasion. The Punch board shows the verdicts behind them, and the panel under the summary shows today\'s call-offs and no-shows.' },
  // THE LETTERS A DOOR FIRES (apps-script/SmartGate.gs): the reset link, the invitation, the weekly key check, a…
  { id: 'letter', title: 'Letters a door fires', icon: MessageSquare, tint: 'peach', measured: false,
    drives: 'fires at the door that sends it',
    why: 'A reset link leaves when somebody asks for it, an invitation when an administrator sends one, the weekly key check when its sweep has measured, a form notice when somebody answers, a copy to the platform\'s own mailbox when a call-off or a suggestion lands. There is no date to count against, so a zero here would be a measurement nobody took. Each row\'s note says who it goes to and where its words live.' },
  // THE DOORS WITHOUT WORDS: each is a switch, not a message, and the board below this screen's summary draws what…
  { id: 'gate', title: 'Doors without words', icon: ShieldAlert, tint: 'amber', measured: false,
    drives: 'says nothing — it holds a door while the lane holds',
    why: 'A gate sends nothing to anybody. Armed, the door it names holds whenever the send switch holds; the board of doors on this screen says what each one reaches and what holding it costs.' },
]

/** A species this screen has no section written for: shown as it is, never hidden. */
const strayTitle = (kind: string): string => {
  const words = kind.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Other'
}

// THE PRIORITY LADDER, AS THE FILE THAT OWNS IT WROTE IT (apps-script/CommPolicy.gs, COMM_PRIORITIES).
type Priority = 'safety' | 'repair' | 'ask' | 'notice'
type Rung = {
  id: Priority; why: string
  gap: boolean; sleep: boolean; weekend: boolean
  cap: string; carries: string; tint: TintName
}
const LADDER: Rung[] = [
  { id: 'safety', why: 'somebody could be hurt',
    gap: true, sleep: true, weekend: true,
    cap: 'tried until it lands',
    carries: 'Declared and carried empty: nothing is filed under it yet, so the top of the ladder is not claimed by a correction the day something real needs it.',
    tint: 'pink' },
  { id: 'repair', why: 'we owe them a word',
    gap: true, sleep: false, weekend: true,
    cap: 'said once, then a person',
    carries: 'A correction, or an answer somebody is waiting on. It asks for nothing, so it does not pay the weekend — and it waits for the quiet hours to lift rather than waking anybody, because a correction at 3am is the second insult.',
    tint: 'amber' },
  { id: 'ask', why: 'they owe us something',
    gap: false, sleep: false, weekend: false,
    cap: 'the book’s cap, then a person',
    carries: 'Everything this lane does today, and the floor anything unresolved lands in.',
    tint: 'blue' },
  { id: 'notice', why: 'worth knowing, never urgent',
    gap: false, sleep: false, weekend: false,
    cap: 'the book’s cap, then a person',
    carries: 'Digests and informational sends. The only rung that may be dropped outright when a pass runs out of budget — which is why nothing has to be promoted to an ask just to be delivered.',
    tint: 'lavender' },
]
const RUNG: Record<string, Rung> = Object.fromEntries(LADDER.map((r) => [r.id, r]))

// WHICH RUNG A SITUATION IS ON — and today the honest answer is "this desk cannot say".
const priorityOf = (s: Sit): Rung | null => {
  const raw = String(s.priority ?? '').trim().toLowerCase()
  return RUNG[raw] ?? null
}

// THE TRAIL IS BOUNDED, so the count it feeds is a floor and not a total — smartCommsHistory caps at 500 rows (of…
const TRAIL_LIMIT = 500

// THE DOOR IS ONE EXECUTION AT A TIME, AND IT IS THE SCARCE THING — Smart Comms was erroring on every visit and…
const DESK_RESOURCE = 'smartCommsDesk'
// THE KEPT COPY IS KEYED BY THE PLACE IT WAS READ IN, AND BY WHO READ IT (review).
function keptSituationsKey(): string {
  const world = activeWorldId()
  const tenant = activeTenantId()
  const member = useMemberStore.getState().currentMemberId
  const who = useAuthStore.getState().user?.id || ''
  const place = member ? `member:${member}` : world ? `world:${world}` : tenant ? `tenant:${tenant}` : 'home'
  return `smartcomms.desk.situations.${who}.${place}`
}
// THE KEYWORD NAMES THIS BROWSER LAST SAW — names only, never a head-count.
function keptKeywordNames(): KeywordBook | null {
  const kept = readKept<KeptSituations>(keptSituationsKey())
  const keys = kept && Array.isArray(kept.keywords)
    ? kept.keywords.filter((k): k is string => typeof k === 'string' && !!k)
    : []
  return keys.length ? { keys, now: {} } : null
}

// AND WHICH ROWS PAGE THE ALERT FLOOR, FOR THE SAME REASON AND ON THE SAME TERMS.
function keptFloorAlerts(): FloorBook {
  const kept = readKept<KeptSituations>(keptSituationsKey())
  const ids = kept && Array.isArray(kept.floorAlerts)
    ? kept.floorAlerts.filter((k): k is string => typeof k === 'string' && !!k)
    : []
  return ids.length ? { ids } : null
}

// The same 120s the Catalogue, the Guide and the Replies pages already give this door.
const DOOR_TIMEOUT_MS = 120_000
// THE PREVIEW IS A `cost: 'minutes'` READ AND IS GIVEN A MINUTES DEADLINE (review).
const PREVIEW_TIMEOUT_MS = 240_000

// The kept copy carries its own stamp — a floor that cannot say how old it is is not a floor, it is a claim.
type KeptSituations = { at: string; rows: Sit[]; keywords?: string[]; floorAlerts?: string[] }

// THE MINI CACHE, AND WHAT IT IS FOR.
type KeptTrail = { at: string; deliveries: Delivery[]; testMode: TestMode | null }
function keptTrailKey(): string { return keptSituationsKey() + ':trail' }

// THE LINES A TEXT MAY LEAVE FROM, as this browser last read them (`lineDirectory`) — only what the sender rule…
type LineBook = { at: string; lines: DeskLine[] }
function keptLinesKey(): string { return keptSituationsKey() + ':lines' }
function keptLines(): LineBook | null {
  const kept = readKept<LineBook>(keptLinesKey())
  return kept && Array.isArray(kept.lines) && kept.lines.length ? kept : null
}

// WHAT A CARD SAYS ABOUT ITS LAST SAVE.
type RowNote = { tone: 'refused' | 'waiting'; text: string }

// WHERE THE ROWS ON SCREEN CAME FROM, WHEN THE DOOR COULD NOT SAY — and the three are named apart because they are…
type Floor = { from: 'slice' | 'deposit' | 'kept'; ageMs: number | null; carried: boolean | null }

// What to CALL the floor, in one place, so no corner of the screen can name a file the rows did not come from.
function floorName(f: Floor): string {
  return f.from === 'slice' ? 'this platform’s last built copy'
    : f.from === 'deposit' ? 'the last deposit'
      : 'this browser’s kept copy'
}

// The age, and — for a carried-forward deposit tab — the fact that the age belongs to the build rather than to the…
function floorAge(f: Floor): string {
  const age = sinceMs(f.ageMs)
  if (f.from !== 'deposit') return age
  if (f.carried === true) return `${age} at the build, rows older`
  if (f.carried === null) return `${age} at the build, rows possibly older`
  return age
}

// THE BAND COLOUR IS NOT THIS PAGE'S BUSINESS ANY MORE (review).

/** The condition in plain words — "30 days before DODD 8-Hour expires". */
function describe(s: Sit): string {
  // One normaliser with kindOf: a cell holding ' bundle' must take the same branch here as it does in the grouping…
  const kind = kindOf(s)
  // THE BUNDLE SPECIES.
  if (kind === 'bundle') {
    const what = String(s.label || 'outstanding compliance items').trim()
    return `One message for everything still owed — ${what}. The obligations lane picks who and when.`
  }
  const days = String(s.days_before ?? '').trim()
  if (kind === 'digest') return `Weekly digest — everything past ${days || '?'} days`
  // THE MAILBOX SPECIES.
  if (kind === 'mailbox') {
    const heard = String(s.event ?? '') === 'no_call' ? 'No Show No Call' : 'Late Show'
    return `When the platform mailbox hears “${heard} — <person>”`
  }
  // THE AI SPECIES.
  if (kind === 'ai') {
    const model = String(s.ai_model ?? '').trim()
    const only = String(s.ai_providers ?? '').trim()
    return `The AI request — ${model ? `model ${model}` : 'the model the code ships'}` +
      (only ? `, only ${only}` : '') + '. The prompt stays in the code.'
  }
  if (kind === 'event') {
    // THE LADDER, AND IT ENDS WHERE IT USED TO BEGIN: the hand-written sentence, then the row's own label, then the…
    const label = String(s.label ?? '').trim()
    const base = EVENT_SENTENCE[sentenceKey(s)]
      ?? (label || `When "${s.event || s.id}" happens`)
    const wait = Number(days)
    return wait > 0 ? `${base}, then wait ${wait} day${wait === 1 ? '' : 's'}` : base
  }
  // AND THE COUNTDOWN BELONGS TO THE REMINDER ALONE.
  if (kind !== 'reminder') {
    const label = String(s.label ?? '').trim()
    return EVENT_SENTENCE[sentenceKey(s)] ?? (label || `When "${s.id}" happens`)
  }
  const what = String(s.credential || s.id.replace(/_expiring$/, '')).replace(/_/g, ' ')
  return `${days || '?'} days before ${what} expires`
}

function ago(iso: string): string {
  if (!iso) return 'never'
  return sinceMs(Date.now() - new Date(iso).getTime())
}

// THE SAME WORDS FOR AN AGE THAT ARRIVED AS A NUMBER.
function sinceMs(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) return 'an age this desk could not measure'
  if (ms < 0) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h ago`
  return `${(ms / 86_400_000).toFixed(1)}d ago`
}

/* ---------- the ladder ---------- */

/** One permission, said yes or no — never folded into the one beside it. */
function Permission({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <li className={cn('flex items-start gap-1.5 text-[11.5px] leading-[16px]', ok ? 'font-semibold text-text-1' : 'text-text-3')}>
      {ok ? <Check size={12} className="mt-0.5 shrink-0" /> : <X size={12} className="mt-0.5 shrink-0" />}
      <span>{ok ? yes : no}</span>
    </li>
  )
}

/** What a rung reads as in one word, with its three permissions in the title. */
function PriorityChip({ sit }: { sit: Sit }) {
  const r = priorityOf(sit)
  if (!r) {
    return (
      <span
        title="Unknown, not ask: the ladder could not be read just now, because the words book's Digest Settings (comm_priority_*) did not answer. Nothing here claims the floor as a reading."
        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-semibold leading-4 text-text-3"
      >
        priority —
      </span>
    )
  }
  return (
    <span
      title={`${r.why} · ${r.gap ? 'skips the pacing gap' : 'waits for the pacing gap'} · ` +
        `${r.sleep ? 'may wake somebody' : 'never wakes anybody — it waits out the quiet hours'} · ` +
        `${r.weekend ? 'may be said on a weekend' : 'holds over a weekend'} · ${r.cap}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4',
        TINT_BG[r.tint], TINT_FG[r.tint],
      )}
    >
      {r.id}
    </span>
  )
}

// WHETHER THIS ROW CAN SPEAK, ON THE CARD.
function WordsChip({ sit }: { sit: Sit }) {
  if (kindOf(sit) === 'ai') return null
  const w = wordsByChannel(sit)
  const on = sit.enabled === 'yes'
  if (!w.sms && !w.email) {
    return on ? (
      <span
        title="Switched on with every template blank. The one send door skips a channel whose words are empty, so this reaches nobody whatever the switch reads — write the SMS or the e-mail in Edit, or switch it back off."
        className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4', TINT_BG.peach, TINT_FG.peach)}
      >
        <AlertTriangle size={10} className="shrink-0" /> on · no words
      </span>
    ) : (
      <span
        title="No SMS and no e-mail written yet. That is how a situation ships: off and silent until somebody writes what it should say. Nothing is sent and nothing is claimed."
        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-semibold leading-4 text-text-3"
      >
        no words yet
      </span>
    )
  }
  const named = String(sit.channels ?? '').toLowerCase()
  const namedSms = named.includes('sms')
  const namedEmail = named.includes('email')
  // A ROW THAT NAMES NO CHANNEL IS NOT CLAIMING ONE.
  if (!namedSms && !namedEmail) return null
  const blank = [namedSms ? 'sms' : '', namedEmail ? 'e-mail' : ''].filter(Boolean)
  const has = [namedSms && w.sms ? 'sms' : '', namedEmail && w.email ? 'e-mail' : ''].filter(Boolean)
  if (has.length) {
    // ON AND WRITTEN, SAID OUT LOUD — and only where EVERY channel the row names carries words, so the half-written…
    if (!on || has.length < blank.length) return null
    return (
      <span
        title={`Switched on and written on ${has.join(' and ')} — ${has.length === 1 ? 'the channel it names' : 'every channel it names'}. So this row has something to say the next time it fires, and the one send door will render it. What still stands between these words and a phone is the sending dial, test mode and the opt-out list — not this card.`}
        className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4', TINT_BG.mint, TINT_FG.mint)}
      >
        <Check size={10} className="shrink-0" /> on · written
      </span>
    )
  }
  return (
    <span
      title={`It names ${blank.join(' and ')} and has nothing written there. The words it does carry are on a channel it does not name, and the send door puts the lane's own channel ahead of this cell — so words somebody WROTE there can still leave. The one exception is the generic credential letter the old mapper planted in these rows: every door now refuses that one by name, so it cannot leave at all. Read what is in there before switching this on.`}
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4', TINT_BG.peach, TINT_FG.peach)}
    >
      <AlertTriangle size={10} className="shrink-0" /> blank on {blank.join(' and ')}
    </span>
  )
}

// `AddressChip`, `AudienceChip` and `AudienceLine` live in ./toAddress with the predicate they share: the card, the…

/* ---------- what this desk says about itself ---------- */

// ONE LAW THIS DESK KEEPS ABOUT ITS OWN NUMBERS, WRITTEN WHERE IT IS READ.
function Rule({ tint, label, children }: { tint: TintName; label: string; children: ReactNode }) {
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2.5" style={{ borderLeft: `3px solid ${TINT_VAR[tint]}` }}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</p>
      <p className="mt-1 text-[12.5px] leading-[1.5] text-text-2">{children}</p>
    </div>
  )
}

// ONE ROW OF THE PROVENANCE TABLE.
function Source({ what, count, from, unread }: { what: string; count: string; from: string; unread?: boolean }) {
  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="py-2 pl-4 pr-3 text-[12.5px] leading-[1.45] text-text-2">{what}</td>
      <td className={cn('whitespace-nowrap py-2 pr-3 text-right font-stat text-[12.5px]', unread ? 'text-text-3' : 'text-text-1')}>
        {count}
      </td>
      <td className="break-all py-2 pr-4 font-mono text-[11px] leading-[1.45] text-text-3">{from}</td>
    </tr>
  )
}

/* ---------- the editor drawer ---------- */

// WHAT THE PLATFORM MADE OF THE HOURS, beside the cell they are typed into.
function HoursNote({ hours, typed }: { hours: ScheduleFact | null; typed: string }) {
  if (!hours) {
    return typed.trim() ? (
      <p className="mt-1 text-[11.5px] leading-[17px] text-text-3">
        This desk was not told how the platform reads these hours — the backend it asked
        does not carry that answer yet, so nothing here says whether they are kept.
      </p>
    ) : null
  }
  const kept = hours.hours ?? []
  const bad = hours.unreadable ?? []
  return (
    <p className="mt-1 text-[11.5px] leading-[17px] text-text-3">
      {hours.honored === false ? (
        <>
          This one is <span className="font-semibold text-text-2">sent the moment it happens</span>,
          by its own lane — hours typed here hold nothing back.
        </>
      ) : kept.length ? (
        <>
          Kept: <span className="font-semibold text-text-2">{kept.join(', ')}</span> — each hour is
          its own telling, so this goes {kept.length}× a day.
          {hours.next ? ` Next at ${hours.next}.` : ''}
        </>
      ) : (
        'No hours kept: it speaks whenever its sweep passes.'
      )}
      {bad.length ? (
        <span className="font-semibold text-text-2">
          {' '}“{bad.join('”, “')}” could not be read as a time — the save refuses it.
        </span>
      ) : null}
    </p>
  )
}

// WHAT THE PLATFORM WOULD REFUSE IN THIS ROW AS IT STANDS — on the card, with what it accepts instead.
export function StoredFix({ sit, book, lines, hours, onEdit }: {
  sit: Sit; book: KeywordBook | null; lines: DeskLine[] | null; hours: ScheduleFact | null; onEdit: () => void
}) {
  const fixes: ReactNode[] = []
  const to = readRowAddresses(sit.to, sit.cc, book).to
  if (to.reachesNobody) {
    fixes.push(
      <>
        <span className="font-semibold">Goes to</span> holds {to.dead.map((w) => `“${w}”`).join(', ')}, which reaches
        nobody — allowed: numbers with all ten digits, e-mails with their own domain
        {book && book.keys.length ? `, or ${book.keys.join(', ')}` : ''}. Clear it, or write who it should reach.
      </>,
    )
  }
  const from = String(sit.from_line ?? '').trim()
  const sender = from && lines && lines.length ? readSenderLine(from, lines) : null
  if (sender && !sender.ok) {
    fixes.push(
      <>
        <span className="font-semibold">Sends from</span> holds “{from}”, which is not one of our lines — allowed:{' '}
        {senderNames(lines ?? []).join(', ')}, or blank for Automations.
      </>,
    )
  }
  const badHours = hours?.unreadable ?? []
  if (badHours.length) {
    fixes.push(
      <>
        <span className="font-semibold">Send at</span> holds “{badHours.join('”, “')}”, which is not a time of day —
        write times like 09:00, 13:00, or leave it blank.
      </>,
    )
  }
  if (!fixes.length) return null
  return (
    <div className={cn('mt-2.5 rounded-md px-3 py-2 text-[11.5px] leading-[17px]', TINT_BG.peach, TINT_FG.peach)}>
      <p className="font-semibold">
        To fix — the platform refuses to save {fixes.length === 1 ? 'this cell as it stands' : 'these cells as they stand'}:
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {fixes.map((f, i) => <li key={i}>{f}</li>)}
      </ul>
      <p className="mt-1">
        The switch still works — it writes only whether the row is on.{' '}
        <button type="button" onClick={onEdit} className="font-semibold underline underline-offset-2">Fix it in Edit</button>
      </p>
    </div>
  )
}

/** The last save of a row, as the platform answered it: refused with its words, or sent and not yet confirmed. */
function RowNoteLine({ note, onDismiss }: { note: RowNote; onDismiss: () => void }) {
  const refused = note.tone === 'refused'
  return (
    <div
      role={refused ? 'alert' : 'status'}
      className={cn('mt-2.5 flex items-start gap-2 rounded-md px-3 py-2 text-[11.5px] leading-[17px]',
        refused ? cn(TINT_BG.pink, TINT_FG.pink) : 'bg-tint-amber text-tint-fg-amber')}
    >
      <AlertTriangle size={12} className="mt-[2px] shrink-0" />
      <p className="min-w-0 flex-1">
        {refused && <span className="font-semibold">Not saved — </span>}
        {note.text}
      </p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 rounded-sm px-0.5 hover:opacity-70">
        <X size={12} />
      </button>
    </div>
  )
}

// THE LINE A TEXT LEAVES FROM, CHOSEN FROM OUR LINES.
function SenderSelect({ value, lines, onChange }: { value: string; lines: DeskLine[]; onChange: (v: string) => void }) {
  const options = senderOptions(lines)
  const choice = senderChoice(value, lines)
  const stray = choice === null ? String(value).trim() : ''
  return (
    <select
      value={choice ?? `stray:${stray}`}
      onChange={(e) => onChange(e.target.value.startsWith('stray:') ? stray : e.target.value)}
      className={INPUT}
    >
      <option value="">Automations — the default line (blank)</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      {stray ? <option value={`stray:${stray}`}>“{stray}” — not one of our lines</option> : null}
    </select>
  )
}

/** What the platform makes of the word in Sends from, beside the cell — and what it accepts instead. */
function SenderNote({ value, lines }: { value: string; lines: DeskLine[] | null }) {
  const v = String(value ?? '').trim()
  if (!v) {
    return (
      <p className="mt-1 text-[11.5px] leading-[17px] text-text-3">
        Blank: texts leave from the Automations line (…5558), as every text always has.
      </p>
    )
  }
  const read = lines && lines.length ? readSenderLine(v, lines) : null
  if (read && !read.ok) {
    return (
      <p className={cn('mt-1 text-[11.5px] font-semibold leading-[17px]', TINT_FG.peach)}>
        Not a line of ours: {read.why}. The platform refuses to save it. Choose one of our lines
        ({senderNames(lines ?? []).join(', ')}) or Automations.
      </p>
    )
  }
  return (
    <p className="mt-1 text-[11.5px] leading-[17px] text-text-3">
      Texts from this row leave from{' '}
      <span className="font-semibold text-text-2">{formatPhoneDisplay(v)}</span>{' '}
      — replies go to that line’s inbox — whenever the lane sending it names this row. Several
      hiring texts (outreach, interviews, screening, the Ready to Start notes) and the invitations do
      not name their rows yet, and leave from Automations whatever this cell says.
      {!read && ' Our lines were not read this visit, so the platform judges this word when you save: a line’s role, its name or its number — never an e-mail address.'}
    </p>
  )
}

function SituationEditor(
  { sit, book, floors = null, team = null, seen = 'unread', reach = null, sentBy = null,
    hours = null, lines = null, oldRows = null, onClose, onSaved }:
  { sit: Sit; book: KeywordBook | null; floors?: FloorBook; team?: TeamFloor
    seen?: FloorSeen; reach?: ReachBook; sentBy?: LegacySender | null
    hours?: ScheduleFact | null
    /** our lines, as `lineDirectory` answered them; null while this desk has not read them */
    lines?: DeskLine[] | null
    /** the floor this row was drawn from when it is not today's read, and whether that read is still out */
    oldRows?: { floor: Floor; reading: boolean } | null
    onClose: () => void
    /** the cells the platform took, and whether it answered for them or only the relay did */
    onSaved: (patch: RowPatch, heard: 'saved' | 'waiting') => void },
) {
  const [d, setD] = useState<Sit>({ ...sit })
  const [saving, setSaving] = useState(false)
  /** the platform's refusal, kept in the panel beside the cells it names until the next save */
  const [saveError, setSaveError] = useState('')
  const set = (k: string, v: string) => setD((s) => ({ ...s, [k]: v }))
  const isEvent = kindOf(sit) === 'event'
  // AN AI ROW IS NOT A MESSAGE, so it must not be edited as one.
  const isAi = kindOf(sit) === 'ai'
  // A BUNDLE IS NOT PACED FROM THIS ROW (review).
  const isBundle = kindOf(sit) === 'bundle'
  // WHAT IS IN THOSE TWO CELLS, READ AGAINST THE PLATFORM'S REGISTRY.
  const read = readRowAddresses(d.to, d.cc, book)
  const strayTo = read.to.dead
  const strayCc = read.cc.dead
  const floor = readFloor(sit.id, floors)

  const save = async () => {
    // ONLY THE CELLS THIS SAVE CHANGES ARE SENT (deskWrites).
    const patch = rowPatch(sit, d)
    const cells = patchCells(patch)
    if (!cells.length) {
      toast({ type: 'info', title: 'Nothing to save', body: 'No cell was changed, so nothing was written.' })
      onClose()
      return
    }
    const wroteTo = cells.includes('to')
    const wroteCc = cells.includes('cc')
    const blocked = [wroteTo && read.to.reachesNobody ? 'Goes to' : '', wroteCc && read.cc.reachesNobody ? 'Also copied' : '']
      .filter(Boolean)
    const deadNow = (wroteTo ? read.to.dead : []).concat(wroteCc ? read.cc.dead : [])
    const misplacedNow = (wroteTo ? read.to.misplaced : []).concat(wroteCc ? read.cc.misplaced : [])
    // THE CELL IS EDITED HERE, SO IT IS ASKED HERE — BUT THE PLATFORM ANSWERS.
    if (blocked.length) {
      const one = deadNow.length === 1
      const body = [
        `${blocked.join(' and ')} ${blocked.length === 1 ? 'reaches' : 'reach'} nobody: `,
        `Goes to and Also copied carry addresses written out — an e-mail with its own domain, or a number with all ten of its digits${book && book.keys.length ? `, or a keyword the platform resolves (${book.keys.join(', ')})` : ''}. A word that is neither stands for nothing here: it reaches nobody and nothing says so afterwards. A half-written one — an extension, a number missing digits, an address with no domain — is refused by the platform too, so it is refused here, where you can still fix it. Clearing the cell is allowed.`,
        misplacedNow.length
          ? ` “${misplacedNow.join('”, “')}” is a keyword this platform resolves, but only in Goes to — every door that sends a copy splits that cell into e-mails and numbers, so a keyword there reaches nobody.`
          : '',
      ].filter(Boolean).join('')
      setSaveError(body)
      toast({ type: 'warning', title: one ? `“${deadNow[0]}” is not an address` : 'Those are not addresses', body })
      return
    }
    // THE LINE IS ASKED HERE TOO, by the door's own rule, when this desk holds our lines; without them the platform…
    if (cells.includes('from_line') && lines && lines.length) {
      const sender = readSenderLine(d.from_line, lines)
      if (!sender.ok) {
        const body = `Sends from: ${sender.why}. Choose one of our lines (${senderNames(lines).join(', ')}), or leave it blank to send from Automations.`
        setSaveError(body)
        toast({ type: 'warning', title: 'Not a line of ours', body })
        return
      }
    }
    setSaving(true)
    setSaveError('')
    try {
      const data = await gasAction<unknown>('smartCommsSet', { rows: [patch] })
      // THE RELAY'S WORD IS NOT THE PLATFORM'S.
      const heard = isRelayReceipt(data) ? 'waiting' : 'saved'
      if (heard === 'waiting') {
        toast({
          type: 'warning',
          title: `${sit.id}: sent, not confirmed yet`,
          body: 'The platform has not confirmed this save yet. The next read of the situations shows whether it landed.',
        })
      } else if (deadNow.length) {
        // A DEAD WORD THAT DID NOT STOP THE SAVE STILL HAS TO BE SAID, and only once the save actually landed.
        const one = deadNow.length === 1
        toast({
          type: 'warning',
          title: `Saved — “${deadNow.join('”, “')}” ${one ? 'reaches' : 'reach'} nobody`,
          body: `The rest of the cell is addressed, so the row was saved as written. ` +
            `${one ? 'That entry is' : 'Those entries are'} neither an address nor a keyword ` +
            `this platform resolves, so ${one ? 'it adds' : 'they add'} nobody to who hears this.`,
        })
      } else {
        toast({ type: 'success', title: 'Saved — Settings shows the same.' })
      }
      onSaved(patch, heard)
      onClose()
    } catch (err) {
      if (confirmationLost(err)) {
        toast({ type: 'warning', title: `${sit.id}: sent, not confirmed yet`,
          body: 'The platform took this save, but its answer was lost on the way back. The next read of the situations shows it.' })
        onSaved(patch, 'waiting')
        onClose()
        return
      }
      // the platform's refusal stays in the panel, beside the cells it names, with what was typed
      const why = err instanceof Error ? err.message : String(err)
      setSaveError(why)
      toast({ type: 'danger', title: 'Not saved', body: why })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SidePanel
      open
      onClose={onClose}
      label="Situation"
      title={sit.id}
      footer={
        <>
          {saveError && (
            <p role="alert" className={cn('mb-3 rounded-md px-3 py-2 text-[11.5px] leading-[17px]', TINT_BG.peach, TINT_FG.peach)}>
              <span className="font-semibold">Not saved — </span>{saveError}
            </p>
          )}
          <button onClick={() => void save()} disabled={saving}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Save situation
          </button>
          <p className="mt-2 text-center text-[11px] text-text-3">
            Writes only the cells you changed, into the same tab the Settings screen edits — one truth, two doors.
          </p>
        </>
      }
    >
        <p className="mb-4 mt-0.5 text-[12px] text-text-3">{describe(sit)}</p>
        {/* OLD ROWS ARE EDITABLE NOW, AND SAY SO. A save writes only the cells
            it changes, so a row drawn from the last reading can be fixed while
            the read is still out — what it cannot do is vouch for the cells
            nobody touched, and those are left exactly as the tab holds them. */}
        {oldRows && (
          <p className="mb-4 rounded-md bg-tint-amber px-3 py-2 text-[11.5px] leading-[17px] text-tint-fg-amber">
            {oldRows.reading
              ? 'The situations are still being read, so this row is the last reading this desk held'
              : 'The situations did not come back, so this row is the last reading this desk held'}{' '}
            ({floorName(oldRows.floor)}, {floorAge(oldRows.floor)}). A save writes only the cells you change, over
            whatever the tab holds now; every other cell stays exactly as the tab has it.
          </p>
        )}

        {/* WHAT THE LANE SAYS ABOUT THIS ROW — AND WHICH PLACEHOLDERS IT CAN
            ACTUALLY FILL.
            The `note` column is written by the lane that fires the row and it
            is the only place that says which words in a template resolve: the
            blast's own note says {employee} {date} {reason} {house} resolve,
            that {time} does not because no shift start is readable, and that
            the street address never will — a house code stands 1:1 with a
            client's address. These words are written by hand against that
            documentation, which was promised "in the note the Desk shows"
            and appeared nowhere. A placeholder nobody is told about is a
            template that ships with a word in it that never fills in.
            Read-only here: it describes what the code does, and is not one of
            the cells this drawer edits. */}
        {/* AND THE LANE'S OWN ANSWER STANDS ABOVE THAT NOTE, NOT UNDER IT.
            The note is a cell in the row, so a row ALREADY in the tab keeps
            whatever note it arrived with: `call_off_cover_offer` still carries
            one written for a design that was never built, ending "it cannot
            fire today", on a row that now fires — and no seeding law may
            rewrite a note somebody might have edited by hand. So who this
            row's sender actually reaches is drawn FIRST, read from the sender,
            and a stale note can no longer be the last word about it. */}
        <SenderReachLine sit={d} reach={reach} sentBy={sentBy} />
        {String(sit.note ?? '').trim() && (
          <div className="mb-4 rounded-md border border-border bg-surface-2 px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
              What this row is, and what it can fill in
            </p>
            <p className="mt-1 whitespace-pre-line text-[11.5px] leading-[17px] text-text-2">{sit.note}</p>
            {SENDER_REACH[sit.id] ? (
              <p className="mt-1.5 text-[11px] leading-4 text-text-3">
                Written into the row by the lane, and a row already in this tab keeps the note it
                arrived with. Where this disagrees with <span className="font-semibold text-text-2">
                Who this row’s own sender reaches</span> above, that line is the newer reading — it
                comes from the sender, this comes from the cell.
              </p>
            ) : null}
          </div>
        )}

        <div className="space-y-3">
          <label className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2">
            <span className="text-[12.5px] font-semibold text-text-2">Enabled</span>
            <Switch checked={d.enabled === 'yes'} onCheckedChange={(c) => set('enabled', c ? 'yes' : 'no')} />
          </label>

          {isAi ? (
            <>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-text-2">Model</span>
                <input
                  value={d.ai_model ?? ''}
                  onChange={(e) => set('ai_model', e.target.value)}
                  placeholder="groq=openai/gpt-oss-120b, openai=gpt-4o-mini"
                  className={INPUT}
                />
                {/* BLANK IS AN ANSWER HERE, and the field says so — somebody
                    clearing this cell is asking for the code's own name back,
                    not asking for no model at all. */}
                <span className="mt-1 block text-[11px] leading-4 text-text-3">
                  <span className="font-semibold text-text-2">A model belongs to a provider, not to the ladder.</span>{' '}
                  One bare name is sent to <em>every</em> provider, and they do not share a catalogue —
                  so <code>groq=openai/gpt-oss-120b</code> is usually what you want. Keys: a rung's own
                  name (<code>groq2</code>), a host (<code>groq</code>), or a bare name as the default.
                  Empty means the code decides, exactly as before. Guardian →{' '}
                  <span className="font-semibold">Test the AI lane</span> lists what each provider serves.
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-text-2">Only these providers</span>
                <input
                  value={d.ai_providers ?? ''}
                  onChange={(e) => set('ai_providers', e.target.value)}
                  placeholder="blank = the whole ladder, in its own order"
                  className={INPUT}
                />
                <span className="mt-1 block text-[11px] leading-4 text-text-3">
                  A narrowing, never a reordering: the ladder tries the oldest key first because that
                  is what has been answering. Naming some only says who may be asked at all.
                </span>
              </label>
              <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[11.5px] leading-[17px] text-text-3">
                The <span className="font-semibold text-text-2">prompt is not here</span>. It is what the
                analysis asks — not how it is asked — and it lives in the code, where a change is reviewed.
                This row carries only the request.
              </p>
              <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
                {/* THE TEST LIVES WHERE THE MODEL IS EDITED.
                    Changing a model and then walking to another screen to find out
                    whether it took is how somebody stops checking. */}
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                  Does it answer?
                </p>
                <AiLaneTest compact />
              </div>
            </>
          ) : (
          <>
          {/* WHERE THE PRIORITY IS DECIDED, since it is not decided here. The
              row has no priority column and the drawer must not grow a control
              that writes one — the membership is the words book's
              comm_priority_* rows, resolved by the lane and only shown here. */}
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <PriorityChip sit={d} />
            <p className="mt-1.5 text-[11.5px] leading-[17px] text-text-3">
              What this may cost the person — set in the policy book, not on this row. It paces the
              message; it never opens a door the dial and the opt-out list keep shut.
            </p>
          </div>
          {isBundle && (
            <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[11.5px] leading-[17px] text-text-3">
              <span className="font-semibold text-text-2">The obligations lane paces this one.</span>{' '}
              It picks who is owed what and when to say it, and fills the items into the message at
              send time — so there is no “days before”, no attempt ceiling and no frequency to set
              here. What you edit below is the wording and the channels.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            {!isBundle && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-text-2">{isEvent ? 'Wait days first' : 'Days before'}</span>
                <input value={d.days_before ?? ''} onChange={(e) => set('days_before', e.target.value)} className={INPUT} />
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-text-2">Channels</span>
              <input value={d.channels ?? ''} onChange={(e) => set('channels', e.target.value)} placeholder="sms, email" className={INPUT} />
            </label>
            {!isBundle && (
              <>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-text-2">Max # of attempts</span>
                  <input type="number" min={1} value={d.max_attempts ?? '1'} onChange={(e) => set('max_attempts', e.target.value)} className={INPUT} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-text-2">Frequency</span>
                  <select value={d.frequency || 'once'} onChange={(e) => set('frequency', e.target.value)} className={INPUT}>
                    <option value="once">Once</option>
                    <option value="daily">Daily</option>
                    <option value="every_other_day">Every other day</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
              </>
            )}
          </div>
          {/* THE HOURS OF THE DAY. Frequency could only
              ever say how many DAYS apart two tellings were, so "say it at
              nine, again at one, and again at five" had no cell to live in.
              Each hour here is its own occasion: the same message goes three
              times in a day and none of the three repeats. Blank is exactly
              what every row does today. */}
          {!isBundle && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-text-2">
                Send at — hours of the day (blank: whenever the sweep passes)
              </span>
              <input
                value={d.send_at ?? ''}
                onChange={(e) => set('send_at', e.target.value)}
                placeholder="09:00, 13:00, 17:00"
                className={INPUT}
              />
              <HoursNote hours={hours} typed={d.send_at ?? ''} />
            </label>
          )}
          {/* THE ROW'S OWN SHEET — the sheet is created first and the row
              switched back on afterwards. Name a house and this
              row's messages are WRITTEN there and reach nobody — the dial, one
              row at a time. It is here rather than in a spreadsheet because
              the afternoon this was needed, the only way to set it was to open
              the situations tab and find a column by eye. */}
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">
              Writes into (a sheet of its own, instead of sending)
            </span>
            <input
              value={d.record_to ?? ''}
              onChange={(e) => set('record_to', e.target.value)}
              placeholder="blank: it sends · a house name: it only writes"
              className={INPUT}
            />
            <p className="mt-1 text-[11.5px] leading-[17px] text-text-3">
              {String(d.record_to ?? '').trim()
                ? <>Every message from this row is written into{' '}
                    <span className="font-semibold text-text-2">{String(d.record_to).trim()}</span>{' '}
                    and reaches nobody — the switch above can stay on.</>
                : 'Blank: this row sends, and the platform-wide brakes decide whether anything leaves.'}
            </p>
          </label>
          {/* the line a text leaves from (Rpc.gs rpcSituationLine_); replies land there — chosen from our lines
              when this desk holds them, typed when it does not, and judged by the door's own rule either way */}
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">
              Sends from (a line of ours — texts only, never an e-mail address)
            </span>
            {lines && lines.length ? (
              <SenderSelect value={d.from_line ?? ''} lines={lines} onChange={(v) => set('from_line', v)} />
            ) : (
              <input
                value={d.from_line ?? ''}
                onChange={(e) => set('from_line', e.target.value)}
                placeholder="blank: Automations · or a line’s role, name or number (Administration)"
                className={INPUT}
              />
            )}
            <SenderNote value={d.from_line ?? ''} lines={lines} />
          </label>
          {/* THE LABEL USED TO OFFER THE KEYWORD IT HAD ALREADY LOST, and then
              it refused the one that replaced it. `team` was taken out of the
              lane — it resolved to a floor list built from our own lines and
              then filtered by the rule that refuses our own lines — and this
              field went on teaching people to type it; `hotline_call_off` is
              addressed to that word to this day, and the word adds nobody to
              the alert its lane sends anyway (FloorNote, below).
              What stands in its place is not "no keywords at
              all": `allstaff` is a word the backend RESOLVES and can count, so
              the field names whatever the platform answers for, from the
              registry, and refuses the rest. */}
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">
              Goes to (numbers and e-mails, or a keyword the platform resolves)
            </span>
            <input
              value={d.to ?? ''}
              onChange={(e) => set('to', e.target.value)}
              placeholder="numbers and e-mails, separated by commas"
              className={INPUT}
            />
            <KeywordHint book={book} />
            {/* AND WHETHER THIS CELL IS THE AUDIENCE AT ALL. On a row whose
                lane pages the alert floor it is not: the alert reaches the
                recipients in Settings whatever stands here, and this cell only
                ADDS to them. It is said beside the cell, because this is where
                somebody decides what to type into it — and could otherwise
                conclude that emptying it silences the row. */}
            <FloorNote floor={floor} team={team} seen={seen} />
            {/* WHO THE KEYWORD IS, AND HOW MANY — beside the cell it is typed
                in. The blast is the one row nobody should arm without being
                told the size of it first. It is handed the floor for the same
                reason the note above is: a row whose alert goes out through
                the team list takes this cell as extra numbers, so a keyword
                there adds nobody and its head-count is a number about the
                keyword rather than about this row. */}
            <AudienceNote to={d.to} book={book} floor={floor} />
            {strayTo.length > 0 && (
              <span className={cn('mt-1 block text-[11px] leading-4 font-semibold', TINT_FG.peach)}>
                {strayTo.map((w) => `“${w}”`).join(', ')} {strayTo.length === 1 ? 'is' : 'are'} neither an address
                nor a keyword this platform resolves — {strayTo.length === 1 ? 'it reaches' : 'they reach'} nobody
                {/* ON A FLOOR ROW THE WORD COSTS THE ADDITION, NOT THE ALERT:
                    the note above says who hears it anyway, and this must not
                    read as "so nothing goes out". */}
                {floor === 'pages' ? ', so it adds nobody to the alert above' : ''}.
                {read.to.reachesNobody
                  ? ' The platform refuses to save this cell as it stands — clear it, or write the numbers and e-mails it should reach.'
                  : ''}
              </span>
            )}
            {read.to.unverified.length > 0 && (
              <span className="mt-1 block text-[11px] leading-4 text-text-3">
                {read.to.unverified.map((w) => `“${w}”`).join(', ')} could not be checked: this desk was not told
                which keywords the platform resolves. The platform refuses a word it cannot resolve when you save.
              </span>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">Also copied (cc)</span>
            <input value={d.cc ?? ''} onChange={(e) => set('cc', e.target.value)} className={INPUT} />
            {strayCc.length > 0 && (
              <span className={cn('mt-1 block text-[11px] leading-4 font-semibold', TINT_FG.peach)}>
                {strayCc.map((w) => `“${w}”`).join(', ')} {strayCc.length === 1 ? 'is' : 'are'} neither an e-mail
                nor a number — {strayCc.length === 1 ? 'it reaches' : 'they reach'} nobody.
                {read.cc.misplaced.length > 0 && (
                  <> A keyword is resolved in <span className="font-semibold">Goes to</span> only: every door that
                  sends a copy splits this cell into e-mails and numbers.</>
                )}
              </span>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">SMS</span>
            <textarea rows={4} value={d.sms_text ?? ''} onChange={(e) => set('sms_text', e.target.value)} className={AREA} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">E-mail subject</span>
            <input value={d.email_subject ?? ''} onChange={(e) => set('email_subject', e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">E-mail</span>
            <textarea rows={4} value={d.email_text ?? ''} onChange={(e) => set('email_text', e.target.value)} className={AREA} />
          </label>
          </>
          )}
        </div>
    </SidePanel>
  )
}

/* ---------- the doors that reach the world without a word ---------- */

// THE GATE BOARD.
export function GateBoard({ gates, letters, reading = false, readError = '', refused = false }: {
  gates: GatesRead | null
  letters: AuthLetterFact[] | null
  /** the situations read these ride is still in flight */
  reading?: boolean
  /** why the last situations read failed; '' once one has landed */
  readError?: string
  /** the situations read was refused for this account */
  refused?: boolean
}) {
  const laneWord = gates ? String(gates.lane || '').trim().toLowerCase() : ''
  // ONLY A STATED OFF IS OFF.
  const holding = Boolean(gates) && laneWord !== 'off'
  // A READ THAT HAS NOT LANDED, OR DID NOT COME BACK, IS NOT A READ THAT LANDED WITHOUT THE KEY: "not told" is said…
  const unread: 'refused' | 'reading' | 'failed' | '' =
    refused ? 'refused' : reading ? 'reading' : readError ? 'failed' : ''
  return (
    <div className="mt-8">
      <h2 className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
        <ShieldAlert size={14} className={cn('shrink-0', TINT_FG.amber)} />
        Doors that reach the world without saying a word
      </h2>
      <p className="mb-3 max-w-[78ch] text-[12px] leading-[18px] text-text-3">
        A grant on a document, a file published to anyone with the link, a row written into a live
        workbook. None of these is a message, so none of them was ever on this desk — and none of
        them asked the switch either. Each one is a situation now, with its own switch.{' '}
        <span className="font-semibold text-text-1">Every one of them arrives off</span>: off is the
        platform exactly as it stands, and arming one is a decision made here, one door at a time.
      </p>

      {!gates ? (
        <Card className="p-4">
          <p className="text-[12.5px] leading-[18px] text-text-3">
            {unread === 'refused'
              ? <><span className="font-semibold text-text-1">This desk was refused.</span>{' '}
                The situations read was declined for this account, so which doors are armed is not
                shown here{readError ? ` — ${readError}` : ''}. It is not an all-clear.</>
              : unread === 'reading'
                ? <>Reading the doors…</>
                : unread === 'failed'
                  ? <><span className="font-semibold text-tint-fg-peach">The situations read failed</span>, so
                    which doors are armed is unknown — {readError}. It is not an all-clear.</>
                  : <><span className="font-semibold text-text-1">This desk was not told.</span>{' '}
                    The read it makes did not carry the gates, so this screen cannot say on its own which
                    doors are governed. It is not an all-clear.</>}
          </p>
        </Card>
      ) : (
        <>
          {unread === 'failed' && (
            <p className="mb-2 max-w-[78ch] text-[12px] leading-[18px] text-tint-fg-peach">
              The latest situations read failed ({readError}), so this board is the one this desk last read.
            </p>
          )}
          <p className="mb-3 text-[12px] leading-[18px] text-text-3">
            {laneWord === 'unreadable'
              ? <><span className="font-semibold text-tint-fg-peach">The send switch could not be read.</span>{' '}
                An unreadable switch HOLDS — it is not an off switch — so every armed door below is
                holding right now, and every held row says why.</>
              : laneWord === 'holding'
                ? <>The send switch is on, so every armed door below is holding right now.</>
                : laneWord === 'off'
                  ? <>The send switch is off. Nothing below is holding, whatever it is armed to do.</>
                  : <><span className="font-semibold text-tint-fg-peach">This desk was not told the state of the send switch</span>
                    {laneWord ? ` (the read said “${laneWord}”)` : ''}. A switch nobody named is not an off
                    switch, so every armed door below is treated as holding.</>}
          </p>
          {/* WHEN A SWITCH ACTS — the backend's words, so a switch that has not
              taken effect yet is never mistaken for one that does nothing. */}
          {gates.lag && (
            <p className="-mt-1 mb-3 max-w-[78ch] text-[11.5px] leading-[17px] text-text-3">{gates.lag}</p>
          )}
          <Card padded={false} className="overflow-hidden">
            <ul className="divide-y divide-border">
              {gates.gates.map((g) => {
                // A SWITCH NOTHING ASKS MUST NEVER LOOK ARMED.
                const unwired = g.wired === false
                return (
                  <li key={g.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[12.5px] font-semibold text-text-1">{g.label}</span>
                      <Badge label={g.armed ? 'armed' : 'off'} tint={g.armed ? 'blue' : 'mint'} />
                      {g.armed && holding && !unwired && <Badge label="holding now" tint="amber" />}
                      {unwired && <Badge label="not wired in this build" tint="peach" />}
                      {g.relay && <Badge label="lane" tint="lavender" />}
                      {g.person && <Badge label="reaches a person" tint="pink" />}
                      {!g.known && <Badge label="row not planted yet" tint="peach" />}
                    </div>
                    <p className="mt-1 text-[11.5px] leading-[17px] text-text-3">
                      <span className="font-semibold text-text-2">Reaches:</span> {g.reaches}
                    </p>
                    <p className="mt-0.5 text-[11.5px] leading-[17px] text-text-3">
                      <span className="font-semibold text-text-2">Holding it costs:</span> {g.costs}
                    </p>
                    {unwired && (
                      <p className={cn('mt-0.5 text-[11.5px] leading-[17px] font-semibold', TINT_FG.peach)}>
                        Nothing asks this switch yet: {g.wired_why || 'the door that asks it is not in the published build'}.
                      </p>
                    )}
                    {g.caveat && (
                      <p className={cn('mt-0.5 text-[11.5px] leading-[17px]', TINT_FG.peach)}>{g.caveat}</p>
                    )}
                    {g.person && (
                      <p className="mt-0.5 text-[11px] leading-[16px] text-text-3">
                        If the situations tab cannot be read, this door holds while the send switch holds —
                        nobody can say it is not armed.
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] leading-[16px] text-text-3">
                      <code>{g.id}</code> — the switch is the situation of that name, in the tab below.
                    </p>
                  </li>
                )
              })}
            </ul>
          </Card>
        </>
      )}

      {/* ─────────────────────────────────────────────────────────────────
          AND THE LETTERS THAT LEAVE WHILE EVERYTHING ELSE IS HELD.
          This is an exception, and an exception nobody can see is one nobody
          can revisit — so it is drawn, named, and switchable in the one
          direction that stops it.
          ───────────────────────────────────────────────────────────────── */}
      <h3 className="mb-1 mt-6 text-[12.5px] font-semibold text-text-2">
        The letters that leave while the lane is holding
      </h3>
      {!letters ? (
        <p className="text-[12px] leading-[18px] text-text-3">
          {unread === 'refused'
            ? <><span className="font-semibold text-text-1">This desk was refused</span>, so which letters
              carry the exemption is not shown here. It is not a claim that none do.</>
            : unread === 'reading'
              ? <>Reading the letters…</>
              : unread === 'failed'
                ? <><span className="font-semibold text-tint-fg-peach">The situations read failed</span>, so
                  which letters carry the exemption is unknown — {readError}. It is not a claim that none do.</>
                : <><span className="font-semibold text-text-1">This desk was not told</span> which letters
                  carry the exemption. It is not a claim that none do.</>}
        </p>
      ) : (
        <>
          <p className="mb-3 max-w-[78ch] text-[12px] leading-[18px] text-text-3">
            A person locked out of the platform cannot be helped by a letter sitting in a mockup, so
            these are delivered for real even while everything else is held — and the row in the
            outbox <span className="font-semibold text-text-1">says so out loud</span>, every time.
            Switch one off here and it does not send at all: the switch beats the exemption, and the
            dial does not. If the situations tab cannot be read, the letter is held and the log says
            why. The link a letter carries never reaches the outbox row.
          </p>
          <Card padded={false} className="overflow-hidden">
            <ul className="divide-y divide-border">
              {letters.map((l) => (
                <li key={l.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[12.5px] font-semibold text-text-1">{l.label || l.kind.replace(/_/g, ' ')}</span>
                    <Badge label={l.on ? 'on' : 'off — does not send at all'}
                      tint={l.on ? 'green' : 'peach'} />
                    {l.on && holding && <Badge label="delivered while the lane holds" tint="amber" />}
                    {!l.known && <Badge label="row not planted yet" tint="peach" />}
                    <code className="text-[11px] text-text-3">{l.id}</code>
                  </div>
                  {/* WHERE THE WORDS LIVE, said rather than implied: the Desk
                      must never show words that are not the words sent. */}
                  <p className="mt-1 text-[11.5px] leading-[17px] text-text-3">
                    {l.email_words === 'template'
                      ? 'The e-mail is a designed letter whose words are not in this row; the SMS copy is this row’s words, and the dial holds it like any text.'
                      : l.email_words === 'row'
                        ? 'The e-mail’s subject and words are this row’s cells, in both its plain and its designed part.'
                        : 'This desk was not told where this letter’s words live.'}
                  </p>
                  {l.also_needs && (
                    <p className="mt-1 text-[11.5px] leading-[17px] text-text-3">
                      <span className="font-semibold text-text-1">Its letter passes test mode:</span> it claims
                      the {l.kind.replace(/_/g, ' ')}’s exemption, so the letter reaches the real person while test
                      mode holds every other message, and only its text waits. It sends only while this row and{' '}
                      <code className="text-[11px]">{l.also_needs}</code> are both on.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}

/* ---------- the desk ---------- */

export default function SmartCommsPage() {
  const [situations, setSituations] = useState<Sit[]>([])
  const [sending, setSending] = useState('')
  // THE SENDING DIAL, WHICH IS NOT THE TRANSPORT DOOR ABOVE IT.
  const [dial, setDial] = useState('')
  // AND THE ONE MEASURED REACH THE LANE PUBLISHES.
  const [reach, setReach] = useState<ReachBook>(null)
  // AND THE OTHER SENDER, DECLARED BY THE LANE RATHER THAN DESCRIBED HERE.
  const [sentBy, setSentBy] = useState<LegacySender | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [due, setDue] = useState<DueRow[]>([])
  const [previewDenied, setPreviewDenied] = useState(false)
  // The preview did not come back.
  const [previewUnread, setPreviewUnread] = useState(false)
  // EACH READ IS PENDING ON ITS OWN (review).
  const [trailPending, setTrailPending] = useState(true)
  const [duePending, setDuePending] = useState(true)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Sit | null>(null)
  /** our lines, for Sends from: this browser's last copy first, the directory's answer once read */
  const [lineBook, setLineBook] = useState<LineBook | null>(() => keptLines())
  const linesAsked = useRef(false)
  /** what each card says about its last save, by row id */
  const [rowNotes, setRowNotes] = useState<Record<string, RowNote>>({})
  /** the rows whose switch is on its way to the platform */
  const [switching, setSwitching] = useState<Record<string, true>>({})
  // THE CELLS THIS TAB WROTE, held over any read that may predate them.
  const written = useRef(new Map<string, { patch: RowPatch; done: number }>())
  /** which load is the newest: an older one that answers late never draws over it */
  const loadSeq = useRef(0)
  /** and the newest that reads the trail and the preview too: only it asks those two doors */
  const fullSeq = useRef(0)
  /** when the door last answered with the rows on screen; 0 while they are a floor's, or nothing */
  const lastLive = useRef(0)
  /** the redirect as the newest situations read stated it, so a trail read by an older load never says "not told" over it */
  const deskTestSaid = useRef<TestMode | null>(null)
  const noteRow = useCallback((id: string, note: RowNote | null) => {
    setRowNotes((prev) => {
      const next = { ...prev }
      if (note) next[id] = note
      else delete next[id]
      return next
    })
  }, [])
  /** Rows as this tab knows them: the read, with every cell this tab wrote after that read began laid over it. */
  const overlayWritten = useCallback((rows: Sit[], readAt: number): Sit[] => {
    const held = written.current
    for (const [id, w] of [...held]) if (w.done && readAt > w.done) held.delete(id)
    if (!held.size) return rows
    return rows.map((r) => {
      const w = held.get(r.id)
      return w ? withPatch(r, w.patch) : r
    })
  }, [])
  // OUR LINES, FOR SENDS FROM — the directory the platform judges that cell by (`lineDirectory`, the same read the…
  const readLines = useCallback(async () => {
    const generation = keptGeneration()
    try {
      const res = await gasAction<{ lines?: DeskLine[] }>('lineDirectory', {}, { timeoutMs: DOOR_TIMEOUT_MS })
      if (!Array.isArray(res.lines) || !res.lines.length) return
      const lines: DeskLine[] = res.lines.filter(Boolean).map((l) => ({
        id: String(l.id ?? ''), digits: String(l.digits ?? ''), e164: String(l.e164 ?? ''),
        name: String(l.name ?? ''), role: String(l.role ?? ''),
      }))
      const read: LineBook = { at: new Date().toISOString(), lines }
      setLineBook(read)
      keepIfCurrent(keptLinesKey(), read, generation)
    } catch {
      // the drawer keeps its free cell and says the platform judges the word at save
    }
  }, [])
  // WHERE THE CATALOGUE ACTUALLY LIVES, asked of the router and never assumed (`smartCommsGet` resolves the tab's…
  const [book, setBook] = useState<{ tab: string; id: string }>({ tab: '', id: '' })
  // WHICH WORDS THIS PLATFORM RESOLVES IN `to`, AND WHO EACH OF THEM IS.
  const [keywords, setKeywords] = useState<KeywordBook | null>(null)
  // WHICH ROWS REACH THE ALERT FLOOR WHATEVER THEIR `to` SAYS, and who that floor is.
  const [floors, setFloors] = useState<FloorBook>(null)
  const [team, setTeam] = useState<TeamFloor>(null)
  // THE DOORS THAT REACH THE WORLD WITHOUT SAYING ANYTHING.
  const [gates, setGates] = useState<GatesRead | null>(null)
  // AND THE TWO LETTERS THAT LEAVE WHILE EVERYTHING ELSE IS HELD.
  const [authLetters, setAuthLetters] = useState<AuthLetterFact[] | null>(null)
  // THE HOURS EACH ROW KEEPS, AND WHETHER A CLOCK IS LISTENING.
  const [schedule, setSchedule] = useState<Record<string, ScheduleFact> | null>(null)
  // null = NOBODY TOLD THIS DESK whether the redirect is on.
  const [testMode, setTestMode] = useState<TestMode | null>(null)
  // A FAILED READ IS NOT AN ANSWER (review).
  const [loadError, setLoadError] = useState('')
  const [historyError, setHistoryError] = useState(false)
  // WHERE THE ROWS ON SCREEN CAME FROM WHEN THE DOOR DID NOT ANSWER.
  const [floor, setFloor] = useState<Floor | null>(null)
  // THE SECOND FAILURE, TRACKED APART FROM THE FIRST.
  const [floorFailed, setFloorFailed] = useState(false)
  // A REFUSAL IS NOT A SILENCE.
  const [refused, setRefused] = useState(false)
  // THE DOOR IS STILL BEING ASKED.
  const [deskReading, setDeskReading] = useState(true)

  // THE FLOOR, RUN ONLY AFTER THE DOOR HAS ALREADY FAILED.
  const standOnTheFloor = useCallback(async (): Promise<Floor | null> => {
    // WHICH WORDS ARE ADDRESSES TRAVELS WITH THE ROWS, and no rung below carries it: the slice and the deposit hold…
    const floorKeywords = keptKeywordNames()
    // And which rows page the alert floor, from the same kept copy and for the same reason: a desk on its floor…
    const floorAlerts = keptFloorAlerts()
    try {
      const slice = await readSliceFloor<Sit>(DESK_RESOURCE)
      if (slice && slice.rows.length) {
        const stood: Floor = { from: 'slice', ageMs: slice.ageMs, carried: null }
        setSituations(overlayWritten(slice.rows, 0))
        setKeywords(floorKeywords)
        setFloors(floorAlerts)
        setFloor(stood)
        return stood
      }
    } catch {
      // The floor failing is not a second error to shout about — it is the absence of a floor, and that is said on…
    }

    // AND THEN THE DEPOSIT ITSELF — the rung this lane is built around.
    try {
      const cut = await depositTab<Sit>(DESK_RESOURCE)
      if (cut.state === 'rows' && cut.rows.length) {
        const stood: Floor = { from: 'deposit', ageMs: cut.ageMs, carried: cut.carried }
        setSituations(overlayWritten(cut.rows, 0))
        setKeywords(floorKeywords)
        setFloors(floorAlerts)
        setFloor(stood)
        return stood
      }
    } catch {
      // Same as above: no floor is not a second alarm.
    }
    const kept = readKept<KeptSituations>(keptSituationsKey())
    if (kept && Array.isArray(kept.rows) && kept.rows.length) {
      const at = Date.parse(kept.at || '')
      const stood: Floor = { from: 'kept', ageMs: Number.isNaN(at) ? null : Date.now() - at, carried: null }
      setSituations(overlayWritten(kept.rows, 0))
      setKeywords(floorKeywords)
      setFloors(floorAlerts)
      setFloor(stood)
      return stood
    }
    setSituations([])
    setKeywords(null)
    setFloors(null)
    setFloor(null)
    setFloorFailed(true)
    return null
  }, [overlayWritten])

  // `countNow` IS THE ONE MOMENT THE HEAD-COUNT IS WORTH AN EXECUTION.
  const load = useCallback(async (
    { countNow = false, situationsOnly = false }: { countNow?: boolean; situationsOnly?: boolean } = {},
  ) => {
    const seq = ++loadSeq.current
    const readAt = Date.now()
    // TODAY'S ROWS ALREADY ON SCREEN ARE NOT REPLACED BY AN OLDER COPY while they are read again: a refresh keeps…
    const liveOnScreen = lastLive.current > 0
    if (!liveOnScreen) setLoading(true)
    setDeskReading(true)
    if (!situationsOnly) {
      setTrailPending(true)
      setDuePending(true)
    }
    setFloorFailed(false)
    setRefused(false)
    // The kept keys are named by who and where AT THE KEEP, so a door that answers after a sign-out would file the…
    const generation = keptGeneration()

    // THE JSON PAINTS FIRST, AND THAT IS THE DECLARED ORDER: Smart Comms loads from the JSON first and from the…
    const prepainted = liveOnScreen ? null : await standOnTheFloor()
    // WHICH DOOR ANSWERED THE REDIRECT.
    let testFromDesk: TestMode | null = null
    // Rows are on screen, so this is a REFRESH and no longer a load.
    if (prepainted || liveOnScreen) setLoading(false)
    if (!situationsOnly) fullSeq.current = seq

    try {
      const res = await gasAction<{
        situations?: Sit[]; sending?: string; tab?: string; spreadsheet_id?: string
        // THE LANE'S OWN DIAL AND THE ONE REACH IT COUNTS.
        dial?: string
        // AND THE OTHER BRAKE, AS THE PLATFORM RESOLVES IT — `on` is the answer every send door acts on, not the…
        test_mode?: { on?: boolean; explicit?: boolean; sms?: string[]; emails?: string[] }
        // THE LANE PUBLISHES ITS REACH AS ONE OBJECT, because one row is the question: `commCallOffManagerReach_`…
        call_off_reach?: ReachCount
        call_off_also_sent_by?: LegacySender
        reach?: Record<string, ReachCount>
        keywords?: Record<string, KeywordAudience>
        floor_alerts?: Record<string, { floor?: boolean }>
        // THE HOURS, PER ROW.
        schedule?: Record<string, ScheduleFact>
        // THE SHAPE IS THE MODULE'S, NOT A SECOND COPY OF IT.
        team?: NonNullable<TeamFloor>
        // THE DOORS THAT REACH THE WORLD WITHOUT A WORD, and the two letters that leave while the lane holds.
        gates?: { lane?: string; gates?: GateFact[]; lag?: string }
        auth_letters?: AuthLetterFact[]
        // each situation's rung, as the lane resolves it from comm_priority_* (null when the ladder was not read)
        lane?: { priorities?: Record<string, string> | null }
      }>(
        'smartCommsGet', countNow ? { keywords: 'fresh' } : {}, { timeoutMs: DOOR_TIMEOUT_MS },
      )
      // A MISSING LIST IS NOT AN EMPTY TAB.
      if (!Array.isArray(res.situations)) {
        throw Object.assign(new Error(isRelayReceipt(res)
          ? 'The read came back as a receipt of an earlier attempt, not as the situations — nothing was read.'
          : 'The read came back without the situations — nothing was read.'), { status: 502 })
      }
      // a newer load is out, and it answers for the rows: this older answer draws nothing over it
      if (seq !== loadSeq.current) throw Object.assign(new Error('superseded'), { superseded: true })
      const rungs = res.lane?.priorities ?? null
      const rows = overlayWritten(res.situations, readAt).map((s) => ({ ...s, priority: rungs?.[s.id] ?? '' }))
      // AN ABSENT REGISTRY IS NOT AN EMPTY ONE.
      const registry = res.keywords && typeof res.keywords === 'object' ? res.keywords : null
      const keywordNames = registry ? Object.keys(registry) : []
      setKeywords(registry ? { keys: keywordNames, now: registry } : null)
      // AND THE SAME RULE FOR THE FLOOR ALERTS, for the same reason in the other direction: a backend that does not…
      const declared = res.floor_alerts && typeof res.floor_alerts === 'object' ? res.floor_alerts : null
      const floorIds = declared
        ? Object.keys(declared).filter((id) => declared[id] && declared[id].floor === true)
        : []
      setFloors(declared ? { ids: floorIds } : null)
      setSchedule(res.schedule && typeof res.schedule === 'object' ? res.schedule : null)
      setTeam(res.team && typeof res.team === 'object' ? res.team : null)
      // AND THE SAME RULE ONCE MORE: an absent key is a desk that was not told, never a platform with no gated…
      setGates(res.gates && Array.isArray(res.gates.gates)
        ? { lane: String(res.gates.lane ?? ''), gates: res.gates.gates,
            ...(typeof res.gates.lag === 'string' && res.gates.lag ? { lag: res.gates.lag } : {}) }
        : null)
      setAuthLetters(Array.isArray(res.auth_letters) ? res.auth_letters : null)
      setSituations(rows)
      // THE DESK IS USABLE THE MOMENT THE SITUATIONS ARRIVE.
      setLoading(false)
      setSending(res.sending ?? '')
      // ONLY A WORD THE LANE ITSELF USES IS AN ANSWER.
      setDial(['send', 'record', 'off'].includes(String(res.dial ?? '').trim().toLowerCase())
        ? String(res.dial).trim().toLowerCase() : '')
      // AND THE SECOND BRAKE OFF THE SAME READ.
      const deskTest = res.test_mode
      testFromDesk = deskTest && typeof deskTest.on === 'boolean'
        ? { on: deskTest.on,
            sms: Array.isArray(deskTest.sms) ? deskTest.sms : [],
            emails: Array.isArray(deskTest.emails) ? deskTest.emails : [] }
        : null
      if (testFromDesk) setTestMode(testFromDesk)
      deskTestSaid.current = testFromDesk
      const laneReach = res.call_off_reach && typeof res.call_off_reach === 'object'
        ? { call_off_house_manager: res.call_off_reach } : null
      setReach(res.reach && typeof res.reach === 'object' ? res.reach : laneReach)
      setSentBy(res.call_off_also_sent_by && typeof res.call_off_also_sent_by === 'object'
        ? res.call_off_also_sent_by : null)
      setBook({ tab: String(res.tab ?? ''), id: String(res.spreadsheet_id ?? '') })
      setLoadError('')
      setFloor(null)
      lastLive.current = Date.now()
      // The door answered: this browser's floor is refreshed, and the resource stops being served as old wherever…
      const keptNow = readKept<KeptSituations>(keptSituationsKey())
      if (rows.length || !(keptNow && Array.isArray(keptNow.rows) && keptNow.rows.length)) {
        keepIfCurrent(
          keptSituationsKey(),
          // The names keep; the head-counts do not (KeptSituations).
          { at: new Date().toISOString(), rows, keywords: keywordNames,
            floorAlerts: floorIds } satisfies KeptSituations,
          generation,
        )
      }
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      const status = (err as { status?: number }).status
      if (seq !== loadSeq.current || (err as { superseded?: boolean }).superseded) {
        // a newer load is out and answers for the rows; this one says nothing over it
      } else if (status === 403) {
        setLoadError(why || 'the read did not come back')
        lastLive.current = 0
        // Refused, not unheard.
        setRefused(true)
        setSituations([])
        setKeywords(null)
        setFloors(null)
        setTeam(null)
        // Refused is refused for the gates too: a board kept from an earlier read would be an answer this account…
        setGates(null)
        setAuthLetters(null)
        // Refused is refused for everything that came through that door: a dial and a reach kept from an earlier…
        setDial('')
        setTestMode(null)
        testFromDesk = null
        deskTestSaid.current = null
        setReach(null)
        setSentBy(null)
        setFloor(null)
        toast({ type: 'danger', title: 'This desk was refused', body: why })
      } else {
        setLoadError(why || 'the read did not come back')
        // THE ALARM MATCHES WHAT ACTUALLY HAPPENED.
        let stood = prepainted
        if (!stood && lastLive.current) {
          stood = { from: 'kept', ageMs: Date.now() - lastLive.current, carried: null }
          setFloor(stood)
        }
        if (!stood) stood = await standOnTheFloor()
        lastLive.current = 0
        toast(stood
          ? {
            type: 'warning',
            title: 'Showing the last reading of the situations',
            body: `The door did not answer, so these rows come from ${floorName(stood)} — ${floorAge(stood)}. ${why}`,
          }
          : { type: 'danger', title: 'Could not load situations', body: why })
      }
    }
    // THE DESK IS USABLE NOW.
    if (seq === loadSeq.current) {
      setLoading(false)
      setDeskReading(false)
    }
    // a re-read after a save asks the one door; and only the newest full load asks the other two
    if (situationsOnly || seq !== fullSeq.current) return
    // a newer re-read may have stated the redirect while this load's own read was set aside
    testFromDesk = testFromDesk ?? deskTestSaid.current

    // The kept trail paints first, so the counts are on screen while the door is still being asked.
    const keptTrail = readKept<KeptTrail>(keptTrailKey())
    if (keptTrail && Array.isArray(keptTrail.deliveries)) {
      setDeliveries(keptTrail.deliveries)
      // THE FLOOR NEVER OVERWRITES A DOOR THAT JUST ANSWERED.
      if (!testFromDesk) setTestMode(keptTrail.testMode ?? null)
    }

    try {
      const hist = await gasAction<HistoryReply>('smartCommsHistory', { limit: TRAIL_LIMIT }, { timeoutMs: DOOR_TIMEOUT_MS })
      // the same law as the situations: a trail answer without its list read nothing, and is not "nothing sent"
      if (!Array.isArray(hist.deliveries)) throw new Error('the trail came back without its deliveries')
      setDeliveries(hist.deliveries)
      // Only a stated boolean turns the banner into a fact.
      const t = hist.test_mode
      const fromTrail = t && typeof t.on === 'boolean'
        ? { on: t.on, sms: Array.isArray(t.sms) ? t.sms : [], emails: Array.isArray(t.emails) ? t.emails : [] }
        : null
      // THE TRAIL IS THE SECOND SOURCE AND NEVER THE LAST WORD.
      if (!testFromDesk) setTestMode(fromTrail)
      setHistoryError(false)
      keepIfCurrent(keptTrailKey(), {
        at: new Date().toISOString(),
        deliveries: hist.deliveries,
        testMode: testFromDesk ?? fromTrail,
      } satisfies KeptTrail, generation)
    } catch {
      // The trail never blocks the desk — but it must not be read as "nothing was sent" either, so the count it…
      if (!testFromDesk) setTestMode(null)
      setHistoryError(true)
    }
    setTrailPending(false)
    try {
      const prev = await gasAction<{ due?: DueRow[] }>('smartCommsPreview', {}, { timeoutMs: PREVIEW_TIMEOUT_MS })
      // a preview answer without its list read nothing, and is never "nobody is due"
      if (!Array.isArray(prev.due)) throw Object.assign(new Error('the preview came back without its list'), { status: 502 })
      setDue(prev.due)
      setPreviewDenied(false)
      setPreviewUnread(false)
    } catch (err) {
      // REFUSED AND UNREAD ARE DIFFERENT, AND ONE SENTENCE FOR BOTH IS A LIE ABOUT AUTHORISATION (review).
      setDue([])
      const status = (err as { status?: number }).status
      setPreviewDenied(status === 403)
      setPreviewUnread(status !== 403)
    }
    setDuePending(false)
  }, [standOnTheFloor, overlayWritten])

  useEffect(() => { void load() }, [load])

  // THE ARITHMETIC, AND WHAT EACH SUM IS ACTUALLY OF (audit).
  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400000
    return {
      live: situations.filter((s) => s.enabled === 'yes').length,
      off: situations.filter((s) => s.enabled !== 'yes').length,
      weekReached: deliveries.filter((d) => new Date(d.at).getTime() > weekAgo).length,
      trailCapped: deliveries.length >= TRAIL_LIMIT,
      dueNow: due.length,
      priorityKnown: situations.filter((s) => !!priorityOf(s)).length,
    }
  }, [situations, deliveries, due])

  const perSituation = useMemo(() => {
    const map: Record<string, { count: number; last: string; due: number }> = {}
    const weekAgo = Date.now() - 7 * 86400000
    for (const d of deliveries) {
      const m = map[d.situation] ?? (map[d.situation] = { count: 0, last: '', due: 0 })
      if (new Date(d.at).getTime() > weekAgo) m.count++
      if (d.at > m.last) m.last = d.at
    }
    for (const dd of due) {
      const m = map[dd.situation] ?? (map[dd.situation] = { count: 0, last: '', due: 0 })
      m.due++
    }
    return map
  }, [deliveries, due])

  // THE AI SECTION ARRIVES OPEN — folded, it was scrolled past unseen; whoever does not need it folds it with Hide
  const [foldedAi, setFoldedAi] = useState(false)

  // The cards, by species.
  const groups = useMemo(
    () => SPECIES
      .map((sp) => {
        const items = situations.filter((s) => kindOf(s) === sp.id)
        // HOW MANY OF THEM ARE ACTUALLY SWITCHED ON, on the heading itself.
        return { ...sp, items, on: items.filter((s) => s.enabled === 'yes').length }
      })
      .filter((g) => g.items.length > 0)
      // AND EVERY OTHER SPECIES, RATHER THAN A NUMBER IN THE LEGEND.
      .concat(
        Array.from(new Set(situations.map(kindOf)))
          .filter((k) => k && !SPECIES.some((sp) => sp.id === k))
          .sort()
          .map((k) => {
            const items = situations.filter((s) => kindOf(s) === k)
            return {
              id: k, title: strayTitle(k), icon: MessageSquare, tint: 'lavender' as TintName,
              measured: false, drives: 'its own lane fires it',
              why: 'This screen has no section written for this species yet. Its rows are shown exactly as they are, because a situation nobody can open is a situation nobody can fix.',
              items, on: items.filter((s) => s.enabled === 'yes').length,
            }
          }),
      ),
    [situations],
  )

  // THE HERO BAR.
  const bands = useMemo(() => {
    const counted = SPECIES
      .map((sp) => ({ ...sp, count: situations.filter((s) => kindOf(s) === sp.id).length }))
      // BIGGEST BAND FIRST, so the bar reads as what the catalogue is MADE OF rather than as the order this file…
      .sort((a, b) => b.count - a.count)
    const known = counted.reduce((n, b) => n + b.count, 0)
    return { counted, other: Math.max(0, situations.length - known) }
  }, [situations])

  // A FLOOR IS FOR READING — AND, NOW THAT A SAVE WRITES ONLY ITS OWN CELLS, FOR EDITING TOO.

  /** A save the platform took: on the card at once, held over any read that left before it, in this browser's copy. */
  const savedHere = useCallback((patch: RowPatch, heard: 'saved' | 'waiting') => {
    const held = written.current.get(patch.id)
    // a queued save is held over the reads of the next two minutes, while the queue delivers it or is refused it
    written.current.set(patch.id, { patch: { ...(held?.patch ?? {}), ...patch },
      done: heard === 'saved' ? Date.now() : Date.now() + 120_000 })
    setSituations((prev) => prev.map((x) => withPatch(x, patch)))
    noteRow(patch.id, heard === 'waiting'
      ? { tone: 'waiting', text: 'Sent — the platform has not confirmed it yet. The next read of the situations shows whether it landed.' }
      : null)
    const kept = readKept<KeptSituations>(keptSituationsKey())
    if (heard === 'saved' && kept && Array.isArray(kept.rows) && kept.rows.length) {
      keepIfCurrent(keptSituationsKey(), { ...kept, rows: kept.rows.map((x) => withPatch(x, patch)) }, keptGeneration())
    }
  }, [noteRow])

  const toggle = async (s: Sit, on: boolean) => {
    const patch: RowPatch = { id: s.id, enabled: on ? 'yes' : 'no' }
    const before = String(s.enabled ?? '')
    const held = written.current.get(s.id)
    written.current.set(s.id, { patch: { ...(held?.patch ?? {}), ...patch }, done: 0 })
    setSituations((prev) => prev.map((x) => withPatch(x, patch)))
    setSwitching((prev) => ({ ...prev, [s.id]: true }))
    noteRow(s.id, null)
    try {
      const data = await gasAction<unknown>('smartCommsSet', { rows: [patch] })
      const heard = isRelayReceipt(data) ? 'waiting' : 'saved'
      savedHere(patch, heard)
      toast(heard === 'saved'
        ? { type: 'success', title: `${s.id} ${on ? 'is live' : 'is off'}.` }
        : { type: 'warning', title: `${s.id}: sent, not confirmed yet`,
            body: 'The platform has not confirmed this switch yet. The next read of the situations shows whether it landed.' })
    } catch (err) {
      if (confirmationLost(err)) {
        savedHere(patch, 'waiting')
        toast({ type: 'warning', title: `${s.id}: sent, not confirmed yet`,
          body: 'The platform took this switch, but its answer was lost on the way back. The next read of the situations shows it.' })
        return
      }
      // the switch goes back, and the platform's own words stay on the card until the next save
      const why = err instanceof Error ? err.message : String(err)
      if (held) written.current.set(s.id, held)
      else written.current.delete(s.id)
      setSituations((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: before } : x)))
      noteRow(s.id, { tone: 'refused', text: why })
      toast({ type: 'danger', title: `${s.id} was not switched ${on ? 'on' : 'off'}`, body: why })
    } finally {
      setSwitching((prev) => {
        const next = { ...prev }
        delete next[s.id]
        return next
      })
    }
  }

  // A SAVE REFUSED AFTER IT WAS ACCEPTED — the write queue's dead letter, told down the stream — puts the row back…
  useEffect(() => onWriteRefused((msg) => {
    if (msg.action !== 'smartCommsSet') return
    for (const id of msg.rows) {
      written.current.delete(id)
      noteRow(id, { tone: 'refused', text: msg.why || 'the platform refused it and gave no reason' })
    }
    void load({ situationsOnly: true })
  }), [load, noteRow])

  // OUR LINES ARE READ ONCE A VISIT: as soon as a drawer opens, or once the desk's own three reads are over and a…
  const desksReadsOut = deskReading || trailPending || duePending
  useEffect(() => {
    if (linesAsked.current) return
    if (editing || (!desksReadsOut && situations.some((s) => String(s.from_line ?? '').trim()))) {
      linesAsked.current = true
      void readLines()
    }
  }, [editing, desksReadsOut, situations, readLines])

  const sendingOn = sending.trim().toLowerCase() === 'on'
  const total = Math.max(1, situations.length)
  // WHAT A HERO NUMBER SAYS WHEN IT IS NOT A NUMBER YET.
  const gap = loading ? '…' : '—'
  // OLD AND REAL IS STILL KNOWN.
  const countsKnown = !loading && (!loadError || !!floor)
  // EACH FIGURE WAITS ON ITS OWN READ.
  const trailGap = trailPending ? '…' : '—'
  const dueGap = duePending ? '…' : '—'
  const sentKnown = !trailPending && !historyError
  const dueKnown = !duePending && !previewDenied && !previewUnread && countsKnown
  // HAS THIS ROW EVER BEEN SEEN TO SEND — asked of the trail this desk read, and never answered by the transport.
  const seenOnTrail = (id: string): FloorSeen =>
    !sentKnown ? 'unread' : perSituation[id]?.last ? 'yes' : 'no'
  // THE DIAL HAS THREE STATES, NOT TWO (review).
  const sendingKnown = sending.trim() !== ''
  const sendingOff = sendingKnown && !sendingOn
  // THE THREE DOORS, GATHERED ONCE AND HANDED TO EVERY CARD.
  const brake: Brake = {
    dial: dial || null,
    sendingKnown,
    sendingOn,
    testOn: testMode === null ? null : testMode.on,
  }

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Smart Comms"
          subtitle="Every message this platform sends, and the words it sends them in."
          actions={
            <>
              {/* THE MASTER SWITCH IS A FACT, NOT A CONTROL — it lives in the
                  transport settings; the desk only has to say which way it is
                  pointing, because every count below means something else when
                  it is off. */}
              <span
                title={!sendingKnown
                  ? 'This desk did not read the dial: the situations came from its last reading, which does not carry it. Nothing here says sending is off.'
                  : sendingOn
                    ? 'The platform is sending for real.'
                    : 'Sending is off at the transport door: situations are evaluated, nothing leaves.'}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-[12.5px] font-semibold',
                  sendingOn ? 'bg-surface text-text-2' : 'bg-surface-2 text-text-3',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', sendingOn ? 'bg-primary' : 'bg-text-3')} />
                {sendingKnown ? `Sending ${sendingOn ? 'on' : 'off'}` : 'Sending not read'}
              </span>
              <PageSwitch />
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading || deskReading || trailPending || duePending}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading || deskReading || trailPending || duePending ? 'animate-spin' : ''} /> Refresh
              </button>
            </>
          }
        />
      </motion.div>

      {/* THE ROWS ARE REAL AND THEY ARE OLD, AND THAT IS SAID BEFORE ANYBODY
          ACTS ON THEM. It sits above the redirect banner on purpose: how old
          these rows are conditions every number and every toggle below it. The
          two rungs are named apart because they are different claims — the
          deposit is the platform's last reading, the kept copy is only what
          this browser itself last saw, and somebody deciding whether to trust a
          card needs to know which one is talking. */}
      {floor && (
        <div className="mb-4 flex items-start gap-2.5 rounded-[14px] border border-transparent bg-tint-amber px-4 py-3 text-[12.5px] leading-[1.45] text-tint-fg-amber">
          <Clock size={15} className="mt-[1px] shrink-0" />
          <p className="min-w-0">
            {/* STILL READING IS NOT FAILED. The floor paints first on every
                visit, and saying "nothing answered" over a read that has not
                had time to answer taught that the door was down. */}
            <span className="font-semibold">
              {deskReading
                ? 'Still reading the situations — until they arrive, this is the last reading this desk held.'
                : 'Nothing answered just now — this is the last reading this desk held.'}
            </span>{' '}
            {floor.from === 'kept'
              ? `The situations below are the copy this browser kept the last time the door did answer, ${sinceMs(floor.ageMs)}.`
              : `The situations below come from ${floorName(floor)}, ${sinceMs(floor.ageMs)}.`}{' '}
            {deskReading && 'Switches and Edit work meanwhile: a save writes only the cells you change. '}
            {/* AND WHAT THAT AGE IS AN AGE OF. The deposit is a delta merge: a
                tab whose fingerprint — row count plus last row — has not moved
                is carried forward wearing the NEW build's stamp, so an edit in
                the middle of the tab would not have been noticed. Printing that
                stamp on its own says the rows were read minutes ago when what
                was read minutes ago was only the fingerprint. */}
            {floor.from === 'deposit' && floor.carried === true && (
              <span>
                That is when the deposit was built, not when these rows were read: this tab was carried forward from an
                earlier build because its row count and last row had not changed, so a situation edited in the middle of
                the tab would look unchanged to it. The rows are older than the stamp.{' '}
              </span>
            )}
            {floor.from === 'deposit' && floor.carried === null && (
              <span>
                That is when the deposit was built; it did not say whether this tab was re-read on that build or carried
                forward from an earlier one, so the rows may be older than the stamp.{' '}
              </span>
            )}
            The tab is alive, so a situation may have been added, switched or reworded since. The counts above are of
            these rows and not of the tab as it stands. {loadError}
          </p>
          {/* ONE ASK AT A TIME, BECAUSE THE DOOR IS ONE AT A TIME (review).
              Aborting a read cancels this browser's wait, never the execution
              behind it: that keeps the account's single slot until it finishes.
              An enabled button over an in-flight load lets somebody queue three
              more executions behind three that are still running, on the very
              door whose congestion put the floor on screen. */}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || deskReading || trailPending || duePending}
            className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 self-center rounded-md border border-border bg-surface px-2.5 text-[11.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading || deskReading || trailPending || duePending ? 'animate-spin' : ''} /> Try again
          </button>
        </div>
      )}

      <DialBanner dial={dial} />

      <BrakesPanel dial={dial} onChanged={() => void load({ countNow: false })} />

      {/* DOES ANY OF THIS REACH A PERSON? — the question that decides what the
          headline below MEANS, in the same three states the Activity page
          keeps: on, off, and not recorded. The transport ("Sending on") and
          test mode are two different doors: sending can be fully on while test
          mode writes every message into the mock outbox and sends none. */}
      <div
        className={cn(
          'mb-4 flex items-start gap-2.5 rounded-[14px] border px-4 py-3 text-[12.5px] leading-[1.45]',
          testMode?.on
            ? 'border-transparent bg-tint-amber text-tint-fg-amber'
            : 'border-border bg-surface text-text-2',
        )}
      >
        {/* The alarm belongs to the state nobody can check, not to the state
            that is merely on: an unknown redirect is the one a reader must not
            walk past. */}
        {testMode === null
          ? <AlertTriangle size={15} className="mt-[1px] shrink-0 text-tint-fg-amber" />
          : <FlaskConical size={15} className={cn('mt-[1px] shrink-0', testMode.on ? '' : 'text-text-3')} />}
        <p className="min-w-0">
          {testMode === null ? (
            <>
              <span className="font-semibold">Whether test mode is on — this desk cannot say.</span>{' '}
              The read behind these numbers does not carry it. It matters here more than anywhere: while
              test mode is on nothing leaves, so the “reached a real person” figure below sits at zero
              however many messages the lanes decide to say — each one is a row in the mock outbox and
              never joins the trail.
            </>
          ) : testMode.on ? (
            <>
              <span className="font-semibold">Test mode is on — nothing leaves the platform.</span>{' '}
              No message reaches anybody, testers included: each one is a row in the mock outbox, and the
              people named are still owed the real message. So “reached a real person” below counts none
              of them.
            </>
          ) : (
            <>
              <span className="font-semibold">Test mode is off.</span>{' '}
              A telling on the trail went to the person it names.
            </>
          )}
        </p>
      </div>

      {/* the headline, on the one dark surface this design system keeps */}
      <div className="mb-5 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Situations live
            </p>
            <p className="font-stat text-[60px] leading-none text-white">{countsKnown ? stats.live : gap}</p>
            {/* THREE FACTS ON ONE LINE, in the order they are argued: how many
                situations exist, how many of them reached somebody, how many
                would fire now. Each keeps its own honesty state — an em-dash
                where a read failed, "at least" where the trail came back full,
                an em-dash where the preview may not be read at all.

                AND THE MIDDLE ONE IS NOT "SENT" (audit). The ledger holds what
                REACHED SOMEBODY: a redirected message is filed under a rehearsal
                key and dropped by smartCommsHistory, so under the test redirect
                it reads near zero while messages leave on every pass. Labelled
                "sent", it invited exactly the wrong conclusion. */}
            <p className="mt-1 text-[12px] leading-[18px] text-white/60">
              {countsKnown
                ? `of ${situations.length} situation${situations.length === 1 ? '' : 's'}`
                : `of ${gap} situations`} ·{' '}
              <span
                title={`One row per telling, from the newest ${TRAIL_LIMIT} on the delivery trail. A message that went to a tester is recorded as a rehearsal and is NOT counted here, so this is people actually reached — not messages leaving.`}
                className="cursor-help underline decoration-dotted decoration-white/30 underline-offset-2"
              >
                {sentKnown ? `${stats.trailCapped ? 'at least ' : ''}${stats.weekReached}` : trailGap}{' '}
                reached a real person in the last 7 days
              </span> ·{' '}
              <span
                title="One per person per credential, from the enabled date-driven situations only: the preview never walks digests, obligation bundles, AI requests or window asks, and a person with no number is counted here and reached by nothing."
                className="cursor-help underline decoration-dotted decoration-white/30 underline-offset-2"
              >
                {dueKnown ? stats.dueNow : previewDenied || previewUnread ? '—' : dueGap}{' '}
                date-driven reminders would fire now
              </span>
            </p>
            {(previewDenied || previewUnread || sendingOff || !sendingKnown) && (
              <p className="mt-2 text-[11.5px] leading-[17px] text-white/45">
                {previewDenied && 'The “would fire now” preview is admin-only, which is why it holds an em-dash and not a zero — nobody may look is not nobody is due.'}
                {previewUnread && 'The “would fire now” preview did not come back, which is why it holds an em-dash and not a zero — it was not refused, it was not answered, and nobody read it is not nobody is due.'}
                {(previewDenied || previewUnread) && (sendingOff || !sendingKnown) ? ' ' : ''}
                {sendingOff && 'Nothing leaves while sending is off: the situations are still evaluated, and nothing walks out of the transport door.'}
                {!sendingKnown && 'This desk did not read the master dial, so it cannot say whether anything is leaving the transport door — that is not the same as sending being off.'}
              </p>
            )}
            {loadError && !loading && (
              <p className="mt-3 text-[12px] leading-[17px] text-white/70">
                The situations did not come back — the numbers above are unread, not zero.
              </p>
            )}
          </div>

          <div className="sm:col-span-2">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              What the catalogue is made of
            </p>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              {bands.counted.map((b) => (
                b.count ? (
                  <span
                    key={b.id}
                    title={`${b.count} ${b.title.toLowerCase()}`}
                    style={{ width: `${(b.count / total) * 100}%`, background: heroBand(b.tint) }}
                  />
                ) : null
              ))}
              {bands.other ? (
                <span
                  title={`${bands.other} of another kind — this screen has no section for it yet`}
                  style={{ width: `${(bands.other / total) * 100}%`, background: 'rgba(255,255,255,0.32)' }}
                />
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[12px] text-white/70">
              {bands.counted.map((b) => (
                <span key={b.id} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: heroBand(b.tint) }} />
                  {b.title} <span className="font-stat text-white">{countsKnown ? b.count : gap}</span>
                </span>
              ))}
              {bands.other ? (
                <span className="inline-flex items-center gap-1.5" title="A kind this screen has no section for yet.">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'rgba(255,255,255,0.32)' }} />
                  Other <span className="font-stat text-white">{bands.other}</span>
                </span>
              ) : null}
            </div>
            {stats.off > 0 && (
              <p className="mt-3 text-[12.5px] text-white/80">
                <span className="font-stat text-white">{stats.off}</span> of them
                {stats.off === 1 ? ' is' : ' are'} switched off — written, reviewed, and saying nothing
                until somebody turns {stats.off === 1 ? 'it' : 'them'} on.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* TODAY, DIRECTLY UNDER THE BLACK CARD: the call-offs in red
          and the no-call-no-shows, from the punch board. */}
      <TodayAbsences />

      {/* AND THEN WHAT IS STILL UNCOVERED. The card above names today's
          absences; this names the shifts nobody is on, on any day — the
          estate's own OPEN rows. Two cards because they are two questions:
          "who did not come" is about a person, "who is covering that night"
          is about a house, and only the second one can still be answered by
          whoever is reading. */}
      <OpenShiftsCard />

      {/* THE LADDER — what a message may cost the person who receives it.
          Four rungs, three permissions each, and the permissions are NOT
          summed into a rank: "may wake somebody" and "may cost a weekend" are
          different prices and a manager pays them for different reasons. */}
      <div className="mt-7">
        <h2 className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
          <ShieldAlert size={14} className={cn('shrink-0', TINT_FG.peach)} />
          What a message may cost the person
        </h2>
        <p className="mb-3 max-w-[78ch] text-[12px] leading-[18px] text-text-3">
          A priority is a <span className="font-semibold text-text-2">pacing</span> decision and never a
          permission: the opt-out list, consent, the sending dial and test mode bind every rung,{' '}
          <code>safety</code> included. It is also not the item’s urgency — how overdue a
          credential is decides the gap between asks, and that is decided per person, per item, at send
          time. And the quiet hours a rung obeys are the <span className="font-semibold text-text-2">platform’s
          clock</span>, not the recipient’s — narrowed per person only where the roster knows when that
          person is asleep.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {LADDER.map((r) => (
            <Card key={r.id} padded={false} className="p-3.5">
              <Badge label={r.id} tint={r.tint} />
              <p className="mt-1.5 text-[12px] leading-[17px] text-text-2">{r.why}</p>
              <ul className="mt-2.5 space-y-1">
                <Permission ok={r.gap} yes="skips the pacing gap" no="waits for the pacing gap" />
                <Permission ok={r.sleep} yes="may wake somebody" no="waits out the quiet hours — never wakes anybody" />
                <Permission ok={r.weekend} yes="may be said on a weekend" no="holds over a weekend" />
              </ul>
              <p className="mt-2 text-[11px] leading-[16px] text-text-3">
                <span className="font-semibold text-text-2">attempts:</span> {r.cap}
              </p>
              <p className="mt-2.5 border-t border-border pt-2 text-[11px] leading-[16px] text-text-3">
                {r.carries}
              </p>
            </Card>
          ))}
        </div>
        {/* WHAT THIS DESK CAN ACTUALLY ANSWER PER SITUATION — said once, out
            loud, instead of ninety-three cards quietly implying the floor. */}
        <p className="mt-3 max-w-[78ch] text-[11.5px] leading-[17px] text-text-3">
          {/* IN FLIGHT IS NOT FAILED, and neither is an answer — the same law
              the hero numbers keep two panels up. */}
          {loading
            ? 'Still reading the situations — which of them sits on which rung is not known yet.'
            : loadError
            ? 'The situations did not come back, so this desk cannot say which of them sits on which rung.'
            : situations.length === 0
              ? 'No situation is loaded, so there is nothing to place on a rung yet.'
              : stats.priorityKnown === 0
                ? <>
                    <span className="font-semibold text-text-2">The ladder could not be read just now.</span>{' '}
                    Which ids carry which rung is resolved from the words book&apos;s{' '}
                    <code>comm_priority_*</code> rows, and they did not answer. Every card below reads{' '}
                    <span className="font-semibold">priority —</span> for that reason, and not because the
                    answer is <code>ask</code>.
                  </>
                : <>
                    Every card below prints the rung the lane resolves for its id from the words book&apos;s{' '}
                    <code>comm_priority_*</code> rows; anything not listed there is an <code>ask</code>.
                  </>}
        </p>
      </div>

      {/* situation cards by species */}
      {groups.map((g) => {
        const folded = g.id === 'ai' && foldedAi
        return (
        <div key={g.id} className="mt-7">
          <h2 className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
            <g.icon size={14} className={cn('shrink-0', TINT_FG[g.tint])} /> {g.title}
            <span
              className="text-[11px] font-normal text-text-3"
              title={g.on === g.items.length
                ? 'Every situation in this section is switched on.'
                : `${g.items.length - g.on} of them are written and switched off — reviewed, and saying nothing until somebody turns them on.`}
            >
              ({g.items.length}{g.on === g.items.length ? '' : ` · ${g.on} on`})
            </span>
            {g.id === 'ai' && (
              <button
                onClick={() => setFoldedAi((v) => !v)}
                className="rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-text-3 hover:bg-surface-2 hover:text-text-1"
              >
                {folded ? 'Show' : 'Hide'}
              </button>
            )}
            {g.id === 'ai' && folded && (
              <span className="text-[11px] font-normal text-text-3">
                — how the platform asks. Nothing here sends anything.
              </span>
            )}
          </h2>
          {!folded && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {g.items.map((s) => {
              const on = s.enabled === 'yes'
              const statsRow = perSituation[s.id]
              // WHETHER A "DUE NOW" COUNT ON THIS CARD WOULD BE A MEASUREMENT.
              const measured = g.measured && on && !previewDenied && !previewUnread
              const dueNow = statsRow?.due ?? 0
              return (
                <Card key={s.id} padded={false} className={cn('p-4 transition-opacity', !on && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-text-1">{s.id}</p>
                      <p className="mt-0.5 text-[12px] leading-5 text-text-2">{describe(s)}</p>
                    </div>
                    <Switch checked={on} disabled={!!switching[s.id]} aria-label={`${s.id} on or off`}
                      onCheckedChange={(c) => void toggle(s, c)} />
                  </div>
                  {/* WHAT THE LAST SAVE OF THIS ROW CAME TO, in the platform's
                      own words, and WHAT IT WOULD REFUSE AS THE ROW STANDS —
                      both before anybody has to discover them by saving. */}
                  {rowNotes[s.id] && <RowNoteLine note={rowNotes[s.id]} onDismiss={() => noteRow(s.id, null)} />}
                  <StoredFix sit={s} book={keywords} lines={lineBook?.lines ?? null}
                    hours={schedule ? schedule[s.id] ?? null : null} onEdit={() => setEditing(s)} />
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {/* WHAT IT MAY COST THE PERSON, first — before the channels
                        and the pace, because it is the only chip that says
                        whether this row may reach somebody at 3am. */}
                    <PriorityChip sit={s} />
                    {/* AND WHETHER IT HAS ANYTHING TO SAY, before the channels
                        — naming a channel is worth nothing while every
                        template behind it is blank. */}
                    <WordsChip sit={s} />
                    {/* AND WHETHER THE PEOPLE IT NAMES EXIST — a dead word in
                        `to`, and beside it how many the live ones resolve to.
                        The blast is the row nobody should arm without being
                        told the size of it, so the number is on the card and
                        not behind a click. */}
                    <AddressChip to={s.to} cc={s.cc} book={keywords}
                                 floor={readFloor(s.id, floors)} team={team}
                                 seen={seenOnTrail(s.id)} />
                    <AudienceChip to={s.to} book={keywords} floor={readFloor(s.id, floors)} />
                    {String(s.channels ?? '').includes('sms') && <Badge label="sms" tint="blue" />}
                    {String(s.channels ?? '').includes('email') && <Badge label="email" tint="lavender" />}
                    <Badge label={`${s.max_attempts || '1'}× · ${s.frequency || 'once'}`} tint="amber" />
                    {/* THE HOURS, AND THE SHEET — both change what this row
                        DOES, so both are read off the card rather than found
                        by opening the drawer. */}
                    {String(s.send_at ?? '').trim() ? (
                      <Badge label={`at ${String(s.send_at).trim()}`} tint="blue" />
                    ) : null}
                    {String(s.record_to ?? '').trim() ? (
                      <Badge label={`writes into ${String(s.record_to).trim()}`} tint="mint" />
                    ) : null}
                    {/* a non-default line is shown */}
                    {String(s.from_line ?? '').trim() ? (
                      <Badge label={`from ${formatPhoneDisplay(String(s.from_line).trim())}`} tint="lavender" />
                    ) : null}
                    {/* "reached", not "sent": a telling on the trail is one that
                        landed on a real person — a redirected one is written as
                        a rehearsal and never counted. */}
                    {statsRow?.count ? (
                      <span
                        title={`Tellings on the delivery trail in the last 7 days — one row per person, whatever the channels. Messages that went to a tester are recorded as rehearsals and are not counted. Read from the newest ${TRAIL_LIMIT} tellings.`}
                        className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4', TINT_BG.mint, TINT_FG.mint)}
                      >
                        {statsRow.count} reached · 7d
                      </span>
                    ) : null}
                    {!g.measured ? (
                      // THE SPECIES SAYS WHICH LANE DECIDES.
                      <span
                        title={g.why}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-semibold leading-4 text-text-3"
                      >
                        {g.drives}
                      </span>
                    ) : measured ? (
                      // PEOPLE MATCHED, NOT MESSAGES LANDING.
                      <span
                        title="People this situation matches right now, one row each. It is what the next sweep would build — not what would land: a person with no number is counted here, and nothing leaves while sending is off."
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4',
                          dueNow ? cn(TINT_BG.pink, TINT_FG.pink) : 'border border-border bg-surface-2 text-text-3',
                        )}
                      >
                        {dueNow} {dueNow === 1 ? 'person' : 'people'} due now
                      </span>
                    ) : !on ? (
                      <span
                        title="The preview walks switched-on situations only, so nobody was counted for this one. It is unread, not empty."
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-semibold leading-4 text-text-3"
                      >
                        due — · switched off
                      </span>
                    ) : null}
                  </div>
                  {/* WHO THE LANE ITSELF RESOLVES, ON THE FOUR ROWS WHERE THE
                      CELL IS NOT THE WHOLE ANSWER. Two of the call-off senders
                      read `Goes to` and two never look at it, so an empty cell
                      is correct on one card and silence on the next — and
                      nothing else here draws anything at all for an empty
                      cell. This is the line that stops a row being worded,
                      armed, and left reaching nobody. */}
                  <SenderReachLine sit={s} reach={reach} sentBy={sentBy} compact />
                  {/* AND WOULD ANYTHING HAPPEN AT ALL. The switch, the words,
                      the audience and the brakes answered as ONE line, in the
                      order a reader can act in — the three local ones first, the platform's
                      last and named once at the top. It is drawn for the rows
                      whose sender this desk can answer for, which is the six
                      that ship armed; a row this screen cannot answer for gets
                      no sentence rather than a reassuring one. */}
                  <StopLine sit={s} brake={brake} />
                  {/* WHO THAT KEYWORD IS, IN WORDS. The chip above says how
                      many; this says whom — and "every active member of staff
                      this platform can text" is the half that decides whether
                      the words written into this row are the right words. */}
                  <AudienceLine to={s.to} book={keywords} floor={readFloor(s.id, floors)} />
                  {/* AND WHO HEARS IT WHATEVER THAT CELL SAYS. On a row whose
                      lane pages the alert floor, "the cell addresses nobody"
                      is a fact about the word and not about the row: the alert
                      takes that path either way, and this line is what keeps an
                      armed alert from reading as inert on the card somebody
                      decides from. It is handed the trail's answer too, so the
                      path is never printed as a record of this row taking it. */}
                  <FloorLine floor={readFloor(s.id, floors)} team={team} seen={seenOnTrail(s.id)} />
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
                    <span
                      className="text-[11.5px] text-text-3"
                      title={statsRow?.last
                        ? 'The newest telling on the delivery trail for this situation — a message that reached a real person, not a rehearsal.'
                        : `Nothing for this situation in the newest ${TRAIL_LIMIT} tellings. Older ones may exist, and a message that only reached a tester is never on this trail.`}
                    >
                      {statsRow?.last ? `last reached somebody ${ago(statsRow.last)}` : 'nothing on the trail'}
                    </span>
                    <button onClick={() => setEditing(s)} aria-label="Edit" title="Edit"
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1">
                      <Pencil size={12} />
                    </button>
                  </div>
                </Card>
              )
            })}
          </div>
          )}
        </div>
        )
      })}

      {loading && situations.length === 0 && (
        <p className="mt-7 inline-flex items-center gap-2 text-[12.5px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the situations…
        </p>
      )}

      {/* "The tab holds nothing" is a claim about the tab. It may only be made
          by a read that came back. A read that threw gets the retry instead. */}
      {!loading && !loadError && situations.length === 0 && (
        <div className="mt-7">
          <EmptyState title="No situations" body="The Smart Comms tab holds no situations yet." />
        </div>
      )}

      {/* THE DOOR WAS REFUSED, WHICH IS AN ANSWER. No retry: the same account
          asking the same door gets the same no, and a button that cannot work
          teaches somebody to distrust every other button on the screen. */}
      {!loading && refused && (
        <div className="mt-7 rounded-md border border-border bg-surface-2 px-4 py-3">
          <p className="text-[13px] font-semibold text-text-1">This desk was refused, not unheard.</p>
          <p className="mt-1 text-[12px] leading-[18px] text-text-3">
            The situations read answers to admin accounts only, and it said so rather than failing: {loadError} Nothing
            here is a claim about the tab, and nothing below stands in for what was declined.
          </p>
        </div>
      )}

      {!loading && loadError && !refused && !floor && (
        <div className="mt-7 rounded-md border border-border bg-surface-2 px-4 py-3">
          <p className="text-[13px] font-semibold text-text-1">The situations could not be read.</p>
          <p className="mt-1 text-[12px] leading-[18px] text-text-3">
            Nothing here says the tab is empty — the desk simply did not hear back. {loadError}
          </p>
          {/* THE SECOND FAILURE, IN ITS OWN SENTENCE. The door being unreachable
              and there being nothing underneath it are different facts, and a
              desk that prints one sentence for both is a desk that cannot be
              used to tell them apart. */}
          {floorFailed && (
            <p className="mt-1.5 text-[12px] leading-[18px] text-text-3">
              And the floor could not answer either: this platform has no built copy of these situations, the last
              deposit does not carry them, and this browser holds no earlier reading of its own. That is why there are
              no cards below — not because there are no situations.
            </p>
          )}
          {/* Same one-at-a-time rule as the banner above. */}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || deskReading || trailPending || duePending}
            className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading || deskReading || trailPending || duePending ? 'animate-spin' : ''} /> Try again
          </button>
        </div>
      )}

      {!trailPending && historyError && (
        <p className="mt-5 text-[11.5px] leading-[17px] text-text-3">
          The delivery trail could not be read, which is why “reached a real person in the last 7 days”
          shows an em-dash rather than a zero — messages may well have gone out. Any “reached · 7d”
          count still on a card below is from the last trail that did come back.
        </p>
      )}

      {/* A FULL PAGE IS A CEILING, NOT A TOTAL. The trail stops at its limit,
          so every 7-day figure above is a floor once it comes back full — a
          desk that printed it as a total would under-report the busiest weeks,
          which are precisely the ones somebody is looking at. */}
      {!trailPending && !historyError && stats.trailCapped && (
        <p className="mt-5 text-[11.5px] leading-[17px] text-text-3">
          The delivery trail came back full — the newest {TRAIL_LIMIT} tellings — so “reached” above is
          at least that many and not exactly: older tellings exist that this desk did not read.
        </p>
      )}

      {previewDenied && (
        <p className="mt-5 text-[11.5px] leading-[17px] text-text-3">
          The “would fire now” preview is admin-only, which is why the hero shows an em-dash and the
          cards carry no “people due now” count — the desk works without it, and none of the numbers
          above depend on it.
        </p>
      )}

      {/* REFUSED AND UNANSWERED READ THE SAME ON SCREEN ONLY IF YOU LET THEM.
          This is the second, and it is not an authorisation fact: nothing was
          declined, the read simply did not come back inside its deadline. */}
      {previewUnread && (
        <p className="mt-5 text-[11.5px] leading-[17px] text-text-3">
          The “would fire now” preview did not come back, which is why the hero shows an em-dash and the
          cards carry no “people due now” count. It was not refused — the door was asked and did not
          answer inside its deadline, so nobody here knows how many are due. The desk works without it,
          and none of the other numbers above depend on it.
        </p>
      )}

      {/* ─────────────────────────────────────────────────────────────────
          HOW TO READ THIS DESK. The rules the screen keeps about its own
          arithmetic, on the screen, in the order they are argued. They are
          not footnotes: each one is the difference between a figure that can
          be acted on and a figure that only looks like it can.
          ───────────────────────────────────────────────────────────────── */}
      <div className="mt-8">
        <h2 className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
          <BookOpen size={14} className={cn('shrink-0', TINT_FG.blue)} />
          How to read this desk
        </h2>
        <p className="mb-3 max-w-[78ch] text-[12px] leading-[18px] text-text-3">
          Every number above is a <span className="font-semibold text-text-2">reading</span>, and a reading
          can fail, be bounded, or be refused. Where that happens the figure is drawn as an em-dash and
          this desk says which it was — because a zero printed for a question nobody answered is the one
          mistake a catalogue of messages cannot afford: somebody switches a situation on believing
          nothing is due.
        </p>

        <Card className="mb-3">
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            <span className="font-semibold text-text-1">The bundle species had no section here at all.</span>{' '}
            The one situation the obligations lane owns was invisible on this desk while its sends piled up
            on the Activity page — a species missing from the list has no screen, and the rows exist all the
            same. It leads the sections now, and instead of a permanent <code>0 would fire</code> it carries
            a chip naming the lane that drives it. The same rule was then owed to every other species the
            preview does not walk, so a digest, an event, a mailbox watcher and an AI request each say what
            decides them rather than reporting a zero they could never move off.
          </p>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Rule tint="mint" label="Reached, not sent">
            The delivery trail is written only when a message reached a{' '}
            <span className="font-semibold text-text-1">real person</span>. While test mode is on, every
            message is held as a rehearsal in Postgres instead (the Activity page lists them), so this figure sits
            near zero with the lane working on every pass. Read as “sent”, it invited exactly the wrong
            conclusion — that the lane had gone quiet. One row is one telling, not one message: a situation
            on sms and e-mail writes a single row.
          </Rule>
          <Rule tint="pink" label="A failed read is not a zero">
            When the situations do not come back, the counts above become em-dashes and the desk says the
            read failed. It never prints “0 situations” for a door that threw, and it never offers the empty
            state — “the tab holds nothing” is a claim about the tab, and only a read that came back may
            make it.
          </Rule>
          <Rule tint="amber" label="The trail is bounded">
            The delivery trail answers with the newest {TRAIL_LIMIT} tellings at most. When it comes back
            full, the seven-day figure reads <span className="font-semibold text-text-1">at least</span> that
            many and not exactly — older tellings exist that this desk never saw, and the busiest weeks are
            precisely the ones somebody is looking at.
          </Rule>
          <Rule tint="lavender" label="The preview is admin-only">
            “Would fire now” comes from a tool-lane read a manager may not make. Where it is refused the
            figure is an em-dash and the cards carry no count:{' '}
            <span className="font-semibold text-text-1">nobody may look</span> must never be shown as{' '}
            <span className="font-semibold text-text-1">nobody is due</span>. The rest of the desk works
            without it.
          </Rule>
          <Rule tint="peach" label="Not every species is counted">
            The preview walks the enabled, date-driven rows only — one match per person per credential — and
            excludes digests, obligation bundles, AI requests and window asks by name. It is what the next
            sweep would <span className="font-semibold text-text-1">build</span>, not what would land: a
            person with no number to reach is counted here, and nothing leaves at all while sending is off.
          </Rule>
          <Rule tint="blue" label="“priority —” means unanswered">
            Which ids sit on which rung is resolved by the lane from the words book&apos;s{' '}
            <code>comm_priority_*</code> rows and printed on every card. A card reading{' '}
            <span className="font-semibold text-text-1">priority —</span> is a ladder that could not be read
            just now — not the code’s floor of <code>ask</code>. Printing the floor would be the same species
            of lie as printing a zero for a read that never landed.
          </Rule>
        </div>
      </div>

      {/* The doors that are not messages, and the letters that are not
          held — both off the one situations read this desk already makes. */}
      <GateBoard gates={gates} letters={authLetters} reading={deskReading} readError={loadError} refused={refused} />

      {/* ─────────────────────────────────────────────────────────────────
          WHERE EVERY FIGURE CAME FROM — including the ones this desk does
          not read at all. A provenance table that listed only what it could
          answer would leave the reader believing the screen had looked
          everywhere.
          ───────────────────────────────────────────────────────────────── */}
      <div className="mt-8">
        <h2 className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
          <Table2 size={14} className={cn('shrink-0', TINT_FG.mint)} />
          Where every figure here comes from
        </h2>
        <p className="mb-3 max-w-[78ch] text-[12px] leading-[18px] text-text-3">
          {floor
            // THE TABLE CANNOT KEEP SAYING "READ LIVE" WHILE THE FLOOR IS HOLDING THE PAGE UP.
            ? <>The situation rows below were <span className="font-semibold">not</span> read on this page load — the
              door {deskReading ? 'has not answered yet' : 'did not answer'} and they come from {floorName(floor)},
              {' '}{floorAge(floor)}. Every count taken from them is a count of those rows. </>
            : <>Read live, on this page load — nothing below is a stored figure. </>}
          The greyed rows are the questions
          this desk does not ask at all; they are answered on the Activity, Rehearsal and Replies screens,
          and they are listed here so that a reader knows the difference between a count and a silence.
        </p>
        <Card padded={false} className="overflow-hidden">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">What</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Count</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Where it came from</th>
                </tr>
              </thead>
              <tbody>
                <Source
                  what="Situations in the catalogue"
                  count={countsKnown ? String(situations.length) : gap}
                  from={floor
                    ? `${floorName(floor)} · smartCommsGet ${deskReading ? 'still reading' : 'did not answer'} · ${floorAge(floor)}`
                    : 'smartCommsGet · the Smart Comms tab, every row'}
                  unread={!countsKnown}
                />
                <Source
                  what="Of those, switched on"
                  count={countsKnown ? String(stats.live) : gap}
                  from="enabled = yes"
                  unread={!countsKnown}
                />
                <Source
                  what="Written and switched off"
                  count={countsKnown ? String(stats.off) : gap}
                  from="enabled ≠ yes"
                  unread={!countsKnown}
                />
                <Source
                  what="Reached a real person, last 7 days"
                  count={sentKnown ? `${stats.trailCapped ? 'at least ' : ''}${stats.weekReached}` : trailGap}
                  from="smartCommsHistory · the delivery ledger, rehearsals dropped at the door"
                  unread={!sentKnown}
                />
                <Source
                  what="Tellings this desk actually read"
                  count={sentKnown ? String(deliveries.length) : trailGap}
                  from={`smartCommsHistory · newest ${TRAIL_LIMIT} at most`}
                  unread={!sentKnown}
                />
                <Source
                  what="Date-driven reminders that would fire now"
                  count={dueKnown ? String(stats.dueNow) : previewDenied || previewUnread ? '—' : dueGap}
                  from={previewUnread
                    ? 'smartCommsPreview · asked, and it did not answer inside its deadline'
                    : 'smartCommsPreview · admin-only, enabled date-driven rows only'}
                  unread={!dueKnown}
                />
                <Source
                  what="Situations that say which rung they are on"
                  count={countsKnown ? `${stats.priorityKnown} of ${situations.length}` : gap}
                  from="the lane resolves each id from the words book’s comm_priority_* rows"
                  unread={!countsKnown || stats.priorityKnown === 0}
                />
                <Source
                  what="Is test mode on?"
                  count={testMode === null ? 'not stated' : testMode.on ? 'on' : 'off'}
                  from={testMode === null
                    ? 'neither read carried it — absent, which is never read as off'
                    : 'smartCommsGet · the resolved test state, the same answer every send door acts on'}
                  unread={testMode === null}
                />
                {/* THE THIRD DOOR, LISTED APART FROM THE OTHER TWO. A row that
                    fires asks the dial, the transport property and the redirect
                    in that order, and they are owned and switched separately —
                    so the table that says where every figure came from has to
                    carry all three, including the one that answers "not
                    stated" today. */}
                <Source
                  what="Where is the sending dial?"
                  count={dial || 'not stated'}
                  from={dial
                    ? 'smartCommsGet · the dial follows test mode — send hands over, record writes it down, off refuses'
                    : 'what this desk read carried no dial — unread, which is not the same as quiet'}
                  unread={!dial}
                />
                <Source
                  what="Call-offs that resolved a house manager"
                  count={(() => {
                    const c = readReach('call_off_house_manager', reach)
                    return c && typeof c.call_offs === 'number'
                      ? `${c.resolved ?? 0} of ${c.call_offs}` : 'not stated'
                  })()}
                  from={reach
                    ? 'smartCommsGet · the reach of the house-manager row, counted by the call-off lane'
                    : 'the situations read does not carry it — the lane counts it, this desk is not handed it'}
                  unread={!readReach('call_off_house_manager', reach)}
                />
                <Source
                  what="Which workbook the catalogue lives in"
                  count={book.tab ? book.tab : gap}
                  from={book.id ? book.id : 'the read did not name the workbook — never assumed from a tab name'}
                  unread={!book.id}
                />
                <Source
                  what="Threads in this generation, and the obligations inside them"
                  count="not read here"
                  from="comm_intents · comm_bindings — the Rehearsal screen"
                  unread
                />
                <Source
                  what="Attempts carrying a provider receipt"
                  count="not read here"
                  from="comm_attempts — the evidence house, one row per attempt"
                  unread
                />
                <Source
                  what="People with a proposed route"
                  count="not read here"
                  from="comm_routes — a phone, an address, the hours their shifts say they are awake"
                  unread
                />
                <Source
                  what="What people answered back"
                  count="not read here"
                  from="comm_contributions — the Replies screen"
                  unread
                />
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {editing && (
        <SituationEditor
          sit={editing}
          book={keywords}
          floors={floors}
          team={team}
          seen={seenOnTrail(editing.id)}
          reach={reach}
          sentBy={sentBy}
          hours={schedule ? schedule[editing.id] ?? null : null}
          lines={lineBook?.lines ?? null}
          oldRows={floor ? { floor, reading: deskReading } : null}
          onClose={() => setEditing(null)}
          // The saved cells are on the card at once; the situations are read again behind them, and the head-count…
          onSaved={(patch, heard) => {
            savedHere(patch, heard)
            setEditing(null)
            void load({ countNow: patchCells(patch).includes('to'), situationsOnly: true })
          }}
        />
      )}
    </div>
  )
}
