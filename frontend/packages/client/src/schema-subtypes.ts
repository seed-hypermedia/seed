// The subtype closure of a schema: the schema itself and every schema whose extension chain
// reaches it. A reference field with a `target` (`{type: hm-url, target: <animal>}`) accepts a
// document typed by the target OR by any subtype of it, so a picker for that field searches
// `attributesSchema IN closure` and a value check tests membership in the same closure.
//
// Subtyping is nominal, by extension: `{type: <parent>, …refinements}` extends the parent and a
// bare `{type: <parent>}` includes it (hypermedia/schema/extension.md); an intersection
// `{allOf: [{type: A}, {type: B}]}` is a subtype of every arm (hypermedia/schema/allof.md). Structural conformance
// ("any document whose attributes happen to validate") would mean validating every candidate,
// which does not scale to a network search, so it is left to the advisory validator.
import {HM_SCHEMAS, kindOf, nameForCid, nameToUrl, schemaCid, type HypermediaSchema} from './schema-engine'
import {unpackHmId} from './hm-types'
import {classifyRef} from './schema-resolve'

/**
 * One key per schema, whatever spelling names it: a library name (`hm://hyper.media/x`, a legacy
 * authority, or its published CID), a raw blob CID, or a canonical document URL (any version,
 * gateway or `hm://` form). Null for a value that names no schema.
 */
export function schemaRefKey(ref: string | null | undefined): string | null {
  const cls = classifyRef(ref)
  switch (cls.kind) {
    case 'none':
      return null
    case 'hm-bundled':
      return `lib:${cls.name}`
    case 'cid': {
      const name = nameForCid(cls.cid)
      return name ? `lib:${name}` : `cid:${cls.cid}`
    }
    case 'hm-doc': {
      // Drop a version, block or fragment: the document is the schema's identity.
      const id = unpackHmId(cls.url)
      return id ? `hm://${id.uid}${id.path?.length ? `/${id.path.join('/')}` : ''}` : cls.url
    }
  }
}

/**
 * The schemas this schema extends or includes: its `type` when that names another schema rather
 * than a kind, or, for an intersection, every arm's parent. A union, a literal or a kind-grounded
 * node has no parent.
 */
export function extensionParentRefs(schema: HypermediaSchema | undefined): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return []
  const node = schema as {type?: unknown; allOf?: unknown}
  if (Array.isArray(node.allOf)) {
    const out: string[] = []
    for (const arm of node.allOf as HypermediaSchema[])
      for (const ref of extensionParentRefs(arm)) if (!out.includes(ref)) out.push(ref)
    return out
  }
  const type = node.type
  if (typeof type !== 'string' || !type) return []
  return kindOf(type) === type ? [type] : []
}

/** A schema the closure may include: every spelling that names it, and what it extends. */
export type SchemaCandidate = {
  /** Every reference string that names this schema (document URL, `ipfs://` CID, library URL). */
  refs: string[]
  /** The references this schema extends or includes: one for an extension, several for an intersection. */
  parents: string[]
}

/** The bundled library as candidates: each schema under its library URL and published CID. */
export function libraryCandidates(): SchemaCandidate[] {
  return Object.entries(HM_SCHEMAS).map(([name, schema]) => {
    const cid = schemaCid(name)
    const url = nameToUrl(name)
    return {
      refs: [...(url ? [url] : []), ...(cid ? [`ipfs://${cid}`] : [])],
      parents: extensionParentRefs(schema),
    }
  })
}

export type SubtypeClosure = {
  /** Normalized keys (`schemaRefKey`) of every schema in the closure. */
  keys: Set<string>
  /** Every spelling of every schema in the closure — what a stored `attributesSchema` may equal. */
  refs: string[]
}

/**
 * The target plus every candidate whose extension chain reaches it (through any arm of an
 * intersection), with every spelling of each collected. Candidates that merely re-spell a member (the target's own document and blob, say)
 * contribute their spellings too. Cycles and unresolvable parents are harmless: the loop only ever
 * adds, and stops when a pass adds nothing.
 */
export function closeOverSubtypes(target: string, candidates: SchemaCandidate[]): SubtypeClosure {
  const targetKey = schemaRefKey(target)
  const keys = new Set<string>()
  const refs: string[] = []
  const add = (ref: string, key: string) => {
    keys.add(key)
    if (!refs.includes(ref)) refs.push(ref)
  }
  if (!targetKey) return {keys, refs}
  add(target, targetKey)
  const keyed = candidates
    .map((candidate) => ({
      refs: candidate.refs
        .map((ref) => [ref, schemaRefKey(ref)] as const)
        .filter((pair): pair is readonly [string, string] => !!pair[1]),
      parentKeys: candidate.parents.map(schemaRefKey).filter((key): key is string => !!key),
    }))
    .filter((candidate) => candidate.refs.length > 0)
  let grew = true
  while (grew) {
    grew = false
    for (const candidate of keyed) {
      const known = candidate.refs.some(([, key]) => keys.has(key))
      const inherits = candidate.parentKeys.some((key) => keys.has(key))
      if (!known && !inherits) continue
      for (const [ref, key] of candidate.refs) {
        if (keys.has(key) && refs.includes(ref)) continue
        add(ref, key)
        grew = true
      }
    }
  }
  return {keys, refs}
}

/** Whether a document's effective attributes schema reference lies in the closure. */
export function inClosure(closure: SubtypeClosure | undefined, ref: string | null | undefined): boolean {
  const key = schemaRefKey(ref)
  return !!closure && !!key && closure.keys.has(key)
}
