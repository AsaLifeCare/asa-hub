// TALENT PIPELINE: the legacy recruiting engine's record — every analyzed résumé with its scores, red flags…
// The study and the split live in the day's handoff; Hotline.gs carries the other half.
import type { AppManifest, PageSchema } from '@/engine/types'

const scoresPage: PageSchema = {
  id: 'scores',
  type: 'sheet',
  title: 'Talent Pipeline',
  icon: 'user-check',
  // `talentPool`, NOT `candidates` — a page reads the JSON slice, never the sheet.
  dataSource: { resource: 'talentPool' },
  config: { entity: ['candidate', 'candidates'], customFeature: 'talentpipeline/TalentPipelinePage' },
}

// The statistics + canonical ranking + the leaders' authorization loop.
const analysisPage: PageSchema = {
  id: 'analysis',
  type: 'sheet',
  title: 'Analysis',
  icon: 'chart-column',
  // `hiringAnalysis` — the numbers are COMPUTED IN PYTHON now, the way the Technology screen already does it: that…
  dataSource: { resource: 'hiringAnalysis' },
  config: { entity: ['candidate', 'candidates'], customFeature: 'talentpipeline/AnalysisPage' },
}

export const talentPipelineManifests: AppManifest[] = [
  {
    id: 'talent-pipeline',
    name: 'Talent Pipeline',
    tagline: 'Every analyzed résumé — scores, red flags, screens and decisions',
    icon: 'user-check',
    accent: 'lavender',
    category: 'Manage',
    version: '1.0.0',
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    // THE APP CAME OFF THE SHELF: the standalone Talent Pipeline is dead and its two screens moved inside Hiring…
    unlisted: true,
    pages: [scoresPage, analysisPage],
    notifications: ['app'],
  },
]
