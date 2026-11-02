// WHO IS BEHIND THE SOURCE — clicking Direct shows the modal with the details of whoever made that direct, and…
// The chip on a pipeline card says WHERE somebody came from and stops there, which is the half that cannot be acted…
import type { ReactNode } from 'react'
import { CalendarDays, Signpost, UserRound } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/shared/Badge'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { ohioDayYear } from '@/lib/ohio'
import type { TintName } from '@/engine/types'

const str = (v: unknown) => String(v ?? '').trim()

// The same floor intake holds a phone to — under it, a tel: link would dial nothing, so the number is shown as the…
const dialable = (phone: string) => phone.replace(/\D/g, '').length >= 7

// `created_by` is a LANE STAMP, not a name.
const LANE_DOOR: { re: RegExp; door: string }[] = [
  { re: /^asa-hub-talent-auth:(.+)$/i, door: 'through the Talent Pipeline crossing' },
  { re: /^asa-hub-resume:(.+)$/i, door: 'from a résumé' },
  { re: /^asa-hub:(.+)$/i, door: '' },
]

function whoAdded(raw: string): string {
  if (!raw) return ''
  if (/^referral:public$/i.test(raw)) return 'The referrals form on the sign-in page'
  for (const lane of LANE_DOOR) {
    const m = lane.re.exec(raw)
    if (m) {
      const who = m[1].trim()
      return lane.door ? `${who} — ${lane.door}` : who
    }
  }
  return raw
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[12.5px]">
      <span className="mt-0.5 shrink-0 text-text-3">{icon}</span>
      <span className="w-[76px] shrink-0 text-text-3">{label}</span>
      <span className="min-w-0 flex-1 break-words text-text-1">{children}</span>
    </div>
  )
}

export function SourceModal({
  open,
  onOpenChange,
  rec,
  candidateName,
  source,
  tint,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  // The card's record.
  rec: Record<string, unknown> | null | undefined
  candidateName: string
  /** The chip's OWN word — what was clicked, never a second guess at the row. */
  source: string
  tint: TintName
}) {
  const who = candidateName.trim() || 'This card'
  const word = str(source)
  const referralName = str(rec?.referralName)
  const referralPhone = str(rec?.referralPhone)
  const addedBy = whoAdded(str(rec?.addedBy))
  // A referral is a card the sheet CALLS a referral, or one carrying a referrer while the source cell says…
  const isReferral = /referral/i.test(word) || Boolean(referralName || referralPhone)
  // 'Direct' is the fallback word, so the caveat below belongs to it alone — every other source was read off…
  const isDirect = /^direct$/i.test(word)
  const applied =
    rec?.appliedAt && !isNaN(new Date(String(rec.appliedAt)).getTime())
      ? ohioDayYear(String(rec.appliedAt))
      : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">
            Where this card came from
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-5 text-text-3">
            {who} — the chip on the card, and the person behind it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <Row icon={<Signpost size={12} />} label="Source">
            <Badge label={word} tint={tint} className="text-[10px]" />
          </Row>
          <Row icon={<CalendarDays size={12} />} label="Applied">
            {applied || <span className="text-text-2">No date on the row.</span>}
          </Row>
          <Row icon={<UserRound size={12} />} label="Added by">
            {addedBy || <span className="text-text-2">Nothing on the row says who added this card.</span>}
          </Row>
        </div>

        {isReferral && (
          <div className="space-y-2.5 rounded border border-border bg-surface-2 p-3">
            {referralName || referralPhone ? (
              <>
                <Row icon={<UserRound size={12} />} label="Referred by">
                  {referralName || <span className="text-text-2">No name was written down — only this number.</span>}
                </Row>
                <Row icon={<UserRound size={12} />} label="Their phone">
                  {referralPhone ? (
                    dialable(referralPhone) ? (
                      <a
                        href={`tel:${referralPhone.replace(/\D/g, '')}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {formatPhoneDisplay(referralPhone)}
                      </a>
                    ) : (
                      <>
                        {referralPhone}
                        <span className="text-text-3"> · too short to dial</span>
                      </>
                    )
                  ) : (
                    <span className="text-text-2">No number was written down.</span>
                  )}
                </Row>
              </>
            ) : (
              <p className="text-[12.5px] leading-5 text-text-2">
                This card is marked as a referral, but nobody wrote down who referred them — the
                referral name and phone on the row are both empty.
              </p>
            )}
          </div>
        )}

        {isDirect && (
          <p className="text-[12.5px] leading-5 text-text-2">
            Direct is also what the platform reads when the source cell is blank. The card is handed
            the word, not the cell, so it cannot tell somebody who came to us directly from a row
            nobody filled in. If you know where they actually came from, an admin can write it in
            Edit candidate.
          </p>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
