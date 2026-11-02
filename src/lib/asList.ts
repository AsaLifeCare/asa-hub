// A spreadsheet has no arrays.
// Every "list" field arrives from a sheet as ONE CELL — `"onboarding,psi"` — while the seed data that the screens…
export function asList(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  const s = String(value).trim()
  if (!s) return []
  // JSON arrays survive some round trips through the sheet as text
  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean)
    } catch { /* not JSON after all — fall through to the separators */ }
  }
  return s.split(/[,;|\n]+/).map((v) => v.trim()).filter(Boolean)
}
