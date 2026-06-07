/**
 * Account commands — get, list, contacts, capabilities.
 */

import type {Command} from 'commander'
import * as ed25519 from '@noble/ed25519'
import {CID} from 'multiformats/cid'
import * as blobs from '@shm/shared/blobs'
import {getClient, getOutputFormat, isPretty} from '../index'
import {formatOutput, printError, printSuccess} from '../output'
import {resolveIdWithClient} from '../utils/resolve-id'
import {resolveKey} from '../utils/keyring'

export function registerAccountCommands(program: Command) {
  const account = program.command('account').description('Manage accounts (get, list, contacts, profile, capabilities)')

  // ── get ──────────────────────────────────────────────────────────────────

  account
    .command('get <uid>')
    .description('Get account information')
    .option('-q, --quiet', 'Output ID only')
    .action(async (uid: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const result = await client.request('Account', uid)

        if (globalOpts.quiet) {
          if (result.type === 'account') {
            console.log(result.metadata?.name || result.id.uid)
          } else {
            console.log('not-found')
          }
        } else {
          console.log(formatOutput(result, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── list ─────────────────────────────────────────────────────────────────

  account
    .command('list')
    .description('List all known accounts')
    .option('-q, --quiet', 'Output IDs and names only')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const result = await client.request('ListAccounts', {})

        if (globalOpts.quiet) {
          result.accounts.forEach((a) => {
            const name = a.metadata?.name || ''
            console.log(`${a.id.id}\t${name}`)
          })
        } else {
          console.log(formatOutput(result, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── contacts ─────────────────────────────────────────────────────────────

  account
    .command('contacts <uid>')
    .description('List contacts for an account')
    .option('-q, --quiet', 'Output names only')
    .action(async (uid: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const result = await client.request('AccountContacts', uid)

        if (globalOpts.quiet) {
          result.forEach((c) => {
            console.log(c.name || c.account)
          })
        } else {
          console.log(formatOutput(result, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── profile ──────────────────────────────────────────────────────────────

  const profile = account.command('profile').description('Manage account profile blobs')

  profile
    .command('set')
    .description('Publish a profile blob for an account')
    .requiredOption('--name <value>', 'Profile display name')
    .option('--icon <value>', 'Profile icon/avatar URI (ipfs://...)')
    .option('--avatar <value>', 'Alias for --icon')
    .option('--description <value>', 'Short profile description')
    .option('-a, --account <uid>', 'Target account UID (defaults to the signing key account)')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .option('-q, --quiet', 'Output CID only')
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)
      const dev = !!globalOpts.dev

      try {
        const key = resolveKey(options.key, dev)
        const targetAccount = options.account?.trim() || key.accountId
        const name = options.name.trim()
        const description = options.description?.trim()
        if (!name) throw new Error('Profile name cannot be empty')
        if (description && new TextEncoder().encode(description).length >= 512) {
          throw new Error('Profile description must be less than 512 bytes')
        }
        if (options.icon && options.avatar && options.icon !== options.avatar) {
          throw new Error('Use either --icon or --avatar, not both')
        }
        const signer: blobs.Signer = {
          principal: key.publicKeyWithPrefix,
          sign: async (data: Uint8Array) => ed25519.signAsync(data, key.privateKey),
        }
        const avatar = options.icon || options.avatar
        if (avatar) {
          if (!avatar.startsWith('ipfs://')) throw new Error('Profile icon/avatar must be an ipfs:// URI')
          const cidString = avatar.slice('ipfs://'.length).split(/[/?#]/, 1)[0]
          if (!cidString) throw new Error('Profile icon/avatar must include an IPFS CID')
          CID.parse(cidString)
        }
        const encoded = await blobs.createProfile(
          signer,
          {
            name,
            ...(avatar ? {avatar} : {}),
            ...(description ? {description} : {}),
            ...(targetAccount !== key.accountId ? {account: blobs.principalFromString(targetAccount)} : {}),
          },
          Date.now(),
        )

        await client.publish({blobs: [{data: encoded.data, cid: encoded.cid.toString()}]})

        const result = {
          cid: encoded.cid.toString(),
          account: targetAccount,
          profile: {
            name,
            ...(avatar ? {icon: avatar} : {}),
            ...(description ? {description} : {}),
          },
        }

        if (globalOpts.quiet || options.quiet) {
          console.log(result.cid)
        } else if (globalOpts.json || globalOpts.yaml) {
          console.log(formatOutput(result, format, pretty))
        } else {
          printSuccess(`Profile published: ${result.cid}`)
          console.log(formatOutput(result, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── capabilities ─────────────────────────────────────────────────────────

  account
    .command('capabilities <id>')
    .description('List access control capabilities')
    .action(async (id: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const {id: unpacked, client} = await resolveIdWithClient(id, globalOpts)
        const result = await client.request('ListCapabilities', {targetId: unpacked})
        console.log(formatOutput(result, format, pretty))
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
