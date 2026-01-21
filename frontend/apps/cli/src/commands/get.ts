/**
 * Get command - fetch resources
 */

import type {Command} from 'commander'
import {getClient, getOutputFormat} from '../index'
import {formatOutput, printError} from '../output'
import {documentToMarkdown} from '../markdown'

export function registerGetCommand(program: Command) {
  program
    .command('get <id>')
    .description('Fetch a document, comment, or entity by Hypermedia ID')
    .option('-m, --metadata', 'Fetch metadata only')
    .option('--md', 'Output as markdown')
    .option('--frontmatter', 'Include YAML frontmatter (with --md)')
    .option('-r, --resolve', 'Resolve embeds, mentions, and queries (with --md)')
    .option('-q, --quiet', 'Output minimal info')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        let result
        if (options.metadata) {
          result = await client.getResourceMetadata(id)
        } else {
          result = await client.getResource(id)
        }

        if (globalOpts.quiet || options.quiet) {
          if (result.type === 'document') {
            console.log(result.document.metadata?.name || result.id.id)
          } else if (result.type === 'comment') {
            console.log(result.id.id)
          } else {
            console.log(result.type)
          }
        } else if (options.md) {
          if (result.type === 'document') {
            const md = await documentToMarkdown(result.document, {
              includeMetadata: true,
              includeFrontmatter: options.frontmatter,
              resolve: options.resolve,
              client: options.resolve ? client : undefined,
            })
            console.log(md)
          } else if (result.type === 'comment') {
            // For comments, just show the content blocks as markdown
            const fakeDoc = {
              content: result.comment.content,
              metadata: {},
              version: result.comment.version,
              authors: [result.comment.author],
            }
            const md = await documentToMarkdown(fakeDoc as any, {
              resolve: options.resolve,
              client: options.resolve ? client : undefined,
            })
            console.log(md)
          } else {
            printError(`Cannot render ${result.type} as markdown`)
            process.exit(1)
          }
        } else {
          console.log(formatOutput(result, format))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // Shorthand for CID fetch
  program
    .command('cid <cid>')
    .description('Fetch raw IPFS block by CID')
    .action(async (cid: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.getCID(cid)
        console.log(formatOutput(result, format))
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // Interaction summary
  program
    .command('stats <id>')
    .description('Get interaction statistics for a document')
    .action(async (id: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)

      try {
        const result = await client.getInteractionSummary(id)
        console.log(formatOutput(result, format))
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
