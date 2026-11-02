// Settings → My Work → Support Requests: one switch per automation the Support Requests app runs.
// Each ships off, and a value that is missing, unknown or unreadable runs nothing (SupportDeskSwitches.gs…

export type AutoPart =
  | 'late_show' | 'no_call' | 'punch' | 'incident' | 'general' | 'vehicle' | 'payroll' | 'adp_update' | 'time_off'

export type AutoValues = Record<AutoPart, boolean>

export const AUTOS_OFF: AutoValues = {
  late_show: false, no_call: false, punch: false, incident: false, general: false, vehicle: false, payroll: false,
  adp_update: false, time_off: false,
}

export const SUPPORT_AUTOMATIONS: { part: AutoPart; key: string; label: string; desc: string }[] = [
  {
    part: 'late_show', key: 'mywork_auto_sr_late_show', label: 'Late Show warnings',
    desc: 'A Late Show becomes a warning request, “Directors, are you aware?”, and a red alert in each director’s My Inbox. No text: the Late Show message already speaks.',
  },
  {
    part: 'no_call', key: 'mywork_auto_sr_no_call_no_show', label: 'No Call No Show warnings',
    desc: 'The same for a No Call No Show: a warning request and a red alert in each director’s My Inbox.',
  },
  {
    part: 'punch', key: 'mywork_auto_sr_punch_missing', label: 'Missing punch warnings',
    desc: 'The first missing clock-in or clock-out of a shift: a warning request and an alert to Ty, Brittany, Arthur and Wellington, and a text through the Smart Comms situation sr_punch_aware.',
  },
  {
    part: 'incident', key: 'mywork_auto_sr_incident', label: 'Incident alerts',
    desc: 'Every incident filed (hotline, platform or form): an alert marked important to the directors, Arthur and Wellington — the category, the house and the day, never the report.',
  },
  {
    part: 'general', key: 'mywork_auto_sr_general_requests', label: 'General requests to Arthur and Wellington',
    desc: '“Other - General Requests” becomes a My Inbox alert to Arthur and Wellington. No second text: the hotline already texts them both.',
  },
  {
    part: 'vehicle', key: 'mywork_auto_sr_vehicle', label: 'Vehicle requests to the directors',
    desc: 'A vehicle request or issue from the hotline goes to Ty and Brittany as an alert, then a text through sr_vehicle_request.',
  },
  {
    part: 'payroll', key: 'mywork_auto_sr_payroll', label: 'Payroll requests to Ty',
    desc: 'Pay stubs, payroll and time entry requests go to Ty as an alert, then a text through sr_payroll_request.',
  },
  {
    part: 'adp_update', key: 'mywork_auto_sr_adp_update', label: 'ADP information updates',
    desc: 'A proven address change is applied to the person’s record and the directors are told (sr_adp_applied); a new e-mail or phone waits for one approval in the side panel.',
  },
  {
    part: 'time_off', key: 'mywork_auto_sr_time_off', label: 'My Calendar vacation requests into Scheduling',
    desc: 'A time off request a person adds in My Calendar is asked of the directors in Scheduling (7 days’ notice) and shows in Support Requests and their My Inbox. Off, it files through Time Off as today.',
  },
]

/** A save lands on the app's next pass. */
export const AUTO_LANDS = 'Support Requests follows it from its next pass.'

export const AUTOS_FOOTNOTE = 'Three gates for every text: this switch, the Smart Comms situation, then test mode. ' +
  'If this setting cannot be read, no automation runs.'

export const AUTO_NOT_KNOWN = 'The backend does not know this switch yet — it arrives with the platform release that carries it. ' +
  'Until then it does not run.'

/** Only a plain yes runs — the same reading the backend gives the cell. */
export function autoWord(value: string | undefined): boolean {
  return ['yes', 'on', 'true', '1'].includes(String(value ?? '').trim().toLowerCase())
}
