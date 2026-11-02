/** The Funnel board, unchanged, with the app's black header on top (mounted through CUSTOM_PAGES); whoever may open
 *  Client Candidates also gets each card's "Open in Client Candidates". */
import { useMemo } from 'react'
import PageRenderer from '@/engine/PageRenderer'
import { potentialClientsFunnelPage } from '@/registry/apps-potclients'
import { useCandidatesOpen, withCandidateLink } from '@/pages/features/clientcandidates/candidateLink'
import ReferralsHero from './ReferralsHero'
import { useReferralAnalysis } from './useReferralAnalysis'

export default function PotentialClientsFunnelPage() {
  const { read, retry } = useReferralAnalysis()
  const candidatesOpen = useCandidatesOpen()
  const schema = useMemo(() => (candidatesOpen ? withCandidateLink(potentialClientsFunnelPage) : potentialClientsFunnelPage),
    [candidatesOpen])
  return (
    <div className="w-full">
      <ReferralsHero read={read} on="funnel" onRetry={retry} />
      <PageRenderer schema={schema} />
    </div>
  )
}
