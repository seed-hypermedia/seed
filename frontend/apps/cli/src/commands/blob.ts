/**
 * Blob commands — the low-level half of the Hypermedia protocol: content-addressed DAG-CBOR
 * objects, typed by Onyx schemas, optionally signed with the hypermedia-blob envelope.
 *
 *   blob get <cid>                       read a blob back as dag-json
 *   blob validate -f value.json          check a value against a schema (no network write)
 *   blob create -f value.json            publish a conforming object (with a `schema` link)
 *   blob sign -f fields.json --key k     add the signed envelope (signer, ts, sig), sign, publish
 *   blob verify <cid>                    check a blob's signature and its schema
 *
 * A schema reference is a file, an ipfs:// CID, a library name or a type document's hm:// URL.
 */
import type {Command} from 'commander'
import {publishSignedBlob, signBlob, signedBlobTypeTag} from '@seed-hypermedia/client/onyx-signed-blob'
import {getClient, getOutputFormat, isPretty} from '../index'
import {formatOutput, printError, printInfo, printSuccess, printWarning} from '../output'
import {keyOptions, resolveSigningKey} from '../utils/keys'
import {createSignerFromKey} from '../utils/signer'
import {
  blobSchemaRef,
  encodeBlob,
  fetchBlobValue,
  hasSignedEnvelope,
  ipldToDagJson,
  isPlainMap,
  loadSchema,
  readJsonFile,
  verifySignedBlob,
  violations,
  withoutSchemaLink,
} from '../utils/onyx'
import * as cbor from '@seed-hypermedia/client/cbor'

const fail = (message: string): never => {
  printError(message)
  process.exit(1)
}

function printViolations(errors: string[]) {
  for (const e of errors) console.error(`  ✗ ${e}`)
}

