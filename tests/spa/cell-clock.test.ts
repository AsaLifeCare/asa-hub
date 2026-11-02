/**
 * THE TIME SWITCH — the clock spelling of a calendar cell
 * (src/pages/features/shifts/cellClock.ts).
 *
 * THE FIXTURE IS THE LIVE CALENDARS, NOT AN INVENTION — BUT IT IS A SNAPSHOT
 * OF THEM, NOT A LIVE GUARANTEE. Every row of LIVE_CELLS is a DISTINCT cell
 * text read off the estate's own grids in the mirror
 * (`asa_house_calendar_live`, all seventeen tabs), and its third column is the
 * hours the ESTATE'S OWN READER found in it (server/shift_slices.classify, run
 * over the same texts). The houses keep typing, so the set moves: 188 rows
 * stand here, of which 185 were the whole of the live grids when they were
 * last read and three are shapes that have since been edited away and are kept
 * because they cost nothing and were real. READ THE MIRROR AGAIN before
 * believing this file is exhaustive — the count in it ages, the rows do not.
 * ROSTER_CELLS adds the shapes the wider schedule mirror carries that the
 * house grids happen not to (`asa_schedules.shift_raw`, 1,294 distinct texts,
 * all checked the same way) — the already-spelled `10:00 PM-7:00 AM`, the
 * glued `10P-8AJH`, `1050am to 1pm`, and one cell of somebody's keyboard
 * falling over.
 *
 * WHAT THE THIRD COLUMN IS FOR. The screen may not say a different time from
 * the one the hours were counted from. So: wherever the server read hours,
 * the spelled cell must carry exactly those two times, written by the panel's
 * own `hhmm`. If the SPA's reading of the grammar ever drifts from
 * shift_slices', this test fails on the live cell that proves it — before a
 * house manager reads an overnight backwards.
 *
 * AND WHAT IT REFUSES. A cell the estate's reader does not read as a range is
 * left exactly as typed: tokens, OFF, R/O, NCNS, `8-3`, `7A-10`,
 * `7A-230P-10P-8A`. The switch spells out times; it never guesses one.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CLOCK_DASH, cellText, clockText, hourText, rangeText, readRange } from '@/pages/features/shifts/cellClock'
import { hhmm } from '@/pages/features/shifts/houseCalTypes'
import { useUiPrefsStore } from '@/stores/useUiPrefsStore'

/** raw cell · what the switch draws · the hours the server read, if any */
type Case = [raw: string, spelled: string, hours: [number, number] | null]

