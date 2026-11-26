#!/usr/bin/env node

/**
 * Counts design-system drift across the Seed UI packages: values that bypass the
 * `@shm/ui` tokens and primitives. The output is the baseline that later
 * design-system phases drive to zero, and it becomes the `lint:design` gate.
 *
 * This is a regex scan over tracked source files, so a few matches can come
 * from comments or prose strings. The blocking lint will be AST-based.
 *
 * Usage:
 *   node scripts/design-audit.mjs [--output=table|json|markdown] [--detailed] [--output-file=PATH]
 */

import {execFileSync} from 'node:child_process'
import {readFileSync, writeFileSync} from 'node:fs'
import {basename, extname} from 'node:path'
import {fileURLToPath} from 'node:url'

/** UI packages scanned, keyed by the name shown in reports. */
export const PACKAGES = {
  ui: 'frontend/packages/ui/src/',
  editor: 'frontend/packages/editor/src/',
  'agents-ui': 'frontend/packages/agents-ui/src/',
  desktop: 'frontend/apps/desktop/src/',
  web: 'frontend/apps/web/app/',
  vault: 'vault/src/frontend/',
  emails: 'frontend/apps/emails/',
}

/** Files that define tokens or are not shipped UI, so they are not drift. */
const EXCLUDED = [
  /\.stories\.[jt]sx?$/,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /(^|\/)__tests__\//,
  /(^|\/)e2e\//,
  /(^|\/)test-utils?\//,
  /story-fixtures\.tsx$/,
  /\.d\.ts$/,
  /^frontend\/packages\/ui\/src\/theme\.css$/,
]

const SOURCE_EXT = new Set(['.ts', '.tsx', '.jsx', '.js', '.mjs'])
const CSS_EXT = new Set(['.css'])

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const COLOR_UTILITY =
  'bg|text|border|border-[xytrblse]|ring|ring-offset|fill|stroke|from|via|to|outline|decoration|divide|placeholder|caret|accent|shadow'
