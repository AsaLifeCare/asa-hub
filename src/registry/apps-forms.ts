// FORMS — the detachable page as an app of its own.
// Two pages, and the split is deliberate: the LINKS, which is what gets sent to somebody, and the ANSWERS, which is…
import type { AppManifest, PageSchema } from '@/engine/types'
import { useRegistryStore } from '@/stores/useRegistryStore'

const formsLinksPage: PageSchema = {
  id: 'links',
  type: 'sheet',
  title: 'Forms',
  icon: 'link',
  // No `forms` resource is drawn generically here on purpose: the definition row carries the TOKEN that is the key…
  dataSource: { resource: 'forms' },
  config: { entity: ['form', 'forms'], customFeature: 'forms/FormsPage' },
}

const formsAnswersPage: PageSchema = {
  id: 'answers',
  type: 'sheet',
  title: 'Answers',
  icon: 'inbox',
  dataSource: { resource: 'formSubmissions' },
  config: { entity: ['answer', 'answers'], customFeature: 'forms/FormResponsesPage' },
}

export const formsManifests: AppManifest[] = [
  {
    id: 'forms',
    name: 'Forms',
    tagline: 'A page you send as a link — filled in once, landing here',
    icon: 'clipboard-list',
    accent: 'mint',
    category: 'Operations',
    version: '1.0.0',
    // 'form' keeps this very app visible while a form is focused — every app whose audience names neither 'all' nor…
    audience: ['admin', 'manager', 'form'],
    isNew: true,
    enabled: true,
    pages: [formsLinksPage, formsAnswersPage],
    notifications: ['app'],
  },
]

// Deferred for the same reason as the Guardian's: a module-level getState() crashes with a TDZ ReferenceError when…
queueMicrotask(() => {
  const registered = useRegistryStore.getState().apps
  const missing = formsManifests.filter((m) => !registered.some((a) => a.id === m.id))
  if (missing.length) useRegistryStore.setState({ apps: [...registered, ...missing] })
})
