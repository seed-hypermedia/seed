/**
 * Changes command - document history
 */

import type {Command} from 'commander'
import {getClient, getOutputFormat} from '../index'
import {formatOutput, printError} from '../output'

export function registerChangesCommand(program: Command) {
  program
    .command('changes <targetId>')
    .description('List document change history')
    .option('-q, --quiet', 'Output CIDs and authors only')
    .action(async (targetId: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.listChanges(targetId)

        if (globalOpts.quiet) {
          result.changes.forEach((c) => {
            console.log(`${c.id || 'unknown'}\t${c.author || ''}`)
          })
          if (result.latestVersion) {
            console.log(`latest\t${result.latestVersion}`)
          }
        } else {
          console.log(formatOutput(result, format))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
