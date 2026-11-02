// Folds case, accents and whitespace only — never nicknames or first-name matches, so two Marias stay apart.
export function normalizeName(v: string): string {
  return String(v || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ')
}

export function sameName(a: string, b: string): boolean {
  const x = normalizeName(a)
  return !!x && x === normalizeName(b)
}
