/**
 * Query and discovery commands — query, children, citations, activity.
 *
 * These remain top-level commands as they are frequently used for discovery.
 */

import type {Command} from 'commander'
import {getClient, getOutputFormat, isPretty} from '../index'
import {formatOutput, printError} from '../output'
import {resolveIdWithClient} from '../utils/resolve-id'
import type {
  HMDocumentFilter,
  HMDocumentSort,
  HMDocumentAttributeKind,
  HMQuerySort,
} from '@seed-hypermedia/client/hm-types'
import {compileExploreQuery, parseExploreQuery} from '@seed-hypermedia/client/explore-query'

const BUILTIN_SORTS: Record<string, HMDocumentSort['attribute']> = {
  title: 'BUILTIN_SORT_ATTRIBUTE_NAME',
  name: 'BUILTIN_SORT_ATTRIBUTE_NAME',
  path: 'BUILTIN_SORT_ATTRIBUTE_PATH',
  created: 'BUILTIN_SORT_ATTRIBUTE_CREATE_TIME',
  updated: 'BUILTIN_SORT_ATTRIBUTE_UPDATE_TIME',
  activity: 'BUILTIN_SORT_ATTRIBUTE_ACTIVITY_TIME',
  comments: 'BUILTIN_SORT_ATTRIBUTE_COMMENT_COUNT',
}
const ATTRIBUTE_KINDS: Record<string, HMDocumentAttributeKind> = {
  string: 'DOCUMENT_ATTRIBUTE_KIND_STRING',
  int: 'DOCUMENT_ATTRIBUTE_KIND_INT',
  bool: 'DOCUMENT_ATTRIBUTE_KIND_BOOL',
  object: 'DOCUMENT_ATTRIBUTE_KIND_OBJECT',
}

/**
 * `--where` (the Explore grammar) and/or `--filter` (a DocumentFilter as JSON) compiled into one
 * filter, scoped to `space` (and `--path`) unless space is `*`. Text terms have nowhere to go here.
 */
function buildDocumentFilter(
  space: string,
  path: string | undefined,
  where: string | undefined,
  rawFilter: string | undefined,
): HMDocumentFilter | undefined {
  const parts: HMDocumentFilter[] = []
  if (space !== '*') parts.push({spaceMatch: {space}})
  if (path) parts.push({pathMatch: {path: path.startsWith('/') ? path : `/${path}`, prefix: true}})
  if (where) {
    const compiled = compileExploreQuery(parseExploreQuery(where), {type: 'node'})
    for (const diagnostic of compiled.diagnostics) console.error(`warning: ${diagnostic.message}`)
    if (compiled.textTerms.length) {
      console.error(
        `warning: free-text terms are not matched by --where (use \`search\`): ${compiled.textTerms
          .map((t) => t.value)
          .join(', ')}`,
      )
    }
    if (compiled.filter) parts.push(compiled.filter)
  }
  if (rawFilter) parts.push(JSON.parse(rawFilter) as HMDocumentFilter)
  return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : {and: {filters: parts}}
}

