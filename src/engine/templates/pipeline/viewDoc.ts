// OPENING WHAT IS ALREADY ON FILE — a dot carrying a positive check may have a document behind it, and that…
// A finished checklist item is a document somebody delivered.
import { fileToBase64, gasAction, inferMime } from '@/features/hiring/shared'
import { openFile } from '@/stores/useFileViewerStore'
import { toast } from '@/stores/useToastStore'

// checklist/matrix id → the Files catalogue's doc_id, for click-to-view.
export async function uploadCandidateDoc(
  who: { id: string; name?: string; email?: string },
  item: { id: string },
  file: File,
): Promise<void> {
  const base64 = await fileToBase64(file)
  await gasAction('tableDocUpload', {
    candidate_id: who.id,
    candidate_name: who.name ?? '',
    item_id: item.id,
    doc_id: DOC_ID_FOR[item.id] ?? '',
    email: who.email ?? '',
    filename: file.name,
    mime_type: inferMime(file),
    base64,
  })
}

export const DOC_ID_FOR: Record<string, string> = {
  cjis: 'background_check',
  'dropbox-link': 'dropbox_packet',
  'new-hire-packet': 'dropbox_packet',
  'dodd-cert': 'dodd_8hr',
  'cpr-cert': 'cpr_first_aid',
  'med-cert': 'med_del',
  'drivers-license': 'drivers_id',
  diploma: 'hs_diploma',
  'ss-card': 'ss_birth',
}

type DocRec = {
  id: string; name?: string; resumeLink?: string; docsOnFile?: string[]
  // THE APPLICATION'S ENVELOPE.
  application?: { srid?: string; status?: string } | null
}
type Item = { id: string; label: string; status: string }

// Is this item something a click could actually show?
export function itemViewable(rec: DocRec | null | undefined, item: Item | null | undefined): boolean {
  if (!rec || !item) return false
  if (item.status !== 'done' && item.status !== 'auto') return false
  if (item.id === 'resume') return !!rec.resumeLink
  // The application is addressed by envelope, not by doc_id — and the item is only ever `done` when that envelope…
  if (item.id === 'application') return !!rec.application?.srid
  const docId = DOC_ID_FOR[item.id]
  if (!docId) return false
  return Array.isArray(rec.docsOnFile) ? rec.docsOnFile.includes(docId) : true
}

/** The same question for a chip that is not a checklist item — the packet. */
export function docOnFile(rec: DocRec | null | undefined, itemId: string): boolean {
  const docId = DOC_ID_FOR[itemId]
  if (!rec || !docId) return false
  return Array.isArray(rec.docsOnFile) ? rec.docsOnFile.includes(docId) : true
}

/** The resume rides on the row itself; everything else is asked of docList. */
export async function viewItemDoc(rec: DocRec, itemId: string, label: string) {
  const who = String(rec.name ?? 'Candidate')
  if (itemId === 'resume' && rec.resumeLink) {
    openFile({ url: rec.resumeLink, title: `${who} — resume`, icon: 'file-text' })
    return
  }
  // THE APPLICATION IS FETCHED, NOT LOOKED UP (paying the debt the condition dictionary opened: it told people the…
  if (itemId === 'application') {
    const srid = rec.application?.srid
    if (!srid) return
    toast({ type: 'info', title: 'Fetching the signed application…' })
    try {
      const d = await gasAction<{ doc_url: string }>('recruitmentDoc', { signature_request_id: srid })
      if (d.doc_url) openFile({ url: d.doc_url, title: `${who} — application`, icon: 'file-text' })
      else toast({ type: 'info', title: 'The application could not be fetched.' })
    } catch (e) {
      // The server's sentence names the real reason — a missing API key, an envelope the mirror no longer holds…
      toast({ type: 'danger', title: 'The application could not be fetched.',
        body: e instanceof Error ? e.message : undefined })
    }
    return
  }
  const docId = DOC_ID_FOR[itemId]
  if (!docId) return
  try {
    const d = await gasAction<{ items: { doc_id: string; file_url: string }[] }>('docList', { candidate_id: rec.id })
    const url = d.items.find((i) => i.doc_id === docId)?.file_url
    if (url) openFile({ url, title: `${who} — ${label}`, icon: 'file-text' })
    else toast({ type: 'info', title: 'No file on record for this item yet.' })
  } catch {
    toast({ type: 'info', title: 'The document could not be fetched.' })
  }
}
