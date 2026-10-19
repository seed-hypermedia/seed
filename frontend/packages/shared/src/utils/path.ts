/** Address rules used by document segment and domain inputs. */
export type PathInputKind = 'path' | 'subdomain' | 'domain'

/** Converts user input to an address, optionally keeping an unfinished trailing separator. */
export function normalizePathInput(
  value: string,
  {kind = 'path', editing = false}: {kind?: PathInputKind; editing?: boolean} = {},
): string {
  if (kind === 'domain') {
    // Pasted URLs must not concatenate their path or query onto the hostname.
    value = value.trimStart()
    if (/^https?:\/\//i.test(value)) {
      try {
        value = new URL(value).hostname
      } catch {
        // Keep incomplete pasted addresses editable under the same input rules.
        value = value.replace(/^https?:\/\//i, '')
      }
    }
    value = value.split(/[/?#]/)[0] || ''
  }
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
  if (kind === 'path') {
    const segment = normalized
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+/, '')
    return editing ? segment : segment.replace(/[-_]+$/, '')
  }
  const labels = kind === 'domain' ? normalized.split('.') : [normalized]
  return labels
    .map((label) => {
      // Keep literal internal double hyphens: encoded international domains use xn--.
      const cleaned = label.replace(/-*[^a-z0-9-]+-*/g, '-').replace(/^-+/, '')
      return editing ? cleaned : cleaned.replace(/-+$/, '')
    })
    .join('.')
}

/** Slugify a string for use as a completed URL path segment. */
export function pathNameify(name: string): string {
  return normalizePathInput(name)
}

/** Checks DNS hostname syntax and label lengths without changing the supplied address. */
export function validateDomain(value: string, kind: 'domain' | 'subdomain' = 'domain'): string | null {
  const labels = value.split('.')
  if (kind === 'domain' && labels.length < 2) return 'Enter a full domain name, such as example.com.'
  if (kind === 'subdomain' && labels.length !== 1) return 'Subdomain must be a single name without dots.'
  if (value.length > 253) return 'Domain must be at most 253 characters long.'
  if (labels.some((label) => label.length > 63)) return 'Each domain label must be at most 63 characters long.'
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    return 'Use letters, digits, and internal dashes, with dots between domain labels.'
  }
  return null
}
