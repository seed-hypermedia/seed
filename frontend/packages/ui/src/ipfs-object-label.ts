// What to call an `ipfs://` reference in a pill. A file is its CID. A DAG-CBOR
// object resolves further: a schema blob is named by its schema (`name`); an
// instance that links its schema (`schema: {"/": cid}`) is named by that type.
// Bundled library schemas resolve synchronously; anything else is fetched
// (react-query dedupes, so a page full of pills costs one request per CID).
import {useCID} from '@shm/shared/models/entity'
import {isDagJsonLink, parseCidString} from './dag-json'
import {isOnyxSchema, nameForCid, ONYX_SCHEMAS, schemaForCid} from './onyx/onyx-engine'
import {useOnyxSchemaRegistry} from './onyx/onyx-schema-registry-cid'

const DAG_CBOR_CODE = 0x71

export type IpfsObjectKind = 'file' | 'object' | 'schema' | 'instance'

export function shortCid(cid: string): string {
  return cid.length > 18 ? `${cid.slice(0, 9)}…${cid.slice(-6)}` : cid
}

function schemaName(schema: Record<string, any> | undefined, fallback: string): string {
  return schema && typeof schema.name === 'string' && schema.name ? schema.name : fallback
}

/** Resolve a pill label for an ipfs reference. `label` is always usable (falls back to the short CID). */
export function useIpfsObjectLabel(cid: string): {kind: IpfsObjectKind; label: string; title: string; named: boolean} {
  const isObject = parseCidString(cid)?.code === DAG_CBOR_CODE
  // Bundled schema CIDs need no fetch.
  const bundledName = isObject ? nameForCid(cid) : undefined
  const bundled = bundledName ? ONYX_SCHEMAS[bundledName] : undefined
  const blob = useCID(isObject && !bundled ? cid : undefined)
  const value = blob.data?.value as Record<string, any> | undefined
  const valueIsSchema = !!value && isOnyxSchema(value)
  const linkedSchemaCid =
    value && !valueIsSchema && isDagJsonLink(value.schema) && parseCidString(value.schema['/'])?.code === DAG_CBOR_CODE
      ? (value.schema['/'] as string)
      : undefined
  const registry = useOnyxSchemaRegistry(linkedSchemaCid && !schemaForCid(linkedSchemaCid) ? [linkedSchemaCid] : [])
  const linkedSchema = linkedSchemaCid ? schemaForCid(linkedSchemaCid) ?? registry.byCid[linkedSchemaCid] : undefined

  const title = `ipfs://${cid}`
  // Unnamed targets show the whole CID (CSS-truncated) — a 9…6 excerpt says nothing.
  if (!isObject) return {kind: 'file', label: cid, title, named: false}
  if (bundled)
    return {kind: 'schema', label: schemaName(bundled, bundledName!), title: `${title} — schema`, named: true}
  if (valueIsSchema)
    return {kind: 'schema', label: schemaName(value, 'Schema'), title: `${title} — schema`, named: true}
  if (linkedSchemaCid)
    return {
      kind: 'instance',
      label: linkedSchema ? schemaName(linkedSchema, cid) : cid,
      title: `${title} — a ${linkedSchema ? schemaName(linkedSchema, 'typed object') : 'typed object'}`,
      named: !!linkedSchema,
    }
  return {kind: 'object', label: cid, title, named: false}
}
