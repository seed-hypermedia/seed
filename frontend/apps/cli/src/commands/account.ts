/**
 * Account commands
 */

import type {Command} from 'commander'
import {getClient, getOutputFormat} from '../index'
import {formatOutput, printError} from '../output'

export function registerAccountCommands(program: Command) {
  // Get single account
  program
    .command('account <uid>')
    .description('Get account information')
    .option('-q, --quiet', 'Output ID only')
    .action(async (uid: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.getAccount(uid)

        if (globalOpts.quiet) {
          if (result.type === 'account') {
            console.log(result.metadata?.name || result.id.uid)
          } else {
            console.log('not-found')
          }
        } else {
          console.log(formatOutput(result, format))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // List all accounts
  program
    .command('accounts')
    .description('List all known accounts')
    .option('-q, --quiet', 'Output IDs and names only')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.listAccounts()

        if (globalOpts.quiet) {
          result.accounts.forEach((a) => {
            const name = a.metadata?.name || ''
            console.log(`${a.id.id}\t${name}`)
          })
        } else {
          console.log(formatOutput(result, format))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // Get account contacts
  program
    .command('contacts <uid>')
    .description('List contacts for an account')
    .option('-q, --quiet', 'Output names only')
    .action(async (uid: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.getAccountContacts(uid)

        if (globalOpts.quiet) {
          result.forEach((c) => {
            console.log(c.name || c.account)
          })
        } else {
          console.log(formatOutput(result, format))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
