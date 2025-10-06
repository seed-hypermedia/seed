/**
 * Formats a date string into a readable format
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  }).format(date)
}

/**
 * Formats a metric value with appropriate units and human-readable format
 */
export function formatMetricValue(value: number, unit: string): string {
  // Special case for bytes - convert to KB, MB, GB as appropriate
  if (unit === 'bytes') {
    return formatBytes(value)
  }

  // For percentages, format with fixed decimal places
  if (unit === '%') {
    return `${value.toFixed(1)}${unit}`
  }

  // For time measurements (ms), format appropriately
  if (unit === 'ms') {
    if (value < 1) {
      return `${(value * 1000).toFixed(2)}μs`
    }
    if (value >= 1000) {
      return `${(value / 1000).toFixed(2)}s`
    }
    return `${Math.round(value)}${unit}`
  }

  // Default formatting - add the unit to the value
  if (unit) {
    return `${value.toLocaleString()}${unit}`
  }

  // Just return the value if no unit
  return value.toLocaleString()
}

/**
 * Formats bytes into human-readable KB, MB, GB
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}
