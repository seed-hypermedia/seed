import {BLOB_META_SCHEMA_CID, type BlobSchema} from './blob-schema'
import {type DagJsonLink, isDagJsonBytes, isDagJsonLink, parseCidString} from './dag-json'

/**
 * Pure core for the plugin manifest blob (see docs/plugins/design.md §1). A
 * plugin is a set of content-addressed blobs; the manifest (DAG-CBOR) links its
 * code blob and per-action input/output schema blobs, declares a permission set
 * from a fixed vocabulary, and is itself an instance of the published
 * PLUGIN_MANIFEST_SCHEMA. No React, no IO — advisory validation (precise
 * human-readable errors, never throws) plus the deterministic tool-name mapping.
 */

// The fixed, versioned permission vocabulary (design §4). Anything outside this
// set is rejected by validatePluginManifest — the bridge enforces per method.
export type PluginPermission = 'document:read' | 'document:write' | 'blob:read' | 'blob:write'

export const PLUGIN_PERMISSIONS: PluginPermission[] = ['document:read', 'document:write', 'blob:read', 'blob:write']

// Short human descriptions, surfaced at install time so a user can judge a grant.
export const PLUGIN_PERMISSION_LABELS: Record<PluginPermission, string> = {
  'document:read': 'Read the current document (metadata and content).',
  'document:write': 'Stage metadata changes into the current draft (you still publish).',
  'blob:read': 'Fetch any IPFS blob by CID.',
  'blob:write': 'Publish new IPFS blobs.',
}

export type PluginAction = {
  name: string
  title?: string
  description?: string
  input?: DagJsonLink
  output?: DagJsonLink
}

export type PluginManifest = {
  schema: DagJsonLink
  name: string
  title?: string
  description?: string
  version?: string
  permissions?: PluginPermission[]
  code: DagJsonLink
  actions: PluginAction[]
  // Unknown extra keys are legal (annotation semantics, like the blob dialect).
  [k: string]: unknown
}

// Plugin and action name shapes. Plugin names allow hyphens (npm-ish, they show
// in URLs/UI); action names allow underscores (they become tool-name segments,
// where a hyphen would be ambiguous against the `__` action separator).
const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const ACTION_NAME_PATTERN = /^[a-z0-9][a-z0-9_]*$/
const NAME_MAX_LENGTH = 64

// Descriptions become model-facing prompt text once merged into agent tools
// (design §4 trust note): a prompt-injection surface, so length-capped.
const DESCRIPTION_MAX_LENGTH = 1024

// The DAG-CBOR multicodec code — input/output schema blobs are always DAG-CBOR.
// The code blob is a raw JS file, so any codec is allowed for `code`.
const DAG_CBOR_CODE = 0x71

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

// A real object value, not one of the two DAG-JSON kind forms.
function isPlainObjectValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !isDagJsonLink(value) && !isDagJsonBytes(value)
}

/**
 * The plugin manifest blob schema, published so the schema/metadata/blob editors
 * can author and validate manifests — the same dogfooding as the meta-schema.
 * Unlike the meta-schema (which can't name its own CID), this schema DOES carry
 * a `schema` link because it's an instance of the blob meta-schema and doesn't
 * reference itself.
 */
