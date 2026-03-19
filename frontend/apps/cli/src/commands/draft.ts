/**
 * Draft commands — create, get, list, rm.
 *
 * Local draft management for Seed documents. Drafts are saved as markdown
 * files in the platform-specific Seed app data directory (shared with the
 * desktop app) and can be reviewed before publishing via `document create -f`
 * or `document update -f`.
 *
 * Both `.md` (CLI-created) and `.json` (desktop-created) drafts are supported
 * for reading. The CLI writes drafts as `.md` files; the desktop writes them
 * as `.json` files with an `index.json` metadata index.
 *
 * Default drafts directory by platform:
 *   Linux:   ~/.config/Seed/drafts/
 *   macOS:   ~/Library/Application Support/Seed/drafts/
 *   Windows: %APPDATA%\\Seed\\drafts\\
 *
 * With --dev flag, "Seed" becomes "Seed-local".
 * Override with SEED_CLI_DRAFTS_DIR env var.
 */

import type {Command} from 'commander'
import {existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync} from 'fs'
import {homedir} from 'os'
import {join, dirname, extname} from 'path'
import * as readline from 'readline'
import {readInput, mergeMetadata} from './document'
import {getOutputFormat, isPretty} from '../index'
import {formatOutput, renderMarkdown, printError, printSuccess, printInfo, printWarning} from '../output'
import {documentToMarkdown} from '../markdown'
import {parseMarkdown} from '../utils/markdown'
import {blocksToMarkdown, slugify, draftFilename, parseDraftFilename} from '@seed-hypermedia/client'
import {editorBlocksToHMBlockNodes} from '@seed-hypermedia/client/editorblock-to-hmblock'
import type {HMDocument, HMBlockNode, HMMetadata} from '@seed-hypermedia/client/hm-types'

/**
 * Resolve the platform-specific app data directory.
 *
 * Matches Electron's `app.getPath('appData')` so the CLI and desktop app
 * share the same root.
 */
function getAppDataDir(): string {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support')
    case 'win32':
      return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    default:
      return process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  }
}

/**
 * Resolve the drafts directory based on CLI options.
 *
 * Uses the same app data root as the desktop app. The `--dev` flag switches
 * from "Seed" to "Seed-local". The `SEED_CLI_DRAFTS_DIR` env var overrides
 * everything (useful for tests and custom setups).
 */
function getDraftsDir(options: Record<string, unknown>): string {
  if (process.env.SEED_CLI_DRAFTS_DIR) return process.env.SEED_CLI_DRAFTS_DIR
  const appName = options.dev ? 'Seed-local' : 'Seed'
  return join(getAppDataDir(), appName, 'drafts')
}

/**
 * Resolve a slug-or-path argument to a file path.
 *
 * If the argument contains `/` or ends with `.md`/`.json`, treat it as a
 * direct path. Otherwise, search the drafts directory for files whose
 * parsed ID or full basename matches the argument. This handles both old
 * `<slug>.md` and new `<slug>_<nanoid>.md` filename formats.
 */
function resolveDraftPath(slugOrPath: string, options: Record<string, unknown>): string {
  if (slugOrPath.includes('/') || slugOrPath.endsWith('.md') || slugOrPath.endsWith('.json')) {
    return slugOrPath
  }
  const draftsDir = getDraftsDir(options)

  // Try exact filename matches first (legacy formats)
  const mdPath = join(draftsDir, `${slugOrPath}.md`)
  if (existsSync(mdPath)) return mdPath
  const jsonPath = join(draftsDir, `${slugOrPath}.json`)
  if (existsSync(jsonPath) && slugOrPath !== 'index') return jsonPath

  // Scan for <slug>_<nanoid>.md or match by nanoid
  try {
    const files = readdirSync(draftsDir)
    for (const file of files) {
      const {id} = parseDraftFilename(file)
      if (id === slugOrPath) return join(draftsDir, file)
      // Also match by slug prefix (e.g. "my-document" matches "my-document_aBcDeFgHiJ.md")
      if (file.endsWith('.md') && file.startsWith(slugOrPath + '_')) return join(draftsDir, file)
    }
  } catch {}

  return mdPath
}

/**
 * Read the desktop draft index (index.json) from a drafts directory.
 *
 * Returns an empty array if the index does not exist or cannot be parsed.
 */
function readDraftIndex(draftsDir: string): Array<{id: string; metadata?: HMMetadata; [key: string]: unknown}> {
  const indexPath = join(draftsDir, 'index.json')
  if (!existsSync(indexPath)) return []
  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8'))
  } catch {
    return []
  }
}

