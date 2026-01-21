/**
 * Comments commands
 */

import type {Command} from 'commander'
import {getClient, getOutputFormat} from '../index'
import {formatOutput, printError} from '../output'

export function registerCommentsCommand(program: Command) {
  // List comments on target
  program
    .command('comments <targetId>')
    .description('List comments on a document')
    .option('-q, --quiet', 'Output IDs and authors only')
    .action(async (targetId: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.listComments(targetId)

        if (globalOpts.quiet) {
          result.comments.forEach((c) => {
            const authorName = result.authors[c.author]?.metadata?.name || c.author
            console.log(`${c.id}\t${authorName}`)
          })
        } else {
          console.log(formatOutput(result, format))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // List threaded discussions
  program
    .command('discussions <targetId>')
    .description('List threaded discussions on a document')
    .option('-c, --comment <id>', 'Filter to specific thread')
    .action(async (targetId: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.listDiscussions(targetId, options.comment)
        console.log(formatOutput(result, format))
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // Get single comment
  program
    .command('comment <id>')
    .description('Get a single comment by ID')
    .action(async (id: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.getComment(id)
        console.log(formatOutput(result, format))
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // Activity feed
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