export const PLUGIN_MANIFEST_SCHEMA: BlobSchema = {
  schema: {'/': BLOB_META_SCHEMA_CID},
  title: 'Plugin Manifest',
  description: 'A Seed plugin manifest: links the code blob and per-action schemas, declares permissions.',
  type: 'object',
  properties: {
    name: {
      type: 'string',
      title: 'Name',
      description: 'Machine name (lowercase, digits, hyphens).',
      pattern: '^[a-z0-9][a-z0-9-]*$',
      maxLength: NAME_MAX_LENGTH,
    },
    title: {type: 'string', title: 'Title', description: 'Human-facing plugin name.'},
    description: {
      type: 'string',
      title: 'Description',
      description: 'What the plugin does. Shown at install time.',
      maxLength: DESCRIPTION_MAX_LENGTH,
    },
    version: {type: 'string', title: 'Version', description: 'A version string (e.g. 1.0.0).'},
    permissions: {
      type: 'array',
      title: 'Permissions',
      description: 'Capabilities the plugin needs, granted at install time.',
      items: {type: 'string', enum: [...PLUGIN_PERMISSIONS]},
    },
    code: {kind: 'link', title: 'Code', description: 'Link to the raw JavaScript code blob.'},
    actions: {
      type: 'array',
      title: 'Actions',
      description: 'The actions this plugin exposes.',
      items: {
        type: 'object',
        title: 'Action',
        properties: {
          name: {
            type: 'string',
            title: 'Name',
            description: 'Machine name (lowercase, digits, underscores).',
            pattern: '^[a-z0-9][a-z0-9_]*$',
            maxLength: NAME_MAX_LENGTH,
          },
          title: {type: 'string', title: 'Title', description: 'Human-facing action name.'},
          description: {
            type: 'string',
            title: 'Description',
            description: 'What the action does. Becomes model-facing tool text.',
            maxLength: DESCRIPTION_MAX_LENGTH,
          },
          input: {kind: 'link', title: 'Input schema', description: 'Link to the input Blob Schema.'},
          output: {kind: 'link', title: 'Output schema', description: 'Link to the output Blob Schema.'},
        },
        required: ['name'],
        additionalProperties: true,
      },
    },
  },
  required: ['name', 'code', 'actions'],
  additionalProperties: true,
}

/**
 * CIDv1 (dag-cbor 0x71, sha2-256) of the canonical DAG-CBOR encoding of
 * PLUGIN_MANIFEST_SCHEMA. Precomputed and hardcoded; plugin-manifest.test.ts
 * re-derives it from PLUGIN_MANIFEST_SCHEMA and asserts equality so it can
 * never silently drift.
 */
export const PLUGIN_MANIFEST_SCHEMA_CID = 'bafyreihqfltqulazz4erxr37nel6exe34fknmyrb26fixzzsimuhdwdqta'

/**
 * Cheap check mirroring isSchemaBlob: a plain object whose reserved `schema`
 * key links the plugin-manifest schema CID. Does not validate the contents.
 */
export function isPluginManifest(value: unknown): boolean {
  if (!isRecord(value)) return false
  const link = value.schema
  return isDagJsonLink(link) && link['/'] === PLUGIN_MANIFEST_SCHEMA_CID
}

// A DAG-JSON link whose CID parses; optionally pinned to a specific codec.
function linkCid(value: unknown, requireCode?: number): {cid: string} | undefined {
  if (!isDagJsonLink(value)) return undefined
  const parsed = parseCidString(value['/'])
  if (!parsed) return undefined
  if (requireCode !== undefined && parsed.code !== requireCode) return undefined
  return {cid: value['/']}
}

function validateAction(action: unknown, index: number, errors: string[], seen: Set<string>): void {
  const where = `actions[${index}]`
  if (!isPlainObjectValue(action)) {
    errors.push(`${where} must be an object`)
    return
  }
  const name = action.name
  if (typeof name !== 'string' || name.length === 0) {
    errors.push(`${where}.name is required and must be a string`)
  } else {
    if (!ACTION_NAME_PATTERN.test(name))
      errors.push(`${where}.name "${name}" must match ${ACTION_NAME_PATTERN.source} (lowercase, digits, underscores)`)
    if (name.length > NAME_MAX_LENGTH) errors.push(`${where}.name must be at most ${NAME_MAX_LENGTH} characters`)
    if (seen.has(name)) errors.push(`duplicate action name "${name}"`)
    seen.add(name)
  }
  if (action.description !== undefined) {
    if (typeof action.description !== 'string') errors.push(`${where}.description must be a string`)
    else if (action.description.length > DESCRIPTION_MAX_LENGTH)
      errors.push(`${where}.description must be at most ${DESCRIPTION_MAX_LENGTH} characters`)
  }
  for (const field of ['input', 'output'] as const) {
    if (action[field] === undefined) continue
    if (!linkCid(action[field], DAG_CBOR_CODE))
      errors.push(`${where}.${field} must be a link to a DAG-CBOR (0x71) schema blob`)
  }
}

