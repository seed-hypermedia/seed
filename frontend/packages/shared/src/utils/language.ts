export function pluralS(length: number | undefined, label: string, pluralLabel?: string) {
  if (length !== 1 && pluralLabel) return pluralLabel
  return `${label}${length === 1 ? '' : 's'}`
}
