// A client files an incident or a repair request from their own house page.
// The form asks only what happened: the server writes the client's name, or their street, onto the row (Estate.gs…
import { useMemo, useState } from 'react'
import OpsRecordModal, { type OpsField } from '@/features/ops-flows/OpsRecordModal'
import { api } from '@/lib/api'
import { invalidate } from '@/lib/apiCache'
import { URGENCY_OPTIONS } from '@/lib/estateFiling'
import { toast } from '@/stores/useToastStore'
import type { FileTarget } from './houseTools'

export const FILING_FORMS: Record<FileTarget, { title: string; sent: string; fields: OpsField[] }> = {
  uiIncidents: {
    title: 'Report an incident',
    sent: 'The staff have your report.',
    fields: [
      { key: 'incident_category', label: 'What kind of incident', required: true, placeholder: 'e.g. a fall, a missed medication' },
      { key: 'incident_date', label: 'Date', kind: 'date', required: true },
      { key: 'incident_time', label: 'Time', kind: 'time' },
      { key: 'incident_location', label: 'Where', placeholder: 'Home, Community, Day program…' },
      { key: 'summary_of_incident', label: 'What happened', kind: 'textarea', required: true, placeholder: 'Who, what, when, where' },
      { key: 'immediate_action_taken', label: 'What was done right away', kind: 'textarea' },
    ],
  },
  workOrders: {
    title: 'Request maintenance',
    sent: 'Maintenance has your request.',
    fields: [
      { key: 'select_address_vehicle', label: 'House', required: true },
      { key: 'repair_type', label: 'What needs fixing', required: true, placeholder: 'e.g. Plumbing, a door, the heating' },
      { key: 'urgency_level', label: 'Urgency — 1 low … 5 high', kind: 'chips', options: URGENCY_OPTIONS, required: true },
      {
        key: 'please_describe_the_issue', label: 'Describe the issue', kind: 'textarea', required: true,
        placeholder: 'e.g. Kitchen faucet leaking at the base',
      },
    ],
  },
}

export default function HouseFilingModal({ target, address, onClose }: {
  target: FileTarget | null
  address: string
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const initial = useMemo(() => ({ select_address_vehicle: address }), [address])
  const form = target ? FILING_FORMS[target] : null

  return (
    <OpsRecordModal
      open={!!form}
      title={form?.title ?? ''}
      fields={form?.fields ?? []}
      row={null}
      initial={initial}
      busy={busy}
      onClose={onClose}
      onSubmit={async (v) => {
        if (!target || !form) return
        setBusy(true)
        try {
          await api.create(target, { ...v, timestamp: new Date().toISOString() })
          invalidate(target)
          toast({ type: 'success', title: 'Sent', body: form.sent })
          onClose()
        } catch (e) {
          toast({ type: 'danger', title: 'Could not send it', body: e instanceof Error ? e.message : 'Try again in a moment.' })
        } finally {
          setBusy(false)
        }
      }}
    />
  )
}