export function registerBlobCommands(program: Command) {
  const blob = program
    .command('blob')
    .description('Content-addressed DAG-CBOR objects: get, validate, create, sign, verify')

  blob
    .command('get <cid>')
    .description('Fetch a blob by CID and print it as dag-json')
    .action(async (cid: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        const value = await fetchBlobValue(getClient(globalOpts), cid.replace(/^ipfs:\/\//, ''))
        if (value === undefined) fail(`No blob at ${cid}`)
        console.log(
          formatOutput(
            value,
            getOutputFormat(globalOpts) === 'md' ? 'json' : getOutputFormat(globalOpts),
            isPretty(globalOpts),
          ),
        )
      } catch (error) {
        fail((error as Error).message)
      }
    })

  blob
    .command('validate')
    .description('Validate a dag-json value against a schema; exit 1 on any violation')
    .requiredOption('-f, --file <path>', 'The value (dag-json)')
    .option(
      '-s, --schema <ref>',
      'Schema: a file, ipfs://<cid>, a library name, or a type document hm:// URL (default: the value’s own schema link)',
    )
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        const value = readJsonFile(options.file)
        const ref = options.schema ?? blobSchemaRef(value)
        if (!ref) fail('No schema: pass --schema, or give the value a `schema` link')
        const loaded = await loadSchema(getClient(globalOpts), ref)
        const errors = violations(loaded.schema, withoutSchemaLink(value), loaded.registry)
        if (errors.length) {
          printError(
            `${options.file} does not conform to ${loaded.source} (${errors.length} violation${
              errors.length === 1 ? '' : 's'
            }):`,
          )
          printViolations(errors)
          process.exit(1)
        }
        printSuccess(`${options.file} conforms to ${loaded.source}`)
      } catch (error) {
        fail((error as Error).message)
      }
    })

  blob
    .command('create')
    .description('Publish a dag-json value as a DAG-CBOR blob, validated against its schema and linked to it')
    .requiredOption('-f, --file <path>', 'The value (dag-json)')
    .option('-s, --schema <ref>', 'Schema the value must follow; the published blob links to it as `schema`')
    .option('--no-link', 'Do not add the `schema` link to the published blob')
    .option('--force', 'Publish even when the value violates the schema')
    .option('--dry-run', 'Print the blob that would be published (dag-json) and its CID without publishing')
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        const client = getClient(globalOpts)
        const value = readJsonFile(options.file)
        const ref = options.schema ?? blobSchemaRef(value)
        let published: unknown = value
        if (ref) {
          const loaded = await loadSchema(client, ref)
          if (options.link !== false && loaded.cid && isPlainMap(value) && !('schema' in value)) {
            published = {...value, schema: {'/': loaded.cid}}
          }
          const errors = violations(loaded.schema, withoutSchemaLink(published), loaded.registry)
          if (errors.length) {
            const lines = [
              `${options.file} does not conform to ${loaded.source} (${errors.length} violation${
                errors.length === 1 ? '' : 's'
              }):`,
            ]
            if (options.force) {
              printWarning(lines[0]!)
              printViolations(errors)
            } else {
              printError(lines[0]!)
              printViolations(errors)
              printInfo('Fix the value, or pass --force to publish it anyway.')
              process.exit(1)
            }
          }
        }
        const {data, cid} = await encodeBlob(published)
        if (options.dryRun) {
          console.log(formatOutput({cid: `ipfs://${cid}`, value: published}, 'json', isPretty(globalOpts)))
          return
        }
        await client.publish({blobs: [{data, cid}]})
        if (globalOpts.quiet) console.log(`ipfs://${cid}`)
        else printSuccess(`Published ipfs://${cid}${ref ? ` (conforms to ${ref})` : ''}`)
      } catch (error) {
        fail((error as Error).message)
      }
    })

  blob
    .command('sign')
    .description('Sign a value as a Hypermedia signed blob (adds signer, ts, sig) and publish it')
    .requiredOption('-f, --file <path>', 'The value’s own fields (dag-json); the envelope is added here')
    .option('-s, --schema <ref>', 'A signed-blob schema (extends hypermedia-blob); the type tag comes from it')
    .option('-t, --type <tag>', 'The `type` tag, when the schema does not pin one (or there is no schema)')
    .option('--ts <ms>', 'Timestamp (unix ms; default: now)')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .option('--force', 'Publish even when the signed blob violates the schema')
    .option('--dry-run', 'Print the signed blob (dag-json) and its CID without publishing')
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        const client = getClient(globalOpts)
        const body = readJsonFile(options.file)
        if (!isPlainMap(body)) fail(`${options.file} must hold a map (the blob’s fields)`)
        for (const k of ['signer', 'sig', 'ts'] as const) {
          if (k in body) fail(`${options.file} already has "${k}": the envelope is filled at signing, leave it out`)
        }
        const loaded = options.schema ? await loadSchema(client, options.schema) : null
        const pinned = loaded ? signedBlobTypeTag(loaded.schema, loaded.registry) : undefined
        if (options.type && pinned && options.type !== pinned) {
          fail(`--type ${options.type} disagrees with the schema, which pins type "${pinned}"`)
        }
        const typeTag: string | undefined =
          options.type ?? pinned ?? (typeof body.type === 'string' ? body.type : undefined)
        const key = await resolveSigningKey(options.key, keyOptions(globalOpts))
        const signer = createSignerFromKey(key)
        const ts = options.ts !== undefined ? Number(options.ts) : undefined
        if (ts !== undefined && !Number.isFinite(ts)) fail(`--ts must be a number of milliseconds, got ${options.ts}`)

        const {type: _bodyType, ...fields} = body
        const signed = await signBlob(signer, typeTag ? fields : body, {typeTag, ts})
        const value = ipldToDagJson(cbor.decode(signed.data)) as Record<string, unknown>
        if (loaded) {
          const errors = violations(loaded.schema, value, loaded.registry)
          if (errors.length) {
            printError(
              `The signed blob does not conform to ${loaded.source} (${errors.length} violation${
                errors.length === 1 ? '' : 's'
              }):`,
            )
            printViolations(errors)
            if (!options.force) {
              printInfo('Fix the fields, or pass --force to publish it anyway.')
              process.exit(1)
            }
          }
        }
        if (options.dryRun) {
          console.log(
            formatOutput({cid: `ipfs://${signed.cid}`, signer: key.accountId, value}, 'json', isPretty(globalOpts)),
          )
          return
        }
        const result = await publishSignedBlob(client, signer, typeTag ? fields : body, {typeTag, ts: signed.ts})
        if (globalOpts.quiet) console.log(`ipfs://${result.cid}`)
        else
          printSuccess(
            `Signed by ${key.accountId} and published ipfs://${result.cid}${typeTag ? ` (type ${typeTag})` : ''}`,
          )
      } catch (error) {
        fail((error as Error).message)
      }
    })

  blob
    .command('verify <cid>')
    .description('Check a blob’s signature (when it carries the signed envelope) and its schema')
    .option('-s, --schema <ref>', 'Schema to validate against (default: the blob’s own schema link, if any)')
    .action(async (cidArg: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        const client = getClient(globalOpts)
        const cid = cidArg.replace(/^ipfs:\/\//, '')
        const value = await fetchBlobValue(client, cid)
        if (value === undefined) fail(`No blob at ${cid}`)
        const report: Record<string, unknown> = {cid: `ipfs://${cid}`}
        let ok = true
        if (hasSignedEnvelope(value)) {
          const check = await verifySignedBlob(value)
          report.signature = check
          ok = ok && check.ok
          if (!globalOpts.json && !globalOpts.yaml) {
            if (check.ok)
              printSuccess(
                `Signature valid: signed by ${check.signer}${
                  check.ts ? ` at ${new Date(check.ts).toISOString()}` : ''
                }`,
              )
            else
              printError(
                `Signature INVALID (${check.reason ?? 'unknown'})${
                  check.signer ? `; claimed signer ${check.signer}` : ''
                }`,
              )
          }
        } else {
          report.signature = null
          if (!globalOpts.json && !globalOpts.yaml) printInfo('Not a signed blob (no signer/sig/ts envelope)')
        }
        const ref = options.schema ?? blobSchemaRef(value)
        if (ref) {
          const loaded = await loadSchema(client, ref)
          const errors = violations(loaded.schema, withoutSchemaLink(value), loaded.registry)
          report.schema = {ref, source: loaded.source, violations: errors}
          ok = ok && errors.length === 0
          if (!globalOpts.json && !globalOpts.yaml) {
            if (errors.length) {
              printError(
                `Does not conform to ${loaded.source} (${errors.length} violation${errors.length === 1 ? '' : 's'}):`,
              )
              printViolations(errors)
            } else printSuccess(`Conforms to ${loaded.source}`)
          }
        } else {
          report.schema = null
          if (!globalOpts.json && !globalOpts.yaml)
            printInfo('No schema to check (pass --schema, or a blob with a schema link)')
        }
        report.ok = ok
        if (globalOpts.json || globalOpts.yaml)
          console.log(formatOutput(report, getOutputFormat(globalOpts), isPretty(globalOpts)))
        if (!ok) process.exit(1)
      } catch (error) {
        fail((error as Error).message)
      }
    })
}
