/**
 * THE SHARE PANEL FITS ITS SIDE PANEL. Locations, Clients and Staff all draw the same ShareBody: a long link must be
 * cut with an ellipsis inside a column no wider than the panel, so the link box, the three tiles and More… never run
 * past the panel's right edge.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import { ShareBody } from '@/pages/features/locations/LocationPanel'

const LONG = `https://asamylife.asalifecare.com/app/locations/overview?house=ABD2005&tab=staff&panel=share&x=${'y'.repeat(200)}`

describe('ShareBody', () => {
  const html = renderToString(<ShareBody payload={{ title: '38TH - ABD2005', subtitle: 'Locations · Staff', url: LONG }} />)

  it('lays out in one column that can shrink to the panel, never to the link', () => {
    assert.match(html, /data-share-panel=""/)
    assert.match(html, /class="grid min-w-0 grid-cols-\[minmax\(0,1fr\)\][^"]*"[^>]*data-share-panel/)
  })

  it('cuts a long link with an ellipsis and keeps it whole in its title', () => {
    assert.match(html, /class="min-w-0 flex-1 truncate[^"]*"[^>]*data-share-link=""/)
    assert.ok(html.includes(`title="${LONG.replace(/&/g, '&amp;')}"`), 'the whole link stays in the title')
  })

  it('still offers copy text, download and print', () => {
    for (const word of ['Copy text', 'Download', 'Print']) assert.ok(html.includes(word), word)
  })
})
