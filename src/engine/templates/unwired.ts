// A BUTTON A MANIFEST DECLARED AND NOBODY WIRED.
// The engine draws whatever an app's config lists — `secondaryActions`, `rowActions`, a stage's own menu.
import { toast } from '@/stores/useToastStore'

export function unwiredAction(label: string, note?: string): void {
  toast({
    type: 'warning',
    title: label,
    body: note
      ? `Nothing happened — ${note}`
      : 'Nothing happened: this button is declared in the app but has no action behind it yet.',
  })
}
