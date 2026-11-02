/** Stub routes owned by later page agents (apps.md / notifications.md / settings.md). */
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import PageHeader from '@/components/shared/PageHeader'
import TintTile from '@/components/shared/TintTile'
import type { TintName } from '@/engine/types'

function Stub({ title, sub, icon, tint }: { title: string; sub: string; icon: string; tint: TintName }) {
  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader title={title} subtitle={sub} />
      <Card className="flex flex-col items-center py-10 text-center">
        <TintTile icon={icon} tint={tint} size="xl" />
        <div className="mt-4 max-w-[360px]">
          <EmptyState title={`${title} is on its way`} body="This surface is a scaffold placeholder — a page agent builds the full experience on top of the shell contracts." />
        </div>
      </Card>
    </div>
  )
}

export function AppsStub() {
  return <Stub title="App Hub" sub="Install and manage workspace apps" icon="layout-grid" tint="mint" />
}

export function NotificationsStub() {
  return <Stub title="Notifications" sub="Your full inbox, filters and bulk actions" icon="bell" tint="blue" />
}

export function SettingsStub() {
  return <Stub title="Settings" sub="Appearance, notifications and API driver config" icon="settings" tint="lavender" />
}
