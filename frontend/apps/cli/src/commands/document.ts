/**
 * Document commands — get, create, update, delete, fork, move, redirect, changes, stats, cid.
 */

import type {Command} from 'commander'
import {existsSync, readFileSync, writeFileSync} from 'fs'
import {extname} from 'path'
import {CID} from 'multiformats/cid'
import {
  createVersionRef,
  createTombstoneRef,
  createRedirectRef,
  createGenesisChange,
  autoLinkChildToParent,
  createChangeOps,
  createChange,
  pdfToBlocks,
  fileToIpfsBlobs,
  slugify,
  resolveCapability,
  type DocumentOperation,
  type CollectedBlob,
} from '@seed-hypermedia/client'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {getClient, getServerUrl, getOutputFormat, isPretty} from '../index'
import {formatOutput, renderMarkdown, printError, printSuccess, printInfo, printWarning} from '../output'
import {documentToMarkdown} from '../markdown'
import {resolveKey} from '../utils/keyring'
import {resolveIdWithClient} from '../utils/resolve-id'
import {createSignerFromKey} from '../utils/signer'
import {resolveDocumentState} from '../utils/depth'
import {parseMarkdown, flattenToOperations, type BlockNode} from '../utils/markdown'
import {parseBlocksJson, hmBlockNodesToOperations} from '../utils/blocks-json'
import {createBlocksMap, computeReplaceOps, hmBlockNodeToBlockNode, type APIBlockNode} from '../utils/block-diff'
import {resolveFileLinks} from '../utils/file-links'
import type {HMBlockNode, HMDocument, HMMetadata} from '@seed-hypermedia/client/hm-types'

// ── Input helpers ────────────────────────────────────────────────────────────

/**
 * Read all of stdin as a UTF-8 string.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf-8')
}

/**
 * Read stdin as raw binary (for PDF piping).
 */
async function readStdinBinary(): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

type InputFormat = 'markdown' | 'json' | 'pdf'

/**
 * Detect input format from file extension.
 */
function detectFormatFromExtension(filePath: string): InputFormat {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.json':
      return 'json'
    case '.pdf':
      return 'pdf'
    case '.md':
    case '.txt':
    case '':
      return 'markdown'
    default:
      return 'markdown'
  }
}

/**
 * Auto-detect format from content (for stdin).
 * If the first non-whitespace character is [ or {, treat as JSON blocks.
 * Otherwise treat as markdown.
 */
function detectFormatFromContent(content: string): 'markdown' | 'json' {
  const firstChar = content.trimStart()[0]
  if (firstChar === '[' || firstChar === '{') return 'json'
  return 'markdown'
}

export type ParsedInput = {
  ops: DocumentOperation[]
  metadata: HMMetadata
  fileBlobs: CollectedBlob[]
  tree?: BlockNode[] // parsed block tree for smart diffing in update
  blocks?: HMBlockNode[] // for dry-run rendering
  source?: string // extraction method label
}

/**
 * Read and parse input from -f file, stdin, or error.
 *
 * Format is auto-detected from file extension (for -f) or content
 * inspection (for stdin). Returns document operations, metadata from
 * frontmatter, and any IPFS blobs from file:// link resolution.
 */
