/**
 * Document commands — get, create, update, delete, fork, move, redirect, changes, stats, cid.
 */

import type {Command} from 'commander'
import {readFileSync} from 'fs'
import {CID} from 'multiformats/cid'
import {base58btc} from 'multiformats/bases/base58'
import * as ed25519 from '@noble/ed25519'
import {
  createVersionRef,
  createTombstoneRef,
  createRedirectRef,
} from '@seed-hypermedia/client'
import type {HMSigner} from '@shm/shared/hm-types'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {getClient, getOutputFormat} from '../index'
import {formatOutput, printError, printSuccess, printInfo} from '../output'
import {documentToMarkdown} from '../markdown'
import {resolveKey} from '../utils/keyring'
import {
  createGenesisChange,
  createDocumentChange,
  encodeBlock,
  type DocumentOperation,
} from '../utils/signing'
import {resolveDocumentState} from '../utils/depth'
import {parseMarkdown, flattenToOperations} from '../utils/markdown'
import {parseBlocksJson, hmBlockNodesToOperations} from '../utils/blocks-json'
import {createBlocksMap, matchBlockIds, computeReplaceOps, type APIBlockNode} from '../utils/block-diff'
import type {HMBlockNode} from '@shm/shared/hm-types'
import type {KeyPair} from '../utils/key-derivation'

function createSignerFromKey(key: KeyPair): HMSigner {
  return {
    getPublicKey: async () => key.publicKeyWithPrefix,
    sign: async (data: Uint8Array) => ed25519.signAsync(data, key.privateKey),
  }
}

