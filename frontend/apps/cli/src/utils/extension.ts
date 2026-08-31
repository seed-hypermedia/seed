/**
 * Pure helpers for the `extension` command group: reading an extension
 * package from disk, building install records, and turning them into
 * metadata attribute ops. No network access here so everything is unit
 * testable; see `extension.test.ts`.
 */

import {existsSync, readFileSync} from 'fs'
import {basename, join, resolve} from 'path'
import {
  EXTENSION_INSTALLS_KEY,
  EXTENSION_MANIFEST_KEY,
  EXTENSION_MOUNT_PATH_RE,
  ExtensionInstallRecordSchema,
  validateExtensionManifest,
  type ExtensionInstallRecord,
  type ExtensionManifest,
} from '@seed-hypermedia/client/extensions'
import {slugify} from '@seed-hypermedia/client'
import {diffAttributes, type Attribute} from './publish'

/** Entry HTML files above this size are refused at publish time. */
export const MAX_ENTRY_BYTES = 4 * 1024 * 1024

export type ExtensionPackageOptions = {
  entry?: string
  manifest?: string
  readme?: string
  name?: string
}

export type ExtensionPackage = {
  dir: string
  manifestPath: string
  entryPath: string
  readmePath: string | null
  /** Manifest as written on disk (without `entry`, which is computed at publish time). */
  manifestRaw: Record<string, unknown>
  entryHtml: string
  entryBytes: Uint8Array
  /** README markdown, or null when there is none. */
  readme: string | null
  name: string
  /** Where the name came from, for the publish log. */
  nameSource: 'flag' | 'readme' | 'package.json' | 'directory'
  warnings: string[]
}

/**
 * Read an extension package directory: manifest JSON, entry HTML, README and
 * (for the name fallback) package.json. Throws with actionable messages when
 * the required files are missing or the entry is too large.
 */
