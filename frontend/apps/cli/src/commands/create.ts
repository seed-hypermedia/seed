/**
 * Document creation command.
 *
 * Creates a new Seed Hypermedia document from markdown content.
 * Supports hierarchical block structure with headings, paragraphs,
 * code blocks, lists, and inline formatting.
 *
 * All blobs (genesis, change, ref) are signed locally and pushed
 * to the remote server via the HTTP document-update endpoint.
 */

import type {Command} from 'commander'
import {readFileSync} from 'fs'
import {getClient} from '../index'
import {printError, printSuccess, printInfo} from '../output'
import {resolveKey} from '../utils/keyring'
import {
  createGenesisChange,
  createDocumentChange,
  createRef,
  encodeBlock,
  blockReference,
  type DocumentOperation,
} from '../utils/signing'
import {parseMarkdown, flattenToOperations} from '../utils/markdown'

export function registerCreateCommand(program: Command) {
  program
    .command('create <account>')
    .description('Create a new document from markdown content')
    .option('-p, --path <path>', 'Document path (e.g. "my-document")')
    .option('--title <title>', 'Document title (overrides H1 from markdown)')
    .option('--body <text>', 'Markdown content (inline)')
    .option('--body-file <file>', 'Read markdown content from file')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (account: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev
      const client = getClient(globalOpts)

      try {
        // Resolve the signing key.
        const key = resolveKey(options.key, dev)

        // Read markdown content.
        let markdown: string
        if (options.bodyFile) {
          markdown = readFileSync(options.bodyFile, 'utf-8')
        } else if (options.body) {
          markdown = options.body
        } else {
          printError('No content specified. Use --body or --body-file.')
          process.exit(1)
        }

        // Parse markdown into block tree.
        const {title: parsedTitle, tree} = parseMarkdown(markdown)
        const title = options.title || parsedTitle

        if (!title) {
          printError(
            'No title found. Use --title or include an H1 heading in the markdown.',
          )
          process.exit(1)
        }

        const rawPath = options.path || slugify(title)
        const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`

        // Build operations.
        const ops: DocumentOperation[] = []

        // Set document metadata.
        ops.push({
          type: 'SetAttributes',
          attrs: [{key: ['name'], value: title}],
        })

        // Flatten block tree into ReplaceBlock + MoveBlocks operations.
        ops.push(...flattenToOperations(tree))

        // Create genesis blob.
        const genesisChange = await createGenesisChange(key)
        const genesisBlock = await encodeBlock(genesisChange)

        // Create document change with all operations.
        const signedChange = await createDocumentChange(
          key,
          genesisBlock.cid,
          [genesisBlock.cid],
          1,
          ops,
        )
        const changeBlock = await encodeBlock(signedChange)

        // Create ref with path and space.
        const generation = Number(signedChange.ts)
        const signedRef = await createRef(
          key,
          genesisBlock.cid,
          changeBlock.cid,
          generation,
          path,
          key.publicKeyWithPrefix,
        )
        const refBlock = await encodeBlock(signedRef)

        // For new documents the genesis blob must be stored before the
        // change+ref that reference it.  The document-update endpoint
        // stores whatever blobs you send in its `change` and `ref`
        // fields, so we piggy-back the genesis through a preliminary
        // call (sending it as both fields).  A second call then sends
        // the real change and ref which can now resolve the genesis.
        const genesisRef = blockReference(genesisBlock)
        await client.updateDocument({
          change: genesisRef,
          ref: genesisRef,
        })

        await client.updateDocument({
          change: blockReference(changeBlock),
          ref: blockReference(refBlock),
        })

        const hmUrl = `hm://${account}${path}`
        printSuccess(`Document created: ${hmUrl}`)
        if (!globalOpts.quiet) {
          printInfo(`Title: ${title}`)
          printInfo(`Path: ${path}`)
          printInfo(`Genesis CID: ${genesisBlock.cid.toString()}`)
          printInfo(`Change CID: ${changeBlock.cid.toString()}`)
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}

/**
 * Creates a URL-safe slug from a title string.
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