const LIVE_CELLS: Case[] = [
  ['OFF', 'OFF', null],
  ['48TH (B)', '48TH (B)', null],
  ['JH', 'JH', null],
  ['LD', 'LD', null],
  ['EC', 'EC', null],
  ['MS', 'MS', null],
  ['49TH', '49TH', null],
  ['R/O', 'R/O', null],
  ['BM', 'BM', null],
  ['SB', 'SB', null],
  ['38TH', '38TH', null],
  ['230P-10P', '2:30 PM – 10:00 PM', [14.5, 22]],
  ['8A-2P', '8:00 AM – 2:00 PM', [8, 14]],
  ['48TH (A)', '48TH (A)', null],
  ['NW', 'NW', null],
  ['10P-8A', '10:00 PM – 8:00 AM', [22, 32]],
  ['8A-8P', '8:00 AM – 8:00 PM', [8, 20]],
  ['8P-8A', '8:00 PM – 8:00 AM', [20, 32]],
  ['48th (B)', '48th (B)', null],
  ['*10P-8A', '*10:00 PM – 8:00 AM', [22, 32]],
  ['*8A-8P', '*8:00 AM – 8:00 PM', [8, 20]],
  ['2P-10P', '2:00 PM – 10:00 PM', [14, 22]],
  ['830A-2P', '8:30 AM – 2:00 PM', [8.5, 14]],
  ['2P-930P', '2:00 PM – 9:30 PM', [14, 21.5]],
  ['10P-7A', '10:00 PM – 7:00 AM', [22, 31]],
  ['8A-230P', '8:00 AM – 2:30 PM', [8, 14.5]],
  ['49th', '49th', null],
  ['*2P-10P', '*2:00 PM – 10:00 PM', [14, 22]],
  ['ADMIN', 'ADMIN', null],
  ['930P-830A', '9:30 PM – 8:30 AM', [21.5, 32.5]],
  ['7A-230P', '7:00 AM – 2:30 PM', [7, 14.5]],
  ['MK', 'MK', null],
  ['*7A-430P', '*7:00 AM – 4:30 PM', [7, 16.5]],
  ['430P-7A', '4:30 PM – 7:00 AM', [16.5, 31]],
  ['9A-3P', '9:00 AM – 3:00 PM', [9, 15]],
  ['830A-230P', '8:30 AM – 2:30 PM', [8.5, 14.5]],
  ['3P-11P', '3:00 PM – 11:00 PM', [15, 23]],
  ['38th', '38th', null],
  ['8P-830A', '8:00 PM – 8:30 AM', [20, 32.5]],
  ['*8P-8A', '*8:00 PM – 8:00 AM', [20, 32]],
  ['11P-830A', '11:00 PM – 8:30 AM', [23, 32.5]],
  ['630A-630P', '6:30 AM – 6:30 PM', [6.5, 18.5]],
  ['930P-8A', '9:30 PM – 8:00 AM', [21.5, 32]],
  ['930P-730A', '9:30 PM – 7:30 AM', [21.5, 31.5]],
  ['*230P-930P', '*2:30 PM – 9:30 PM', [14.5, 21.5]],
  ['*10P-830A', '*10:00 PM – 8:30 AM', [22, 32.5]],
  ['10P-830A', '10:00 PM – 8:30 AM', [22, 32.5]],
  ['MED DEL 8A-4P', 'MED DEL 8:00 AM – 4:00 PM', null],
  ['8P-815A', '8:00 PM – 8:15 AM', [20, 32.25]],
  ['12A-12A', '12:00 AM – 12:00 AM', [0, 24]],
  ['1030P-630A', '10:30 PM – 6:30 AM', [22.5, 30.5]],
  ['9P-8A', '9:00 PM – 8:00 AM', [21, 32]],
  ['*8A-9P', '*8:00 AM – 9:00 PM', [8, 21]],
  ['*230P-10P', '*2:30 PM – 10:00 PM', [14.5, 22]],
  ['630A-230P', '6:30 AM – 2:30 PM', [6.5, 14.5]],
  ['630P-630A', '6:30 PM – 6:30 AM', [18.5, 30.5]],
  ['LD > JH', 'LD > JH', null],
  ['830A-3P', '8:30 AM – 3:00 PM', [8.5, 15]],
  ['230P-1030P', '2:30 PM – 10:30 PM', [14.5, 22.5]],
  ['JH > MS', 'JH > MS', null],
  ['MS > LD', 'MS > LD', null],
  ['*7A-230P', '*7:00 AM – 2:30 PM', [7, 14.5]],
  ['830A-8P', '8:30 AM – 8:00 PM', [8.5, 20]],
  ['*8A-2P', '*8:00 AM – 2:00 PM', [8, 14]],
  ['630A-1030P', '6:30 AM – 10:30 PM', [6.5, 22.5]],
  ['3P-1130P', '3:00 PM – 11:30 PM', [15, 23.5]],
  ['*8P-830A', '*8:00 PM – 8:30 AM', [20, 32.5]],
  ['8A-3P', '8:00 AM – 3:00 PM', [8, 15]],
  ['630A-630P > 1030P-630A', '6:30 AM – 6:30 PM > 10:30 PM – 6:30 AM', [6.5, 18.5]],
  ['7A-2P', '7:00 AM – 2:00 PM', [7, 14]],
  ['*10P-7A', '*10:00 PM – 7:00 AM', [22, 31]],
  ['8P-7A', '8:00 PM – 7:00 AM', [20, 31]],
  ['*2P-8P', '*2:00 PM – 8:00 PM', [14, 20]],
  ['230P-815A', '2:30 PM – 8:15 AM', [14.5, 32.25]],
  ['MANAGER MEET>230P-10P', 'MANAGER MEET>2:30 PM – 10:00 PM', [14.5, 22]],
  ['630P-1030P', '6:30 PM – 10:30 PM', [18.5, 22.5]],
  ['2P-10p', '2:00 PM – 10:00 PM', [14, 22]],
  ['11P-8A', '11:00 PM – 8:00 AM', [23, 32]],
  ['10P-730A', '10:00 PM – 7:30 AM', [22, 31.5]],
  ['NO WORKSHOP', 'NO WORKSHOP', null],
  ['48TH (B) > 38TH', '48TH (B) > 38TH', null],
  ['8A-8A', '8:00 AM – 8:00 AM', [8, 32]],
  ['8A-10P', '8:00 AM – 10:00 PM', [8, 22]],
  ['MANAGER MEET 230P-10P', 'MANAGER MEET 2:30 PM – 10:00 PM', null],
  ['8A-4P > MS', '8:00 AM – 4:00 PM > MS', [8, 16]],
  ['8A-8P > LD', '8:00 AM – 8:00 PM > LD', [8, 20]],
  ['8A-930P', '8:00 AM – 9:30 PM', [8, 21.5]],
  ['8-3', '8-3', null],
  ['EC > SB', 'EC > SB', null],
  ['8A-4P > 48TH (B); 8A-4P > EC; 8A-4P > MS', '8:00 AM – 4:00 PM > 48TH (B); 8:00 AM – 4:00 PM > EC; 8:00 AM – 4:00 PM > MS', [8, 16]],
  ['8A-4P > EC; 8A-4P > LD; 8A-4P > MS', '8:00 AM – 4:00 PM > EC; 8:00 AM – 4:00 PM > LD; 8:00 AM – 4:00 PM > MS', [8, 16]],
  ['ADMIN/MS', 'ADMIN/MS', null],
  ['48TH (B) > 8P-8A', '48TH (B) > 8:00 PM – 8:00 AM', [20, 32]],
  ['8A-4P > 48TH (B); 8A-4P > LD; 8A-4P > MS', '8:00 AM – 4:00 PM > 48TH (B); 8:00 AM – 4:00 PM > LD; 8:00 AM – 4:00 PM > MS', [8, 16]],
  ['7A-10P', '7:00 AM – 10:00 PM', [7, 22]],
  ['C/O', 'C/O', null],
  ['MANAGER MEET', 'MANAGER MEET', null],
  ['2P-10P JH', '2:00 PM – 10:00 PM JH', [14, 22]],
  ['8A-4P > 48TH (B)', '8:00 AM – 4:00 PM > 48TH (B)', [8, 16]],
  ['8A-4P > 48TH (B); 8A-4P > EC; 8A-4P > LD', '8:00 AM – 4:00 PM > 48TH (B); 8:00 AM – 4:00 PM > EC; 8:00 AM – 4:00 PM > LD', [8, 16]],
  ['5P-9P', '5:00 PM – 9:00 PM', [17, 21]],
  ['MANAGER MEET>2P-10P', 'MANAGER MEET>2:00 PM – 10:00 PM', [14, 22]],
  ['1P-4P', '1:00 PM – 4:00 PM', [13, 16]],
  ['8P-8:15A', '8:00 PM – 8:15 AM', [20, 32.25]],
  ['7A-2:30P > JH', '7:00 AM – 2:30 PM > JH', [7, 14.5]],
  ['5P-9P > BS', '5:00 PM – 9:00 PM > BS', [17, 21]],
  ['8A-730P', '8:00 AM – 7:30 PM', [8, 19.5]],
  ['MANAGER MEET>3-11P', 'MANAGER MEET>3:00 PM – 11:00 PM', [15, 23]],
  ['1115P-8A', '11:15 PM – 8:00 AM', [23.25, 32]],
  ['2P-6P > MS', '2:00 PM – 6:00 PM > MS', [14, 18]],
  ['JH > 8P-8:30A', 'JH > 8:00 PM – 8:30 AM', [20, 32.5]],
  ['2P-10P > 48TH (B)', '2:00 PM – 10:00 PM > 48TH (B)', [14, 22]],
  ['8A-4P > 38TH', '8:00 AM – 4:00 PM > 38TH', [8, 16]],
  ['4P-10P', '4:00 PM – 10:00 PM', [16, 22]],
  ['6P-8A > MS', '6:00 PM – 8:00 AM > MS', [18, 32]],
  ['49TH > EC', '49TH > EC', null],
  ['7A-230P-10P-8A', '7A-230P-10P-8A', null],
  ['*12P-8A', '*12:00 PM – 8:00 AM', [12, 32]],
  ['11-8P', '11:00 AM – 8:00 PM', [11, 20]],
  ['*8A-830A', '*8:00 AM – 8:30 AM', [8, 8.5]],
  ['MED DEL 8A-4P 630P-1030P', 'MED DEL 8:00 AM – 4:00 PM 6:30 PM – 10:30 PM', null],
  ['MS > 11P-8A', 'MS > 11:00 PM – 8:00 AM', [23, 32]],
  ['MED DEL 8A-4P 230P-1030P', 'MED DEL 8:00 AM – 4:00 PM 2:30 PM – 10:30 PM', null],
  ['LD > 8P-8:15A', 'LD > 8:00 PM – 8:15 AM', [20, 32.25]],
  ['3P-830A', '3:00 PM – 8:30 AM', [15, 32.5]],
  ['730P-7A', '7:30 PM – 7:00 AM', [19.5, 31]],
  ['2P-8A', '2:00 PM – 8:00 AM', [14, 32]],
  ['MS > 10P-8:30A', 'MS > 10:00 PM – 8:30 AM', [22, 32.5]],
  ['10P-8A > EC', '10:00 PM – 8:00 AM > EC', [22, 32]],
  ['3P-10P > 49TH', '3:00 PM – 10:00 PM > 49TH', [15, 22]],
  ['1P-2P', '1:00 PM – 2:00 PM', [13, 14]],
  ['930P-9A', '9:30 PM – 9:00 AM', [21.5, 33]],
  ['830A-830A', '8:30 AM – 8:30 AM', [8.5, 32.5]],
  ['*8A-10P', '*8:00 AM – 10:00 PM', [8, 22]],
  ['49TH > 10P-8:30A', '49TH > 10:00 PM – 8:30 AM', [22, 32.5]],
  ['8P-11A', '8:00 PM – 11:00 AM', [20, 35]],
  ['10P-7A > SB', '10:00 PM – 7:00 AM > SB', [22, 31]],
  ['8A-8:30A > EC', '8:00 AM – 8:30 AM > EC', [8, 8.5]],
  ['*8P-1A', '*8:00 PM – 1:00 AM', [20, 25]],
  ['7A-10', '7A-10', null],
  ['9A-12P<4P-9:30P', '9:00 AM – 12:00 PM<4:00 PM – 9:30 PM', [9, 12]],
  ['8A-8P > JH', '8:00 AM – 8:00 PM > JH', [8, 20]],
  ['8A-8P > MS', '8:00 AM – 8:00 PM > MS', [8, 20]],
  ['*8A-4P', '*8:00 AM – 4:00 PM', [8, 16]],
  ['1A-8A', '1:00 AM – 8:00 AM', [1, 8]],
  ['EC > 10P-8:15A', 'EC > 10:00 PM – 8:15 AM', [22, 32.25]],
  ['8A-7:30P', '8:00 AM – 7:30 PM', [8, 19.5]],
  ['*1015A-2P', '*10:15 AM – 2:00 PM', [10.25, 14]],
  ['c/o', 'c/o', null],
  ['8P-8A > EC', '8:00 PM – 8:00 AM > EC', [20, 32]],
  ['12P-8P', '12:00 PM – 8:00 PM', [12, 20]],
  ['49TH > 10P-7A', '49TH > 10:00 PM – 7:00 AM', [22, 31]],
  ['1030A-230P', '10:30 AM – 2:30 PM', [10.5, 14.5]],
  ['JH > 10P-9A', 'JH > 10:00 PM – 9:00 AM', [22, 33]],
  ['8P-8A > SB', '8:00 PM – 8:00 AM > SB', [20, 32]],
  ['8P-7A > SB', '8:00 PM – 7:00 AM > SB', [20, 31]],
  ['2:30P-10P > EC', '2:30 PM – 10:00 PM > EC', [14.5, 22]],
  ['48TH (B)<10P-8A', '48TH (B)<10:00 PM – 8:00 AM', [22, 32]],
  ['3P-12A', '3:00 PM – 12:00 AM', [15, 24]],
  ['8P-8:15A > EC', '8:00 PM – 8:15 AM > EC', [20, 32.25]],
  ['EC > 3P-11P', 'EC > 3:00 PM – 11:00 PM', [15, 23]],
  ['2P-10P > LD', '2:00 PM – 10:00 PM > LD', [14, 22]],
  ['*840A-8P (late)', '*8:40 AM – 8:00 PM (late)', null],
  ['2:30P-10P', '2:30 PM – 10:00 PM', [14.5, 22]],
  ['230P-830A', '2:30 PM – 8:30 AM', [14.5, 32.5]],
  ['4P-8A', '4:00 PM – 8:00 AM', [16, 32]],
  ['2P-815A', '2:00 PM – 8:15 AM', [14, 32.25]],
  ['EC > 8A-2P', 'EC > 8:00 AM – 2:00 PM', [8, 14]],
  ['2:30P-9:30P > BM', '2:30 PM – 9:30 PM > BM', [14.5, 21.5]],
  ['MANAGER MEET>230P-9:30P', 'MANAGER MEET>2:30 PM – 9:30 PM', [14.5, 21.5]],
  ['48th (A)', '48th (A)', null],
  ['*8A-7P', '*8:00 AM – 7:00 PM', [8, 19]],
  ['7A-10:30A', '7:00 AM – 10:30 AM', [7, 10.5]],
  ['MANAGER MEET>9P-830A', 'MANAGER MEET>9:00 PM – 8:30 AM', [21, 32.5]],
  ['1:30P-4P', '1:30 PM – 4:00 PM', [13.5, 16]],
  ['230P-1115P', '2:30 PM – 11:15 PM', [14.5, 23.25]],
  ['*8P-12P', '*8:00 PM – 12:00 PM', [20, 36]],
  ['*7A-10P', '*7:00 AM – 10:00 PM', [7, 22]],
  ['230P-7A', '2:30 PM – 7:00 AM', [14.5, 31]],
  ['7A-1130A', '7:00 AM – 11:30 AM', [7, 11.5]],
  ['*230P-8A', '*2:30 PM – 8:00 AM', [14.5, 32]],
  ['MED DEL 8A-4P 10P-730A', 'MED DEL 8:00 AM – 4:00 PM 10:00 PM – 7:30 AM', null],
  // the shapes the grids had grown by the time the mirror was read again —
  // the spelled-out afternoon, the lowercase tails, the comma pair the
  // server takes for no hours at all, and a token glued to a range by `>`
  ['2pm - 730pm', '2:00 PM – 7:30 PM', [14, 19.5]],
  ['2pm-930p', '2:00 PM – 9:30 PM', [14, 21.5]],
  ['730P-830am', '7:30 PM – 8:30 AM', [19.5, 32.5]],
  ['830a-8p,8p-8a', '8:30 AM – 8:00 PM,8:00 PM – 8:00 AM', null],
  ['8a-8p,8p-830a', '8:00 AM – 8:00 PM,8:00 PM – 8:30 AM', null],
  ['NW>10P-8A', 'NW>10:00 PM – 8:00 AM', [22, 32]],
]

