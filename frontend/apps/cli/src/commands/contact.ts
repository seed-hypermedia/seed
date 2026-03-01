/**
 * Contact commands — create, delete, list.
 */

import type {Command} from 'commander'
import * as ed25519 from '@noble/ed25519'
import {createContact, deleteContact, contactRecordIdFromBlob, createSeedClient} from '@seed-hypermedia/client'
import type {HMSigner, HMAccountContactsRequest, HMSubjectContactsRequest} from '@shm/shared/hm-types'
import {getClient, getOutputFormat} from '../index'
import {formatOutput, printError, printSuccess, printInfo} from '../output'
import {resolveKey} from '../utils/keyring'

/**
 * Resolve a contact identifier that may be either a record ID (authority/tsid)
 * or a CID. If it's a CID, fetch the blob from the server and compute the record ID.
 */
async function resolveContactId(idOrCid: string, serverUrl: string): Promise<string> {
  if (idOrCid.includes('/')) return idOrCid
  const response = await fetch(`${serverUrl}/ipfs/${idOrCid}`)
  if (!response.ok) throw new Error(`Could not fetch blob by CID: ${idOrCid} (${response.status})`)
  const blobData = new Uint8Array(await response.arrayBuffer())
  return contactRecordIdFromBlob(blobData)
}

export function registerContactCommands(program: Command) {
  const contact = program
    .command('contact')
    .description('Manage contacts (create, delete, list)')
    .addHelpText(
      'after',
      `
Examples:
  $ seed contact create --subject z6Mkr... --name "Alice"
  $ seed contact list z6Mkr...                 # both directions
  $ seed contact list z6Mkr... --account       # only contacts they created
  $ seed contact list z6Mkr... --subject       # only contacts about them
  $ seed contact delete z6Mkr.../zQ3sh...`,
    )

  // ── create ───────────────────────────────────────────────────────────────

  contact
    .command('create')
    .description('Create a contact (a named reference to another account)')
    .requiredOption('--subject <accountId>', 'Account ID of the person being described')
    .requiredOption('--name <name>', 'Display name for the contact')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev
      const client = getClient(globalOpts)

      try {
        const key = resolveKey(options.key, dev)

        const signer: HMSigner = {
          getPublicKey: async () => key.publicKeyWithPrefix,
          sign: async (data: Uint8Array) => ed25519.signAsync(data, key.privateKey),
        }

        const seedClient = createSeedClient(client.server)
        const contactResult = await createContact(
          {
            subjectUid: options.subject,
            name: options.name,
          },
          signer,
        )
        await seedClient.publish(contactResult)

        printSuccess('Contact created')
        if (globalOpts.quiet) {
          console.log(contactResult.recordId)
        } else {
          printInfo(`Contact ID: ${contactResult.recordId}`)
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── delete ───────────────────────────────────────────────────────────────

  contact
    .command('delete <contactIdOrCid>')
    .description('Delete a contact (publish a tombstone). Accepts record ID (authority/tsid) or CID.')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (contactIdOrCid: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev

      try {
        const key = resolveKey(options.key, dev)
        const client = getClient(globalOpts)
        const contactId = await resolveContactId(contactIdOrCid, client.server)

        const signer: HMSigner = {
          getPublicKey: async () => key.publicKeyWithPrefix,
          sign: async (data: Uint8Array) => ed25519.signAsync(data, key.privateKey),
        }

        const seedClient = createSeedClient(client.server)
        await seedClient.publish(await deleteContact({contactId}, signer))

        printSuccess('Contact deleted')
        if (!globalOpts.quiet) {
          printInfo(`Deleted contact: ${contactId}`)
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── list ─────────────────────────────────────────────────────────────────

  contact
    .command('list [accountId]')
    .description('List contacts for an account. Shows both directions by default, or filter with --account / --subject.')
    .option('--account', 'Only show contacts signed by the account')
    .option('--subject', 'Only show contacts where the account is the subject')
    .action(async (accountId: string | undefined, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const format = getOutputFormat(globalOpts)

      if (!accountId) {
        printError('Provide an account ID')
        cmd.help({error: true})
        return
      }

      // Default: show both directions. Flags narrow it down.
      const showAccount = !options.subject || options.account
      const showSubject = !options.account || options.subject

      try {
        const seedClient = createSeedClient(getClient(globalOpts).server)
        let results: {id: string; name: string; account: string; subject: string}[] = []

        if (showAccount) {
          const accountContacts = await seedClient.request<HMAccountContactsRequest>('AccountContacts', accountId)
          results.push(...accountContacts)
        }

        if (showSubject) {
          const subjectContacts = await seedClient.request<HMSubjectContactsRequest>('SubjectContacts', accountId)
          // Dedupe if showing both directions
          if (showAccount) {
            const seen = new Set(results.map((c) => c.id))
            for (const c of subjectContacts) {
              if (!seen.has(c.id)) results.push(c)
            }
          } else {
            results = subjectContacts
          }
        }

        if (globalOpts.quiet) {
          results.forEach((c) => {
            console.log(`${c.id}\t${c.name}\t${c.subject}`)
          })
        } else {
          console.log(formatOutput(results, format))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
