/**
 * Comment commands — get, list, create, discussions.
 */

import type {Command} from 'commander'
import {readFileSync} from 'fs'
import * as ed25519 from '@noble/ed25519'
import {createComment, deleteComment, createSeedClient} from '@seed-hypermedia/client'
import type {HMAnnotation, HMBlockNode, HMSigner, UnpackedHypermediaId, HMCommentRequest} from '@shm/shared/hm-types'
import {getClient, getOutputFormat} from '../index'
import {formatOutput, printError, printSuccess, printInfo} from '../output'
import {resolveKey} from '../utils/keyring'
import {unpackHmId, packHmId} from '../utils/hm-id'

export function registerCommentCommands(program: Command) {
  const comment = program.command('comment').description('Manage comments (get, list, create, discussions)')

  // ── get ──────────────────────────────────────────────────────────────────

  comment
    .command('get <id>')
    .description('Get a single comment by ID')
    .action(async (id: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.getComment(id)
        console.log(formatOutput(result, format))
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── list ─────────────────────────────────────────────────────────────────

  comment
    .command('list <targetId>')
    .description('List comments on a document')
    .option('-q, --quiet', 'Output IDs and authors only')
    .action(async (targetId: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.listComments(targetId)

        if (globalOpts.quiet) {
          result.comments.forEach((c) => {
            const authorName = result.authors[c.author]?.metadata?.name || c.author
            console.log(`${c.id}\t${authorName}`)
          })
        } else {
          console.log(formatOutput(result, format))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── create ───────────────────────────────────────────────────────────────

  comment
    .command('create <targetId>')
    .description('Create a comment on a document')
    .option('--body <text>', 'Comment text')
    .option('--file <path>', 'Read comment text from file')
    .option('--reply <commentId>', 'Reply to an existing comment')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (targetId: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev
      const client = getClient(globalOpts)

      try {
        const key = resolveKey(options.key, dev)

        let text: string
        if (options.body) {
          text = options.body
        } else if (options.file) {
          text = readFileSync(options.file, 'utf-8')
        } else {
          throw new Error('Provide comment text with --body or --file.')
        }

        // Parse the target ID to extract an optional block reference.
        const unpacked = unpackHmId(targetId)
        if (!unpacked) {
          throw new Error(`Invalid Hypermedia ID: ${targetId}`)
        }
        const blockRef = unpacked.blockRef
        // Strip the blockRef for the API fetch (server doesn't need it).
        const fetchId = unpacked.id + (unpacked.version ? `?v=${unpacked.version}` : '')

        const resource = await client.getResource(fetchId)
        if (resource.type !== 'document') {
          throw new Error(`Target is ${resource.type}, expected a document.`)
        }

        const doc = resource.document

        let body = textToBlocks(text)

        // When targeting a specific block, wrap the comment body in an
        // Embed block whose link contains the block reference fragment.
        // This matches the desktop/web app behaviour for block-level comments.
        if (blockRef) {
          const embedLink = packHmId({
            ...unpacked,
            version: doc.version,
            blockRef,
          })
          body = [
            {
              block: {
                id: generateBlockId(),
                type: 'Embed',
                text: '',
                annotations: [],
                attributes: {childrenType: 'Group', view: 'Content'},
                link: embedLink,
              },
              children: body,
            },
          ]
        }

        let replyParent: string | undefined
        let threadRoot: string | undefined

        if (options.reply) {
          const parentComment = await client.getComment(options.reply)
          const parentVersion = parentComment.version || parentComment.id
          if (parentVersion) replyParent = parentVersion
          if (parentComment.threadRoot) {
            threadRoot = parentComment.threadRoot
          } else if (parentComment.version) {
            threadRoot = parentComment.version
          }
        }

        const signer: HMSigner = {
          getPublicKey: async () => key.publicKeyWithPrefix,
          sign: async (data: Uint8Array) => ed25519.signAsync(data, key.privateKey),
        }

        const publishClient = createSeedClient(client.server)
        const result = await publishClient.publish(
          await createComment(
            {
              content: body,
              docId: {
                ...unpacked,
                blockRef: null,
                version: null,
              } as UnpackedHypermediaId,
              docVersion: doc.version,
              blobs: [],
              replyCommentVersion: replyParent || undefined,
              rootReplyCommentVersion: threadRoot || undefined,
            },
            signer,
          ),
        )

        const commentId = result.cids[0]
        if (!commentId) {
          throw new Error('Failed to publish comment blob')
        }

        printSuccess('Comment created')
        if (globalOpts.quiet) {
          console.log(commentId)
        } else {
          printInfo(`Comment CID: ${commentId}`)
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── delete ─────────────────────────────────────────────────────────────

  comment
    .command('delete <commentId>')
    .description('Delete a comment (publish a tombstone)')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (commentId: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev
      const client = getClient(globalOpts)

      try {
        const key = resolveKey(options.key, dev)

        const seedClient = createSeedClient(client.server)

        // Fetch the comment to get target details
        const existing = await seedClient.request<HMCommentRequest>('Comment', commentId)

        const signer: HMSigner = {
          getPublicKey: async () => key.publicKeyWithPrefix,
          sign: async (data: Uint8Array) => ed25519.signAsync(data, key.privateKey),
        }

        await seedClient.publish(
          await deleteComment(
            {
              commentId,
              targetAccount: existing.targetAccount,
              targetPath: existing.targetPath || '',
              targetVersion: existing.targetVersion,
            },
            signer,
          ),
        )

        printSuccess('Comment deleted')
        if (!globalOpts.quiet) {
          printInfo(`Deleted comment: ${commentId}`)
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── discussions ──────────────────────────────────────────────────────────

  comment
    .command('discussions <targetId>')
    .description('List threaded discussions on a document')
    .option('-c, --comment <id>', 'Filter to specific thread')
    .action(async (targetId: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.listDiscussions(targetId, options.comment)
        console.log(formatOutput(result, format))
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a line of text, extracting inline mentions of the form
 * `@[DisplayName](hm://accountId)`. Each mention is replaced with
 * U+FFFC (object replacement character) in the output text and an
 * Embed annotation is created spanning that single character.
 */
function parseMentions(line: string): {text: string; annotations: HMAnnotation[]} {
  const mentionRe = /@\[([^\]]*)\]\((hm:\/\/[^)]+)\)/g
  const annotations: HMAnnotation[] = []
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = mentionRe.exec(line)) !== null) {
    // Append text before the mention
    result += line.slice(lastIndex, match.index)
    const pos = result.length
    // Insert the object replacement character
    result += '\uFFFC'
    annotations.push({
      type: 'Embed',
      starts: [pos],
      ends: [pos + 1],
      link: match[2],
    })
    lastIndex = match.index + match[0].length
  }

  // Append remaining text
  result += line.slice(lastIndex)
  return {text: result, annotations}
}

function textToBlocks(text: string): HMBlockNode[] {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)

  if (lines.length === 0) {
    return [
      {
        block: {
          id: generateBlockId(),
          type: 'Paragraph',
          text: '',
          attributes: {},
          annotations: [],
        },
        children: [],
      },
    ]
  }

  return lines.map((line) => {
    const {text: parsedText, annotations} = parseMentions(line)
    return {
      block: {
        id: generateBlockId(),
        type: 'Paragraph',
        text: parsedText,
        attributes: {},
        annotations,
      },
      children: [],
    }
  })
}

let blockCounter = 0

function generateBlockId(): string {
  blockCounter++
  const ts = Date.now().toString(36)
  const count = blockCounter.toString(36)
  return `blk-${ts}-${count}`
}