/** The shapes the wider roster mirror carries and the house grids do not. */
const ROSTER_CELLS: Case[] = [
  ['* 8A-8P', '* 8:00 AM – 8:00 PM', [8, 20]],
  ['*2P-10P > 48TH (A)', '*2:00 PM – 10:00 PM > 48TH (A)', [14, 22]],
  ['*2P-10P JH', '*2:00 PM – 10:00 PM JH', [14, 22]],
  ['*2P-10P>10P-830A', '*2:00 PM – 10:00 PM>10:00 PM – 8:30 AM', [14, 22]],
  ['*2P-430P 930P-10P', '*2:00 PM – 4:30 PM 9:30 PM – 10:00 PM', null],
  ['*730A-3P<10P-730A', '*7:30 AM – 3:00 PM<10:00 PM – 7:30 AM', [7.5, 15]],
  ['*7A-2P < 49th', '*7:00 AM – 2:00 PM < 49th', [7, 14]],
  ['*7A-3P>MEET', '*7:00 AM – 3:00 PM>MEET', [7, 15]],
  ['*8A-8P/8P-8A', '*8:00 AM – 8:00 PM/8:00 PM – 8:00 AM', null],
  ['10:00 PM-7:00 AM', '10:00 PM – 7:00 AM', [22, 31]],
  ['10P-8A> 8a-230p', '10:00 PM – 8:00 AM> 8:00 AM – 2:30 PM', [22, 32]],
  ['12A-630A>630P-1030P', '12:00 AM – 6:30 AM>6:30 PM – 10:30 PM', [0, 6.5]],
  ['MS 230-10P', 'MS 2:30 PM – 10:00 PM', null],
  ['48th (B)/2-10p', '48th (B)/2:00 PM – 10:00 PM', null],
  ['48TH (B)10P-8A', '48TH (B)10:00 PM – 8:00 AM', null],
  ['8A-230P)', '8:00 AM – 2:30 PM)', null],
  ['8A-8P/JH', '8:00 AM – 8:00 PM/JH', null],
  ['6P-7P IST', '6:00 PM – 7:00 PM IST', [18, 19]],
  ['8A-5P ADM', '8:00 AM – 5:00 PM ADM', [8, 17]],
  ['MED DEL 8A-4P   230P-1030P', 'MED DEL 8:00 AM – 4:00 PM   2:30 PM – 10:30 PM', null],
  // a time glued to letters is not a time the estate reads, and is left alone
  ['10P-8AJH', '10P-8AJH', null],
  ['8a-8pms', '8a-8pms', null],
  ['BM> 230p-10pSB', 'BM> 230p-10pSB', null],
  // …and neither is a sentence, a word, or a keyboard falling over
  ['1050am to 1pm', '1050am to 1pm', null],
  ['11A 11P', '11A 11P', null],
  ['TRAINING 230P', 'TRAINING 230P', null],
  ['8AM MEDS', '8AM MEDS', null],
  ['In-service Day', 'In-service Day', null],
  ['NCNS', 'NCNS', null],
  ['ťþdrrt d t to NH hyhy nun n8k+i Kim. 9.$99', 'ťþdrrt d t to NH hyhy nun n8k+i Kim. 9.$99', null],
]

