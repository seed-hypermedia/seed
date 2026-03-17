/**
 * Search command — keyword, semantic, or hybrid search for documents and comments.
 */

import type {Command} from 'commander'
import {getClient, getOutputFormat, isPretty} from '../index'
import {formatOutput, printError} from '../output'

/** Map human-readable search type names to the numeric enum values. */
const SEARCH_TYPES: Record<string, number> = {
  keyword: 0,
  semantic: 1,
  hybrid: 2,
}

export function registerSearchCommand(program: Command) {
  program
    .command('search <query>')
    .description('Search for documents and comments')
    .option('-a, --account <uid>', 'Limit search to account')
    .option('-t, --type <type>', 'Search type: keyword, semantic, or hybrid', 'keyword')
    .option('-c, --context-size <number>', 'Context size in runes around matches', parseInt)
    .option('-l, --limit <number>', 'Maximum number of results', parseInt)
    .option('--titles-only', 'Search only titles and contacts (default includes body and comments)')
    .option('-q, --quiet', 'Output tab-separated: id, blockRef, type, title')
    .action(async (query: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      const typeName = (options.type as string).toLowerCase()
      const searchType = SEARCH_TYPES[typeName]
      if (searchType === undefined) {
        printError(`Unknown search type "${options.type}". Use: keyword, semantic, or hybrid`)
        process.exit(1)
      }

      try {
        const result = await client.request('Search', {
          query,
          accountUid: options.account,
          searchType,
          contextSize: options.contextSize,
          pageSize: options.limit,
          includeBody: !options.titlesOnly,
        })

        if (globalOpts.quiet) {
          result.entities.forEach((e) => {
            const blockRef = e.id.blockRef || ''
            console.log(`${e.id.id}\t${blockRef}\t${e.type}\t${e.title || ''}`)
          })
        } else {
          console.log(formatOutput(result, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