export function registerDocumentCommands(program: Command) {
  const doc = program.command('document').description('Manage documents (get, create, update, delete, fork, move, redirect, changes, stats, cid)')

  // ── get ──────────────────────────────────────────────────────────────────

  doc
    .command('get <id>')
    .description('Fetch a document, comment, or entity by Hypermedia ID')
    .option('-m, --metadata', 'Fetch metadata only')
    .option('--md', 'Output as markdown')
    .option('--frontmatter', 'Include YAML frontmatter (with --md)')
    .option('-r, --resolve', 'Resolve embeds, mentions, and queries (with --md)')
    .option('-q, --quiet', 'Output minimal info')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        if (options.metadata) {
          const unpacked = unpackHmId(id)
          if (!unpacked) {
            printError(`Invalid Hypermedia ID: ${id}`)
            process.exit(1)
          }
          const result = await client.request('ResourceMetadata', unpacked)
          if (globalOpts.quiet || options.quiet) {
            console.log(result.metadata?.name || result.id.id)
          } else {
            console.log(formatOutput(result, format))
          }
          return
        }

        const resourceId = unpackHmId(id)
        if (!resourceId) {
          printError(`Invalid Hypermedia ID: ${id}`)
          process.exit(1)
        }
        const result = await client.request('Resource', resourceId)

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
    .description('Create a new document from markdown or HMBlockNodes JSON')
    .option('-p, --path <path>', 'Document path (e.g. "my-document")')
    .requiredOption('--title <title>', 'Document title')
    .option('--body <text>', 'Markdown content (inline)')
    .option('--body-file <file>', 'Read markdown content from file')
    .option('--blocks <json>', 'HMBlockNodes JSON (inline)')
    .option('--blocks-file <file>', 'Read HMBlockNodes JSON from file')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (account: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev
      const client = getClient(globalOpts)

      try {
        const key = resolveKey(options.key, dev)

        const hasBody = options.body || options.bodyFile
        const hasBlocks = options.blocks || options.blocksFile

        if (hasBody && hasBlocks) {
          printError('Cannot combine --body/--body-file with --blocks/--blocks-file.')
          process.exit(1)
        }

        if (!hasBody && !hasBlocks) {
          printError('No content specified. Use --body, --body-file, --blocks, or --blocks-file.')
          process.exit(1)
        }

        const title = options.title
        const rawPath = options.path || slugify(title)
        const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`

        const ops: DocumentOperation[] = []
        ops.push({
          type: 'SetAttributes',
          attrs: [{key: ['name'], value: title}],
        })

        if (hasBlocks) {
          let json: string
          if (options.blocksFile) {
            json = readFileSync(options.blocksFile, 'utf-8')
          } else {
            json = options.blocks
          }
          const nodes = parseBlocksJson(json)
          ops.push(...hmBlockNodesToOperations(nodes))
        } else {
          let markdown: string
          if (options.bodyFile) {
            markdown = readFileSync(options.bodyFile, 'utf-8')
          } else {
            markdown = options.body
          }
          const {tree} = parseMarkdown(markdown)
          ops.push(...flattenToOperations(tree))
        }

        const genesisChange = await createGenesisChange(key)
        const genesisBlock = await encodeBlock(genesisChange)

        const signedChange = await createDocumentChange(key, genesisBlock.cid, [genesisBlock.cid], 1, ops)
        const changeBlock = await encodeBlock(signedChange)

        const signer = createSignerFromKey(key)
        const generation = Number(signedChange.ts)
        const refInput = await createVersionRef(
          {
            space: account,
            path,
            genesis: genesisBlock.cid.toString(),
            version: changeBlock.cid.toString(),
            generation,
          },
          signer,
        )

        await client.publish({
          blobs: [
            {data: new Uint8Array(genesisBlock.bytes), cid: genesisBlock.cid.toString()},
            {data: new Uint8Array(changeBlock.bytes), cid: changeBlock.cid.toString()},
            ...refInput.blobs,
          ],
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
    .option('--replace-body <file>', 'Replace document body from file (smart positional diff)')
    .option('--parent <blockId>', 'Parent block ID for new content (default: root)')
    .option('--delete-blocks <ids>', 'Comma-separated block IDs to delete')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev
      const client = getClient(globalOpts)

      try {
        const key = resolveKey(options.key, dev)

        // --replace-body is mutually exclusive with --body, --body-file, --delete-blocks
        if (options.replaceBody && (options.body || options.bodyFile || options.deleteBlocks)) {
          printError('--replace-body cannot be combined with --body, --body-file, or --delete-blocks.')
          process.exit(1)
        }

        const ops = buildMetadataOps(options)

        // Fetch the document — needed for all paths (replace-body needs
        // the existing block tree; other paths need account/path).
        const resourceId = unpackHmId(id)
        if (!resourceId) {
          printError(`Invalid Hypermedia ID: ${id}`)
          process.exit(1)
        }
        const resource = await client.request('Resource', resourceId)
        if (resource.type !== 'document') {
          printError(`Resource is ${resource.type}, not a document.`)
          process.exit(1)
        }
        const existingDoc = resource.document

        if (options.replaceBody) {
          // Smart replace: diff existing blocks against new markdown
          const markdown = readFileSync(options.replaceBody, 'utf-8')
          const {tree: newTree} = parseMarkdown(markdown)

          // Convert API block tree to the format expected by block-diff
          const oldNodes = (existingDoc.content || []).map(toAPIBlockNode)
          const oldMap = createBlocksMap(oldNodes)

          // Match IDs positionally, then compute minimal ops
          const matched = matchBlockIds(oldNodes, newTree)
          const diffOps = computeReplaceOps(oldMap, matched)
          ops.push(...diffOps)
        } else {
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
        }

        if (ops.length === 0) {
          printError(
            'No updates specified. Use --title, --summary, --body, --body-file, --replace-body, or --delete-blocks.',
          )
          process.exit(1)
        }

        const docAccount = existingDoc.account
        const docPath = existingDoc.path || ''

        const state = await resolveDocumentState(client, id)
        const genesisCid = CID.parse(state.genesis)
        const depCids = state.heads.map((h) => CID.parse(h))
        const newDepth = state.headDepth + 1

        const signedChange = await createDocumentChange(key, genesisCid, depCids, newDepth, ops)
        const changeBlock = await encodeBlock(signedChange)

        const signer = createSignerFromKey(key)
        const generation = Number(signedChange.ts)
        const refInput = await createVersionRef(
          {
            space: docAccount,
            path: docPath,
            genesis: state.genesis,
            version: changeBlock.cid.toString(),
            generation,
          },
          signer,
        )

        await client.publish({
          blobs: [
            {data: new Uint8Array(changeBlock.bytes), cid: changeBlock.cid.toString()},
            ...refInput.blobs,
          ],
        })

        printSuccess('Document updated')
        if (globalOpts.quiet) {
          console.log(changeBlock.cid.toString())
        } else {
          printInfo(`Change CID: ${changeBlock.cid.toString()}`)
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
      const client = getClient(globalOpts)

      try {
        const key = resolveKey(_options.key, dev)
        const signer = createSignerFromKey(key)

        const unpacked = unpackHmId(id)
        if (!unpacked) {
          printError(`Invalid Hypermedia ID: ${id}`)
          process.exit(1)
        }

        const resource = await client.request('Resource', unpacked)
        if (resource.type !== 'document') {
          printError(`Cannot delete: resource is ${resource.type}, not a document.`)
          process.exit(1)
        }
        const doc = resource.document
        const generation = doc.generationInfo ? Number(doc.generationInfo.generation) : 1

        const refInput = await createTombstoneRef(
          {
            space: unpacked.uid,
            path: hmIdPathToEntityQueryPath(unpacked.path),
            genesis: doc.genesis,
            generation,
          },
          signer,
        )
        await client.publish(refInput)

        printSuccess('Document deleted')
        if (!globalOpts.quiet) {
          printInfo(`Deleted: ${id}`)
        }
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
      const client = getClient(globalOpts)

      try {
        const key = resolveKey(_options.key, dev)
        const signer = createSignerFromKey(key)

        const sourceUnpacked = unpackHmId(sourceId)
        if (!sourceUnpacked) {
          printError(`Invalid source Hypermedia ID: ${sourceId}`)
          process.exit(1)
        }

        const resource = await client.request('Resource', sourceUnpacked)
        if (resource.type !== 'document') {
          printError(`Cannot fork: source is ${resource.type}, not a document.`)
          process.exit(1)
        }
        const doc = resource.document
        if (!doc.generationInfo) throw new Error('No generation info for source document')

        const dest = unpackHmId(destinationId)
        if (!dest) {
          printError(`Invalid destination Hypermedia ID: ${destinationId}`)
          process.exit(1)
        }

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

        printSuccess('Document forked')
        if (!globalOpts.quiet) {
          printInfo(`Source: ${sourceId}`)
          printInfo(`Destination: ${destinationId}`)
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
      const client = getClient(globalOpts)

      try {
        const key = resolveKey(_options.key, dev)
        const signer = createSignerFromKey(key)

        const source = unpackHmId(sourceId)
        const dest = unpackHmId(destinationId)
        if (!source) {
          printError(`Invalid source Hypermedia ID: ${sourceId}`)
          process.exit(1)
        }
        if (!dest) {
          printError(`Invalid destination Hypermedia ID: ${destinationId}`)
          process.exit(1)
        }

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

        printSuccess('Document moved')
        if (!globalOpts.quiet) {
          printInfo(`Source: ${sourceId} → redirect`)
          printInfo(`Destination: ${destinationId}`)
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
      const client = getClient(globalOpts)

      try {
        const key = resolveKey(_options.key, dev)
        const signer = createSignerFromKey(key)

        const source = unpackHmId(id)
        const target = unpackHmId(_options.to)
        if (!source) {
          printError(`Invalid source Hypermedia ID: ${id}`)
          process.exit(1)
        }
        if (!target) {
          printError(`Invalid target Hypermedia ID: ${_options.to}`)
          process.exit(1)
        }

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

        printSuccess('Redirect created')
        if (!globalOpts.quiet) {
          printInfo(`${id} → ${_options.to}`)
          if (_options.republish) {
            printInfo('Mode: republish')
          }
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
        const unpacked = unpackHmId(targetId)
        if (!unpacked) {
          printError(`Invalid Hypermedia ID: ${targetId}`)
          process.exit(1)
        }
        const result = await client.request('ListChanges', {targetId: unpacked})

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
        const unpacked = unpackHmId(id)
        if (!unpacked) {
          printError(`Invalid Hypermedia ID: ${id}`)
          process.exit(1)
        }
        const result = await client.request('InteractionSummary', {id: unpacked})
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
        const result = await client.request('GetCID', {cid})
        console.log(formatOutput(result, format))
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildMetadataOps(options: Record<string, string>): DocumentOperation[] {
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

/**
 * Convert API BlockNode (with optional children) to the APIBlockNode shape
 * expected by block-diff utilities (with required children array).
 */
function toAPIBlockNode(node: HMBlockNode): APIBlockNode {
  const block = node.block as {id: string; type: string; text?: string; link?: string; annotations?: unknown[]; attributes?: Record<string, unknown>}
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