const ALL: Case[] = [...LIVE_CELLS, ...ROSTER_CELLS]

describe('the codes this platform must spell', () => {
  it('930P-730A is 9:30 PM – 7:30 AM', () => {
    assert.equal(clockText('930P-730A'), '9:30 PM – 7:30 AM')
  })
  it('the day, the overnight, the half hour and the midnight', () => {
    assert.equal(clockText('8A-4P'), '8:00 AM – 4:00 PM')
    assert.equal(clockText('10P-8A'), '10:00 PM – 8:00 AM')
    assert.equal(clockText('7A-230P'), '7:00 AM – 2:30 PM')
    assert.equal(clockText('12P-12A'), '12:00 PM – 12:00 AM')
  })
  it('words around a time keep their place', () => {
    assert.equal(clockText('MED DEL 8A-4P'), 'MED DEL 8:00 AM – 4:00 PM')
    assert.equal(clockText('48TH (B); 8A-4P'), '48TH (B); 8:00 AM – 4:00 PM')
  })
})

describe('every distinct cell text in the live house calendars', () => {
  for (const [raw, spelled] of LIVE_CELLS) {
    it(`${raw} → ${spelled}`, () => assert.equal(clockText(raw), spelled))
  }
})

describe('the shapes the roster mirror adds', () => {
  for (const [raw, spelled] of ROSTER_CELLS) {
    it(`${raw} → ${spelled}`, () => assert.equal(clockText(raw), spelled))
  }
})

