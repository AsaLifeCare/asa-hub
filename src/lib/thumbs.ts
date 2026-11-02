// Small copies for grids.
// The image bank was painting a wall of tiles by downloading the full-size original behind each one: fifty…
const LIBRARY = '/assets/library/'

export function thumbFor(src: string | null | undefined): string {
  const path = String(src ?? '')
  if (!path.startsWith(LIBRARY)) return path
  const rest = path.slice(LIBRARY.length)
  if (rest.startsWith('thumbs/')) return path
  // Everything after the last dot goes: several files in the library are named "<hash>.jpeg (no extension)", and…
  return `${LIBRARY}thumbs/${rest.replace(/\.[^./]*$/, '')}.webp`
}
