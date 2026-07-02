import * as cbor from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {describe, expect, test} from 'vitest'
import {BLOB_META_SCHEMA_CID} from '../blob-schema'
import {dagJsonToIpld} from '../dag-json'
import {
  isPluginManifest,
  parsePluginToolName,
  PLUGIN_MANIFEST_SCHEMA,
  PLUGIN_MANIFEST_SCHEMA_CID,
  PLUGIN_PERMISSION_LABELS,
  PLUGIN_PERMISSIONS,
  pluginToolName,
  validatePluginManifest,
} from '../plugin-manifest'

// A DAG-CBOR (0x71) CID and a raw (0x55) CID, for codec-specific checks.
const CBOR_CID = 'bafyreigu5vewjq63sy3t2spkkpmchine3vo3jnuuvntx7ig4oef7hafuka'
const CBOR_CID_2 = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const RAW_CID = 'bafkreidvwvig4vhsdqmlhwe6t55mlttj5h7tenqy5xhcipwx5gyp6ejhly'

// A minimal valid manifest builder.
function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    schema: {'/': PLUGIN_MANIFEST_SCHEMA_CID},
    name: 'word-count',
    code: {'/': RAW_CID},
    actions: [{name: 'count_words', input: {'/': CBOR_CID}, output: {'/': CBOR_CID_2}}],
    ...overrides,
  }
}

function errorsOf(value: unknown): string[] {
  const result = validatePluginManifest(value)
  return 'errors' in result ? result.errors : []
}

describe('validatePluginManifest — happy path', () => {
  test('accepts a minimal well-formed manifest', () => {
    const result = validatePluginManifest(validManifest())
    expect('manifest' in result).toBe(true)
    if ('manifest' in result) expect(result.manifest.name).toBe('word-count')
  })

  test('accepts optional title/description/version/permissions and extra keys', () => {
    const result = validatePluginManifest(
      validManifest({
        title: 'Word Count',
        description: 'Counts words.',
        version: '1.0.0',
        permissions: ['document:read'],
        author: 'someone', // unknown extra key is allowed
      }),
    )
    expect('manifest' in result).toBe(true)
  })

  test('actions may omit input/output', () => {
    const result = validatePluginManifest(validManifest({actions: [{name: 'run'}]}))
    expect('manifest' in result).toBe(true)
  })
})

describe('validatePluginManifest — shape', () => {
  test('rejects non-objects, links, and bytes forms', () => {
    expect(errorsOf(null)).toContain('manifest must be a plain object')
    expect(errorsOf([])).toContain('manifest must be a plain object')
    expect(errorsOf('str')).toContain('manifest must be a plain object')
    expect(errorsOf({'/': CBOR_CID})).toContain('manifest must be a plain object')
    expect(errorsOf({'/': {bytes: 'AQID'}})).toContain('manifest must be a plain object')
  })
})

describe('validatePluginManifest — schema link', () => {
  test('rejects a wrong or missing schema CID and names the expected one', () => {
    const errs = errorsOf(validManifest({schema: {'/': BLOB_META_SCHEMA_CID}}))
    expect(errs.some((e) => e.includes(PLUGIN_MANIFEST_SCHEMA_CID))).toBe(true)
    expect(errorsOf(validManifest({schema: undefined})).some((e) => e.includes('schema'))).toBe(true)
    expect(errorsOf(validManifest({schema: 'not-a-link'})).some((e) => e.includes('schema'))).toBe(true)
  })
})

describe('validatePluginManifest — name', () => {
  test('requires a name', () => {
    expect(errorsOf(validManifest({name: undefined}))).toContain('name is required and must be a string')
    expect(errorsOf(validManifest({name: 123}))).toContain('name is required and must be a string')
  })

  test('rejects names that break the pattern', () => {
    expect(errorsOf(validManifest({name: 'Word_Count'})).some((e) => e.includes('must match'))).toBe(true)
    expect(errorsOf(validManifest({name: '-lead'})).some((e) => e.includes('must match'))).toBe(true)
    expect(errorsOf(validManifest({name: 'has space'})).some((e) => e.includes('must match'))).toBe(true)
  })

  test('accepts hyphenated names, rejects over-length', () => {
    expect('manifest' in validatePluginManifest(validManifest({name: 'a-b-c-123'}))).toBe(true)
    const long = 'a'.repeat(65)
    expect(errorsOf(validManifest({name: long})).some((e) => e.includes('at most 64'))).toBe(true)
  })
})

describe('validatePluginManifest — code', () => {
  test('requires a code link with a valid CID (any codec)', () => {
    expect(errorsOf(validManifest({code: undefined})).some((e) => e.includes('code'))).toBe(true)
    expect(errorsOf(validManifest({code: 'nope'})).some((e) => e.includes('code'))).toBe(true)
    expect(errorsOf(validManifest({code: {'/': 'not-a-cid'}})).some((e) => e.includes('code'))).toBe(true)
    // a DAG-CBOR CID is also fine for code (any codec allowed)
    expect('manifest' in validatePluginManifest(validManifest({code: {'/': CBOR_CID}}))).toBe(true)
  })
})

