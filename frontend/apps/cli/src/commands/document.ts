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
  describeRedirect,
  followRedirects,
  followToDocument,
  packHmId,
  resolveCapability,
  resolveEditableDocument,
  type DocumentOperation,
  type CollectedBlob,
} from '@seed-hypermedia/client'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {getClient, getServerUrl, getOutputFormat, isPretty} from '../index'
import {formatOutput, renderMarkdown, printError, printSuccess, printInfo, printWarning} from '../output'
import {documentToMarkdown} from '../markdown'
import {keyOptions, resolveSigningKey} from '../utils/keys'
import {resolveIdWithClient} from '../utils/resolve-id'
import {createSignerFromKey} from '../utils/signer'
import {resolveDocumentState} from '../utils/depth'
import {parseMarkdown, flattenToOperations, type BlockNode} from '../utils/markdown'
import {parseBlocksJson, hmBlockNodesToOperations} from '../utils/blocks-json'
import {
  createBlocksMap,
  computeReplaceOps,
  hmBlockNodeToBlockNode,
  rebindTableIdentities,
  type APIBlockNode,
} from '../utils/block-diff'
import {resolveFileLinks} from '../utils/file-links'
import {markdownBlockNodesToHMBlockNodes} from '@seed-hypermedia/client'
import type {HMBlockNode, HMDocument, HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'

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

  // Resolve file:// links on image blocks: read the local file, chunk it
  // with UnixFS, and rewrite link to ipfs://CID. The roundtrip through
  // HMBlockNode reuses the shared resolver used by the JSON path.
  const hmNodes = markdownBlockNodesToHMBlockNodes(tree)
  const resolved = await resolveFileLinks(hmNodes)
  const resolvedTree = resolved.nodes.map(hmBlockNodeToBlockNode)

  const ops = flattenToOperations(resolvedTree)

  return {ops, metadata, fileBlobs: resolved.blobs, tree: resolvedTree}
}

/**
 * Records a followed redirect in the markdown frontmatter so the fact survives piping to a file:
 * `republishOf` (the address whose latest content this is) or `movedTo`. Both keys are ignored by
 * the frontmatter parser on the way back in, so `get > file; update -f file` still round-trips.
 */
