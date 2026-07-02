import type {PlainJsonSchema} from '@shm/ui/blob-schema-compile'
import {pluginToolName, type PluginManifest} from '@shm/ui/plugin-manifest'

/**
 * Serializable descriptor for one plugin action exposed as an assistant tool
 * (see docs/plugins/design.md §5). Built renderer-side (where manifests and
 * schemas live) and shipped to the main process, which registers them as extra
 * `streamText` tools whose execution round-trips back to the sandbox.
 */
export type PluginToolDescriptor = {
  toolName: string
  pluginCid: string
  actionName: string
  description: string
  /** LLM-facing input schema, already lowered from the blob-schema dialect. */
  inputSchema: PlainJsonSchema
}

// Action descriptions become model-facing prompt text (a prompt-injection
// surface), so cap them the same way the manifest validator does.
const DESCRIPTION_MAX_LENGTH = 1024

function capDescription(text: string): string {
  return text.length > DESCRIPTION_MAX_LENGTH ? text.slice(0, DESCRIPTION_MAX_LENGTH) : text
}

/** One enabled, valid plugin with its actions' compiled input schemas by name. */
export type PluginToolSource = {
  cid: string
  manifest: PluginManifest
  /** actionName → compiled input schema; missing/undefined → an empty object input. */
  inputSchemas: Record<string, PlainJsonSchema | undefined>
}

/**
 * Flatten enabled plugins into per-action tool descriptors. Pure: the caller
 * has already filtered to enabled+valid plugins and compiled the input schemas.
 * Duplicate tool names (same plugin+action across sources) are dropped after
 * the first, so registration is deterministic.
 */
export function buildPluginToolDescriptors(sources: PluginToolSource[]): PluginToolDescriptor[] {
  const descriptors: PluginToolDescriptor[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    for (const action of source.manifest.actions) {
      const toolName = pluginToolName(source.manifest.name, action.name)
      if (seen.has(toolName)) continue
      seen.add(toolName)
      const description = capDescription(action.description ?? action.title ?? action.name)
      // A permissive object input keeps the tool callable while its real schema
      // is still loading (the caller re-registers once the registry converges).
      const inputSchema = source.inputSchemas[action.name] ?? {type: 'object'}
      descriptors.push({toolName, pluginCid: source.cid, actionName: action.name, description, inputSchema})
    }
  }
  return descriptors
}
