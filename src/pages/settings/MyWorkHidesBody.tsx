// Settings → My Work: the switches Python alone keeps (myWorkHidesGet / myWorkHidesSet), each keeping one part to the
// master's own session; every part is hidden while nothing says to show it.
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import ConfigReadFailed from './ConfigReadFailed'
import { STAMPS_LANDS } from './myWorkDisplay'

type HidePart = 'add_apps' | 'time_off_messages' | 'sched_training_legend' | 'ssa_documents' | 'sched_time_off_all'
  | 'test_mode_warnings' | 'client_medication' | 'client_billing' | 'inbox_alerts' | 'location_supplies' | 'profile_docs'
  | 'copy_mirrored' | 'inbox_alerts_subtitle' | 'candidates_crumb' | 'transport_submenu' | 'client_trips' | 'staff_calendar_clients'
  | 'staff_calendar_details' | 'client_edit_notes' | 'ssa_coordination' | 'ssa_edit_notes' | 'incident_notes' | 'client_transport_notes' | 'staff_profile_map' | 'staff_profile_ists_worked' | 'staff_edit_notes' | 'recruiters_book' | 'apply_progress' | 'support_desk_subtitle' | 'client_care_home' | 'ist_booking' | 'mail_app'
type HideValues = Record<HidePart, boolean>

