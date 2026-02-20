/**
 * Document commands — get, create, update, changes, stats, cid.
 */

import type {Command} from 'commander'
import {readFileSync} from 'fs'
import {CID} from 'multiformats/cid'
import {base58btc} from 'multiformats/bases/base58'
import {getClient, getOutputFormat} from '../index'
import {formatOutput, printError, printSuccess, printInfo} from '../output'
import {documentToMarkdown} from '../markdown'
import {resolveKey} from '../utils/keyring'
import {
  createGenesisChange,
  createDocumentChange,
  createRef,
  encodeBlock,
  blockReference,
  signBlob,
  type DocumentOperation,
} from '../utils/signing'
import {resolveDocumentState} from '../utils/depth'
import {parseMarkdown, flattenToOperations} from '../utils/markdown'

export function registerDocumentCommands(program: Command) {
  const doc = program
    .command('document')
    .description('Manage documents (get, create, update, changes, stats, cid)')

  // ── get ──────────────────────────────────────────────────────────────────

  doc
    .command('get <id>')
    .description('Fetch a document, comment, or entity by Hypermedia ID')
    .option('-m, --metadata', 'Fetch metadata only')
    .option('--md', 'Output as markdown')
    .option('--frontmatter', 'Include YAML frontmatter (with --md)')
    .option(
      '-r, --resolve',
      'Resolve embeds, mentions, and queries (with --md)',
    )
    .option('-q, --quiet', 'Output minimal info')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        if (options.metadata) {
          const result = await client.getResourceMetadata(id)
          if (globalOpts.quiet || options.quiet) {
            console.log(result.metadata?.name || result.id.id)
          } else {
            console.log(formatOutput(result, format))
          }
          return
        }

        const result = await client.getResource(id)

        if (globalOpts.quiet || options.quiet) {
          if (result.type === 'document') {
            console.log(result.document.metadata?.name || result.id.id)
          } else if (result.type === 'comment') {
            console.log(result.id.id)
          } else {
            console.log(result.type)
          }
        } else if (options.md) {
          if (result.type === 'document') {
            const md = await documentToMarkdown(result.document, {
              includeMetadata: true,
              includeFrontmatter: options.frontmatter,
              resolve: options.resolve,
              client: options.resolve ? client : undefined,
            })
            console.log(md)
          } else if (result.type === 'comment') {
            const fakeDoc = {
              content: result.comment.content,
              metadata: {},
              version: result.comment.version,
              authors: [result.comment.author],
            }
            const md = await documentToMarkdown(fakeDoc as any, {
              resolve: options.resolve,
              client: options.resolve ? client : undefined,
            })
            console.log(md)
          } else {
            printError(`Cannot render ${result.type} as markdown`)
            process.exit(1)
          }
        } else {
          console.log(formatOutput(result, format))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── create ───────────────────────────────────────────────────────────────

  doc
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
        const key = resolveKey(options.key, dev)

        let markdown: string
        if (options.bodyFile) {
          markdown = readFileSync(options.bodyFile, 'utf-8')
        } else if (options.body) {
          markdown = options.body
        } else {
          printError('No content specified. Use --body or --body-file.')
          process.exit(1)
        }

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

        const ops: DocumentOperation[] = []
        ops.push({
          type: 'SetAttributes',
          attrs: [{key: ['name'], value: title}],
        })
        ops.push(...flattenToOperations(tree))

        const genesisChange = await createGenesisChange(key)
        const genesisBlock = await encodeBlock(genesisChange)

        const signedChange = await createDocumentChange(
          key,
          genesisBlock.cid,
          [genesisBlock.cid],
          1,
          ops,
        )
        const changeBlock = await encodeBlock(signedChange)

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

        // Genesis must be stored before the change+ref that reference it.
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

  // ── update ───────────────────────────────────────────────────────────────

  doc
    .command('update <id>')
    .description('Update document metadata, append content, or delete blocks')
    .option('--title <title>', 'Set document title')
    .option('--summary <summary>', 'Set document summary')
    .option('--body <text>', 'Markdown content to append (inline)')
    .option('--body-file <file>', 'Read markdown content to append from file')
    .option(
      '--parent <blockId>',
      'Parent block ID for new content (default: root)',
    )
    .option('--delete-blocks <ids>', 'Comma-separated block IDs to delete')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev
      const client = getClient(globalOpts)

      try {
        const key = resolveKey(options.key, dev)
        const ops = buildMetadataOps(options)

        if (options.deleteBlocks) {
          const blockIds = options.deleteBlocks
            .split(',')
            .map((id: string) => id.trim())
            .filter(Boolean)
          if (blockIds.length > 0) {
            ops.push({type: 'DeleteBlocks', blocks: blockIds})
          }
        }

        if (options.bodyFile || options.body) {
          let markdown: string
          if (options.bodyFile) {
            markdown = readFileSync(options.bodyFile, 'utf-8')
          } else {
            markdown = options.body
          }

          const parentId = options.parent || ''
          const {tree} = parseMarkdown(markdown)
          ops.push(...flattenToOperations(tree, parentId))
        }

        if (ops.length === 0) {
          printError(
            'No updates specified. Use --title, --summary, --body, --body-file, or --delete-blocks.',
          )
          process.exit(1)
        }

        const resource = await client.getResource(id)
        if (resource.type !== 'document') {
          printError(`Resource is ${resource.type}, not a document.`)
          process.exit(1)
        }

        const doc = resource.document
        const account = doc.account
        const path = doc.path || ''

        const state = await resolveDocumentState(client, id)
        const genesisCid = CID.parse(state.genesis)
        const depCids = state.heads.map((h) => CID.parse(h))
        const newDepth = state.headDepth + 1

        const space = base58btc.decode(account)

        const signedChange = await createDocumentChange(
          key,
          genesisCid,
          depCids,
          newDepth,
          ops,
        )
        const changeBlock = await encodeBlock(signedChange)

        const generation = Number(signedChange.ts)
        const signedRef = await createRef(
          key,
          genesisCid,
          changeBlock.cid,
          generation,
          path || undefined,
          space,
        )
        const refBlock = await encodeBlock(signedRef)

        await client.updateDocument({
          change: blockReference(changeBlock),
          ref: blockReference(refBlock),
        })

        printSuccess('Document updated')
        if (globalOpts.quiet) {
          console.log(changeBlock.cid.toString())
        } else {
          printInfo(`Change CID: ${changeBlock.cid.toString()}`)
          printInfo(`Ref CID: ${refBlock.cid.toString()}`)
        }
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
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.listChanges(targetId)

        if (globalOpts.quiet) {
          result.changes.forEach((c) => {
            console.log(`${c.id || 'unknown'}\t${c.author || ''}`)
          })
          if (result.latestVersion) {
            console.log(`latest\t${result.latestVersion}`)
          }
        } else {
          console.log(formatOutput(result, format))
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
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.getInteractionSummary(id)
        console.log(formatOutput(result, format))
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

      try {
        const result = await client.getCID(cid)
        console.log(formatOutput(result, format))
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildMetadataOps(
  options: Record<string, string>,
): DocumentOperation[] {
  const ops: DocumentOperation[] = []
  const attrs: Array<{key: string[]; value: unknown}> = []

  if (options.title !== undefined) {
    attrs.push({key: ['name'], value: options.title})
  }

  if (options.summary !== undefined) {
    attrs.push({key: ['summary'], value: options.summary})
  }

  if (attrs.length > 0) {
    ops.push({type: 'SetAttributes', attrs})
  }

  return ops
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
