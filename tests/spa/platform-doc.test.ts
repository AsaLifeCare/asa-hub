/**
 * THE PLATFORM'S DOCUMENT VIEWING RULE: bytes from an authenticated door open centred, in the one FileViewer, as a
 * blob URL on the platform's own origin — revoked when the viewer closes or another file takes its place. Only a
 * PDF or a picture becomes a URL; a refusal is a toast; an older ask never lands over a newer one.
 */
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveObjectURL } from 'node:buffer'
import { DOC_FAILED_TITLE, DOC_NOT_SHOWN, openPlatformDoc, usePlatformDoc, type DocBytes } from '@/lib/platformDoc'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import { useToastStore } from '@/stores/useToastStore'
import { mountHook } from './react-host'

const PDF: DocBytes = { name: 'a.pdf', mime: 'application/pdf', b64: Buffer.from('%PDF').toString('base64') }
const PNG: DocBytes = { name: 'a.png', mime: 'image/png', b64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') }
const viewer = () => useFileViewerStore.getState().file
const alive = (url: string) => resolveObjectURL(url) !== undefined

afterEach(() => {
  useFileViewerStore.getState().closeFile()
  useToastStore.setState({ toasts: [] })
})

describe('openPlatformDoc', () => {
  it('opens the bytes centred as a blob URL of their own type, with the heading given', async () => {
    assert.equal(await openPlatformDoc(PDF, { title: 'Policy', subtitle: 'All locations' }), true)
    const f = viewer()
    assert.ok(f)
    assert.match(f.url, /^blob:/)
    assert.deepEqual([f.title, f.subtitle, f.icon], ['Policy', 'All locations', 'file-text'])
    assert.equal(resolveObjectURL(f.url)?.type, 'application/pdf')
  })

  it('the URL is revoked when the viewer closes, and when another file takes its place', async () => {
    await openPlatformDoc(PDF, { title: 'One' })
    const one = viewer()!.url
    await openPlatformDoc(Promise.resolve(PNG), { title: 'Two' })
    const two = viewer()!.url
    assert.ok(!alive(one), 'the first file is let go when the second opens')
    assert.ok(alive(two))
    useFileViewerStore.getState().closeFile()
    assert.ok(!alive(two), 'closing lets the file go')
  })

  it('only a PDF or a picture becomes a URL; a file without bytes is refused', async () => {
    await assert.rejects(openPlatformDoc({ mime: 'text/html', b64: 'PGgxPg==' }, { title: 'x' }), new RegExp(DOC_NOT_SHOWN))
    await assert.rejects(openPlatformDoc({ mime: 'application/pdf', b64: '' }, { title: 'x' }), /without its file/)
    assert.equal(viewer(), null)
  })

  it('an older ask never lands over a newer one', async () => {
    let release: (v: DocBytes) => void = () => {}
    const slow = openPlatformDoc(new Promise<DocBytes>((r) => { release = r }), { title: 'Slow' })
    await openPlatformDoc(PNG, { title: 'Fast' })
    release(PDF)
    assert.equal(await slow, false)
    assert.equal(viewer()?.title, 'Fast')
  })
})

describe('usePlatformDoc', () => {
  it('names the ask while its bytes come, then opens it; a refusal is a toast in the caller\'s words', async () => {
    let release: (v: DocBytes) => void = () => {}
    const h = mountHook(() => usePlatformDoc((e) => `said: ${e}`), {})
    h.run(() => h.current.open('d1', () => new Promise<DocBytes>((r) => { release = r }), { title: 'Doc one' }))
    assert.equal(h.current.opening, 'd1')
    release(PDF)
    await h.settle(() => h.current.opening === '')
    assert.equal(viewer()?.title, 'Doc one')
    useFileViewerStore.getState().closeFile()
    h.run(() => h.current.open('d2', () => Promise.reject(new Error('no such document')), { title: 'Doc two' }))
    await h.settle(() => h.current.opening === '')
    assert.equal(viewer(), null)
    const [t] = useToastStore.getState().toasts
    assert.deepEqual([t?.type, t?.title, t?.body], ['danger', DOC_FAILED_TITLE, 'said: no such document'])
    h.unmount()
  })
})
