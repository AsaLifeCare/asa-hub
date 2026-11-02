// Builds the detail-panel payload for an event (body moved verbatim from ScheduleTemplate.tsx's openEvent; the…
import { format } from 'date-fns'
import { peopleByIds, personById } from '@/lib/people-lookup'
import type { DetailPanelPayload } from '@/stores/useDetailPanelStore'
import type { CalEvent, TintName } from '@/engine/types'
import type { EventTypeMap, Resource } from './types'
import { fromMin, houseOf, toMin } from './utils'

export function buildEventDetail(e: CalEvent, eventTypes: EventTypeMap, resources: Resource[]): DetailPanelPayload {
  const t = eventTypes[e.type] ?? { label: e.type, tint: 'blue' as TintName }
  const owner = resources.find((r) => r.id === e.personId)
  const ownerPerson = personById(e.personId)
  const day = new Date(`${e.date}T00:00:00`)
  const endMin = toMin(e.start) + e.durationMin
  const attendees = peopleByIds(e.attendees)
  const house = houseOf(e)
  return {
    record: e as unknown as Record<string, unknown>,
    config: {
      header: {
        avatar: owner?.avatar ?? ownerPerson?.avatar,
        title: e.title,
        subtitle: `${t.label} · ${format(day, 'EEE MMM d')}, ${e.start}–${fromMin(endMin)}`,
        statusChip: { label: 'Confirmed', tint: 'mint' },
        actions: [
          { icon: 'message-circle-plus', label: 'Message staff' },
          { icon: 'calendar-clock', label: 'Reschedule' },
        ],
      },
      stats: [
        { label: 'Duration', value: `${e.durationMin}m`, icon: 'clock', tint: 'blue' },
        { label: 'House', value: house, icon: 'map-pin', tint: 'peach' },
        { label: 'Type', value: t.label, icon: 'tag', tint: t.tint },
        { label: 'Attendees', value: attendees.length + (owner ? 1 : 0), icon: 'users', tint: 'mint' },
      ],
      sections: [
        {
          kind: 'list',
          title: 'Attendees',
          items: [
            ...(owner ? [{ title: `${owner.name} (on shift)`, meta: 'Confirmed', avatar: { src: owner.avatar, name: owner.name } }] : []),
            ...attendees.map((p) => ({ title: p.name, meta: 'Confirmed', avatar: p })),
          ],
        },
        {
          kind: 'fields',
          title: 'Details',
          fields: [
            { icon: 'user', label: 'Assigned to', value: owner?.name ?? '—' },
            { icon: 'calendar', label: 'Date', value: format(day, 'EEEE, MMM d, yyyy') },
            { icon: 'map-pin', label: 'House', value: house },
            ...(e.type === 'shift' ? [{ icon: 'repeat', label: 'Recurs', value: 'Rota pattern' }] : []),
            ...(e.notes ? [{ icon: 'file-text', label: 'Notes', value: e.notes }] : []),
          ],
        },
        {
          kind: 'timeline',
          title: e.type === 'shift' ? 'Shift checkpoints' : 'Agenda',
          entries: [
            { time: e.start, text: e.type === 'shift' ? 'Clock in and read handoff notes' : 'Check-in and introductions', tint: t.tint },
            { time: fromMin(toMin(e.start) + Math.max(5, Math.round(e.durationMin * 0.2))), text: e.type === 'shift' ? 'Mid-shift tasks and documentation' : 'Main discussion', tint: 'blue' },
            { time: fromMin(endMin - Math.min(10, Math.max(5, Math.round(e.durationMin * 0.15)))), text: e.type === 'shift' ? 'Handoff to the next shift' : 'Wrap-up and action items', tint: 'mint' },
          ],
        },
      ],
    },
  }
}