export const MY_WORK_HIDE_SWITCHES: {
  part: HidePart
  heading: string
  label: string
  desc: string
  /** the state in words, where "Hidden from everyone else" / "Shown to everyone" would say it wrong */
  words?: { hidden: string; shown: string }
}[] = [
  {
    part: 'add_apps', heading: 'Sidebar', label: 'The “+ Add apps” button',
    desc: 'The dashed button at the bottom of the sidebar that opens the App Hub. Everyone else enters through My Work.',
  },
  {
    part: 'time_off_messages', heading: 'My Work · Time off', label: 'Send Message Approved / Not Approved',
    desc: 'The two buttons under a Time off approval row in My Actions that tell the person the outcome through Smart Comms. Hidden, nobody else sees them or can send them.',
  },
  {
    part: 'ist_booking', heading: 'My Work · Client training (IST)', label: 'Book training here, directors approve here',
    desc: 'Book training opens a side panel in My Work (the client, the staff member, the date, confirmed or declined) instead of Workforce Compliance; Send puts it in front of the directors and above, who approve it in My Work, and the person reads the approval there. Hidden, everyone else keeps the Workforce Compliance link and sees no booking or approval.',
  },
  {
    part: 'sched_training_legend', heading: 'Scheduling', label: 'The key’s training line',
    desc: 'The cap icon and “Training with the house manager (no IST) — not counted as DSP” in the colour key above the grid. The cells keep their marks.',
  },
  {
    part: 'sched_time_off_all', heading: 'Scheduling · Time Off Requests', label: 'Every ask, house manager and up',
    desc: 'Every account from house manager up (HM, MANAGER, ADMIN, DIRECTOR and every badge above) sees every time off ask. Hidden, they see their own and their houses’ asks, and only the directors the Scheduling settings list see every ask. Staff always see their own alone.',
    words: { hidden: 'Only the listed directors see every ask', shown: 'House managers and up see every ask' },
  },
  {
    part: 'test_mode_warnings', heading: 'Every app', label: 'Test mode warnings',
    desc: 'Every TEST MODE banner, pill and line the apps draw: Transportation, Scheduling (its banner, a request’s “Made while test mode was on”, the approval panel), Support Requests, My Calendar (the banner, a request’s “Test” pill, a shift’s Test mode mark), My Work’s approval panel and its Test mode fact, and “Test mode” in My Inbox’s items. Families, SSA, Staff, Clients, Locations, Emergency Contacts, both candidate apps and My Profile draw none today. Test mode itself stays on; only the warning is hidden.',
  },
  {
    part: 'ssa_documents', heading: 'SSA', label: 'Documents',
    desc: 'The Documents section of every SSA profile: its tab and its list. Hidden, nobody else sees it or reads it there.',
  },
  {
    part: 'client_medication', heading: 'Clients', label: 'Medication',
    desc: 'The Medication section of every client: its tab and its lists. Hidden, nobody else sees it or reads it there.',
  },
  {
    part: 'client_billing', heading: 'Clients', label: 'Billing',
    desc: 'The Billing section of every client. Hidden, nobody else sees its tab.',
  },
  {
    part: 'client_care_home', heading: 'Clients · Care & Support', label: 'Home & equipment',
    desc: 'The Home & equipment tab of every client’s Care & Support. Hidden, nobody else sees it or reads it there.',
  },
  {
    part: 'inbox_alerts', heading: 'My Inbox · Alerts', label: 'New staff members and platform updates',
    desc: 'The alerts about new staff members and the release notes’ updates: every app updated, security updated, privacy updated. Hidden, nobody else gets them or sees their filters.',
  },
  {
    part: 'location_supplies', heading: 'Locations', label: 'House Supplies',
    desc: 'The House Supplies section of every house: its tab and its counts. Hidden, nobody else sees it or reads it there.',
  },
  {
    part: 'support_desk_subtitle', heading: 'Support Requests', label: 'The line under the title',
    desc: '“Every hotline request and every scheduling request, in one place.” under Support Requests. Hidden, nobody else sees it.',
  },
  {
    part: 'profile_docs', heading: 'My Profile', label: 'My Docs',
    desc: 'The My Docs page in My Profile, for every person: on its rail and under My Profile in the sidebar. Hidden, nobody else sees it.',
  },
  {
    part: 'copy_mirrored', heading: 'My Profile · My Requirements', label: 'When the copy was mirrored',
    desc: '“Requirements: the copy read here was mirrored Oct 23, 2026 — anything filed since may not show yet”, and the same line under My Work’s sources. Hidden, nobody else sees it.',
  },
  {
    part: 'inbox_alerts_subtitle', heading: 'My Inbox · Alerts', label: 'The line under the title',
    desc: '“What concerns you, from every source that can tell — newest first”.',
  },
  {
    part: 'candidates_crumb', heading: 'Staff Candidates · Client Candidates', label: 'The breadcrumb inside the page',
    desc: 'The second “Staff Candidates › Overview” (or Client Candidates) drawn above the candidate’s card; the one in the top bar stays.',
  },
  {
    part: 'transport_submenu', heading: 'Sidebar', label: 'Transportation’s submenu',
    desc: 'Calendar, History and Vehicles under Transportation in the sidebar. Hidden, the sidebar opens the Calendar and the pages stay a tab away.',
  },
  {
    part: 'client_trips', heading: 'Clients · Appointments', label: 'Transportation trips',
    desc: 'The client’s Transportation trips listed under their appointments.',
  },
  {
    part: 'staff_calendar_clients', heading: 'Staff · Calendar', label: 'The clients’ names',
    desc: 'The names of the house’s clients on each shift, and the client on each trip. The house and the shift stay.',
  },
  {
    part: 'staff_calendar_details', heading: 'Staff · Calendar', label: 'The calendar’s details',
    desc: 'The line under the title, the count of shifts coming up, each week’s heading and its count, and the badges on a shift (Med, HM, Team leader). Everyone else sees one table of the shifts and trips, the shift’s state still on each row.',
  },
  {
    part: 'client_edit_notes', heading: 'Clients · Client details panel', label: 'The panel’s notes',
    desc: 'In a client’s edit panel: its title, the Updated line, the intro naming what is sent, and the notes under the fields (the rename, the status, the house, and why the SSN and the card are locked). The fields stay, a locked one still locked.',
  },
  {
    part: 'ssa_coordination', heading: 'SSA · Activity', label: 'Coordination follow-up',
    desc: 'The Coordination follow-up section under the timeline: each client’s plan date to follow up on. The timeline stays.',
  },
  {
    part: 'ssa_edit_notes', heading: 'SSA · Edit details panel', label: 'The panel’s notes',
    desc: 'In an SSA’s edit panel: its title, the intro naming where the fields land, and the notes under the fields (the agency’s, the e-mail’s). The fields stay.',
  },
  {
    part: 'client_transport_notes', heading: 'Clients · Transportation', label: 'Vehicles, the counts and their notes',
    desc: 'The Vehicles tab, the counts on History (Needs assignment, Scheduled, Completed) and the lines under them (what each count means, the newest entry). The calendar, the trips and New trip stay; a source that could not be read is still said.',
  },
  {
    part: 'incident_notes', heading: 'Incidents · New incident panel', label: 'The panel’s notes',
    desc: 'In every New incident panel (Locations, Clients, Families & Guardians): its title, the lines under the title, the note under each field (Summary, Immediate Action, Cause, Prevention) and the Still needed line. The fields stay, the required ones still required.',
  },
  {
    part: 'staff_profile_map', heading: 'Staff · Staff Profile', label: 'The map under Associated locations',
    desc: 'The Google map of the person’s houses and its Open larger. The houses stay listed.',
  },
  {
    part: 'staff_profile_ists_worked', heading: 'Staff · Staff Profile', label: 'ISTs and Where they worked',
    desc: 'The ISTs card (which clients the person is trained on) and Where they worked (the houses from the Calendar Archive and the PSI punches). Staff Details, the clients, the locations and the notes stay.',
  },
  {
    part: 'staff_edit_notes', heading: 'Staff · Edit panels', label: 'The panels’ notes',
    desc: 'In every Staff edit panel (Staff Details, Employment, HR Admin, Compliance, Driver, MAIS, IST, notes): the intro naming where each field is saved and the notes under the fields. The fields stay, a locked one still locked.',
  },
  {
    part: 'recruiters_book', heading: 'Recruiters’ Book', label: 'The whole app',
    desc: 'The Recruiters’ Book app itself: not in anyone else’s apps or sidebar, and every one of its pages (Talent Pipeline, Onboarding, the screens) refused to them, even once App Control releases it. You keep it as it is.',
  },
  {
    part: 'mail_app', heading: 'Mail', label: 'The whole app',
    desc: 'The Mail app is yours alone, whichever way this is set: no badge, App Control row or seen list opens it, a Director or a Platform Lead included. Hidden, it is also cut from every other account’s app lists, the seen list’s too.',
  },
  {
    part: 'apply_progress', heading: 'Every edit panel', label: 'The progress panel after Apply',
    desc: 'The bar and the steps (Postgres, kept caches, slices, live ring, this page) an edit’s Apply shows. Hidden, Apply does the edit and the panel closes; a refusal is still said.',
  },
]

