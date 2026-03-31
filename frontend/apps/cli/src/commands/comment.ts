/**
 * Comment commands — get, list, create, edit, discussions.
 */

import type {Command} from 'commander'
import {readFileSync} from 'fs'
import {createComment, deleteComment, updateComment} from '@seed-hypermedia/client'
import type {HMAnnotation, HMBlockNode, HMComment, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {unpackHmId, packHmId} from '@shm/shared/utils/entity-id-url'
import {getClient, getOutputFormat, isPretty} from '../index'
import {formatOutput, printError, printSuccess} from '../output'
import {resolveKey} from '../utils/keyring'
import {resolveIdWithClient} from '../utils/resolve-id'
import {createSignerFromKey} from '../utils/signer'

export function registerCommentCommands(program: Command) {
  const comment = program.command('comment').description('Manage comments (get, list, create, edit, discussions)')

  // ── get ──────────────────────────────────────────────────────────────────

  comment
    .command('get <id>')
    .description('Get a single comment by ID')
    .action(async (id: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const result = await client.request('Comment', id)
        console.log(formatOutput(result, format, pretty))
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── list ─────────────────────────────────────────────────────────────────

  comment
    .command('list <targetId>')
    .description('List comments on a document or URL')
    .option('-q, --quiet', 'Output IDs and authors only')
    .action(async (targetId: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const {id: unpacked, client} = await resolveIdWithClient(targetId, globalOpts)
        const result = await client.request('ListComments', {targetId: unpacked})

        if (globalOpts.quiet) {
          result.comments.forEach((c) => {
            const authorName = result.authors[c.author]?.metadata?.name || c.author
            console.log(`${c.id}\t${authorName}`)
          })
        } else {
          console.log(formatOutput(result, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── create ───────────────────────────────────────────────────────────────

  comment
    .command('create <targetId>')
    .description('Create a comment on a document or URL')
    .option('--body <text>', 'Comment text')
    .option('--file <path>', 'Read comment text from file')
    .option('--reply <commentId>', 'Reply to an existing comment')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (targetId: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev

      try {
        const {id: unpacked, client} = await resolveIdWithClient(targetId, globalOpts)
        const key = resolveKey(options.key, dev)
        const text = readCommentText(options)
        const blockRef = unpacked.blockRef
        // Strip the blockRef for the API fetch (server doesn't need it).
        const resourceId = {...unpacked, blockRef: null} as UnpackedHypermediaId

        const resource = await client.request('Resource', resourceId)
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
          const parentComment = await client.request('Comment', options.reply)
          const parentVersion = parentComment.version || parentComment.id
          if (parentVersion) replyParent = parentVersion
          if (parentComment.threadRoot) {
            threadRoot = parentComment.threadRoot
          } else if (parentComment.version) {
            threadRoot = parentComment.version
          }
        }

        const signer = createSignerFromKey(key)

        const result = await client.publish(
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
              visibility: doc.visibility === 'PRIVATE' ? 'Private' : '',
            },
            signer,
          ),
        )

        const commentId = result.cids[0]
        if (!commentId) {
          throw new Error('Failed to publish comment blob')
        }

        if (!globalOpts.quiet) printSuccess(`Comment published: ${commentId}`)
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── edit ─────────────────────────────────────────────────────────────────

  comment
    .command('edit <commentId>')
    .description('Edit an existing comment')
    .option('--body <text>', 'Updated comment text')
    .option('--file <path>', 'Read updated comment text from file')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (commentId: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev
      const client = getClient(globalOpts)

      try {
        const key = resolveKey(options.key, dev)
        const text = readCommentText(options)
        if (!text.trim()) {
          throw new Error('Comment text cannot be empty.')
        }

        const existing = await client.request('Comment', commentId)
        if (existing.content.length === 0) {
          throw new Error('Cannot edit a deleted comment.')
        }

        const signer = createSignerFromKey(key)
        const updatedContent = preserveBlockCommentWrapper(existing, textToBlocks(text))

        await client.publish(
          await updateComment(
            {
              commentId,
              targetAccount: existing.targetAccount,
              targetPath: existing.targetPath || '',
              targetVersion: existing.targetVersion,
              content: updatedContent,
              replyParentVersion: existing.replyParentVersion || null,
              rootReplyCommentVersion: existing.threadRootVersion || null,
              visibility: existing.visibility === 'PRIVATE' ? 'Private' : '',
            },
            signer,
          ),
        )

        if (!globalOpts.quiet) printSuccess(`Comment updated: ${commentId}`)
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

        // Fetch the comment to get target details
        const existing = await client.request('Comment', commentId)

        const signer = createSignerFromKey(key)

        await client.publish(
          await deleteComment(
            {
              commentId,
              targetAccount: existing.targetAccount,
              targetPath: existing.targetPath || '',
              targetVersion: existing.targetVersion,
              visibility: existing.visibility === 'PRIVATE' ? 'Private' : '',
            },
            signer,
          ),
        )

        if (!globalOpts.quiet) printSuccess(`Comment deleted: ${commentId}`)
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── discussions ──────────────────────────────────────────────────────────

  comment
    .command('discussions <targetId>')
    .description('List threaded discussions on a document or URL')
    .option('-c, --comment <id>', 'Filter to specific thread')
    .action(async (targetId: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const {id: unpacked, client} = await resolveIdWithClient(targetId, globalOpts)
        const result = await client.request('ListDiscussions', {targetId: unpacked, commentId: options.comment})
        console.log(formatOutput(result, format, pretty))
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

function readCommentText(options: {body?: string; file?: string}): string {
  if (options.body) return options.body
  if (options.file) return readFileSync(options.file, 'utf-8')
  throw new Error('Provide comment text with --body or --file.')
}

function preserveBlockCommentWrapper(comment: HMComment, content: HMBlockNode[]): HMBlockNode[] {
  const firstNode = comment.content[0]
  if (!firstNode || comment.content.length !== 1) return content
  if (firstNode.block.type !== 'Embed' || !firstNode.block.link) return content

  const quotedTarget = unpackHmId(firstNode.block.link)
  if (!quotedTarget?.blockRef) return content

  const quotedPath = quotedTarget.path?.length ? `/${quotedTarget.path.join('/')}` : ''
  if (quotedTarget.uid !== comment.targetAccount) return content
  if (quotedPath !== (comment.targetPath || '')) return content
  if (quotedTarget.version !== comment.targetVersion) return content

  return [
    {
      ...firstNode,
      children: content,
    },
  ]
}

let blockCounter = 0

function generateBlockId(): string {
  blockCounter++
  const ts = Date.now().toString(36)
  const count = blockCounter.toString(36)
  return `blk-${ts}-${count}`
}
