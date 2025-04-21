export function pluralizer(
  count: number,
  singleLabel: string,
  pluralSuffix = 's',
) {
  return count === 1
    ? `1 ${singleLabel}`
    : `${count} ${singleLabel}${pluralSuffix}`
}

export function pluralS(
  length: number | undefined,
  label: string,
  pluralLabel?: string,
) {
  if (length !== 1 && pluralLabel) return pluralLabel
  return `${label}${length === 1 ? '' : 's'}`
}
