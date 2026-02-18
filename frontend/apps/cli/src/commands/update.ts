/**
 * Document update command.
 *
 * Updates document metadata (title, summary) by creating a signed
 * Change + Ref blob pair and submitting them to the server.
 */

import type {Command} from 'commander'
import {CID} from 'multiformats/cid'
import {getClient, getOutputFormat} from '../index'
import {printError, printSuccess, printInfo, formatOutput} from '../output'
import {getKey, getDefaultKey, type KeyringKey} from '../utils/keyring'
import {
  createDocumentChange,
  createRef,
  encodeBlock,
  blockReference,
  type DocumentOperation,
} from '../utils/signing'
import {resolveDocumentState} from '../utils/depth'

export function registerUpdateCommand(program: Command) {
  program
    .command('update <id>')
    .description('Update document metadata')
    .option('--title <title>', 'Set document title')
    .option('--summary <summary>', 'Set document summary')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev
      const client = getClient(globalOpts)

      try {
        // Resolve the signing key.
        const key = resolveKey(options.key, dev)

        // Build operations from flags.
        const ops = buildMetadataOps(options)
        if (ops.length === 0) {
          printError('No updates specified. Use --title or --summary.')
          process.exit(1)
        }

        // Fetch the document to get account + path.
        const resource = await client.getResource(id)
        if (resource.type !== 'document') {
          printError(`Resource is ${resource.type}, not a document.`)
          process.exit(1)
        }

        const doc = resource.document
        const account = doc.account
        const path = doc.path || ''

        // Resolve document state (genesis, heads, depth).
        const state = await resolveDocumentState(client, id)

        const genesisCid = CID.parse(state.genesis)
        const depCids = state.heads.map((h) => CID.parse(h))
        const newDepth = state.headDepth + 1

        // Resolve space (account public key).
        // The key's account must match the document account, or have a capability.
        // For now we pass the signer as space if it matches the account.

        // Create the signed Change blob.
        const signedChange = await createDocumentChange(
          key,
          genesisCid,
          depCids,
          newDepth,
          ops,
        )

        const changeBlock = await encodeBlock(signedChange)

        // Create the signed Ref blob.
        // Generation: reuse timestamp of the change as generation if unknown.
        const generation = Number(signedChange.ts)
        const signedRef = await createRef(
          key,
          genesisCid,
          changeBlock.cid,
          generation,
          path || undefined,
        )

        const refBlock = await encodeBlock(signedRef)

        // Submit to server.
        const result = await client.updateDocument({
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