export async function readInput(options: {file?: string; grobidUrl?: string; quiet?: boolean}): Promise<ParsedInput> {
  const {file} = options
  let format: InputFormat
  let content: string
  let pdfBuffer: Buffer | undefined

  if (file) {
    // -f <path>: read from file, detect format by extension
    if (!existsSync(file)) {
      throw new Error(`File not found: ${file}`)
    }
    format = detectFormatFromExtension(file)
    if (format === 'pdf') {
      pdfBuffer = readFileSync(file) as Buffer
    } else {
      content = readFileSync(file, 'utf-8')
    }
  } else if (!process.stdin.isTTY) {
    // Piped stdin: read content and auto-detect format
    // Try to detect PDF by magic bytes first
    const raw = await readStdinBinary()
    if (raw.length === 0) {
      throw new Error('No input provided. Use -f <file> or pipe content via stdin.')
    }
    if (raw.length >= 4 && raw[0] === 0x25 && raw[1] === 0x50 && raw[2] === 0x44 && raw[3] === 0x46) {
      // %PDF magic bytes
      format = 'pdf'
      pdfBuffer = raw
    } else {
      content = raw.toString('utf-8')
      format = detectFormatFromContent(content)
    }
  } else {
    throw new Error('No input provided. Use -f <file> or pipe content via stdin.')
  }

  // ── PDF path ──
  if (format === 'pdf') {
    if (!pdfBuffer) throw new Error('PDF buffer is empty')
    if (!options.quiet) printInfo('Extracting PDF content...')
    const result = await pdfToBlocks(pdfBuffer.buffer as ArrayBuffer, {
      grobidUrl: options.grobidUrl,
    })
    if (!options.quiet) printInfo(`Extraction method: ${result.source}`)

    const metadata: HMMetadata = {}
    if (result.metadata.name) metadata.name = result.metadata.name
    if (result.metadata.summary) metadata.summary = result.metadata.summary
    if (result.metadata.displayAuthor) metadata.displayAuthor = result.metadata.displayAuthor
    if (result.metadata.displayPublishTime) metadata.displayPublishTime = result.metadata.displayPublishTime

    const ops: DocumentOperation[] = []
    ops.push(...hmBlockNodesToOperations(result.blocks))

    return {
      ops,
      metadata,
      fileBlobs: [],
      blocks: result.blocks,
      source: result.source,
    }
  }

  // ── JSON blocks path ──
  if (format === 'json') {
    let nodes = parseBlocksJson(content!)
    const resolved = await resolveFileLinks(nodes)
    nodes = resolved.nodes
    return {
      ops: hmBlockNodesToOperations(nodes),
      metadata: {},
      fileBlobs: resolved.blobs,
      tree: nodes.map(hmBlockNodeToBlockNode),
    }
  }

  // ── Markdown path ──
  const {tree, metadata} = parseMarkdown(content!)
  const ops = flattenToOperations(tree)

  // Resolve file:// links in the tree (images with local paths)
  // We need to convert BlockNode tree back through operations,
  // but file:// links are in the operations already via the link field.
  // For now, file:// resolution only applies to JSON blocks input.
  // Markdown images get file:// prepended at tokenizer level and will
  // be resolved when we add block-level file link resolution.

  return {ops, metadata, fileBlobs: [], tree}
}