/** Arbitrary values (`w-[13px]`). A trailing `:` means an arbitrary variant (`data-[state=open]:`), which is not drift. */
const ARBITRARY = /(?<![\w-])-?([a-z][a-z0-9-]*)-\[([^\]\s'"`]+)\](?!:)/g
const LENGTH = /\d(?:px|rem|em)\b/
const COLOR_VALUE = /^(?:#|(?:rgba?|hsla?|oklch|oklab|lch|lab|color-mix)\()/

/** Motion in a file; paired with MOTION_REDUCE to find animations with no reduced-motion path. */
const MOTION =
  /(?<![\w-])(?:transition(?:-(?:all|colors|opacity|shadow|transform|\[[^\]]+\]))?|animate-[a-z][\w-]*|duration-(?:\d+|\[[^\]]+\]|\([^)]+\)))(?![\w-])|@keyframes|(?<![\w-])animation\s*:|(?<![\w-])transition\s*:|from\s+['"](?:motion\/react|motion|framer-motion)['"]/
const MOTION_REDUCE = /motion-reduce|motion-safe|prefers-reduced-motion|useReducedMotion|reducedMotion/

/** Basenames of primitives that must only exist in `@shm/ui`. */
const PRIMITIVE_NAMES = new Set([
  'button',
  'dialog',
  'input',
  'textarea',
  'tooltip',
  'popover',
  'select',
  'checkbox',
  'switch',
  'tabs',
  'dropdown-menu',
  'sheet',
  'drawer',
  'toast',
  'badge',
  'label',
  'separator',
  'scroll-area',
])

/**
 * Drift categories. `source` patterns run on TS/TSX, `css` patterns on CSS.
 * A category with `filter` counts only the arbitrary values the filter accepts.
 */
export const CATEGORIES = [
  {
    id: 'rawPalette',
    label: 'Raw Tailwind palette colours (bg-blue-700)',
    source: new RegExp(`(?<![\\w-])(?:${COLOR_UTILITY})-(?:${PALETTE})-(?:50|[1-9]00|950)(?:/[\\d.]+)?(?![\\w-])`, 'g'),
  },
  {
    id: 'blackWhite',
    label: 'Raw black/white colours (bg-black/5)',
    source: new RegExp(`(?<![\\w-])(?:${COLOR_UTILITY})-(?:black|white)(?:/[\\d.]+)?(?![\\w-])`, 'g'),
  },
  {
    id: 'colorLiteral',
    label: 'Colour literals (#hex, rgb(), hsl(), oklch())',
    source:
      /(?<=["'`\s(\[:,])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|(?<![\w-])(?:rgba?|hsla?|oklch|oklab|lch|lab)\(/g,
    css: /(?<![\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|(?<![\w-])(?:rgba?|hsla?|oklch|oklab|lch|lab)\(/g,
  },
  {
    id: 'arbitraryLength',
    label: 'Arbitrary lengths (w-[13px], top-[2.5rem])',
    arbitrary: (utility, value) =>
      LENGTH.test(value) && !COLOR_VALUE.test(value) && utility !== 'z' && !isTextSize(utility, value),
  },
  {
    id: 'arbitraryTextSize',
    label: 'Arbitrary text sizes (text-[11px])',
    arbitrary: (utility, value) => isTextSize(utility, value),
  },
  {
    id: 'arbitraryOther',
    label: 'Other arbitrary values (grid-cols-[...], bg-[#fff])',
    arbitrary: (utility, value) => !LENGTH.test(value) && utility !== 'z',
  },
  {
    id: 'zIndex',
    label: 'Numeric z-index (z-50, z-[9999])',
    source: /(?<![\w-])-?z-(?:\d+|\[[^\]\s]+\])(?![\w-])/g,
    css: /(?<![\w-])z-index\s*:\s*-?\d+/g,
  },
  {
    id: 'transitionAll',
    label: 'transition-all',
    source: /(?<![\w-])transition-all(?![\w-])/g,
    css: /transition(?:-property)?\s*:\s*all\b/g,
  },
  {
    id: 'genericEasing',
    label: 'Generic easing (ease-in, ease-in-out, ease-linear)',
    source: /(?<![\w-])ease-(?:in|out|in-out|linear)(?![\w-])/g,
    css: /(?<![\w-])(?:ease|ease-in|ease-out|ease-in-out)(?=\s*[;,)]|\s+\d)/g,
  },
  {
    id: 'inlineStyle',
    label: 'Inline style objects (style={{...}})',
    source: /style=\{\{/g,
  },
  {
    id: 'physicalDirection',
    label: 'Physical-direction classes (ml-, pl-, left-, text-left)',
    source:
      /(?<![\w-])-?(?:(?:m[lr]|p[lr]|scroll-m[lr]|scroll-p[lr]|left|right)-(?:\d+(?:\.\d+)?|px|auto|full|\d+\/\d+|\[[^\]\s]+\]|\([^)\s]+\))|(?:border|rounded)-(?:[lr]|tl|tr|bl|br)(?:-[a-z0-9.\/\[\]%#()-]+)?|text-(?:left|right)|float-(?:left|right))(?![\w-])/g,
    css: /(?<![\w-])(?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?\s*:|(?<![\w-])(?:left|right)\s*:\s*[-\d.a-z(]|text-align\s*:\s*(?:left|right)|float\s*:\s*(?:left|right)/g,
  },
  {
    id: 'fontFamily',
    label: 'Font families outside the tokens',
    source: /fontFamily\s*[=:]\s*(?![{\s]*['"`]?\s*(?:var\(--font-|inherit))|(?<![\w-])font-\[[^\]]+\]/g,
    css: /font-family\s*:\s*(?!\s*(?:var\(--font-|inherit))/g,
  },
  {
    id: 'primitiveImport',
    label: 'Radix/Vaul/Sonner/cmdk imported outside @shm/ui',
    source: /from\s+['"](?:@radix-ui\/[\w-]+|vaul|sonner|cmdk)['"]/g,
    skip: (pkg) => pkg === 'ui',
  },
]

function isTextSize(utility, value) {
  return utility === 'text' && LENGTH.test(value) && !COLOR_VALUE.test(value)
}

/** Count category matches in one file's text. Returns {categoryId: count}. */
export function scanText(text, {css = false, pkg = ''} = {}) {
  const counts = {}
  const scanned = css ? text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{[^}]*\}/g, '') : text
  const arbitrary = css ? [] : [...scanned.matchAll(ARBITRARY)]
  for (const cat of CATEGORIES) {
    if (cat.skip?.(pkg)) continue
    let n = 0
    if (cat.arbitrary) {
      n = arbitrary.filter((m) => cat.arbitrary(m[1], m[2])).length
    } else {
      const re = css ? cat.css : cat.source
      if (re) n = (scanned.match(re) || []).length
    }
    if (n) counts[cat.id] = n
  }
  if (MOTION.test(scanned) && !MOTION_REDUCE.test(scanned)) counts.motionWithoutReduce = 1
  return counts
}

/** Distinct z-index values, to show how far the stacking order has drifted. */
function zValues(text) {
  return [...text.matchAll(/(?<![\w-])(-?)z-(\d+|\[[^\]\s]+\])(?![\w-])/g)].map(
    (m) => m[1] + m[2].replace(/[[\]]/g, ''),
  )
}

function listFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z', ...Object.values(PACKAGES)], {cwd: root, encoding: 'utf8'})
  return out.split('\0').filter(Boolean)
}

/** Run the audit over a repository root. */
export function audit(root) {
  const result = {packages: {}, files: {}, zValues: {}, duplicatePrimitives: []}
  for (const pkg of Object.keys(PACKAGES)) result.packages[pkg] = {}
  for (const file of listFiles(root)) {
    if (EXCLUDED.some((re) => re.test(file))) continue
    const ext = extname(file)
    const css = CSS_EXT.has(ext)
    if (!css && !SOURCE_EXT.has(ext)) continue
    const pkg = Object.keys(PACKAGES).find((p) => file.startsWith(PACKAGES[p]))
    if (pkg !== 'ui' && ext === '.tsx' && PRIMITIVE_NAMES.has(basename(file, ext).toLowerCase())) {
      result.duplicatePrimitives.push(file)
    }
    let text
    try {
      text = readFileSync(`${root}/${file}`, 'utf8')
    } catch {
      continue
    }
    const counts = scanText(text, {css, pkg})
    for (const [id, n] of Object.entries(counts)) {
      result.packages[pkg][id] = (result.packages[pkg][id] || 0) + n
      ;(result.files[id] ||= []).push([file, n])
    }
    if (!css) for (const v of zValues(text)) result.zValues[v] = (result.zValues[v] || 0) + 1
  }
  result.packages[Object.keys(PACKAGES)[0]].duplicatePrimitives = 0
  for (const file of result.duplicatePrimitives) {
    const pkg = Object.keys(PACKAGES).find((p) => file.startsWith(PACKAGES[p]))
    result.packages[pkg].duplicatePrimitives = (result.packages[pkg].duplicatePrimitives || 0) + 1
  }
  return result
}

/** Report rows in display order. */
export const ROWS = [
  ...CATEGORIES.map((c) => [c.id, c.label]),
  ['motionWithoutReduce', 'Files with motion but no reduced-motion handling'],
  ['duplicatePrimitives', 'Primitive components re-implemented outside @shm/ui'],
]

function table(result, markdown) {
  const pkgs = Object.keys(PACKAGES)
  const header = ['Category', ...pkgs, 'total']
  const rows = ROWS.map(([id, label]) => {
    const cells = pkgs.map((p) => result.packages[p][id] || 0)
    return [label, ...cells, cells.reduce((a, b) => a + b, 0)]
  })
  if (markdown) {
    return [
      `| ${header.join(' | ')} |`,
      `|${header.map((_, i) => (i ? '---:' : '---')).join('|')}|`,
      ...rows.map((r) => `| ${r.join(' | ')} |`),
    ].join('\n')
  }
  const widths = header.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i]).length)))
  const line = (r) => r.map((c, i) => (i ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join('  ')
  return [line(header), ...rows.map(line)].join('\n')
}

function detailed(result) {
  const lines = []
  for (const [id, label] of ROWS) {
    const files = (result.files[id] || []).sort((a, b) => b[1] - a[1]).slice(0, 10)
    if (!files.length) continue
    lines.push(`\n${label}`)
    for (const [file, n] of files) lines.push(`  ${String(n).padStart(4)}  ${file}`)
  }
  if (result.duplicatePrimitives.length) {
    lines.push('\nPrimitive components re-implemented outside @shm/ui')
    for (const f of result.duplicatePrimitives) lines.push(`        ${f}`)
  }
  const z = Object.entries(result.zValues).sort((a, b) => Number.parseInt(a[0]) - Number.parseInt(b[0]))
  lines.push(`\nDistinct z-index values: ${z.map(([v, n]) => `${v} (${n})`).join(', ')}`)
  return lines.join('\n')
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('Usage: node scripts/design-audit.mjs [--output=table|json|markdown] [--detailed] [--output-file=PATH]')
    return
  }
  const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim()
  const result = audit(root)
  const format = opt('output') || 'table'
  let text
  if (format === 'json') {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim()
    const {files, ...rest} = result
    text = JSON.stringify({commit, ...rest}, null, 2)
  } else {
    text = table(result, format === 'markdown')
    if (args.includes('--detailed')) text += '\n' + detailed(result)
  }
  const file = opt('output-file')
  if (file) writeFileSync(file, text + '\n')
  else console.log(text)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
