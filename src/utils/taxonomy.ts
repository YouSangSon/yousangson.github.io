export function slugifyTaxonomy(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}
