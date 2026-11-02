// AN ADDRESS AS A LINK — a press opens the one right panel at its standard width with the address and its Google map.
// "Open larger" hands the same address to the platform's centred viewer; Google Maps itself opens in a new tab.
import { useState } from 'react'
import { ExternalLink, Loader2, MapPin, Maximize2 } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { mapsEmbedUrl, mapsSearchUrl, openAddressInPlatform } from '@/lib/maps'

export const ADDRESS_MAP_LABEL = 'Address'

/** The address's Google map, with "Open larger" under it; a new address says it is loading until its map arrives. */
export function AddressMapFrame({ address, height = 320 }: { address: string; height?: number }) {
  const [shown, setShown] = useState('')
  const loading = shown !== address
  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-surface" data-address-map-frame="">
      <div className="relative" style={{ height }}>
        <iframe key={address} src={mapsEmbedUrl(address)} title={`Map of ${address}`} loading="lazy"
          onLoad={() => setShown(address)} style={{ height }} className="w-full border-0" data-address-frame="" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-surface/80 text-[12.5px] text-text-2"
            data-address-map-loading="">
            <Loader2 size={15} className="animate-spin" /> Loading the map…
          </div>
        )}
      </div>
      <button type="button" onClick={() => openAddressInPlatform(address)} data-address-larger=""
        className="inline-flex items-center gap-1 px-3 py-2 text-[11.5px] font-semibold text-primary hover:underline">
        <Maximize2 size={12} /> Open larger
      </button>
    </div>
  )
}

export function AddressMapPanel({ open, address, title, onClose }: {
  open: boolean
  address: string
  /** whose address it is, drawn as the panel's title */
  title: string
  onClose: () => void
}) {
  const shown = open && !!address
  return (
    <SidePanel open={shown} onClose={onClose} label={ADDRESS_MAP_LABEL} title={title}>
      {shown && (
        <div className="grid gap-3 pt-2" data-address-map="">
          <p className="flex items-start gap-2 text-[13.5px] leading-5 text-text-1" data-address-text="">
            <MapPin size={15} className="mt-0.5 shrink-0 text-text-3" />
            <span className="min-w-0 break-words">{address}</span>
          </p>
          <AddressMapFrame address={address} />
          <a href={mapsSearchUrl(address)} target="_blank" rel="noopener noreferrer" data-address-google=""
            className="inline-flex w-fit items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">
            <ExternalLink size={13} /> Open in Google Maps
          </a>
        </div>
      )}
    </SidePanel>
  )
}

export default function AddressMapLink({ address, title, className }: {
  address: string
  /** the panel's title; the address itself when none */
  title?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-address-link=""
        className={cn('text-left text-primary hover:underline', className)}>
        {address}
      </button>
      <AddressMapPanel open={open} address={address} title={title || address} onClose={() => setOpen(false)} />
    </>
  )
}