export function registerQueryCommands(program: Command) {
  program
    .command('query <space>')
    .description(
      'List documents in a space, or find documents by attribute (--where / --filter; space `*` = everywhere)',
    )
    .option('-p, --path <path>', 'Path prefix')
    .option('-m, --mode <mode>', 'Query mode: Children or AllDescendants', 'Children')
    .option('-l, --limit <n>', 'Limit results (page size with --where / --filter)', parseInt)
    .option('--sort <term>', 'Sort by: title, path, created, updated, activity, displayTime (comments with --where)')
    .option('--reverse', 'Reverse sort order')
    .option(
      '-w, --where <query>',
      'Attribute conditions in the Explore grammar: key=value (exact), key!=v, key>=3, key:text (contains), key^text (starts with), has:key, missing:key, path:/x/*, AND/OR/NOT, parentheses',
    )
    .option('--filter <json>', 'A raw DocumentFilter as JSON (ANDed with --where)')
    .option('--sort-by <key>', 'With --where / --filter: sort by a user attribute key (dotted for nested)')
    .option('--page-token <token>', 'With --where / --filter: continue from a previous nextPageToken')
    .option('-q, --quiet', 'Output IDs and names only')
    .action(async (space: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        if (options.where || options.filter || space === '*') {
          const filter = buildDocumentFilter(space, options.path, options.where, options.filter)
          if (!filter) {
            printError('Give --where or --filter (or a space) so the query has a condition')
            process.exit(1)
          }
          const sort: HMDocumentSort[] = []
          if (options.sortBy) sort.push({key: options.sortBy, descending: !!options.reverse})
          else if (options.sort) {
            const attribute = BUILTIN_SORTS[String(options.sort).toLowerCase()]
            if (!attribute) {
              printError(`Unknown sort term "${options.sort}"; use ${Object.keys(BUILTIN_SORTS).join(', ')}`)
              process.exit(1)
            }
            sort.push({attribute, descending: !!options.reverse})
          }
          const result = await client.request('QueryDocuments', {
            filter,
            sort: sort.length ? sort : undefined,
            pageSize: options.limit,
            pageToken: options.pageToken,
          })
          if (globalOpts.quiet) {
            for (const doc of result.documents ?? []) {
              const path = (doc.path ?? '').replace(/^\/+/, '')
              console.log(`hm://${doc.account}${path ? `/${path}` : ''}\t${(doc.metadata as any)?.name || ''}`)
            }
          } else {
            console.log(formatOutput(result, format, pretty))
          }
          return
        }
        const includes = [
          {
            space,
            path: options.path,
            mode: options.mode as 'Children' | 'AllDescendants',
          },
        ]

        const sort: HMQuerySort[] | undefined = options.sort
          ? [{term: options.sort, reverse: options.reverse}]
          : undefined

        const result = await client.request('Query', {includes, sort, limit: options.limit})

        if (!result) {
          printError('No results')
          process.exit(1)
        }

        if (globalOpts.quiet) {
          result.results.forEach((r) => {
            console.log(`${r.id.id}\t${r.metadata?.name || ''}`)
          })
        } else {
          console.log(formatOutput(result, format, pretty))
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
      const pretty = isPretty(globalOpts)

      try {
        const includes = [
          {
            space,
            path: options.path,
            mode: 'Children' as const,
          },
        ]

        const result = await client.request('Query', {includes, limit: options.limit})

        if (!result) {
          printError('No results')
          process.exit(1)
        }

        if (globalOpts.quiet) {
          result.results.forEach((r) => {
            console.log(`${r.id.id}\t${r.metadata?.name || ''}`)
          })
        } else {
          console.log(formatOutput(result, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  program
    .command('attributes [space]')
    .description('Which attribute keys documents use, and the values a key takes (space omitted = everywhere)')
    .option('--parent <path>', 'List the direct child names of this dotted object path')
    .option('--recursive', 'List complete dotted scalar paths instead of direct children')
    .option('--values <key>', 'List the distinct values of this dotted attribute key')
    .option('--kind <kind>', 'With --values: string, int, or bool (default: every kind the key has been seen with)')
    .option('--prefix <text>', 'Case-insensitive name or value prefix')
    .option('-l, --limit <n>', 'Page size', parseInt)
    .option('--page-token <token>', 'Continue from a previous nextPageToken')
    .action(async (space: string | undefined, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)
      try {
        if (options.values) {
          const path = String(options.values).split('.')
          let kinds: HMDocumentAttributeKind[]
          if (options.kind) {
            const kind = ATTRIBUTE_KINDS[String(options.kind).toLowerCase()]
            if (!kind) {
              printError('--kind must be string, int, or bool')
              process.exit(1)
            }
            kinds = [kind]
          } else {
            const known = await client.request('ListDocumentAttributeNames', {
              account: space,
              parentPath: path.slice(0, -1),
              prefix: path[path.length - 1],
              pageSize: 50,
            })
            const observed = (known.names ?? [])
              .filter((entry) => entry.name === path[path.length - 1])
              .flatMap((entry) => (entry.kinds ?? []).map((usage) => usage.kind))
            kinds = (
              ['DOCUMENT_ATTRIBUTE_KIND_STRING', 'DOCUMENT_ATTRIBUTE_KIND_INT', 'DOCUMENT_ATTRIBUTE_KIND_BOOL'] as const
            ).filter((kind) => observed.includes(kind))
            if (!kinds.length) kinds = ['DOCUMENT_ATTRIBUTE_KIND_STRING']
          }
          const values: Array<{kind: string; value: unknown}> = []
          let nextPageToken: string | undefined
          for (const kind of kinds) {
            const result = await client.request('ListDocumentAttributeValues', {
              path,
              kind,
              account: space,
              prefix: options.prefix,
              pageSize: options.limit,
              pageToken: kinds.length === 1 ? options.pageToken : undefined,
            })
            for (const entry of result.values ?? []) values.push({kind, value: entry.value})
            if (kinds.length === 1 && result.nextPageToken) nextPageToken = result.nextPageToken
          }
          console.log(formatOutput({key: options.values, values, nextPageToken}, format, pretty))
          return
        }
        const result = await client.request('ListDocumentAttributeNames', {
          account: space,
          parentPath: options.parent ? String(options.parent).split('.') : undefined,
          prefix: options.prefix,
          pageSize: options.limit,
          pageToken: options.pageToken,
          recursive: !!options.recursive,
        })
        console.log(formatOutput(result, format, pretty))
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
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const {id: unpacked, client} = await resolveIdWithClient(id, globalOpts)
        const result = await client.request('ListCitations', {targetId: unpacked})

        if (globalOpts.quiet) {
          result.citations.forEach((c) => {
            console.log(c.source)
          })
        } else {
          console.log(formatOutput(result, format, pretty))
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
      const pretty = isPretty(globalOpts)

      try {
        const result = await client.request('ListEvents', {
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
          console.log(formatOutput(result, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
