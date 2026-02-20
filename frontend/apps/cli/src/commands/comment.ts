/**
 * Comment commands — get, list, create, discussions.
 */

import type {Command} from 'commander'
import {readFileSync} from 'fs'
import {CID} from 'multiformats/cid'
import {base58btc} from 'multiformats/bases/base58'
import {getClient, getOutputFormat} from '../index'
import {formatOutput, printError, printSuccess, printInfo} from '../output'
import {resolveKey} from '../utils/keyring'
import {signBlob, encodeBlock, blockReference} from '../utils/signing'

// Ed25519 multicodec prefix.
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01])

type CommentBlock = {
  id: string
  type: string
  text: string
  annotations: unknown[]
  children?: CommentBlock[]
}

type SignedComment = {
  type: 'Comment'
  signer: Uint8Array
  sig: Uint8Array
  ts: bigint
  space: Uint8Array
  path: string
  version: CID[]
  body: CommentBlock[]
  replyParent?: CID
  threadRoot?: CID
}

export function registerCommentCommands(program: Command) {
  const comment = program
    .command('comment')
    .description('Manage comments (get, list, create, discussions)')

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
            const authorName =
              result.authors[c.author]?.metadata?.name || c.author
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

        const resource = await client.getResource(targetId)
        if (resource.type !== 'document') {
          throw new Error(`Target is ${resource.type}, expected a document.`)
        }

        const doc = resource.document
        const space = base58btc.decode(doc.account)
        const path = doc.path || ''
        const versionCids = doc.version.split('.').map((v) => CID.parse(v))

        const body = textToBlocks(text)

        let replyParent: CID | undefined
        let threadRoot: CID | undefined

        if (options.reply) {
          const parentComment = await client.getComment(options.reply)
          if (parentComment.id) {
            replyParent = CID.parse(parentComment.version || parentComment.id)
          }
          if (parentComment.threadRoot) {
            threadRoot = CID.parse(parentComment.threadRoot)
          } else if (parentComment.version) {
            threadRoot = CID.parse(parentComment.version)
          }
        }

        const unsigned: SignedComment = {
          type: 'Comment',
          signer: key.publicKeyWithPrefix,
          sig: new Uint8Array(64),
          ts: BigInt(Date.now()),
          space,
          path,
          version: versionCids,
          body,
        }

        if (replyParent) unsigned.replyParent = replyParent
        if (threadRoot) unsigned.threadRoot = threadRoot

        const signed = await signBlob(unsigned, key.privateKey)
        const commentBlock = await encodeBlock(signed)

        await client.createComment({
          comment: commentBlock.bytes,
          blobs: [],
        })

        printSuccess('Comment created')
        if (globalOpts.quiet) {
          console.log(commentBlock.cid.toString())
        } else {
          printInfo(`Comment CID: ${commentBlock.cid.toString()}`)
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

function textToBlocks(text: string): CommentBlock[] {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)

  if (lines.length === 0) {
    return [
      {
        id: generateBlockId(),
        type: 'Paragraph',
        text: '',
        annotations: [],
      },
    ]
  }

  return lines.map((line) => ({
    id: generateBlockId(),
    type: 'Paragraph',
    text: line,
    annotations: [],
  }))
}

let blockCounter = 0

function generateBlockId(): string {
  blockCounter++
  const ts = Date.now().toString(36)
  const count = blockCounter.toString(36)
  return `blk-${ts}-${count}`
}
