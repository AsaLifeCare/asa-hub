/**
 * Filing an incident or a repair request: clients, staff and every role above
 * may file; editing and removing stay with admins and managers. The screen's
 * lists are held to Estate.gs, which is the gate.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COORDINATOR_ONLY, FILE_ROLES, mayEditEstate, mayFile } from '@/lib/estateFiling'
import { FILING_FORMS } from '@/pages/features/houses/HouseFilingModal'
import type { FileTarget } from '@/pages/features/houses/houseTools'

const estate = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(), 'apps-script/Estate.gs'), 'utf8')
const words = (src: string) => [...src.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
const serverRoles = words(/var ESTATE_FILE_ROLES = \[([^\]]*)\]/.exec(estate)?.[1] ?? '')
const serverColumns = (target: FileTarget) =>
  words(new RegExp(`${target}:\\s*\\[([^\\]]*)\\]`).exec(/var ESTATE_FILE_COLUMNS = \{[^]*?\n\};/.exec(estate)?.[0] ?? '')?.[1] ?? '')

describe('who files, and who changes a filing', () => {
  it('clients, staff, managers and admins file; nobody else does', () => {
    for (const role of ['client', 'staff', 'manager', 'admin']) assert.equal(mayFile(role), true, role)
    for (const role of ['onboarding', 'interviewer', '', null, undefined, 'guardian']) assert.equal(mayFile(role), false, String(role))
  })

  it('editing and removing stay with admins and managers', () => {
    assert.deepEqual(['admin', 'manager', 'staff', 'client', 'onboarding'].map(mayEditEstate), [true, true, false, false, false])
  })

  it('the screen offers what Estate.gs admits — the same roles, the same columns', () => {
    assert.deepEqual([...FILE_ROLES].sort(), [...serverRoles].sort())
    assert.ok(serverColumns('uiIncidents').includes('summary_of_incident'), 'the incident columns were read')
    for (const col of COORDINATOR_ONLY) {
      assert.ok(!serverColumns('workOrders').includes(col), `a filer never sends ${col}`)
    }
  })

  it("a client's forms ask only the form's own columns, and never who it is about or who filed it", () => {
    for (const target of ['uiIncidents', 'workOrders'] as const) {
      const keys = FILING_FORMS[target].fields.map((f) => f.key)
      for (const k of keys) assert.ok(serverColumns(target).includes(k), `${target}.${k} is a column a filer sends`)
      for (const never of ['client_name', 'your_name', 'status', 'resolution_notes']) {
        assert.ok(!keys.includes(never), `${target} never asks ${never}`)
      }
    }
    assert.equal(FILING_FORMS.workOrders.fields[0].key, 'select_address_vehicle', 'the house comes first, filled in')
  })
})

describe('the two screens hold New to the filing rule, and the pencil to the writer rule', () => {
  // a drawn screen reads the store's initial state on the server renderer, so
  // the wiring is held here and the rule itself above
  const page = (name: string) =>
    readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(), `src/pages/features/clientops/${name}.tsx`), 'utf8')

  for (const [name, label] of [['HouseRepairPage', 'New repair request'], ['UiIncidentsPage', 'New UI report']] as const) {
    it(`${name}: New is live for every filer; edit and remove stay with writers`, () => {
      const src = page(name)
      assert.match(src, /const canWrite = mayEditEstate\(me\?\.role\)/)
      assert.match(src, /const canFile = mayFile\(me\?\.role\)/)
      const button = new RegExp(`disabled=\\{!canFile\\}[^]*?${label}`).exec(src)?.[0] ?? ''
      assert.ok(button && !button.includes('canWrite'), `${label} is gated by canFile alone`)
      assert.match(src, /\{canWrite && \(/, 'the row actions stay behind canWrite')
      assert.doesNotMatch(src, /role === 'admin' \|\| me\?\.role === 'manager'/, 'no second copy of the rule')
    })
  }

  it("HouseRepairPage: a filer's form leaves out the coordinator's columns", () => {
    assert.match(page('HouseRepairPage'), /canWrite \? fields : fields\.filter\(\(f\) => !\(COORDINATOR_ONLY/)
    assert.match(page('HouseRepairPage'), /fields=\{formFields\}/)
  })
})
