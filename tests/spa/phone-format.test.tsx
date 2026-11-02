/**
 * THE ONE PHONE SPELLING THE SCREEN READS (src/lib/phoneFormat.ts): a US
 * number as "(xxx) xxx-xxxx", its extension kept after it, anything else
 * exactly as written. Links, inputs, search keys and stored values keep the
 * machine spelling — formatPhoneE164 — and the two always name one number.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { formatPhoneDisplay, formatPhoneE164, formatPhoneList } from '@/lib/phoneFormat'
import { Cell } from '@/engine/templates/sheet/Cell'
import { isPhoneColumn } from '@/engine/templates/sheet/types'
import { shareFromPanel } from '@/engine/templates/detail/utils'
import { counterpartLabel, type Counterpart } from '@/pages/features/staffprofiles/staffModel'
import { sharePayloadFor, type LocationOverview } from '@/pages/features/locations/locationModel'

describe('formatPhoneDisplay', () => {
  it('ten digits read as a US number', () => {
    assert.equal(formatPhoneDisplay('3309195558'), '(330) 919-5558')
  })

  it('eleven digits starting with 1, or +1, drop the country code', () => {
    for (const raw of ['13309195558', '+13309195558', '+1 330 919 5558', '1-330-919-5558', '+1 (330) 919-5558', '+1.330.919.5558']) {
      assert.equal(formatPhoneDisplay(raw), '(330) 919-5558', raw)
    }
  })

  it('any punctuation a sheet holds reads the same', () => {
    for (const raw of ['(330) 919-5558', '330.919.5558', '330-919-5558', '330 919 5558', '  (330)919-5558  ', '(330)-919-5558']) {
      assert.equal(formatPhoneDisplay(raw), '(330) 919-5558', raw)
    }
  })

  it('an extension stays after the number', () => {
    assert.equal(formatPhoneDisplay('330-919-5558 x123'), '(330) 919-5558 x123')
    assert.equal(formatPhoneDisplay('+13309195558 ext. 12'), '(330) 919-5558 x12')
    assert.equal(formatPhoneDisplay('(330) 919-5558 extension 7'), '(330) 919-5558 x7')
    assert.equal(formatPhoneDisplay('3309195558x4'), '(330) 919-5558 x4')
    assert.equal(formatPhoneDisplay('1 330 919 5558 #22'), '(330) 919-5558 x22')
  })

  it('a number that is not a US one is shown as written', () => {
    for (const raw of ['+44 20 7946 0958', '+4930123456', '+52 55 1234 5678', '+33 1 23 45 67 89', '23309195558',
      '5558', '911', '919-5558', '330919555', '330-919-55588']) {
      assert.equal(formatPhoneDisplay(raw), raw, raw)
    }
  })

  it('text that is not a phone is shown as written', () => {
    for (const raw of ['Not on file', '330-919-5558 (cell)', 'bob@example.com', 'Main line', '330-919-5558 / 330-555-0101']) {
      assert.equal(formatPhoneDisplay(raw), raw, raw)
    }
  })

  it('empty stays empty', () => {
    assert.equal(formatPhoneDisplay(''), '')
    assert.equal(formatPhoneDisplay('   '), '')
    assert.equal(formatPhoneDisplay(null), '')
    assert.equal(formatPhoneDisplay(undefined), '')
  })

  it('a cell of several entries formats each number and keeps the rest as written', () => {
    assert.equal(formatPhoneList('+13309195558, bob@example.com; 3305550101'), '(330) 919-5558, bob@example.com; (330) 555-0101')
    assert.equal(formatPhoneList('+13309195558,+13305550101'), '(330) 919-5558,(330) 555-0101')
    assert.equal(formatPhoneList('allstaff'), 'allstaff')
    assert.equal(formatPhoneList('+44 20 7946 0958, 5558'), '+44 20 7946 0958, 5558')
    assert.equal(formatPhoneList(''), '')
    assert.equal(formatPhoneList(null), '')
  })

  it('a number from a sheet cell (a JS number) reads the same', () => {
    assert.equal(formatPhoneDisplay(3309195558), '(330) 919-5558')
  })

  it('is stable when applied twice, and names the number E.164 names', () => {
    for (const raw of ['+13309195558', '330.919.5558', '+44 20 7946 0958', '5558']) {
      const shown = formatPhoneDisplay(raw)
      assert.equal(formatPhoneDisplay(shown), shown, raw)
      assert.equal(formatPhoneE164(shown), formatPhoneE164(raw), raw)
    }
  })
})

describe('the screens read the display spelling', () => {
  it('a sheet column keyed as a phone shows it formatted; other columns are untouched', () => {
    const draw = (key: string, value: unknown) =>
      renderToString(createElement(Cell, { col: { key, label: key, kind: 'text' }, row: { [key]: value } }))
    assert.ok(draw('phone', '+13309195558').includes('(330) 919-5558'))
    assert.ok(draw('guardian_phone', '3309195558').includes('(330) 919-5558'))
    assert.ok(draw('vetPhone', '1-330-919-5558').includes('(330) 919-5558'))
    assert.ok(draw('phone', '+44 20 7946 0958').includes('+44 20 7946 0958'))
    assert.ok(draw('employee_id', '3309195558').includes('3309195558'))
    assert.ok(!draw('employee_id', '3309195558').includes('(330)'))
  })

  it('a column carrying the phone icon shows it formatted whatever its key', () => {
    const html = renderToString(createElement(Cell, {
      col: { key: 'contact', label: 'Contact', kind: 'text', icon: 'phone' }, row: { contact: '+13309195558' },
    }))
    assert.ok(html.includes('(330) 919-5558'))
    assert.ok(!html.includes('+13309195558'))
    const plain = renderToString(createElement(Cell, { col: { key: 'contact', label: 'Contact', kind: 'text' }, row: { contact: '+13309195558' } }))
    assert.ok(plain.includes('+13309195558'))
  })

  it('one rule names a phone column for the table, its export and its share', () => {
    assert.ok(isPhoneColumn({ key: 'phone' }) && isPhoneColumn({ key: 'guardian_phone_number' }) && isPhoneColumn({ key: 'fax' }))
    assert.ok(isPhoneColumn({ key: 'contact', icon: 'phone' }))
    assert.ok(!isPhoneColumn({ key: 'contact' }) && !isPhoneColumn({ key: 'employee_id', icon: 'hash' }))
  })

  it('a detail panel shared as text carries its phone fields formatted', () => {
    const config = { header: { title: 'name' }, sections: [{ kind: 'fields', title: 'Contact', fields: [
      { label: 'Phone', value: 'phone', icon: 'phone' }, { label: 'Code', value: 'code' }] }] }
    const text = shareFromPanel(config, { name: 'Ann', phone: '+13309195558', code: '3309195558' }).text ?? ''
    assert.match(text, /^Phone: \(330\) 919-5558$/m)
    assert.match(text, /^Code: 3309195558$/m)
  })

  it('a text thread with no label is named by its number, formatted', () => {
    const c: Counterpart = { id: '+13305550100', label: '', owner: '', count: 2, firstAt: '', lastAt: '' }
    assert.equal(counterpartLabel(c), '(330) 555-0100')
    assert.equal(counterpartLabel({ ...c, label: 'Hotline' }), 'Hotline')
    assert.equal(counterpartLabel({ ...c, label: '+13305550100' }), '(330) 555-0100', 'the server names a bookless line by its number')
  })

  it('a house shared as text carries the display spelling', () => {
    const overview = { managers: [{ name: 'Wanda McCollum-Dotson', phone: '+13302241560' }], housePhone: '3304550000' } as unknown as LocationOverview
    const text = sharePayloadFor({ code: 'NW4045', title: 'NW - NW4045', address: '', clients: [] }, 'overview', overview).text ?? ''
    assert.match(text, /House manager: Wanda McCollum-Dotson · \(330\) 224-1560/)
    assert.match(text, /House phone: \(330\) 455-0000/)
  })
})
