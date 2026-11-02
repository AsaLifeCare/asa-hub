/**
 * THE CENTRED VIEWER WITH BYTES READ THROUGH A DOOR: a blob: URL lives only in this tab, so the viewer offers no
 * Share (a copied blob link is dead for anyone else) and saves the file under the document's name, not the blob's id.
 * A link from anywhere else keeps Share.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import { FileViewerView, downloadName } from '@/components/shared/FileViewer'

const noop = () => {}

describe('FileViewer with a local document', () => {
  it('a blob document has no Share and downloads under its own name', () => {
    const html = renderToString(<FileViewerView file={{ title: 'Med Del: Cat 2 / Part 1', url: 'blob:https://hub.example/abc' }} closeFile={noop} />)
    assert.match(html, /Open in new tab/)
    assert.doesNotMatch(html, />Share</)
    assert.match(html, /download="Med Del Cat 2 Part 1"/)
  })

  it('a link keeps Share and the plain download', () => {
    const html = renderToString(<FileViewerView file={{ title: 'Policy', url: 'https://drive.google.com/file/d/abc/view' }} closeFile={noop} />)
    assert.match(html, />Share</)
    assert.match(html, /download=""/)
  })

  it('nothing is drawn without a file', () => {
    assert.equal(renderToString(<FileViewerView file={null} closeFile={noop} />), '')
  })

  it('names a download from the title, never an empty or unsafe name', () => {
    assert.equal(downloadName('A/B:C*D?'), 'A B C D')
    assert.equal(downloadName('   '), 'document')
    assert.equal(downloadName(''), 'document')
    assert.equal(downloadName('x'.repeat(200)).length, 120)
  })
})