export function readExtensionPackage(dirArg: string, opts: ExtensionPackageOptions = {}): ExtensionPackage {
  const dir = resolve(dirArg)
  if (!existsSync(dir)) throw new Error(`Extension directory not found: ${dir}`)

  const manifestPath = opts.manifest ? resolve(opts.manifest) : join(dir, 'seed-extension.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath} (use --manifest <file> to point at it)`)
  }
  let manifestRaw: unknown
  try {
    manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (e) {
    throw new Error(`Manifest ${manifestPath} is not valid JSON: ${(e as Error).message}`)
  }
  if (!manifestRaw || typeof manifestRaw !== 'object' || Array.isArray(manifestRaw)) {
    throw new Error(`Manifest ${manifestPath} must be a JSON object`)
  }
  const manifest = {...(manifestRaw as Record<string, unknown>)}
  // Editors add `$schema`; the manifest schema is strict so drop it here.
  delete manifest.$schema

  const entryPath = opts.entry ? resolve(opts.entry) : join(dir, 'dist', 'index.html')
  if (!existsSync(entryPath)) {
    throw new Error(`Entry HTML not found: ${entryPath}. Build the extension first, or pass --entry <file>.`)
  }
  const entryBytes = new Uint8Array(readFileSync(entryPath))
  if (entryBytes.byteLength > MAX_ENTRY_BYTES) {
    throw new Error(
      `Entry HTML is ${formatBytes(entryBytes.byteLength)}; the limit is ${formatBytes(
        MAX_ENTRY_BYTES,
      )}. Inline fewer assets or load large media by CID at runtime.`,
    )
  }
  const entryHtml = Buffer.from(entryBytes).toString('utf-8')
  const warnings = checkEntryHtml(entryHtml)

  const readmePath = opts.readme ? resolve(opts.readme) : join(dir, 'README.md')
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf-8') : null
  if (opts.readme && readme === null) throw new Error(`README not found: ${readmePath}`)

  const {name, nameSource} = deriveExtensionName({flag: opts.name, readme, dir})

  return {
    dir,
    manifestPath,
    entryPath,
    readmePath: readme === null ? null : readmePath,
    manifestRaw: manifest,
    entryHtml,
    entryBytes,
    readme,
    name,
    nameSource,
    warnings,
  }
}

/**
 * Heuristic lint for an entry HTML file. The entry is loaded through
 * `srcdoc` in a sandboxed iframe, so relative and root-relative URLs cannot
 * resolve; anything that is not inlined will silently fail to load.
 */
export function checkEntryHtml(html: string): string[] {
  const warnings: string[] = []
  const refs = html.match(/\b(?:src|href)\s*=\s*["'](?:\.{0,2}\/)[^"']*["']/gi) ?? []
  if (refs.length > 0) {
    const sample = refs
      .slice(0, 3)
      .map((r) => r.trim())
      .join(', ')
    warnings.push(
      `Entry references ${refs.length} relative URL${refs.length === 1 ? '' : 's'} (${sample}${
        refs.length > 3 ? ', …' : ''
      }). Relative paths do not resolve inside the sandboxed iframe — bundle everything into one file (e.g. vite-plugin-singlefile).`,
    )
  }
  if (!/<script\b/i.test(html)) {
    warnings.push('Entry contains no <script> tag.')
  }
  return warnings
}

/** First `# Heading` of a markdown document (outside code fences), or null. */
export function readmeTitle(markdown: string): string | null {
  let inFence = false
  for (const rawLine of stripFrontmatter(markdown).split('\n')) {
    const line = rawLine.trimEnd()
    if (/^(```|~~~)/.test(line.trimStart())) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) return m[1]!.trim()
  }
  return null
}

/**
 * Remove the README's leading `# Title` line when it is the document name:
 * the name is rendered as the page title, so keeping it would show it twice.
 * Only a heading that is the first content line is removed.
 */
export function stripLeadingTitle(markdown: string, title: string): string {
  const fm = splitFrontmatter(markdown)
  const lines = fm.body.split('\n')
  let i = 0
  while (i < lines.length && lines[i]!.trim() === '') i++
  const m = i < lines.length ? /^#\s+(.+?)\s*#*\s*$/.exec(lines[i]!) : null
  if (!m || m[1]!.trim() !== title) return markdown
  lines.splice(i, 1)
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift()
  return fm.frontmatter + lines.join('\n')
}

function splitFrontmatter(markdown: string): {frontmatter: string; body: string} {
  if (!markdown.startsWith('---\n')) return {frontmatter: '', body: markdown}
  const end = markdown.indexOf('\n---', 4)
  if (end === -1) return {frontmatter: '', body: markdown}
  const after = markdown.indexOf('\n', end + 1)
  const cut = after === -1 ? markdown.length : after + 1
  return {frontmatter: markdown.slice(0, cut), body: markdown.slice(cut)}
}

function stripFrontmatter(markdown: string): string {
  return splitFrontmatter(markdown).body
}

export function deriveExtensionName(input: {flag?: string; readme: string | null; dir: string}): {
  name: string
  nameSource: ExtensionPackage['nameSource']
} {
  if (input.flag) return {name: input.flag, nameSource: 'flag'}
  const fromReadme = input.readme ? readmeTitle(input.readme) : null
  if (fromReadme) return {name: fromReadme, nameSource: 'readme'}
  const pkgPath = join(input.dir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {name?: unknown}
      if (typeof pkg.name === 'string' && pkg.name.trim()) {
        return {name: pkg.name.replace(/^@[^/]+\//, ''), nameSource: 'package.json'}
      }
    } catch {
      // unreadable package.json — fall through to the directory name
    }
  }
  return {name: basename(input.dir), nameSource: 'directory'}
}

/** Document path (without leading slash) an extension is published at when `-p` is not given. */
export function defaultExtensionPath(manifest: {defaultMountPath?: string}, name: string): string {
  return manifest.defaultMountPath || slugify(name) || 'extension'
}

/** Validate the on-disk manifest once the entry CID is known. */
export function finalizeManifest(manifestRaw: Record<string, unknown>, entryCid: string): ExtensionManifest {
  return validateExtensionManifest({...manifestRaw, entry: `ipfs://${entryCid}`})
}

export function assertMountPath(mount: string): string {
  const cleaned = mount.replace(/^\/+|\/+$/g, '')
  if (!EXTENSION_MOUNT_PATH_RE.test(cleaned)) {
    throw new Error(
      `Invalid mount path "${mount}": use lowercase letters, digits and dashes, segments separated by "/" (e.g. "board" or "tools/board").`,
    )
  }
  return cleaned
}

export function parseSettingsJson(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`--settings must be a JSON object: ${(e as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--settings must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

export type BuildInstallRecordInput = {
  /** `hm://<uid>/<path>` of the extension document, without version. */
  ext: string
  /** Extension document version to pin, or undefined to follow latest. */
  version?: string
  title?: string
  /** Pass false to hide from navigation; true/undefined leaves the default. */
  nav?: boolean
  settings?: Record<string, unknown>
}

export function buildInstallRecord(input: BuildInstallRecordInput): ExtensionInstallRecord {
  const record: Record<string, unknown> = {ext: input.ext}
  if (input.version) record.version = input.version
  if (input.title) record.title = input.title
  if (input.nav === false) record.nav = false
  if (input.settings && Object.keys(input.settings).length > 0) record.settings = input.settings
  const parsed = ExtensionInstallRecordSchema.safeParse(record)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new Error(`Invalid install record: ${issues}`)
  }
  return parsed.data
}

/** Raw `extensions` map from a home document's metadata (may hold nulls and junk). */
export function rawInstalls(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') return {}
  const raw = (metadata as Record<string, unknown>)[EXTENSION_INSTALLS_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}

/** Raw `seedExtension` value from an extension document's metadata. */
export function rawManifest(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object') return undefined
  return (metadata as Record<string, unknown>)[EXTENSION_MANIFEST_KEY]
}

/**
 * Attribute ops that write `record` at `extensions.<mount>`, nulling any
 * leaf of the previous record that the new one does not carry.
 */
export function installRecordAttributes(mount: string, record: ExtensionInstallRecord, previous: unknown): Attribute[] {
  return diffAttributes([EXTENSION_INSTALLS_KEY, mount], record, previous)
}

/**
 * Attribute ops that remove the record at `extensions.<mount>`: one `null`
 * per leaf of the previous record (the desktop's removal shape). Empty when
 * nothing is installed there.
 */
export function uninstallAttributes(mount: string, previous: unknown): Attribute[] {
  return diffAttributes([EXTENSION_INSTALLS_KEY, mount], undefined, previous)
}

/** `hm://` id of a document without any version/query suffix. */
export function bareHmId(uid: string, path: string[] | null | undefined): string {
  const segments = (path || []).filter(Boolean)
  return segments.length ? `hm://${uid}/${segments.join('/')}` : `hm://${uid}`
}

/** Where a mounted extension is reachable. */
export function extensionMountUrls(serverUrl: string, siteUid: string, mount: string): {hm: string; web: string} {
  return {hm: `hm://${siteUid}/${mount}`, web: `${serverUrl}/hm/${siteUid}/${mount}`}
}

export function installCommandHint(extensionId: string, mount: string | undefined, dev: boolean): string {
  const parts = ['seed-cli', 'extension', 'install', extensionId]
  if (mount) parts.push('--path', mount)
  parts.push('-k', '<sitekey>')
  if (dev) parts.push('--dev')
  return parts.join(' ')
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`
}