export function registerDocumentCommands(program: Command) {
  const doc = program
    .command('document')
    .description('Manage documents (get, create, update, delete, fork, move, redirect, changes, stats, cid)')

  // ── get ──────────────────────────────────────────────────────────────────

  doc
    .command('get <id>')
    .description('Fetch a document, comment, or entity by Hypermedia ID or URL')
    .option('-m, --metadata', 'Fetch metadata only')
    .option('-r, --resolve', 'Resolve embeds, mentions, and queries in markdown output')
    .option('-o, --output <file>', 'Write output to file instead of stdout')
    .option('-q, --quiet', 'Output minimal info')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)
      // --json or --yaml explicitly requested → structured output.
      // --pretty alone stays on the markdown path (beautified).
      const useStructuredOutput = !!(globalOpts.json || globalOpts.yaml)

      /** Write output string to file or stdout. */
      function emit(text: string) {
        if (options.output) {
          writeFileSync(options.output, text + '\n', 'utf-8')
          if (!globalOpts.quiet) printInfo(`Written to ${options.output}`)
        } else {
          console.log(text)
        }
      }

      try {
        const {id: resolvedId, client} = await resolveIdWithClient(id, globalOpts)

        if (options.metadata) {
          const result = await client.request('ResourceMetadata', resolvedId)
          if (globalOpts.quiet || options.quiet) {
            emit(result.metadata?.name || result.id.id)
          } else {
            emit(formatOutput(result, format, pretty))
          }
          return
        }

        const result = await client.request('Resource', resolvedId)

        if (globalOpts.quiet || options.quiet) {
          if (result.type === 'document') {
            emit(result.document.metadata?.name || result.id.id)
          } else if (result.type === 'comment') {
            emit(result.id.id)
          } else {
            emit(result.type)
          }
        } else if (useStructuredOutput) {
          // --json or --yaml → structured output (optionally colorized with --pretty)
          emit(formatOutput(result, format, pretty))
        } else {
          // Default: markdown output (with frontmatter and block IDs)
          // When --pretty: render markdown with ANSI terminal styling
          if (result.type === 'document') {
            let md = await documentToMarkdown(result.document, {
              resolve: options.resolve,
              client: options.resolve ? client : undefined,
            })
            if (pretty) md = renderMarkdown(md)
            emit(md)
          } else if (result.type === 'comment') {
            const fakeDoc = {
              content: result.comment.content,
              metadata: {},
              version: result.comment.version,
              authors: [result.comment.author],
            }
            let md = await documentToMarkdown(fakeDoc as any, {
              resolve: options.resolve,
              client: options.resolve ? client : undefined,
            })
            if (pretty) md = renderMarkdown(md)
            emit(md)
          } else {
            printError(`Cannot render ${result.type} as markdown`)
            process.exit(1)
          }
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── create ───────────────────────────────────────────────────────────────

  doc
    .command('create')
    .description('Create a new document from markdown, JSON blocks, or PDF')
    .option('-f, --file <path>', 'Input file (format detected by extension: .md, .json, .pdf)')
    .option('-p, --path <path>', 'Document path (e.g. "my-document")')
    .option('--name <value>', 'Document title (overrides frontmatter)')
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
    .option('--dry-run', 'Preview extracted content without publishing')
    .option('--force', 'Overwrite existing document at the same path (creates new lineage)')
    .option('-m, --message <text>', 'Publish message (like a git commit message)')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .option('-a, --account <uid>', 'Target space/account UID (publish under a different account using a capability)')
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev

      try {
        // Parse input from file or stdin
        const input = await readInput({
          file: options.file,
          grobidUrl: options.grobidUrl,
          quiet: globalOpts.quiet,
        })

        // Merge metadata: defaults < input (frontmatter/PDF) < CLI flags
        const metadata = mergeMetadata(input.metadata, options, {name: 'Untitled'})

        // ── Dry-run: preview and exit ──
        if (options.dryRun) {
          const dryRunStructured = !!(globalOpts.json || globalOpts.yaml)
          const dryRunPretty = isPretty(globalOpts)
          if (!dryRunStructured) {
            const dryRunDoc = {
              content: input.blocks || [],
              metadata,
              version: '',
              authors: [],
            } as unknown as HMDocument
            let md = await documentToMarkdown(dryRunDoc)
            if (dryRunPretty) md = renderMarkdown(md)
            console.log(md)
          } else {
            const outputFormat = getOutputFormat(globalOpts)
            console.log(formatOutput({metadata, blocks: input.blocks || []}, outputFormat, dryRunPretty))
          }
          return
        }

        const client = getClient(globalOpts)
        const key = resolveKey(options.key, dev)
        const account = options.account || key.accountId

        // When publishing under a different account, resolve the capability
        let capability: string | undefined
        if (options.account && options.account !== key.accountId) {
          capability = await resolveCapability(client, options.account, key.accountId)
          if (!capability) {
            throw new Error(
              `No WRITER or AGENT capability found for key ${key.accountId} on account ${options.account}. ` +
                `Use "account capabilities hm://${options.account}" to check available capabilities.`,
            )
          }
        }

        // Resolve file:// links in metadata (cover, icon, logo)
        const {metadata: resolvedMeta, blobs: metaBlobs} = await resolveMetadataFileLinks(metadata)

        const rawPath = options.path || slugify(resolvedMeta.name || 'Untitled')
        const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`

        // Check if a document already exists at this path. Publishing twice to the same path
        // creates a new genesis, silently orphaning the old document's history, comments, and
        // citations. Require --force to proceed in that case.
        if (!options.force) {
          const existingId = unpackHmId(`hm://${account}${path}`)
          if (existingId) {
            try {
              const existing = await client.request('Resource', existingId)
              if (existing.type === 'document') {
                throw new Error(
                  `Document already exists at ${path}. Use "document update hm://${account}${path}" to modify it, or --force to overwrite with a new lineage.`,
                )
              }
            } catch (e) {
              // Re-throw our own "already exists" error; swallow network/not-found errors
              if ((e as Error).message.includes('already exists')) throw e
            }
          }
        }

        const ops: DocumentOperation[] = []

        // Metadata attributes
        const metaOp = metadataToSetAttributes(resolvedMeta)
        if (metaOp) ops.push(metaOp)

        // Content operations
        ops.push(...input.ops)

        const signer = createSignerFromKey(key)
        const genesisBlock = await createGenesisChange(signer)

        const {unsignedBytes, ts} = createChangeOps({
          ops,
          genesisCid: genesisBlock.cid,
          deps: [genesisBlock.cid],
          depth: 1,
        })
        const changeBlock = await createChange(unsignedBytes, signer)
        const generation = Number(ts)
        const refInput = await createVersionRef(
          {
            space: account,
            path,
            genesis: genesisBlock.cid.toString(),
            version: changeBlock.cid.toString(),
            generation,
            capability,
            message: options.message,
          },
          signer,
        )

        await client.publish({
          blobs: [
            {data: new Uint8Array(genesisBlock.bytes), cid: genesisBlock.cid.toString()},
            {data: new Uint8Array(changeBlock.bytes), cid: changeBlock.cid.toString()},
            ...refInput.blobs,
            ...input.fileBlobs.map((b) => ({data: b.data, cid: b.cid})),
            ...metaBlobs.map((b) => ({data: b.data, cid: b.cid})),
          ],
        })

        if (!globalOpts.quiet) {
          const webUrl = `${getServerUrl(globalOpts)}/hm/${account}${path}`
          printSuccess(`Document published: ${webUrl}`)
        }

        // Auto-link: add embed card in parent document if it exists (same as desktop app)
        try {
          const childHmUrl = `hm://${account}${path}`
          const linked = await autoLinkChildToParent({client, account, path, childHmUrl, signer})
          if (linked && !globalOpts.quiet) {
            printInfo('Parent document updated with link')
          }
        } catch (e) {
          // Failure to auto-link should not fail the child publish
          if (!globalOpts.quiet) printWarning(`Failed to update parent document: ${(e as Error).message}`)
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── update ───────────────────────────────────────────────────────────────

  doc
    .command('update <id>')
    .description('Update document content and metadata (smart diff — only changed blocks are submitted)')
    .option(
      '-f, --file <path>',
      'Input file (format detected by extension: .md, .json). Diffs against existing content.',
    )
    .option('--name <value>', 'Set document title')
    .option('--summary <value>', 'Set document summary')
    .option('--display-author <value>', 'Display author name')
    .option('--display-publish-time <value>', 'Display publish time (YYYY-MM-DD)')
    .option('--icon <value>', 'Document icon (ipfs:// or file:// URL)')
    .option('--cover <value>', 'Cover image (ipfs:// or file:// URL)')
    .option('--site-url <value>', 'Site URL')
    .option('--layout <value>', 'Document layout')
    .option('--show-outline', 'Show document outline')
    .option('--no-show-outline', 'Hide document outline')
    .option('--show-activity', 'Show document activity')
    .option('--no-show-activity', 'Hide document activity')
    .option('--content-width <value>', 'Content width (S, M, L)')
    .option('--seed-experimental-logo <value>', 'Experimental logo (ipfs:// or file:// URL)')
    .option('--seed-experimental-home-order <value>', 'Home ordering (UpdatedFirst, CreatedFirst)')
    .option('--import-categories <value>', 'Import categories (comma-separated)')
    .option('--import-tags <value>', 'Import tags (comma-separated)')
    .option('--parent <blockId>', 'Parent block ID for new content (default: root)')
    .option('--delete-blocks <ids>', 'Comma-separated block IDs to delete')
    .option('-m, --message <text>', 'Publish message (like a git commit message)')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev

      try {
        const {id: resourceId, client} = await resolveIdWithClient(id, globalOpts)
        const key = resolveKey(options.key, dev)

        // For update, only use stdin if -f is explicitly given.
        // Unlike create, update supports metadata-only changes (--name, --summary),
        // so auto-detecting stdin would break those cases.
        const hasFileInput = !!options.file

        const ops: DocumentOperation[] = []
        let fileBlobs: CollectedBlob[] = []
        let metaBlobs: CollectedBlob[] = []

        // Fetch the document — needed for diffing and state resolution
        const resource = await client.request('Resource', resourceId)
        if (resource.type !== 'document') {
          printError(`Resource is ${resource.type}, not a document.`)
          process.exit(1)
        }
        const existingDoc = resource.document

        // Collect content and metadata from file input
        let inputMeta: HMMetadata = {}
        if (hasFileInput) {
          const input = await readInput({
            file: options.file,
            quiet: globalOpts.quiet,
          })
          fileBlobs = input.fileBlobs
          inputMeta = input.metadata

          if (input.tree) {
            // Smart diff: compare input blocks against existing document.
            // Each block is matched by its ID — if the ID exists in the
            // old document, only content changes are emitted. If the ID
            // doesn't exist, the block is treated as new. Old blocks
            // whose IDs are absent from the new tree are deleted.
            const oldNodes = (existingDoc.content || []).map(toAPIBlockNode)
            const oldMap = createBlocksMap(oldNodes)
            const diffOps = computeReplaceOps(oldMap, input.tree)
            ops.push(...diffOps)
          } else {
            // No tree available (e.g. PDF input) — use flat ops as-is
            ops.push(...input.ops)
          }
        }

        // Merge metadata: input (frontmatter) < CLI flags
        const merged = mergeMetadata(inputMeta, options)

        // Resolve file:// links in metadata
        if (Object.keys(merged).length > 0) {
          const resolved = await resolveMetadataFileLinks(merged)
          metaBlobs = resolved.blobs
          const metaOp = metadataToSetAttributes(resolved.metadata)
          if (metaOp) ops.push(metaOp)
        }

        if (options.deleteBlocks) {
          const blockIds = options.deleteBlocks
            .split(',')
            .map((blockId: string) => blockId.trim())
            .filter(Boolean)
          if (blockIds.length > 0) {
            ops.push({type: 'DeleteBlocks', blocks: blockIds})
          }
        }

        if (ops.length === 0) {
          printError('No updates specified. Use --name, --summary, -f <file>, or --delete-blocks.')
          process.exit(1)
        }

        const docAccount = existingDoc.account
        const docPath = existingDoc.path || ''

        const state = await resolveDocumentState(client, id)
        const genesisCid = CID.parse(state.genesis)
        const depCids = state.heads.map((h) => CID.parse(h))
        const newDepth = state.headDepth + 1

        const signer = createSignerFromKey(key)
        const capability = await resolveCapability(client, docAccount, key.accountId)
        const {unsignedBytes, ts} = createChangeOps({ops, genesisCid, deps: depCids, depth: newDepth})
        const changeBlock = await createChange(unsignedBytes, signer)
        const generation = Number(ts)
        const refInput = await createVersionRef(
          {
            space: docAccount,
            path: docPath,
            genesis: state.genesis,
            version: changeBlock.cid.toString(),
            generation,
            capability,
            message: options.message,
          },
          signer,
        )

        await client.publish({
          blobs: [
            {data: new Uint8Array(changeBlock.bytes), cid: changeBlock.cid.toString()},
            ...refInput.blobs,
            ...fileBlobs.map((b) => ({data: b.data, cid: b.cid})),
            ...metaBlobs.map((b) => ({data: b.data, cid: b.cid})),
          ],
        })

        if (!globalOpts.quiet) {
          const serverUrl = getServerUrl(globalOpts)
          const webUrl = `${serverUrl}/hm/${id.replace(/^hm:\/\//, '')}`
          printSuccess(`Document updated: ${webUrl}`)
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── delete ─────────────────────────────────────────────────────────────

  doc
    .command('delete <id>')
    .description('Delete a document by publishing a tombstone ref')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (id: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev

      try {
        const {id: unpacked, client} = await resolveIdWithClient(id, globalOpts)
        const key = resolveKey(_options.key, dev)
        const signer = createSignerFromKey(key)

        const resource = await client.request('Resource', unpacked)
        if (resource.type !== 'document') {
          printError(`Cannot delete: resource is ${resource.type}, not a document.`)
          process.exit(1)
        }
        const doc = resource.document
        const generation = doc.generationInfo ? Number(doc.generationInfo.generation) : 0
        const capability = await resolveCapability(client, unpacked.uid, key.accountId)

        const refInput = await createTombstoneRef(
          {
            space: unpacked.uid,
            path: hmIdPathToEntityQueryPath(unpacked.path),
            genesis: doc.genesis,
            generation,
            capability,
          },
          signer,
        )
        await client.publish(refInput)

        if (!globalOpts.quiet) printSuccess(`Document deleted: ${id}`)
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── fork ───────────────────────────────────────────────────────────────

  doc
    .command('fork <sourceId> <destinationId>')
    .description('Fork a document to a new location (creates a copy)')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (sourceId: string, destinationId: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev

      try {
        const {id: sourceUnpacked, client} = await resolveIdWithClient(sourceId, globalOpts)
        const {id: dest} = await resolveIdWithClient(destinationId, globalOpts)
        const key = resolveKey(_options.key, dev)
        const signer = createSignerFromKey(key)

        const resource = await client.request('Resource', sourceUnpacked)
        if (resource.type !== 'document') {
          printError(`Cannot fork: source is ${resource.type}, not a document.`)
          process.exit(1)
        }
        const doc = resource.document
        if (!doc.generationInfo) throw new Error('No generation info for source document')

        const refInput = await createVersionRef(
          {
            space: dest.uid,
            path: hmIdPathToEntityQueryPath(dest.path),
            genesis: doc.generationInfo.genesis,
            version: doc.version,
            generation: Number(doc.generationInfo.generation),
          },
          signer,
        )
        await client.publish(refInput)

        if (!globalOpts.quiet) {
          const webUrl = `${getServerUrl(globalOpts)}/hm/${destinationId.replace(/^hm:\/\//, '')}`
          printSuccess(`Document forked: ${webUrl}`)
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── move ───────────────────────────────────────────────────────────────

  doc
    .command('move <sourceId> <destinationId>')
    .description('Move a document to a new location (creates redirect at source)')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (sourceId: string, destinationId: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev

      try {
        const {id: source, client} = await resolveIdWithClient(sourceId, globalOpts)
        const {id: dest} = await resolveIdWithClient(destinationId, globalOpts)
        const key = resolveKey(_options.key, dev)
        const signer = createSignerFromKey(key)

        const resource = await client.request('Resource', source)
        if (resource.type !== 'document') {
          printError(`Cannot move: source is ${resource.type}, not a document.`)
          process.exit(1)
        }
        const doc = resource.document
        if (!doc.generationInfo) throw new Error('No generation info for source document')

        // Create version ref at destination
        const versionRefInput = await createVersionRef(
          {
            space: dest.uid,
            path: hmIdPathToEntityQueryPath(dest.path),
            genesis: doc.generationInfo.genesis,
            version: doc.version,
            generation: Number(doc.generationInfo.generation),
          },
          signer,
        )
        await client.publish(versionRefInput)

        // Create redirect ref at source
        const redirectRefInput = await createRedirectRef(
          {
            space: source.uid,
            path: hmIdPathToEntityQueryPath(source.path),
            genesis: doc.generationInfo.genesis,
            generation: Number(doc.generationInfo.generation),
            targetSpace: dest.uid,
            targetPath: hmIdPathToEntityQueryPath(dest.path),
          },
          signer,
        )
        await client.publish(redirectRefInput)

        if (!globalOpts.quiet) {
          const webUrl = `${getServerUrl(globalOpts)}/hm/${destinationId.replace(/^hm:\/\//, '')}`
          printSuccess(`Document moved: ${webUrl}`)
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── redirect ──────────────────────────────────────────────────────────

  doc
    .command('redirect <id>')
    .description('Create a redirect from one document to another')
    .requiredOption('--to <targetId>', 'Target Hypermedia ID to redirect to')
    .option('--republish', 'Republish target content at this location')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (id: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev

      try {
        const {id: source, client} = await resolveIdWithClient(id, globalOpts)
        const {id: target} = await resolveIdWithClient(_options.to, globalOpts)
        const key = resolveKey(_options.key, dev)
        const signer = createSignerFromKey(key)

        const resource = await client.request('Resource', source)
        if (resource.type !== 'document') {
          printError(`Cannot redirect: resource is ${resource.type}, not a document.`)
          process.exit(1)
        }
        const doc = resource.document
        const generation = doc.generationInfo ? Number(doc.generationInfo.generation) : 1

        const refInput = await createRedirectRef(
          {
            space: source.uid,
            path: hmIdPathToEntityQueryPath(source.path),
            genesis: doc.genesis,
            generation,
            targetSpace: target.uid,
            targetPath: hmIdPathToEntityQueryPath(target.path),
            republish: !!_options.republish,
          },
          signer,
        )
        await client.publish(refInput)

        if (!globalOpts.quiet) printSuccess(`Redirect created: ${id} -> ${_options.to}`)
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── changes ──────────────────────────────────────────────────────────────

  doc
    .command('changes <targetId>')
    .description('List document change history')
    .option('-q, --quiet', 'Output CIDs and authors only')
    .action(async (targetId: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const {id: unpacked, client} = await resolveIdWithClient(targetId, globalOpts)
        const result = await client.request('ListChanges', {targetId: unpacked})

        if (globalOpts.quiet) {
          result.changes.forEach((c) => {
            console.log(`${c.id || 'unknown'}\t${c.author || ''}`)
          })
          if (result.latestVersion) {
            console.log(`latest\t${result.latestVersion}`)
          }
        } else {
          console.log(formatOutput(result, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── stats ────────────────────────────────────────────────────────────────

  doc
    .command('stats <id>')
    .description('Get interaction statistics for a document')
    .action(async (id: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const {id: unpacked, client} = await resolveIdWithClient(id, globalOpts)
        const result = await client.request('InteractionSummary', {id: unpacked})
        console.log(formatOutput(result, format, pretty))
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── cid ──────────────────────────────────────────────────────────────────

  doc
    .command('cid <cid>')
    .description('Fetch raw IPFS block by CID')
    .action(async (cid: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const result = await client.request('GetCID', {cid})
        console.log(formatOutput(result, format, pretty))
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── import (deprecated) ──────────────────────────────────────────────────

  doc
    .command('import')
    .description('[deprecated] Use "document create -f <file.pdf>" instead')
    .allowUnknownOption()
    .action(() => {
      printError('The "document import" command has been removed.')
      printInfo('Use "document create -f <file.pdf>" instead.')
      printInfo('Example: seed-hypermedia document create -f paper.pdf --dry-run')
      process.exit(1)
    })
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** All HMMetadata keys that can be set via CLI flags or frontmatter. */
const METADATA_KEYS: (keyof HMMetadata)[] = [
  'name',
  'summary',
  'displayAuthor',
  'displayPublishTime',
  'icon',
  'cover',
  'siteUrl',
  'layout',
  'showOutline',
  'showActivity',
  'contentWidth',
  'seedExperimentalLogo',
  'seedExperimentalHomeOrder',
  'importCategories',
  'importTags',
]

/** Metadata fields that support file:// paths (resolved to ipfs://). */
const FILE_LINK_METADATA_KEYS = ['cover', 'icon', 'seedExperimentalLogo'] as const

/**
 * Extract metadata values from CLI options.
 * Commander.js converts kebab-case flags to camelCase (--display-author → displayAuthor).
 */
function extractCliMetadata(options: Record<string, unknown>): HMMetadata {
  const meta: HMMetadata = {}
  for (const key of METADATA_KEYS) {
    if (options[key] !== undefined) {
      ;(meta as any)[key] = options[key]
    }
  }
  return meta
}

/**
 * Merge metadata from multiple sources.
 * Priority: defaults < inputMeta (frontmatter/PDF) < CLI flags.
 */
export function mergeMetadata(
  inputMeta: HMMetadata,
  options: Record<string, unknown>,
  defaults?: Partial<HMMetadata>,
): HMMetadata {
  const cliMeta = extractCliMetadata(options)
  const result: HMMetadata = {}

  for (const key of METADATA_KEYS) {
    const cli = (cliMeta as any)[key]
    const input = (inputMeta as any)[key]
    const def = defaults ? (defaults as any)[key] : undefined

    const value = cli !== undefined ? cli : input !== undefined ? input : def
    if (value !== undefined) {
      ;(result as any)[key] = value
    }
  }

  // Handle theme (nested object, not a simple flag)
  if (inputMeta.theme) result.theme = inputMeta.theme

  return result
}

/**
 * Convert an HMMetadata object to a SetAttributes operation.
 * Only includes fields with defined values.
 */
function metadataToSetAttributes(metadata: HMMetadata): DocumentOperation | null {
  const attrs: Array<{key: string[]; value: unknown}> = []
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      attrs.push({key: [key], value})
    }
  }
  if (attrs.length === 0) return null
  return {type: 'SetAttributes', attrs}
}

/**
 * Resolve file:// links in metadata fields (cover, icon, seedExperimentalLogo).
 * Reads the local file, chunks it into UnixFS IPFS blocks, and replaces
 * the file:// URL with ipfs://CID.
 */
async function resolveMetadataFileLinks(metadata: HMMetadata): Promise<{metadata: HMMetadata; blobs: CollectedBlob[]}> {
  const allBlobs: CollectedBlob[] = []
  const resolved = {...metadata}

  for (const key of FILE_LINK_METADATA_KEYS) {
    const value = resolved[key]
    if (value && value.startsWith('file://')) {
      const filePath = value.slice(7) // strip file://
      if (!existsSync(filePath)) {
        throw new Error(`File not found for ${key}: ${filePath}`)
      }
      const data = readFileSync(filePath)
      const result = await fileToIpfsBlobs(new Uint8Array(data))
      resolved[key] = `ipfs://${result.cid}`
      allBlobs.push(...result.blobs)
    }
  }

  return {metadata: resolved, blobs: allBlobs}
}

// Re-export slugify from SDK client for backwards compatibility
export {slugify} from '@seed-hypermedia/client'

/**
 * Convert API BlockNode (with optional children) to the APIBlockNode shape
 * expected by block-diff utilities (with required children array).
 */
function toAPIBlockNode(node: HMBlockNode): APIBlockNode {
  const block = node.block as {
    id: string
    type: string
    text?: string
    link?: string
    annotations?: unknown[]
    attributes?: Record<string, unknown>
  }
  return {
    block: {
      id: block.id,
      type: block.type,
      text: block.text || '',
      link: block.link || '',
      annotations: block.annotations || [],
      attributes: block.attributes || {},
    },
    children: (node.children || []).map(toAPIBlockNode),
  }
}
