// Settings → Alerts I receive: each director's, and the master's, own choice of whether three alerts reach them.
// The server decides who has the section (AlertReceive.gs alertReceiveGet answers the directors and the master, 404…

export type ReceivePart = 'no_call' | 'punch' | 'incident'

export type ReceiveValues = Record<ReceivePart, boolean>

export type ReceiveRead = { as: 'master' | 'director'; receive: ReceiveValues; saveable: boolean; why: string }

export const RECEIVE_PARTS: readonly ReceivePart[] = ['no_call', 'punch', 'incident']

export const RECEIVE_ALL_ON: ReceiveValues = { no_call: true, punch: true, incident: true }

export const RECEIVE_ALERTS: { part: ReceivePart; label: string; desc: string }[] = [
  {
    part: 'no_call', label: 'No Call No Show',
    desc: 'A shift that began with nobody on it and no call: the red My Inbox alert, the bell’s no-call no-show notice, and the No Show No Call e-mail and text where they name you.',
  },
  {
    part: 'punch', label: 'Is not punching in',
    desc: 'The first missing clock-in or clock-out of a shift (“Eve Tan is not punching in”, or out): the My Inbox alert and its text.',
  },
  {
    part: 'incident', label: 'Incident filed',
    desc: 'Every incident filed from the hotline, the platform or the form: the important My Inbox alert, and the hotline’s incident e-mail and text where they name you.',
  },
]

export const RECEIVE_SUB = 'Yours alone: an alert you turn off stops reaching you — in My Inbox, by text and by e-mail.'

export const RECEIVE_KEEPS = 'The staff member an alert is about, and everybody else it reaches, keep receiving it as before.'

export const RECEIVE_LANDS = 'It applies from the next alert on.'

/** The read's answer, or null when it is not one. */
export function receiveFrom(data: unknown): ReceiveRead | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const raw = d.receive && typeof d.receive === 'object' ? d.receive as Record<string, unknown> : null
  if (!raw || (d.as !== 'master' && d.as !== 'director')) return null
  const receive = { ...RECEIVE_ALL_ON }
  for (const p of RECEIVE_PARTS) receive[p] = raw[p] !== false
  return { as: d.as, receive, saveable: d.saveable !== false, why: typeof d.why === 'string' ? d.why : '' }
}
