/**
 * Search command
 */

import type {Command} from 'commander'
import {getClient, getOutputFormat} from '../index'
import {formatOutput, printError} from '../output'

export function registerSearchCommand(program: Command) {
  program
    .command('search <query>')
    .description('Search for documents')
    .option('-a, --account <uid>', 'Limit search to account')
    .option('-q, --quiet', 'Output IDs and titles only')
    .action(async (query: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.search(query, options.account)

        if (globalOpts.quiet) {
          result.entities.forEach((e) => {
            console.log(`${e.id.id}\t${e.title || ''}`)
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
