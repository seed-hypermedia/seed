/**
 * Site commands — subscribe, unsubscribe, list-subscriptions, sync-status,
 * reconcile (force-sync). Used to make a local daemon mirror a remote site.
 */

import type {Command} from 'commander'
import {getClient, getOutputFormat, isPretty} from '../index'
import {formatOutput, printError, printSuccess} from '../output'
import {resolveIdWithClient} from '../utils/resolve-id'

export function registerSiteCommands(program: Command) {
  const site = program
    .command('site')
    .description('Manage site subscriptions on the local daemon (subscribe, sync-status, reconcile)')

  // ── subscribe ────────────────────────────────────────────────────────────

  site
    .command('subscribe <id>')
    .description('Subscribe the local daemon to a site or document, mirroring its content')
    .option('--recursive', 'Also subscribe to all documents in the directory', false)
    .option('--wait', 'Wait for first sync to complete before returning (async=false)', false)
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const {id: unpacked, client} = await resolveIdWithClient(id, globalOpts)
        const path = (unpacked.path || []).filter(Boolean).join('/')
        const result = await client.request('Subscribe', {
          account: unpacked.uid,
          path: path ? `/${path}` : '',
          recursive: !!options.recursive,
          async: !options.wait,
        })
        if (globalOpts.quiet) {
          printSuccess('subscribed')
        } else {
          console.log(formatOutput({status: 'subscribed', account: unpacked.uid, path: path ? `/${path}` : '', recursive: !!options.recursive, result}, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── unsubscribe ──────────────────────────────────────────────────────────

  site
    .command('unsubscribe <id>')
    .description('Unsubscribe the local daemon from a site or document')
    .action(async (id: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()

      try {
        const {id: unpacked, client} = await resolveIdWithClient(id, globalOpts)
        const path = (unpacked.path || []).filter(Boolean).join('/')
        await client.request('Unsubscribe', {
          account: unpacked.uid,
          path: path ? `/${path}` : '',
        })
        if (!globalOpts.quiet) printSuccess('unsubscribed')
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── list-subscriptions ───────────────────────────────────────────────────

  site
    .command('list-subscriptions')
    .description('List all active subscriptions on the local daemon')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const result = await client.request('ListSubscriptions', {})
        if (globalOpts.quiet) {
          for (const s of result.subscriptions) {
            console.log(`hm://${s.account}${s.path}\t${s.recursive ? 'recursive' : 'single'}`)
          }
        } else {
          console.log(formatOutput(result, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── sync-status ──────────────────────────────────────────────────────────

  site
    .command('sync-status <id>')
    .description('Report subscription state and writer-capability availability for a site')
    .option('--writer <accountId>', 'Required writer account; ready_for_writes=true only when this account holds a WRITER capability locally')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const {id: unpacked, client} = await resolveIdWithClient(id, globalOpts)
        const path = (unpacked.path || []).filter(Boolean).join('/')
        const subPath = path ? `/${path}` : ''

        const subs = await client.request('ListSubscriptions', {})
        const matching = subs.subscriptions.find(
          (s) => s.account === unpacked.uid && s.path === subPath,
        )

        const caps = await client.request('ListCapabilities', {targetId: unpacked})
        const writerCaps = caps.capabilities.filter((c) => {
          const role = c.role || ''
          return role.toUpperCase().includes('WRITER')
        })

        const readyForWrites =
          !!matching &&
          (options.writer
            ? writerCaps.some((c) => c.delegate === options.writer || c.account === options.writer)
            : writerCaps.length > 0)

        const status = {
          subscribed: !!matching,
          recursive: matching?.recursive ?? false,
          since: matching?.since,
          writerCapCount: writerCaps.length,
          ready_for_writes: readyForWrites,
        }

        if (globalOpts.quiet) {
          console.log(readyForWrites ? 'ready' : 'not-ready')
        } else {
          console.log(formatOutput(status, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── reconcile (force-sync) ───────────────────────────────────────────────

  site
    .command('reconcile')
    .description('Force the daemon to run periodic background sync immediately (pulls capability/comment/ref blobs)')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()

      try {
        const client = getClient(globalOpts)
        await client.request('ForceSync', {})
        if (!globalOpts.quiet) printSuccess('sync triggered')
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