/**
 * Upsert an entry in the draft index (index.json).
 *
 * Reads the current index, replaces or appends the entry, and writes it back.
 * Creates the index file if it doesn't exist.
 */
function upsertDraftIndex(draftsDir: string, entry: {id: string; metadata?: HMMetadata; [key: string]: unknown}) {
  const indexPath = join(draftsDir, 'index.json')
  const index = readDraftIndex(draftsDir)
  const filtered = index.filter((d) => d.id !== entry.id)
  filtered.push(entry)
  mkdirSync(draftsDir, {recursive: true})
  writeFileSync(indexPath, JSON.stringify(filtered, null, 2))
}

/**
 * Read a `.json` draft file and convert its content to markdown.
 *
 * Looks up metadata from `index.json` in the same directory. Converts
 * BlockNote editor blocks to HMBlockNode tree, then renders via the
 * SDK's `blocksToMarkdown`.
 */
function readJsonDraftAsMarkdown(filePath: string): string {
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
  const editorBlocks = raw.content || []
  const hmBlocks = editorBlocksToHMBlockNodes(editorBlocks)

  // Look up metadata from index.json
  const draftsDir = dirname(filePath)
  const draftId = filePath.replace(/.*\//, '').replace(/\.json$/, '')
  const index = readDraftIndex(draftsDir)
  const indexEntry = index.find((d) => d.id === draftId)
  const metadata: HMMetadata = (indexEntry?.metadata as HMMetadata) || {}

  const doc = {
    content: hmBlocks,
    metadata,
    version: '',
    authors: [],
  } as unknown as HMDocument

  return blocksToMarkdown(doc)
}

/**
 * Prompt the user for confirmation on stderr (keeps stdout clean for data).
 */
async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  })
  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y')
    })
  })
}

