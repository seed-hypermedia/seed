/**
 * Query and discovery commands — query, children, citations, activity.
 *
 * These remain top-level commands as they are frequently used for discovery.
 */

import type {Command} from 'commander'
import {getClient, getOutputFormat} from '../index'
import {formatOutput, printError} from '../output'
import type {QueryInclude, QuerySort} from '../client'

export function registerQueryCommands(program: Command) {
  program
    .command('query <space>')
    .description('List documents in a space')
    .option('-p, --path <path>', 'Path prefix')
    .option(
      '-m, --mode <mode>',
      'Query mode: Children or AllDescendants',
      'Children',
    )
    .option('-l, --limit <n>', 'Limit results', parseInt)
    .option(
      '--sort <term>',
      'Sort by: Path, Title, CreateTime, UpdateTime, DisplayTime',
    )
    .option('--reverse', 'Reverse sort order')
    .option('-q, --quiet', 'Output IDs and names only')
    .action(async (space: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const includes: QueryInclude[] = [
          {
            space,
            path: options.path,
            mode: options.mode as 'Children' | 'AllDescendants',
          },
        ]

        const sort: QuerySort[] | undefined = options.sort
          ? [{term: options.sort, reverse: options.reverse}]
          : undefined

        const result = await client.query(includes, sort, options.limit)

        if (globalOpts.quiet) {
          result.results.forEach((r) => {
            console.log(`${r.id.id}\t${r.metadata?.name || ''}`)
          })
        } else {
          console.log(formatOutput(result, format))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  program
    .command('children <space>')
    .description('List child documents (shorthand for query --mode Children)')
    .option('-p, --path <path>', 'Path prefix')
    .option('-l, --limit <n>', 'Limit results', parseInt)
    .option('-q, --quiet', 'Output IDs and names only')
    .action(async (space: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const includes: QueryInclude[] = [
          {
            space,
            path: options.path,
            mode: 'Children',
          },
        ]

        const result = await client.query(includes, undefined, options.limit)

        if (globalOpts.quiet) {
          result.results.forEach((r) => {
            console.log(`${r.id.id}\t${r.metadata?.name || ''}`)
          })
        } else {
          console.log(formatOutput(result, format))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  program
    .command('citations <id>')
    .description('List documents citing this resource')
    .option('-q, --quiet', 'Output source IDs only')
    .action(async (id: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.listCitations(id)

        if (globalOpts.quiet) {
          result.citations.forEach((c) => {
            console.log(c.source)
          })
        } else {
          console.log(formatOutput(result, format))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  program
    .command('activity')
    .description('List activity events')
    .option('-l, --limit <n>', 'Page size', parseInt)
    .option('-t, --token <token>', 'Page token for pagination')
    .option('--authors <uids>', 'Filter by author UIDs (comma-separated)')
    .option('--resource <id>', 'Filter by resource')
    .option('-q, --quiet', 'Output summary only')
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.listEvents({
          pageSize: options.limit,
          pageToken: options.token,
          filterAuthors: options.authors?.split(','),
          filterResource: options.resource,
        })

        if (globalOpts.quiet) {
          console.log(`${result.events.length} events`)
          if (result.nextPageToken) {
            console.log(`next\t${result.nextPageToken}`)
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
