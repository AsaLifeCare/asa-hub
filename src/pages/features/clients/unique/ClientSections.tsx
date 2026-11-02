// The sections a client's screens share: Finances — with Client Finances merged in for a viewer that app admits…
// Unique draws them under its center strip, Record under its tabs, and this is the ONE component both mount…
import { useState } from 'react'
import type { ClientRow } from '../shared'
import ClientWellbeingTab from './WellbeingTabs'
import { ClientFinances, FinancesTab } from './FinancesTab'
import { isSharedSection } from './uniqueTabs'

export default function ClientSections({ current, client, financeAllowed }: {
  /** the chosen tab — a section id draws that section, anything else draws none */
  current: string
  client: ClientRow
  financeAllowed: boolean
}) {
  const mine = String(client.id)
  // which record Finances was opened for, remembered as the section opens rather than after it has drawn
  const [openedFor, setOpenedFor] = useState('')
  if (current === 'finances' && openedFor !== mine) setOpenedFor(mine)
  const keepsFinances = current === 'finances' || openedFor === mine
  const wellbeing = isSharedSection(current) && current !== 'finances' ? current : null

  if (!wellbeing && !keepsFinances) return null

  return (
    <>
      {keepsFinances && (
        <div key={mine} hidden={current !== 'finances'}>
          <FinancesTab client={client} finance={financeAllowed ? <ClientFinances client={client} /> : null} />
        </div>
      )}
      {wellbeing && <ClientWellbeingTab key={wellbeing} tab={wellbeing} client={client} />}
    </>
  )
}
