// Medications: what the pharmacy dispensed for this house's residents — House Supplies' own tab, narrowed to the house.
// Whoever Locations opens the house to reads it whole (locationMedications, Locations' own door); a client's or a
// guardian's view never draws it.
import { gasAction } from '@/features/hiring/shared'
import { isoOf, type MedsView } from '@/lib/houseMedsAnalysis'
import HouseMedsTab from '@/pages/features/housesupplies/HouseMedsTab'
import { readKey, useLocationRead, useLocationViewer } from '../useLocation'
import { ReadLine, SectionCard } from '../LocationParts'

function todayIso(): string {
  const now = new Date()
  return isoOf(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}

const viewOf = (raw: unknown): MedsView => raw as MedsView

export default function HouseMedications({ house }: { house: string }) {
  const viewer = useLocationViewer()
  const meds = useLocationRead(viewer.cut ? null : readKey('locationMedications', house),
    () => gasAction<unknown>('locationMedications', { house }), viewOf)
  if (viewer.cut) return null
  const view = meds.data
  return (
    <SectionCard title="Medications" sub="What the pharmacy dispensed for this house's residents, as House Supplies reads it.">
      <ReadLine state={meds} what="the pharmacy's reports" onRetry={meds.reload} />
      {view && <HouseMedsTab view={view} todayIso={todayIso()} initialLow={false} onChanged={meds.reload}
        fixedHouse={house}
        readHistory={(key) => gasAction<unknown>('locationMedicationHistory', { house, key })} />}
    </SectionCard>
  )
}
