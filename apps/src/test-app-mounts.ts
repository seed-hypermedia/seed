import type {Database} from 'bun:sqlite'
import * as cbor from '@/cbor'
import type {AppSnapshot} from '@/app-mounts'

/**
 * Test fixture: the Datalab converter mounted the way a pass over the mount documents would mount
 * it, without the network. Detection itself is covered in app-mounts.test.ts; the tests that need
 * a working `convert` seed these rows and get on with it.
 */

/** Stand-ins for the tool page's references: a raw file for the code, DAG-CBOR objects for the schemas. */
export const CONVERT_TEST_CODE_CID = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
export const CONVERT_TEST_INPUT_CID = 'bafyreihtfb2u3l5v2z2jtyoalbquk5rrvknmgtixwnpwp2dkt2ysntfw3u'

/** The converter app as a pass would snapshot it: enough for the projection and the sandbox run. */
export const CONVERT_SNAPSHOT: AppSnapshot = {
  slug: 'convert',
  name: 'Datalab converter',
  summary: 'Converts documents from agent memory into markdown.',
  arguments: {
    apiKey: {type: 'string', secret: true, required: true, order: 1},
    mode: {type: 'string', secret: false, required: false, order: 2},
  },
  permissions: {},
  network: {datalab: 'www.datalab.to'},
  usage: {meter: 'per-unit', unit: 'pages', period: 'month', callCap: 200},
  skillDoc: 'Review seed.md before publishing.',
  tools: [
    {
      tool: 'convert',
      summary: 'Convert documents from memory.',
      runtime: 'ts',
      timeoutSecs: 1800,
      input: {
        type: 'object',
        properties: {files: {type: 'array', items: {type: 'string'}}},
        required: ['files'],
        additionalProperties: false,
      },
      inputSchema: `ipfs://${CONVERT_TEST_INPUT_CID}`,
      code: {url: `ipfs://${CONVERT_TEST_CODE_CID}`, cid: CONVERT_TEST_CODE_CID, entry: 'index.ts'},
      instructions: 'Pass memory paths in `files`.',
    },
  ],
}

/**
 * Mounts the converter: a server-wide row (the shared key, with the allowance and ceiling the
 * operator's page sets), or a space's own row paired with the secret it keeps its key under.
 */
export function mountConvert(
  db: Database,
  options: {accountId?: string; secret?: string; allowance?: number; ceiling?: number} = {},
) {
  const now = Date.now()
  const accountId = options.accountId ?? ''
  const mountId = accountId ? `hm://${accountId}/apps/convert` : 'hm://operator/apps/convert'
  const usage = accountId ? null : {allowance: options.allowance ?? 1000, ceiling: options.ceiling ?? 20000}
  db.run(
    `INSERT OR REPLACE INTO app_mounts (account_id, scope, slug, mount_id, bundle_id, version, snapshot_cbor, args_cbor, secret_refs_cbor, usage_cbor, status_cbor, created_at, updated_at)
     VALUES (?, ?, 'convert', ?, 'hm://docs/agent/apps/convert', 'v1', ?, ?, ?, ?, ?, ?, ?)`,
    [
      accountId,
      accountId ? 'space' : 'server',
      mountId,
      cbor.encode(CONVERT_SNAPSHOT),
      cbor.encode({}),
      cbor.encode(options.secret ? {apiKey: options.secret} : {}),
      usage ? cbor.encode(usage) : null,
      cbor.encode({state: 'ok', checkedAt: now}),
      now,
      now,
    ],
  )
}
