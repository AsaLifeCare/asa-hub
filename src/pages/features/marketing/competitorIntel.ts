// Curated-display helpers for the Marketing screen.
// Figures live on the Hub `marketing_competitors` tab (Marketing.gs seeds them from public sources).
export type CompetitorTier = 'peer' | 'mid' | 'large'

export const TIER_LABEL: Record<CompetitorTier, string> = {
  large: 'Largest',
  mid: 'Mid-size',
  peer: 'Direct peer',
}

export const TIER_TINT: Record<CompetitorTier, 'pink' | 'amber' | 'mint'> = {
  large: 'pink',
  mid: 'amber',
  peer: 'mint',
}