describe('the clock never contradicts the hours', () => {
  it('carries exactly the times the estate\'s own reader found', () => {
    let checked = 0
    for (const [raw, spelled, hours] of ALL) {
      if (!hours) continue
      const [start, end] = hours
      assert.ok(
        spelled.includes(rangeText(start, end)),
        `${raw}: the screen says "${spelled}", the hours were read from ${hhmm(start)} – ${hhmm(end)}`,
      )
      checked++
    }
    // the fixture must keep proving something: most live cells ARE shifts
    assert.ok(checked > 140, `only ${checked} cells carried hours`)
  })

  it('and reads the same range the server read, segment for segment', () => {
    // the first thing on a chained cell is what the relay takes for the shift
    assert.deepEqual(readRange('930P-730A'), { start: 21.5, end: 31.5 })
    assert.deepEqual(readRange('230-10p'), { start: 14.5, end: 22 })
    assert.deepEqual(readRange('11-8P'), { start: 11, end: 20 })
    assert.deepEqual(readRange('12A-12A'), { start: 0, end: 24 })
    assert.deepEqual(readRange('6P-7P IST'), { start: 18, end: 19 })
  })
})

describe('what is never guessed', () => {
  const kept = ['OPEN', 'OFF', 'ADMIN', 'R/O', 'RO', 'NCNS', 'C/O', 'MEET', '48TH (B)',
                '8-3', '7A-10', '7A-230P-10P-8A', '1050am to 1pm', '', '   ']
  for (const raw of kept) {
    it(`leaves ${JSON.stringify(raw)} exactly as written`, () => assert.equal(clockText(raw), raw))
  }
  it('an unreadable segment does not become a range', () => {
    assert.equal(readRange('8-3'), null)
    assert.equal(readRange('7A-10'), null)
    assert.equal(readRange('OPEN'), null)
    assert.equal(readRange('7A-230P-10P-8A'), null)
  })
  it('nothing is read out of an empty cell', () => {
    assert.equal(clockText(undefined), '')
    assert.equal(clockText(null), '')
  })
})

