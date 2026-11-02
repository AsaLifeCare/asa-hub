// Cortex — the platform works on the basis of apps, so the Neural Cortex is an app of its own: the full-screen…
// The Copilot star keeps the quick door; this is the house.
import type { AppManifest, PageSchema } from '@/engine/types'

const chatPage: PageSchema = {
  id: 'chat',
  type: 'sheet',
  title: 'Chat',
  icon: 'messages-square',
  // No `cortexChat` resource exists in the resolver, deliberately: the screen posts to /cortex/chat/send and…
  dataSource: { resource: 'cortexChat' },
  config: {
    entity: ['message', 'messages'],
    customFeature: 'cortex/CortexChatPage',
  },
}

const connectomePage: PageSchema = {
  id: 'connectome',
  type: 'sheet',
  title: 'Connectome',
  icon: 'waypoints',
  // Same discipline: /cortex/mesh/graph + /live, admin-only at the relay.
  dataSource: { resource: 'cortexMesh' },
  config: {
    entity: ['node', 'nodes'],
    customFeature: 'cortex/ConnectomePage',
  },
}

export const cortexManifests: AppManifest[] = [
  {
    id: 'cortex',
    name: 'Cortex',
    tagline: "Ask the platform. Watch it think.",
    icon: 'brain',
    accent: 'lavender',
    category: 'Workspace',
    version: '1.0.0',
    // CLIENT IS NAMED HERE, and naming it is not what makes the app appear.
    audience: ['admin', 'manager', 'staff', 'client'],
    isNew: true,
    enabled: true,
    pages: [chatPage, connectomePage],
    notifications: ['app'],
  },
]
