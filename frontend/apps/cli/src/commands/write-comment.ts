/**
 * Comment creation command.
 *
 * Creates a signed Comment blob and submits it to the server.
 */

import type {Command} from 'commander'
import {readFileSync} from 'fs'
import {CID} from 'multiformats/cid'
import {base58btc} from 'multiformats/bases/base58'
import {getClient, getOutputFormat} from '../index'
import {printError, printSuccess, printInfo, formatOutput} from '../output'
import {getKey, getDefaultKey, type KeyringKey} from '../utils/keyring'
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

export function registerWriteCommentCommand(program: Command) {
  program
    .command('comment-create <targetId>')
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
        // Resolve signing key.
        const key = resolveKey(options.key, dev)

        // Get comment body text.
        let text: string
        if (options.body) {
          text = options.body
        } else if (options.file) {
          text = readFileSync(options.file, 'utf-8')
        } else {
          throw new Error('Provide comment text with --body or --file.')
        }

        // Fetch the target document to get space, path, and version.
        const resource = await client.getResource(targetId)
        if (resource.type !== 'document') {
          throw new Error(`Target is ${resource.type}, expected a document.`)
        }

        const doc = resource.document
        const space = base58btc.decode(doc.account)
        const path = doc.path || ''
        const versionCids = doc.version.split('.').map((v) => CID.parse(v))

        // Build comment body as simple paragraph blocks.
        const body = textToBlocks(text)

        // Resolve reply parent if specified.
        let replyParent: CID | undefined
        let threadRoot: CID | undefined

        if (options.reply) {
          // Fetch the reply parent comment to get its ID (CID).
          const parentComment = await client.getComment(options.reply)
          if (parentComment.id) {
            replyParent = CID.parse(parentComment.version || parentComment.id)
          }
          // Thread root is either the parent's thread root or the parent itself.
          if (parentComment.threadRoot) {
            threadRoot = CID.parse(parentComment.threadRoot)
          } else if (parentComment.version) {
            threadRoot = CID.parse(parentComment.version)
          }
        }

        // Build unsigned comment.
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

        // Sign the comment blob.
        const signed = await signBlob(unsigned, key.privateKey)

        // Encode as IPLD block.
        const commentBlock = await encodeBlock(signed)

        // Submit to server.
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
}

function resolveKey(keyFlag: string | undefined, dev: boolean): KeyringKey {
  if (keyFlag) {
    const key = getKey(keyFlag, dev)
    if (!key) {
      throw new Error(
        `Key "${keyFlag}" not found. Use "seed-cli key list" to see available keys.`,
      )
    }
    return key
  }

  const key = getDefaultKey(dev)
  if (!key) {
    throw new Error(
      'No signing keys found. Use "seed-cli key generate" or "seed-cli key import" first.',
    )
  }
  return key
}

/**
 * Converts plain text into an array of Paragraph blocks.
 * Each non-empty line becomes a separate block.
 */
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