/**
 * THE TIMELINE DRAWS FROM HOURS, NOT FROM CODES — and it may not round them.
 *
 * The Shift Board's timeline never sees `815A`; it is handed the number the
 * roster counted (8.25) and writes it above the bar. A formatter that read a
 * fraction as "half past" told a house manager 8:30 for a shift that starts
 * at 8:15 — on 350 live roster rows across 110 shapes (`8P-815A`, `815A-2P`,
 * `930P-815A`, `*7A-245P`…). The relay has always spelled these from the real
 * minutes; this holds the screen to the same arithmetic.
 */
describe('the hours a timeline spells', () => {
  it('a quarter past is a quarter past, never half past', () => {
    assert.equal(hourText(32.25, false), '08:15')
    assert.equal(hourText(8.25, false), '08:15')
    assert.equal(hourText(23.25, false), '23:15')
    assert.equal(hourText(10.25, false), '10:15')
    assert.equal(hourText(14.75, false), '14:45')
    assert.equal(hourText(32.25, true), '8:15 AM')
    assert.equal(hourText(8.25, true), '8:15 AM')
  })
  it('the whole and the half hour still read as they did', () => {
    assert.equal(hourText(20, false), '20:00')
    assert.equal(hourText(21.5, false), '21:30')
    assert.equal(hourText(31.5, false), '07:30')
    assert.equal(hourText(0, false), '00:00')
    assert.equal(hourText(24, false), '00:00')
  })
  it('under the switch it is the estate\'s own clock spelling', () => {
    assert.equal(hourText(20, true), '8:00 PM')
    assert.equal(hourText(21.5, true), '9:30 PM')
    assert.equal(hourText(12, true), '12:00 PM')
    assert.equal(hourText(24, true), '12:00 AM')
    assert.equal(hourText(32, true), '8:00 AM')
  })
  it('the bar and the grid spell every live shift the same way', () => {
    let checked = 0
    for (const [raw, , hours] of ALL) {
      if (!hours) continue
      const [start, end] = hours
      assert.equal(
        rangeText(start, end),
        `${hourText(start, true)} ${CLOCK_DASH} ${hourText(end, true)}`,
        `${raw}: the timeline and the grid disagree`,
      )
      // and the 24-hour reading carries the same minutes as the clock one
      assert.equal(
        hourText(start, false).slice(-2),
        hourText(start, true).slice(-5, -3),
        `${raw}: the timeline's minutes are not the grid's`,
      )
      checked++
    }
    assert.ok(checked > 140, `only ${checked} cells carried hours`)
  })
})

