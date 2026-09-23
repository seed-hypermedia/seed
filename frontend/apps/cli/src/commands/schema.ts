/**
 * Schema commands — Hypermedia schemas as things of their own.
 *
 *   schema get <ref>            print a schema (a file, ipfs://<cid>, a library name, or a type document URL)
 *   schema validate <ref>       check that a schema is a valid Hypermedia schema (against the meta-schema)
 *
 * Publishing a schema is a document operation: `document create --schema-definition <file>`
 * binds it to a page, which is what gives a type its hm:// name.
 */
import type {Command} from 'commander'
import {resolveSchema} from '@seed-hypermedia/client/schema-engine'
import {getClient, getOutputFormat, isPretty} from '../index'
import {formatOutput, printError, printSuccess} from '../output'
import {META_SCHEMA, encodeBlob, loadSchema, violations} from '../utils/schema'

const fail: (message: string) => never = (message) => {
  printError(message)
  process.exit(1)
}

export function registerSchemaCommands(program: Command) {
  const schema = program.command('schema').description('Hypermedia schemas: get and validate')

  schema
    .command('get <ref>')
    .description('Print a schema as dag-json, with its CID')
    .option('--resolve', 'Print the resolved shape (references followed, extensions merged)')
    .action(async (ref: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        const loaded = await loadSchema(getClient(globalOpts), ref)
        const value = options.resolve ? resolveSchema(loaded.schema, {}, loaded.registry).schema : loaded.schema
        const cid = loaded.cid ?? (await encodeBlob(loaded.schema)).cid
        console.log(
          formatOutput(
            {cid: `ipfs://${cid}`, source: loaded.source, schema: value},
            getOutputFormat(globalOpts),
            isPretty(globalOpts),
          ),
        )
      } catch (error) {
        fail((error as Error).message)
      }
    })

  schema
    .command('validate <ref>')
    .description('Check that a schema is a valid Hypermedia schema (it must be an instance of the meta-schema)')
    .action(async (ref: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        const loaded = await loadSchema(getClient(globalOpts), ref)
        const errors = violations(META_SCHEMA, loaded.schema, loaded.registry)
        if (errors.length) {
          printError(
            `${loaded.source} is not a valid Hypermedia schema (${errors.length} violation${
              errors.length === 1 ? '' : 's'
            }):`,
          )
          for (const e of errors) console.error(`  ✗ ${e}`)
          process.exit(1)
        }
        const cid = loaded.cid ?? (await encodeBlob(loaded.schema)).cid
        printSuccess(`${loaded.source} is a valid Hypermedia schema (ipfs://${cid})`)
      } catch (error) {
        fail((error as Error).message)
      }
    })
}