/**
 * Advisory validation of an untrusted manifest value. Never throws; returns
 * either the typed manifest or a list of precise, human-readable errors.
 * Unknown extra keys are allowed (annotation semantics). See design §1.
 */
export function validatePluginManifest(value: unknown): {manifest: PluginManifest} | {errors: string[]} {
  const errors: string[] = []

  if (!isPlainObjectValue(value)) {
    return {errors: ['manifest must be a plain object']}
  }

  if (!isDagJsonLink(value.schema) || value.schema['/'] !== PLUGIN_MANIFEST_SCHEMA_CID) {
    errors.push(`schema must be a link to the plugin manifest schema (${PLUGIN_MANIFEST_SCHEMA_CID})`)
  }

  const name = value.name
  if (typeof name !== 'string' || name.length === 0) {
    errors.push('name is required and must be a string')
  } else {
    if (!PLUGIN_NAME_PATTERN.test(name))
      errors.push(`name "${name}" must match ${PLUGIN_NAME_PATTERN.source} (lowercase, digits, hyphens)`)
    if (name.length > NAME_MAX_LENGTH) errors.push(`name must be at most ${NAME_MAX_LENGTH} characters`)
  }

  if (value.description !== undefined) {
    if (typeof value.description !== 'string') errors.push('description must be a string')
    else if (value.description.length > DESCRIPTION_MAX_LENGTH)
      errors.push(`description must be at most ${DESCRIPTION_MAX_LENGTH} characters`)
  }

  if (!linkCid(value.code)) {
    errors.push('code must be a link to the raw JavaScript code blob')
  }

  if (value.permissions !== undefined) {
    if (!Array.isArray(value.permissions)) {
      errors.push('permissions must be an array')
    } else {
      const vocab = PLUGIN_PERMISSIONS.join(', ')
      for (const perm of value.permissions) {
        if (typeof perm !== 'string' || !(PLUGIN_PERMISSIONS as string[]).includes(perm))
          errors.push(`unknown permission ${JSON.stringify(perm)} (valid: ${vocab})`)
      }
    }
  }

  if (!Array.isArray(value.actions) || value.actions.length === 0) {
    errors.push('actions is required and must be a non-empty array')
  } else {
    const seen = new Set<string>()
    value.actions.forEach((action, index) => validateAction(action, index, errors, seen))
  }

  if (errors.length > 0) return {errors}
  return {manifest: value as PluginManifest}
}

// ---------------------------------------------------------------------------
// Tool naming
// ---------------------------------------------------------------------------

// Namespaced so plugin actions can never collide with the compile-time tool
// registry names. The double underscore separates plugin from action; plugin
// names forbid underscores and action names forbid hyphens, so the split back
// out is unambiguous.
const TOOL_NAME_PREFIX = 'plugin_'
const TOOL_NAME_SEPARATOR = '__'

/** The agent tool name for a plugin action: `plugin_<pluginName>__<actionName>`. */
export function pluginToolName(pluginName: string, actionName: string): string {
  return `${TOOL_NAME_PREFIX}${pluginName}${TOOL_NAME_SEPARATOR}${actionName}`
}

/** Inverse of pluginToolName. Returns null for any name not in that exact shape. */
export function parsePluginToolName(toolName: string): {pluginName: string; actionName: string} | null {
  if (!toolName.startsWith(TOOL_NAME_PREFIX)) return null
  const rest = toolName.slice(TOOL_NAME_PREFIX.length)
  const separator = rest.indexOf(TOOL_NAME_SEPARATOR)
  if (separator <= 0) return null
  const pluginName = rest.slice(0, separator)
  const actionName = rest.slice(separator + TOOL_NAME_SEPARATOR.length)
  if (!PLUGIN_NAME_PATTERN.test(pluginName) || !ACTION_NAME_PATTERN.test(actionName)) return null
  return {pluginName, actionName}
}