/**
 * THE SWITCH REACHES EVERY CALENDAR — all of them, without exception.
 *
 * A formatter nothing calls is a formatter that is not on screen. These read
 * the screens themselves: each calendar surface must go through the shared
 * spelling, and the switch must be reachable on every tab that draws one, so
 * nobody finds a grid spelled out and the next one in code with no way back.
 */
describe('every calendar answers to the one switch', () => {
  const root = process.env.SPA_ROOT ?? process.cwd()
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

  const SPELLS: [file: string, through: RegExp][] = [
    // the house grid House Calendars and the Calendar Builder both draw
    ['src/pages/features/shifts/HouseGrid.tsx', /\bcellText\(/],
    ['src/pages/features/shifts/LastRosterWeek.tsx', /\bcellText\(/],
    ['src/pages/features/shifts/ShiftCellPanel.tsx', /\bclockText\(/],
    ['src/pages/features/shifts/ShiftCardsPage.tsx', /\bcellText\(/],
    ['src/pages/features/shifts/ShiftPersonProfile.tsx', /\bcellText\(/],
    ['src/pages/features/shifts/ShiftTimelinePage.tsx', /\bhourText\(/],
    ['src/pages/features/users/ProfilePage.tsx', /\bcellText\(/],
    ['src/pages/features/calendarbuilder/BuilderGrid.tsx', /\bcellText\(/],
  ]
  for (const [file, through] of SPELLS) {
    it(`${file.split('/').pop()} spells its times through the shared reader`, () => {
      assert.match(read(file), through)
    })
  }

  const CARRIES_TOGGLE = [
    'src/pages/features/calendarbuilder/LiveView.tsx',
    'src/pages/features/shifts/ShiftCardsPage.tsx',
    'src/pages/features/shifts/LastRosterWeek.tsx',
    'src/pages/features/shifts/ShiftTimelinePage.tsx',
    'src/pages/features/calendarbuilder/MasterGrid.tsx',
    'src/pages/features/calendarbuilder/BuilderView.tsx',
  ]
  for (const file of CARRIES_TOGGLE) {
    it(`${file.split('/').pop()} puts the switch where it bites`, () => {
      assert.match(read(file), /<ClockTimesToggle\b/)
    })
  }

  it('the timeline never rounds a fraction back to the half hour', () => {
    const src = read('src/pages/features/shifts/ShiftTimelinePage.tsx')
    assert.doesNotMatch(src, /'30'\s*:\s*'00'/)
  })
})

describe('the switch', () => {
  it('is off until somebody presses it', () => {
    assert.equal(useUiPrefsStore.getState().calendarClockTimes, false)
  })
  it('off, the grid draws the cell exactly as the sheet holds it', () => {
    for (const [raw] of ALL) assert.equal(cellText(raw, false), raw)
  })
  it('on, the grid draws the clock spelling', () => {
    for (const [raw, spelled] of ALL) assert.equal(cellText(raw, true), spelled)
  })
})