export default function MyWorkHidesBody() {
  const [values, setValues] = useState<HideValues | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await gasAction<Partial<Record<HidePart, unknown>>>('myWorkHidesGet', {})
      setValues(Object.fromEntries(MY_WORK_HIDE_SWITCHES.map((s) => [s.part, d?.[s.part] !== false])) as HideValues)
    } catch (e) {
      // never painted as "shown": a switch flipped over a value nobody read would write a law
      setValues(null)
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const flip = async (part: HidePart, next: boolean) => {
    if (values === null) return
    const before = values
    setValues({ ...values, [part]: next })
    setBusy(true)
    try {
      await gasAction('myWorkHidesSet', { part, hidden: next })
      toast({ type: 'success', title: 'Saved', body: STAMPS_LANDS })
    } catch (e) {
      setValues(before)
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 space-y-3 border-t border-border pt-4" data-switch-group="Python switches">
      {values === null ? (
        failed
          ? <ConfigReadFailed why={failed} onRetry={() => { setFailed(''); void load() }} />
          : <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the config…</p>
      ) : MY_WORK_HIDE_SWITCHES.map((s) => (
        <div key={s.part} className="space-y-3" data-switch-group={s.heading}>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">{s.heading}</h3>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5" data-hide-part={s.part}>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-text-1">{s.label}</p>
              <p className="text-[12px] text-text-3">{s.desc} Your own session always keeps it.</p>
              <p className="text-[12px] font-medium text-text-2" data-hide-word={s.part}>
                {values[s.part] ? (s.words?.hidden ?? 'Hidden from everyone else') : (s.words?.shown ?? 'Shown to everyone')}
              </p>
            </div>
            <Switch checked={values[s.part]} onCheckedChange={(v) => void flip(s.part, v)} disabled={busy}
              aria-label={`Hide ${s.label} from everyone else`} />
          </div>
        </div>
      ))}
    </div>
  )
}