export function registerDraftCommands(program: Command) {
  const draft = program.command('draft').description('Manage local document drafts (create, get, list, rm)')

  // ── create ──────────────────────────────────────────────────────────────

  draft
    .command('create')
    .description('Parse, validate, and save a document draft to a local file')
    .option('-f, --file <path>', 'Input file (format detected by extension: .md, .json, .pdf)')
    .option('-o, --output <path>', 'Output path (default: <drafts-dir>/<slug>.md)')
    .option('--name <value>', 'Document title')
    .option('--summary <value>', 'Document summary')
    .option('--display-author <value>', 'Display author name (e.g. "Jane Doe")')
    .option('--display-publish-time <value>', 'Display publish time (YYYY-MM-DD)')
    .option('--icon <value>', 'Document icon (ipfs:// or file:// URL)')
    .option('--cover <value>', 'Cover image (ipfs:// or file:// URL)')
    .option('--site-url <value>', 'Site URL')
    .option('--layout <value>', 'Document layout (e.g. "Seed/Experimental/Newspaper")')
    .option('--show-outline', 'Show document outline')
    .option('--no-show-outline', 'Hide document outline')
    .option('--show-activity', 'Show document activity')
    .option('--no-show-activity', 'Hide document activity')
    .option('--content-width <value>', 'Content width (S, M, L)')
    .option('--seed-experimental-logo <value>', 'Experimental logo (ipfs:// or file:// URL)')
    .option('--seed-experimental-home-order <value>', 'Home ordering (UpdatedFirst, CreatedFirst)')
    .option('--import-categories <value>', 'Import categories (comma-separated)')
    .option('--import-tags <value>', 'Import tags (comma-separated)')
    .option('--grobid-url <url>', 'GROBID server URL for PDF extraction')
    .option('--edit <hm-url>', 'HM URL of the document to edit (e.g. hm://z6Mk.../docs/intro)')
    .option('--location <hm-url>', 'HM URL of the parent to create a child under (e.g. hm://z6Mk.../docs)')
    .option('--visibility <value>', 'Document visibility: PUBLIC or PRIVATE (default: PUBLIC)')
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()

      try {
        if (!options.file) {
          throw new Error('draft create requires -f <file>. Stdin input is not supported for drafts.')
        }

        // Read raw content before parsing (for markdown preservation).
        // PDF files are binary so we only read text for non-PDF inputs.
        const ext = extname(options.file).toLowerCase()
        const rawContent = ext !== '.pdf' ? readFileSync(options.file, 'utf-8') : undefined

        // Parse and validate the input
        const input = await readInput({
          file: options.file,
          grobidUrl: options.grobidUrl,
          quiet: globalOpts.quiet,
        })

        // Merge metadata: defaults < frontmatter/PDF < CLI flags
        const metadata = mergeMetadata(input.metadata, options, {name: 'Untitled'})

        // Generate the draft content
        let draftContent: string
        if (input.blocks) {
          // Non-markdown input (JSON or PDF) — render to markdown
          const doc = {
            content: input.blocks,
            metadata,
            version: '',
            authors: [],
          } as unknown as HMDocument
          draftContent = await documentToMarkdown(doc)
        } else if (rawContent) {
          // Markdown input — preserve the raw content as-is
          draftContent = rawContent
        } else {
          throw new Error('Unexpected state: no parsed blocks and no raw content.')
        }

        // Generate draft ID and filename: <slug>_<nanoid>.md
        const {nanoid} = await import('nanoid')
        const draftId = nanoid(10)
        const slug = slugify(metadata.name || 'untitled')
        const filename = draftFilename(slug, draftId)
        const draftsDir = getDraftsDir(globalOpts)

        // Determine output path
        const defaultPath = join(draftsDir, filename)
        const outputPath = options.output || defaultPath

        // Ensure directory exists and save
        mkdirSync(dirname(outputPath), {recursive: true})
        writeFileSync(outputPath, draftContent, 'utf-8')

        // Write entry to index.json so the desktop app can discover it immediately
        if (!options.output) {
          // Parse --edit or --location HM URLs into uid + path
          let editUid: string | undefined
          let editPath: string[] | undefined
          let locationUid: string | undefined
          let locationPath: string[] | undefined

          if (options.edit) {
            const {unpackHmId} = await import('@shm/shared/utils/entity-id-url')
            const parsed = unpackHmId(options.edit)
            if (parsed) {
              editUid = parsed.uid
              editPath = parsed.path || []
            }
          }

          if (options.location) {
            const {unpackHmId} = await import('@shm/shared/utils/entity-id-url')
            const parsed = unpackHmId(options.location)
            if (parsed) {
              locationUid = parsed.uid
              locationPath = parsed.path || []
            }
          }

          const visibility = options.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC'

          upsertDraftIndex(draftsDir, {
            id: draftId,
            metadata,
            lastUpdateTime: Date.now(),
            visibility,
            deps: [],
            ...(editUid ? {editUid, editPath} : {}),
            ...(locationUid ? {locationUid, locationPath} : {}),
          })
        }

        if (!globalOpts.quiet) printSuccess(`Draft saved to ${outputPath}`)
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── get ────────────────────────────────────────────────────────────────

  draft
    .command('get <slug-or-path>')
    .description('Display a saved draft (use --pretty for terminal-rendered markdown)')
    .option('-o, --output <file>', 'Write output to file instead of stdout')
    .action(async (slugOrPath: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const pretty = isPretty(globalOpts)

      try {
        const filePath = resolveDraftPath(slugOrPath, globalOpts)
        if (!existsSync(filePath)) {
          throw new Error(`Draft not found: ${filePath}`)
        }

        const isJson = filePath.endsWith('.json')
        const useStructuredOutput = !!(globalOpts.json || globalOpts.yaml)
        let output: string

        if (isJson) {
          // Desktop JSON draft — convert BlockNote blocks to markdown
          const markdown = readJsonDraftAsMarkdown(filePath)
          if (useStructuredOutput) {
            const {metadata} = parseMarkdown(markdown)
            const format = getOutputFormat(globalOpts)
            output = formatOutput({metadata, body: markdown}, format, pretty)
          } else {
            output = pretty ? renderMarkdown(markdown) : markdown
          }
        } else {
          // Markdown draft
          const content = readFileSync(filePath, 'utf-8')
          if (useStructuredOutput) {
            const {metadata} = parseMarkdown(content)
            const format = getOutputFormat(globalOpts)
            output = formatOutput({metadata, body: content}, format, pretty)
          } else {
            output = pretty ? renderMarkdown(content) : content
          }
        }

        if (options.output) {
          writeFileSync(options.output, output + '\n', 'utf-8')
          if (!globalOpts.quiet) printInfo(`Written to ${options.output}`)
        } else {
          console.log(output)
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── list ───────────────────────────────────────────────────────────────

  draft
    .command('list')
    .description('List all saved drafts (both .md and .json)')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()

      try {
        const draftsDir = getDraftsDir(globalOpts)
        if (!existsSync(draftsDir)) {
          if (!globalOpts.quiet) printInfo('No drafts found.')
          return
        }

        const allFiles = readdirSync(draftsDir)

        // Collect .md drafts
        const mdFiles = allFiles.filter((f) => f.endsWith('.md')).sort()

        // Collect .json drafts (exclude index.json)
        const jsonFiles = allFiles.filter((f) => f.endsWith('.json') && f !== 'index.json').sort()

        if (mdFiles.length === 0 && jsonFiles.length === 0) {
          if (!globalOpts.quiet) printInfo('No drafts found.')
          return
        }

        // Read the desktop index for JSON draft metadata
        const draftIndex = readDraftIndex(draftsDir)

        type DraftEntry = {slug: string; title: string; format: string; size: number; modified: string}
        const drafts: DraftEntry[] = []

        if (globalOpts.quiet) {
          for (const file of mdFiles) {
            console.log(file.replace(/\.md$/, ''))
          }
          for (const file of jsonFiles) {
            console.log(file.replace(/\.json$/, ''))
          }
          return
        }

        // Process .md drafts
        for (const file of mdFiles) {
          const filePath = join(draftsDir, file)
          const stat = statSync(filePath)
          const slug = file.replace(/\.md$/, '')
          let title = slug
          try {
            const content = readFileSync(filePath, 'utf-8')
            const {metadata} = parseMarkdown(content)
            if (metadata.name) title = metadata.name
          } catch {
            // Ignore parse errors — fall back to slug as title
          }
          drafts.push({slug, title, format: 'md', size: stat.size, modified: stat.mtime.toISOString()})
        }

        // Process .json drafts
        for (const file of jsonFiles) {
          const filePath = join(draftsDir, file)
          const stat = statSync(filePath)
          const id = file.replace(/\.json$/, '')
          const indexEntry = draftIndex.find((d) => d.id === id)
          const title = (indexEntry?.metadata as HMMetadata | undefined)?.name || id
          drafts.push({slug: id, title, format: 'json', size: stat.size, modified: stat.mtime.toISOString()})
        }

        const useStructuredOutput = !!(globalOpts.json || globalOpts.yaml)
        if (useStructuredOutput) {
          const format = getOutputFormat(globalOpts)
          const pretty = isPretty(globalOpts)
          console.log(formatOutput(drafts, format, pretty))
        } else {
          console.log('SLUG\tTITLE\tFORMAT\tSIZE\tMODIFIED')
          for (const d of drafts) {
            const sizeKb = (d.size / 1024).toFixed(1) + 'KB'
            const modified = new Date(d.modified).toLocaleDateString()
            console.log(`${d.slug}\t${d.title}\t${d.format}\t${sizeKb}\t${modified}`)
          }
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── rm ─────────────────────────────────────────────────────────────────

  draft
    .command('rm [slug-or-path]')
    .description('Remove a saved draft (or all drafts with --all)')
    .option('--all', 'Remove all drafts')
    .option('--force', 'Skip confirmation prompt')
    .action(async (slugOrPath: string | undefined, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()

      try {
        const draftsDir = getDraftsDir(globalOpts)

        if (options.all) {
          if (!existsSync(draftsDir)) {
            printInfo('No drafts to remove.')
            return
          }

          const files = readdirSync(draftsDir).filter((f) => f.endsWith('.md'))
          if (files.length === 0) {
            printInfo('No drafts to remove.')
            return
          }

          if (!options.force) {
            const confirmed = await confirm(`Remove all ${files.length} draft(s)?`)
            if (!confirmed) {
              printInfo('Cancelled.')
              return
            }
          }

          // Collect IDs of files being removed
          const removedIds = new Set(files.map((f) => parseDraftFilename(f).id))

          for (const file of files) {
            unlinkSync(join(draftsDir, file))
            if (!globalOpts.quiet) printSuccess(`Removed ${file}`)
          }

          // Clean up index.json entries for removed drafts
          const index = readDraftIndex(draftsDir)
          const filtered = index.filter((d) => !removedIds.has(d.id))
          if (filtered.length !== index.length) {
            const indexPath = join(draftsDir, 'index.json')
            writeFileSync(indexPath, JSON.stringify(filtered, null, 2))
          }
          return
        }

        if (!slugOrPath) {
          throw new Error('Specify a draft to remove, or use --all to remove all drafts.')
        }

        const filePath = resolveDraftPath(slugOrPath, globalOpts)
        if (!existsSync(filePath)) {
          throw new Error(`Draft not found: ${filePath}`)
        }

        if (!options.force) {
          const confirmed = await confirm(`Remove draft "${slugOrPath}"?`)
          if (!confirmed) {
            printInfo('Cancelled.')
            return
          }
        }

        // Extract draft ID and remove from index.json
        const filename = filePath.split('/').pop() || ''
        const {id} = parseDraftFilename(filename)
        const index = readDraftIndex(draftsDir)
        const filtered = index.filter((d) => d.id !== id)
        if (filtered.length !== index.length) {
          const indexPath = join(draftsDir, 'index.json')
          writeFileSync(indexPath, JSON.stringify(filtered, null, 2))
        }

        unlinkSync(filePath)
        if (!globalOpts.quiet) printSuccess(`Removed ${filePath}`)
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
