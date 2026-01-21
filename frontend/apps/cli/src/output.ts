/**
 * Output formatting utilities
 */

import chalk from 'chalk'
import YAML from 'yaml'

export type OutputFormat = 'json' | 'yaml' | 'table' | 'pretty'

export function formatOutput(data: unknown, format: OutputFormat = 'json'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, replacer, 2)
    case 'yaml':
      return YAML.stringify(data, {indent: 2})
    case 'table':
      return formatTable(data)
    case 'pretty':
      return formatPretty(data)
    default:
      return JSON.stringify(data, replacer, 2)
  }
}

// JSON replacer to handle BigInt
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  return value
}

function formatTable(data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return '(empty)'

    const first = data[0]
    if (typeof first !== 'object' || first === null) {
      return data.map(String).join('\n')
    }

    const keys = Object.keys(first)
    const widths = keys.map((k) =>
      Math.max(k.length, ...data.map((row) => String(row[k] ?? '').length))
    )

    const header = keys.map((k, i) => k.padEnd(widths[i])).join('  ')
    const separator = widths.map((w) => '-'.repeat(w)).join('  ')
    const rows = data.map((row) =>
      keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join('  ')
    )

    return [header, separator, ...rows].join('\n')
  }

  if (typeof data === 'object' && data !== null) {
    return Object.entries(data)
      .map(([k, v]) => `${k}: ${formatValue(v)}`)
      .join('\n')
  }

  return String(data)
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return `[${value.length} items]`
    }
    return '{...}'
  }
  return String(value)
}

function formatPretty(data: unknown): string {
  return formatPrettyValue(data, 0)
}

function formatPrettyValue(value: unknown, indent: number): string {
  const prefix = '  '.repeat(indent)

  if (value === null || value === undefined) {
    return chalk.dim('null')
  }

  if (typeof value === 'string') {
    return chalk.green(`"${value}"`)
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return chalk.yellow(String(value))
  }

  if (typeof value === 'boolean') {
    return chalk.blue(String(value))
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((v) => `${prefix}  ${formatPrettyValue(v, indent + 1)}`)
    return `[\n${items.join(',\n')}\n${prefix}]`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const lines = entries.map(
      ([k, v]) => `${prefix}  ${chalk.cyan(k)}: ${formatPrettyValue(v, indent + 1)}`
    )
    return `{\n${lines.join(',\n')}\n${prefix}}`
  }

  return String(value)
}

// Helpers for CLI output

export function printSuccess(message: string) {
  console.log(chalk.green('✓'), message)
}

export function printError(message: string) {
  console.error(chalk.red('✗'), message)
}

export function printWarning(message: string) {
  console.log(chalk.yellow('⚠'), message)
}

export function printInfo(message: string) {
  console.log(chalk.blue('ℹ'), message)
}