describe('validatePluginManifest — permissions', () => {
  test('accepts the full vocabulary', () => {
    expect('manifest' in validatePluginManifest(validManifest({permissions: [...PLUGIN_PERMISSIONS]}))).toBe(true)
  })

  test('rejects unknown permissions and lists the vocabulary', () => {
    const errs = errorsOf(validManifest({permissions: ['document:read', 'network:fetch']}))
    expect(errs.some((e) => e.includes('network:fetch') && e.includes('document:read'))).toBe(true)
  })

  test('rejects a non-array permissions value', () => {
    expect(errorsOf(validManifest({permissions: 'document:read'}))).toContain('permissions must be an array')
  })
})

describe('validatePluginManifest — actions', () => {
  test('requires a non-empty array', () => {
    expect(errorsOf(validManifest({actions: undefined}))).toContain('actions is required and must be a non-empty array')
    expect(errorsOf(validManifest({actions: []}))).toContain('actions is required and must be a non-empty array')
  })

  test('each action needs a name matching the pattern', () => {
    expect(errorsOf(validManifest({actions: [{}]})).some((e) => e.includes('actions[0].name'))).toBe(true)
    expect(errorsOf(validManifest({actions: [{name: 'Bad-Name'}]})).some((e) => e.includes('must match'))).toBe(true)
    expect('manifest' in validatePluginManifest(validManifest({actions: [{name: 'ok_1'}]}))).toBe(true)
  })

  test('rejects duplicate action names', () => {
    const errs = errorsOf(validManifest({actions: [{name: 'go'}, {name: 'go'}]}))
    expect(errs).toContain('duplicate action name "go"')
  })

  test('input/output must be DAG-CBOR links when present', () => {
    expect(
      errorsOf(validManifest({actions: [{name: 'go', input: {'/': RAW_CID}}]})).some((e) =>
        e.includes('input must be a link to a DAG-CBOR'),
      ),
    ).toBe(true)
    expect(
      errorsOf(validManifest({actions: [{name: 'go', output: 'nope'}]})).some((e) =>
        e.includes('output must be a link to a DAG-CBOR'),
      ),
    ).toBe(true)
  })

  test('caps action description length', () => {
    const long = 'x'.repeat(1025)
    expect(
      errorsOf(validManifest({actions: [{name: 'go', description: long}]})).some((e) =>
        e.includes('actions[0].description must be at most 1024'),
      ),
    ).toBe(true)
  })

  test('non-object action entries are reported', () => {
    expect(errorsOf(validManifest({actions: ['nope']}))).toContain('actions[0] must be an object')
  })
})

describe('validatePluginManifest — description cap', () => {
  test('caps the top-level description at 1024 chars', () => {
    const long = 'y'.repeat(1025)
    expect(errorsOf(validManifest({description: long})).some((e) => e.includes('at most 1024'))).toBe(true)
  })
})

describe('isPluginManifest', () => {
  test('true only when schema links the manifest schema CID', () => {
    expect(isPluginManifest({schema: {'/': PLUGIN_MANIFEST_SCHEMA_CID}})).toBe(true)
    expect(isPluginManifest({schema: {'/': BLOB_META_SCHEMA_CID}})).toBe(false)
    expect(isPluginManifest({schema: 'nope'})).toBe(false)
    expect(isPluginManifest(null)).toBe(false)
    expect(isPluginManifest([{schema: {'/': PLUGIN_MANIFEST_SCHEMA_CID}}])).toBe(false)
  })
})

describe('permission vocabulary', () => {
  test('every permission has a label', () => {
    for (const perm of PLUGIN_PERMISSIONS) {
      expect(typeof PLUGIN_PERMISSION_LABELS[perm]).toBe('string')
    }
  })
})

describe('pluginToolName / parsePluginToolName', () => {
  test('round-trips', () => {
    const name = pluginToolName('word-count', 'count_words')
    expect(name).toBe('plugin_word-count__count_words')
    expect(parsePluginToolName(name)).toEqual({pluginName: 'word-count', actionName: 'count_words'})
  })

  test('returns null for non-plugin or malformed names', () => {
    expect(parsePluginToolName('read_document')).toBeNull()
    expect(parsePluginToolName('plugin_')).toBeNull()
    expect(parsePluginToolName('plugin_word-count')).toBeNull()
    expect(parsePluginToolName('plugin___count')).toBeNull() // empty plugin name
    expect(parsePluginToolName('plugin_Bad__x')).toBeNull() // invalid plugin name
    expect(parsePluginToolName('plugin_x__Bad-Action')).toBeNull() // invalid action name
  })
})

describe('PLUGIN_MANIFEST_SCHEMA', () => {
  test('PLUGIN_MANIFEST_SCHEMA_CID matches the freshly computed CID', async () => {
    const data = cbor.encode(dagJsonToIpld(PLUGIN_MANIFEST_SCHEMA))
    const digest = await sha256.digest(data)
    const cid = CID.createV1(0x71, digest).toString()
    expect(cid).toBe(PLUGIN_MANIFEST_SCHEMA_CID)
  })

  test('carries a schema link to the meta-schema (unlike the meta-schema itself)', () => {
    expect(PLUGIN_MANIFEST_SCHEMA.schema).toEqual({'/': BLOB_META_SCHEMA_CID})
  })

  test('requires name, code, and actions', () => {
    expect(PLUGIN_MANIFEST_SCHEMA.required).toEqual(['name', 'code', 'actions'])
  })
})
