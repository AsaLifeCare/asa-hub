// THE SETTINGS CATALOGUE, WHEN IT DID NOT ANSWER — said on the screen.
// Which configuration keys exist, which section draws each one, what it ships as and the sentence under the field…
export type CatalogueState = {
  ok?: boolean
  read?: boolean
  source?: string
  tab?: string
  keys?: number
  sheet_keys?: number
  shipped_only?: string[]
  repaired?: string[]
  refused?: string[]
  message?: string
}

/** The envelope every Settings section already reads, narrowed to this field. */
export function catalogueOf(answer: unknown): CatalogueState | null {
  const c = (answer as { catalogue?: CatalogueState } | null)?.catalogue
  return c && typeof c === 'object' ? c : null
}

export default function CatalogueNotice({ catalogue }: { catalogue?: CatalogueState | null }) {
  const message = String(catalogue?.message ?? '').trim()
  if (!message) return null
  const down = catalogue?.read === false
  const corrected = (catalogue?.repaired?.length ?? 0) + (catalogue?.refused?.length ?? 0) > 0
  const missing = (catalogue?.shipped_only?.length ?? 0) > 0
  const heading = down
    ? 'The settings catalogue could not be read.'
    : missing
      ? 'The settings catalogue is missing some keys.'
      : corrected
        ? 'A row in the settings catalogue had to be corrected.'
        : 'The settings catalogue answered with something to say.'
  return (
    <p
      className={
        down
          ? 'rounded-md bg-tint-pink px-3 py-2 text-[11.5px] leading-[1.55] text-tint-fg-pink'
          : 'rounded-md bg-tint-amber px-3 py-2 text-[11.5px] leading-[1.55] text-tint-fg-amber'
      }
    >
      <span className="font-semibold">{heading}</span> {message}
    </p>
  )
}
