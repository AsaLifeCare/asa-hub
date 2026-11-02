// Fleet & Mileage seed (v7 opsdash bonus wave): company vehicles and their mileage logs — the transport layer…
// All fictional; drivers reuse the core staff directory (src/lib/seed.ts people) and assigned houses reuse the…
import { subDays } from 'date-fns'
import { withTenant } from '@/lib/tenancy'
import { extraSeeds } from '@/lib/seed-extra'
import { people } from '@/lib/seed'
import { houses } from '@/lib/seed-shifts2'

const day = (d: Date) => d.toISOString().slice(0, 10)
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')

/* ---------------- fleetVehicles (5) ---------------- */

export type VehicleStatus = 'active' | 'service' | 'retired'

export type FleetVehicle = {
  id: string
  unit: string // "Van 01"
  vehicle: string // make/model
  year: number
  plate: string
  vin: string
  assignedHouse: string // shift-board house name
  houseCode: string
  primaryDriver: string // staff name
  odometer: number
  status: VehicleStatus
  nextService: string // yyyy-mm-dd
  notes?: string
}

// [unit, vehicle, year, plate, houseIdx, driverIdx, odometer, status, serviceInDays]
const VEHICLE_ROWS: Array<[string, string, number, string, number, number, number, VehicleStatus, number]> = [
  ['Van 01', 'Ford Transit 350', 2021, 'JXR 4417', 0, 1, 61240, 'active', 24],
  ['Van 02', 'Dodge Grand Caravan', 2019, 'HKN 8820', 2, 5, 88415, 'active', 11],
  ['Van 03', 'Toyota Sienna', 2022, 'PQT 2291', 5, 8, 34980, 'service', 41],
  ['Van 04', 'Ford Transit Connect', 2020, 'LMD 7306', 6, 3, 70212, 'active', 5],
  ['Van 05', 'Chrysler Pacifica', 2018, 'GRW 1954', 7, 10, 96530, 'retired', 90],
]

export const fleetVehicles: FleetVehicle[] = withTenant(
  VEHICLE_ROWS.map(([unit, vehicle, year, plate, hIdx, dIdx, odometer, status, svcIn], i) => {
    const house = houses[hIdx % houses.length]
    return {
      id: `veh-${pad(i + 1)}`,
      unit,
      vehicle,
      year,
      plate,
      vin: `1FTBW2X${pad(34 + i * 7)}OH${48210 + i * 137}`,
      assignedHouse: house.name,
      houseCode: house.code,
      primaryDriver: people[dIdx % people.length].name,
      odometer,
      status,
      nextService: day(subDays(now, -svcIn)),
      notes:
        status === 'service'
          ? 'Transmission flush scheduled; keep on local runs only.'
          : status === 'retired'
            ? 'Held as spare pending county auction listing.'
            : undefined,
    }
  }),
)

/* ---------------- mileageLogs (14) ---------------- */

export type MileagePurpose = 'Dr appointment' | 'Day program' | 'Outing' | 'Supply run' | 'Service trip'

export type MileageLog = {
  id: string
  date: string // yyyy-mm-dd
  unit: string
  vehicle: string
  driver: string
  houseCode: string
  purpose: MileagePurpose
  miles: number
  odometerEnd: number
}

const PURPOSES: MileagePurpose[] = ['Dr appointment', 'Day program', 'Outing', 'Supply run', 'Service trip']

// [daysAgo, vehicleIdx, driverIdx, purposeIdx, miles]
const MILEAGE_ROWS: Array<[number, number, number, number, number]> = [
  [0, 0, 1, 0, 18],
  [0, 1, 5, 1, 26],
  [1, 0, 2, 1, 24],
  [1, 3, 3, 0, 12],
  [2, 1, 6, 2, 31],
  [2, 0, 1, 3, 9],
  [3, 3, 7, 0, 15],
  [4, 1, 5, 1, 22],
  [5, 2, 8, 4, 6],
  [6, 0, 4, 0, 19],
  [7, 1, 9, 2, 28],
  [9, 3, 3, 3, 11],
  [11, 0, 1, 1, 25],
  [13, 1, 6, 0, 14],
]

export const mileageLogs: MileageLog[] = withTenant(
  MILEAGE_ROWS.map(([dAgo, vIdx, dIdx, pIdx, miles], i) => {
    const v = fleetVehicles[vIdx % fleetVehicles.length]
    return {
      id: `mil-${pad(i + 1)}`,
      date: day(subDays(now, dAgo)),
      unit: v.unit,
      vehicle: v.vehicle,
      driver: people[dIdx % people.length].name,
      houseCode: v.houseCode,
      purpose: PURPOSES[pIdx % PURPOSES.length],
      miles,
      odometerEnd: v.odometer - dAgo * 7 - miles,
    }
  }),
)

/* ---------------- self-registration (seed-ops3 pattern) ---------------- */

if (!extraSeeds.fleetVehicles) extraSeeds.fleetVehicles = fleetVehicles
if (!extraSeeds.mileageLogs) extraSeeds.mileageLogs = mileageLogs