function withRedirectFrontmatter(md: string, republish: boolean, target: UnpackedHypermediaId): string {
  const line = `${republish ? 'republishOf' : 'movedTo'}: ${JSON.stringify(packHmId(target))}`
  if (md.startsWith('---\n')) return `---\n${line}\n${md.slice(4)}`
  return `---\n${line}\n---\n${md}`
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

        // `:directory` is a view term, not a path segment: list the child documents the way the
        // desktop's directory tab does, instead of asking the server for a document at that path.
        if (resolvedId.path?.[resolvedId.path.length - 1] === ':directory') {
          const parent = {...resolvedId, path: resolvedId.path.slice(0, -1)}
          // No sort: the daemon's `Path` sort term currently returns an empty result set, so the
          // listing relies on the server's default ordering.
          const result = await client.request('Query', {
            includes: [{space: parent.uid, path: hmIdPathToEntityQueryPath(parent.path), mode: 'Children'}],
          })
          const results = result?.results ?? []
          if (globalOpts.quiet || options.quiet) {
            emit(results.map((r) => `${r.id.id}\t${r.metadata?.name || ''}`).join('\n'))
          } else if (useStructuredOutput) {
            emit(formatOutput(result, format, pretty))
          } else {
            let md = results.length
              ? results
                  .map((r) => {
                    const label = r.metadata?.name || hmIdPathToEntityQueryPath(r.path) || r.id.id
                    const summary = r.metadata?.summary ? ` — ${r.metadata.summary}` : ''
                    return `- [${label}](${r.id.id})${summary}`
                  })
                  .join('\n')
              : '(no child documents)'
            if (pretty) md = renderMarkdown(md)
            emit(md)
          }
          return
        }

        if (options.metadata) {
          const result = await client.request('ResourceMetadata', resolvedId)
          if (globalOpts.quiet || options.quiet) {
            emit(result.metadata?.name || result.id.id)
          } else {
            emit(formatOutput(result, format, pretty))
          }
          return
        }

        // A redirected address (a moved path, or a "republished" path that re-publishes another
        // document as its own) is followed so the reader gets content — but never silently: the
        // output names the address the content really lives at, because a write to the requested
        // address does something different (it replaces the redirect) from a write to the target.
        const followed = await followRedirects(client, resolvedId)
        const result = followed.resource
        const redirectNotice = describeRedirect(followed)
        if (redirectNotice && !globalOpts.quiet && !options.quiet) printInfo(redirectNotice)

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
          const structured = redirectNotice
            ? {
                ...result,
                redirect: {
                  from: packHmId(followed.id),
                  to: packHmId(followed.targetId),
                  republish: followed.redirects[0]!.republish,
                  notice: redirectNotice,
                },
              }
            : result
          emit(formatOutput(structured, format, pretty))
        } else {
          // Default: markdown output (with frontmatter and block IDs)
          // When --pretty: render markdown with ANSI terminal styling
          if (result.type === 'document') {
            let md = await documentToMarkdown(result.document, {
              resolve: options.resolve,
              client: options.resolve ? client : undefined,
            })
            if (redirectNotice) md = withRedirectFrontmatter(md, followed.redirects[0]!.republish, followed.targetId)
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
    .option('--children-type <value>', 'Root children type (Group, Unordered, Ordered)')
    .option('--seed-experimental-logo <value>', 'Experimental logo (ipfs:// or file:// URL)')
    .option('--seed-experimental-home-order <value>', 'Home ordering (UpdatedFirst, CreatedFirst)')
    .option('--import-categories <value>', 'Import categories (comma-separated)')
    .option('--import-tags <value>', 'Import tags (comma-separated)')
    .option('--grobid-url <url>', 'GROBID server URL for PDF extraction')
    .option('--dry-run', 'Preview extracted content without publishing')
    .option('--force', 'Overwrite existing document at the same path (creates new lineage)')
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
        const key = await resolveSigningKey(options.key, keyOptions(globalOpts))
        const account = options.account || key.accountId

        // Resolve file:// links in metadata (cover, icon, logo)
        const {metadata: resolvedMeta, blobs: metaBlobs} = await resolveMetadataFileLinks(metadata)

        const rawPath = options.path || slugify(resolvedMeta.name || 'Untitled')
        // "/" publishes the account's home document, whose ref carries no path at all.
        const path = rawPath === '/' ? '' : rawPath.startsWith('/') ? rawPath : `/${rawPath}`

        // When publishing under a different account, resolve the capability.
        // Pass the document path so ListCapabilities can find path-scoped capabilities.
        let capability: string | undefined
        if (options.account && options.account !== key.accountId) {
          capability = await resolveCapability(client, options.account, key.accountId, path)
          if (!capability) {
            throw new Error(
              `No WRITER or AGENT capability found for key ${key.accountId} on account ${options.account}. ` +
                `Use "account capabilities hm://${options.account}" to check available capabilities.`,
            )
          }
        }

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
              if (existing.type === 'redirect') {
                throw new Error(
                  `A redirect already exists at ${path}. Use "document update hm://${account}${path}" to replace it with edited content (continuing the target's history), or --force to overwrite with a new lineage.`,
                )
              }
            } catch (e) {
              // Re-throw our own guard errors; swallow network/not-found errors
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
        const {unsignedBytes, ts} = createChangeOps({ops})
        const changeBlock = await createChange(unsignedBytes, signer)
        const generation = Number(ts)
        const refInput = await createVersionRef(
          {
            space: account,
            path,
            genesis: changeBlock.cid.toString(),
            version: changeBlock.cid.toString(),
            generation,
            capability,
          },
          signer,
        )

        await client.publish({
          blobs: [
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
    .option('--children-type <value>', 'Root children type (Group, Unordered, Ordered)')
    .option('--seed-experimental-logo <value>', 'Experimental logo (ipfs:// or file:// URL)')
    .option('--seed-experimental-home-order <value>', 'Home ordering (UpdatedFirst, CreatedFirst)')
    .option('--import-categories <value>', 'Import categories (comma-separated)')
    .option('--import-tags <value>', 'Import tags (comma-separated)')
    .option('--parent <blockId>', 'Parent block ID for new content (default: root)')
    .option('--delete-blocks <ids>', 'Comma-separated block IDs to delete')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev

      try {
        const {id: resourceId, client} = await resolveIdWithClient(id, globalOpts)
        const key = await resolveSigningKey(options.key, keyOptions(globalOpts))

        // For update, only use stdin if -f is explicitly given.
        // Unlike create, update supports metadata-only changes (--name, --summary),
        // so auto-detecting stdin would break those cases.
        const hasFileInput = !!options.file

        const ops: DocumentOperation[] = []
        let fileBlobs: CollectedBlob[] = []
        let metaBlobs: CollectedBlob[] = []

        // Fetch the document — needed for diffing and state resolution. A redirected address
        // (including a republished one) is followed to its target: the edit builds on the
        // target's DAG and the new Version Ref at THIS address supersedes the redirect.
        const base = await resolveEditableDocument(client, resourceId)
        const existingDoc = base.document
        if (base.redirect && !globalOpts.quiet) {
          printInfo(
            `This address currently ${base.redirect.republish ? 'republishes' : 'redirects to'} ${packHmId(
              base.redirect.target,
            )}; updating it replaces the redirect with an edited copy of that document.`,
          )
        }

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
            // Tables: markdown only carries table/column/row ids, so cell
            // block ids and unexpressible attributes (column width, header
            // column) are rebound from the old document before diffing.
            const rebound = rebindTableIdentities(oldNodes, input.tree)
            const diffOps = computeReplaceOps(oldMap, rebound)
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

        // The Ref lands at the requested address, not the (possibly different) redirect target.
        const docAccount = resourceId.uid
        const docPath = resourceId.path?.length ? `/${resourceId.path.join('/')}` : existingDoc.path || ''

        const state = base.state
        const genesisCid = CID.parse(state.genesis)
        const depCids = state.heads.map((h) => CID.parse(h))
        const newDepth = state.headDepth + 1

        const signer = createSignerFromKey(key)
        const capability = await resolveCapability(client, docAccount, key.accountId, docPath)
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
        const key = await resolveSigningKey(_options.key, keyOptions(globalOpts))
        const signer = createSignerFromKey(key)

        const resource = await client.request('Resource', unpacked)
        if (resource.type !== 'document' && resource.type !== 'redirect') {
          printError(`Cannot delete: resource is ${resource.type}, not a document.`)
          process.exit(1)
        }
        // A redirected path (including a republished one) has no document of its own to read
        // genesis and generation from, so the tombstone borrows the redirect target's genesis and
        // takes a fresh generation — the new maximum generation supersedes the redirect Ref, so
        // the path reads as deleted instead of continuing to follow the target.
        let genesis: string
        let generation: number
        if (resource.type === 'redirect') {
          const base = await followToDocument(client, unpacked)
          genesis = base.document.genesis
          generation = Date.now()
        } else {
          genesis = resource.document.genesis
          generation = resource.document.generationInfo ? Number(resource.document.generationInfo.generation) : 0
        }
        const docPath = hmIdPathToEntityQueryPath(unpacked.path)
        const capability = await resolveCapability(client, unpacked.uid, key.accountId, docPath)

        const refInput = await createTombstoneRef(
          {
            space: unpacked.uid,
            path: hmIdPathToEntityQueryPath(unpacked.path),
            genesis,
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
        const key = await resolveSigningKey(_options.key, keyOptions(globalOpts))
        const signer = createSignerFromKey(key)

        // Follows redirects so a republished path can be forked: the fork points at the content
        // the path currently re-publishes. A fresh generation lets the fork supersede any
        // redirect Ref already sitting at the destination path.
        const {document: doc} = await followToDocument(client, sourceUnpacked)

        const refInput = await createVersionRef(
          {
            space: dest.uid,
            path: hmIdPathToEntityQueryPath(dest.path),
            genesis: doc.generationInfo?.genesis ?? doc.genesis,
            version: doc.version,
            generation: Date.now(),
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
        const key = await resolveSigningKey(_options.key, keyOptions(globalOpts))
        const signer = createSignerFromKey(key)

        // A move acts on whatever lives at the source and keeps it that kind of thing at the
        // destination. Following redirects tells us which: a republish moves as a republish; a
        // plain document moves as a fork of its history; a path that has itself already moved is a
        // pointer with nothing to move.
        const followed = await followToDocument(client, source)
        const genesis = followed.document.generationInfo?.genesis ?? followed.document.genesis

        if (followed.redirect && !followed.redirect.republish) {
          printError(
            `${packHmId(source)} has already moved to ${packHmId(followed.redirect.target)}. ` +
              `Move ${packHmId(followed.redirect.target)} instead.`,
          )
          process.exit(1)
        }

        if (followed.redirect?.republish) {
          // Moving a republish moves the republish: the destination re-publishes the same original
          // (so it keeps tracking the original's edits), and the source redirects to the
          // destination. Forking here would freeze a snapshot and sever the republish.
          const original = followed.targetId
          if (!globalOpts.quiet) {
            printInfo(
              `${packHmId(source)} republishes ${packHmId(original)}; ` +
                `moving it makes ${packHmId(dest)} republish ${packHmId(original)}.`,
            )
          }
          const destRepublishInput = await createRedirectRef(
            {
              space: dest.uid,
              path: hmIdPathToEntityQueryPath(dest.path),
              genesis,
              generation: Date.now(),
              targetSpace: original.uid,
              targetPath: hmIdPathToEntityQueryPath(original.path),
              republish: true,
            },
            signer,
          )
          await client.publish(destRepublishInput)
        } else {
          // A plain document forks its history to the destination. Fresh generations let both refs
          // supersede any redirect Refs already sitting at their paths.
          const versionRefInput = await createVersionRef(
            {
              space: dest.uid,
              path: hmIdPathToEntityQueryPath(dest.path),
              genesis,
              version: followed.document.version,
              generation: Date.now(),
            },
            signer,
          )
          await client.publish(versionRefInput)
        }

        // Redirect the source to the destination (a plain move redirect, not a republish).
        const redirectRefInput = await createRedirectRef(
          {
            space: source.uid,
            path: hmIdPathToEntityQueryPath(source.path),
            genesis,
            generation: Date.now(),
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
        const key = await resolveSigningKey(_options.key, keyOptions(globalOpts))
        const signer = createSignerFromKey(key)

        const resource = await client.request('Resource', source)
        if (resource.type !== 'document' && resource.type !== 'redirect') {
          printError(`Cannot redirect: resource is ${resource.type}, not a document.`)
          process.exit(1)
        }
        // Re-pointing an already-redirected source borrows the current target's genesis (the
        // source has no document of its own). A fresh generation is minted either way — the same
        // choice the daemon's CreateRef makes — so the redirect occupies its own generation row
        // and any later publish at this path supersedes it cleanly.
        const genesis =
          resource.type === 'redirect'
            ? (await followToDocument(client, source)).document.genesis
            : resource.document.genesis

        const refInput = await createRedirectRef(
          {
            space: source.uid,
            path: hmIdPathToEntityQueryPath(source.path),
            genesis,
            generation: Date.now(),
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
  'childrenType',
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
 * Only includes fields with defined values, flattening nested objects into key paths.
 */
function metadataToSetAttributes(metadata: HMMetadata): DocumentOperation | null {
  const attrs: Array<{key: string[]; value: string | number | boolean | null}> = []

  const flatten = (value: unknown, key: string[]) => {
    if (value === undefined) return

    if (value !== null && typeof value === 'object') {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        flatten(nestedValue, [...key, nestedKey])
      }
      return
    }

    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attrs.push({key, value})
    }
  }

  for (const [key, value] of Object.entries(metadata)) {
    flatten(value, [key])
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
