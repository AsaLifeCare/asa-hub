// Keyless Google Maps deep links — same new-tab pattern as ops-flows' `openRouteInMaps` (window.open with…
import { openFile } from '@/stores/useFileViewerStore'

/** Maps search URL for a free-form address/place query. */
export function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/** Open an address in Google Maps (new tab). */
export function openAddressInMaps(address: string) {
  window.open(mapsSearchUrl(address), '_blank', 'noopener,noreferrer')
}

// Open an address CONTAINED in the platform.
export function openAddressInPlatform(address: string) {
  openFile({ title: address, subtitle: 'Google Maps', url: mapsSearchUrl(address), icon: 'map-pin' })
}

// Does a field key/label look address-ish?
export function isAddressKey(key: string): boolean {
  const words = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
  return words.includes('address') || words.includes('location')
}

/** Keyless Google Maps embed of an address, for an iframe. */
export function mapsEmbedUrl(address: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`
}
