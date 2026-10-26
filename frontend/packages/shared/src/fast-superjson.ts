import {serialize as superjsonSerialize, type SuperJSONResult} from 'superjson'

/**
 * Drop-in replacement for superjson's `serialize` for server responses: same
 * output (json, meta.values, meta.referentialEqualities), much less work.
 *
 * superjson's walker copies the current path and ancestor list into fresh
 * arrays at every node, scans the ancestor list linearly, and re-prefixes every
 * annotation at every level on the way back up. On the web server that was
 * ~10% of the CPU of a document render (plus the garbage it leaves for the GC),
 * for payloads that are plain JSON trees with a few bigints, Dates and
 * undefineds. This walks the tree once, building annotation paths top-down.
 *
 * Only the value kinds daemon payloads contain take the fast path: plain
 * objects, arrays, strings, booleans, null, finite numbers, undefined, bigint
 * and valid Dates. Anything else (Map, Set, class instances, NaN, -0, cycles,
 * sparse arrays, prototype-pollution keys, …) hands the whole value to
 * superjson itself, so the output is always exactly what superjson produces.
 */
export function serializeSuperJSON(value: unknown): SuperJSONResult {
  try {
    return fastSerialize(value)
  } catch (e) {
    if (e === BAIL) return superjsonSerialize(value)
    throw e
  }
}

const BAIL = new Error('fast-superjson: unsupported value')

type IdentityRecord = {
  /** Escaped dotted path of the first occurrence ('' for the root) and its segment count. */
  path: string
  depth: number
  /** Later occurrences, in encounter order. */
  more?: {path: string; depth: number}[]
  /** For containers: the serialized value, once its walk has finished. */
  json?: unknown
  done?: boolean
  /** This container's annotations (a snapshot: ancestors reorder the global list
   * later), and the length of its path prefix in them. */
  annotations?: {paths: string[]; types: string[]; depths: number[]; indexKeys: number[]}
  prefixLen?: number
}

/** The key as an array index if the engine orders it as one, else -1. */
function indexKey(key: string): number {
  const c = key.charCodeAt(0)
  if (!(c >= 48 && c <= 57)) return -1
  if (key.length > 1 && c === 48) return -1
  for (let i = 1; i < key.length; i++) {
    const d = key.charCodeAt(i)
    if (d < 48 || d > 57) return -1
  }
  const n = Number(key)
  return n <= 4294967294 ? n : -1
}

function escapeKey(key: string): string {
  return key.indexOf('.') === -1 ? key : key.replace(/\./g, '\\.')
}

function fastSerialize(root: unknown): SuperJSONResult {
  const annPaths: string[] = []
  const annTypes: string[] = []
  // Per annotation: the depth of the value it annotates, and its key when that
  // key is an array index ("0", "17", …), else -1. See reorderIndexKeys.
  const annDepths: number[] = []
  const annIndexKeys: number[] = []

  function pushAnnotation(annPath: string, type: string, depth: number, key: string) {
    annPaths.push(annPath)
    annTypes.push(type)
    annDepths.push(depth)
    annIndexKeys.push(indexKey(key))
  }

  /**
   * superjson collects each container's annotations in a plain object keyed by
   * relative path, so the engine lists a direct child's annotation whose key is
   * an array index ("3") before every string key ("0.a", "name"), in ascending
   * order. Reproduce that order for the container whose annotations span
   * [start, end) and whose children sit at `childDepth`.
   */
  function reorderIndexKeys(start: number, end: number, childDepth: number) {
    let hoisted: number[] | undefined
    for (let i = start; i < end; i++) {
      if (annDepths[i] === childDepth && annIndexKeys[i]! >= 0) (hoisted ??= []).push(i)
    }
    if (!hoisted) return
    hoisted.sort((a, b) => annIndexKeys[a]! - annIndexKeys[b]!)
    const hoistedSet = new Set(hoisted)
    const order = [...hoisted]
    for (let i = start; i < end; i++) if (!hoistedSet.has(i)) order.push(i)
    for (const list of [annPaths, annTypes, annDepths, annIndexKeys] as unknown[][]) {
      const copy = order.map((i) => list[i])
      for (let i = 0; i < copy.length; i++) list[start + i] = copy[i]
    }
  }
  // Every non-primitive (in superjson's sense: objects, Dates and bigints) is
  // tracked by identity, in first-encounter order, like superjson does.
  const identities = new Map<unknown, IdentityRecord>()

  function addIdentity(value: unknown, path: string, depth: number): IdentityRecord | undefined {
    const existing = identities.get(value)
    if (existing) {
      if (existing.more) existing.more.push({path, depth})
      else existing.more = [{path, depth}]
      return existing
    }
    identities.set(value, {path, depth})
    return undefined
  }

  // `path` is the escaped dotted path of `value`. `annPath` is where a leaf's own
  // annotation goes: superjson escapes every segment of an annotation path
  // except a leaf's last one, so it is the parent's path plus the raw key.
  function walk(value: unknown, path: string, depth: number, annPath: string, key: string): unknown {
    switch (typeof value) {
      case 'string':
      case 'boolean':
        return value
      case 'number':
        if (value !== value || value === Infinity || value === -Infinity || (value === 0 && 1 / value < 0)) throw BAIL
        return value
      case 'undefined':
        pushAnnotation(annPath, 'undefined', depth, key)
        return null
      case 'bigint':
        addIdentity(value, path, depth)
        pushAnnotation(annPath, 'bigint', depth, key)
        return value.toString()
      case 'object': {
        if (value === null) return null
        if (value instanceof Date) {
          if (isNaN(value.valueOf())) throw BAIL
          addIdentity(value, path, depth)
          pushAnnotation(annPath, 'Date', depth, key)
          return value.toISOString()
        }
        const isArray = Array.isArray(value)
        if (!isArray) {
          const proto = Object.getPrototypeOf(value)
          if (proto !== Object.prototype && proto !== null) throw BAIL
        }
        const seen = addIdentity(value, path, depth)
        if (seen) {
          // A cycle: superjson replaces it with null. Leave that to superjson.
          if (!seen.done) throw BAIL
          // superjson reuses the first occurrence's result: the same json and
          // the same annotations, re-rooted at this path. It does not descend,
          // so the children get no identities at this path.
          const ann = seen.annotations
          if (ann) {
            for (let i = 0; i < ann.paths.length; i++) {
              const rest = ann.paths[i]!.slice(seen.prefixLen!)
              annPaths.push(depth === 0 ? rest : path + '.' + rest)
              annTypes.push(ann.types[i]!)
              annDepths.push(ann.depths[i]! - seen.depth + depth)
              annIndexKeys.push(ann.indexKeys[i]!)
            }
          }
          return seen.json
        }
        const record = identities.get(value)!
        const annStart = annPaths.length
        record.prefixLen = depth === 0 ? 0 : path.length + 1
        const childDepth = depth + 1
        let out: unknown
        // (record.depth is this first occurrence's depth, used when re-rooting duplicates.)
        if (isArray) {
          const arr = value as unknown[]
          const result: unknown[] = []
          for (let i = 0; i < arr.length; i++) {
            if (!(i in arr)) throw BAIL // sparse
            const key = String(i)
            const childPath = depth === 0 ? key : path + '.' + key
            result.push(walk(arr[i], childPath, childDepth, childPath, key))
          }
          out = result
        } else {
          const obj = value as Record<string, unknown>
          const result: Record<string, unknown> = {}
          const keys = Object.keys(obj)
          for (let i = 0; i < keys.length; i++) {
            const key = keys[i]!
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw BAIL
            const escaped = escapeKey(key)
            result[key] = walk(
              obj[key],
              depth === 0 ? escaped : path + '.' + escaped,
              childDepth,
              depth === 0 ? key : path + '.' + key,
              key,
            )
          }
          out = result
        }
        const annEnd = annPaths.length
        if (annEnd > annStart) {
          reorderIndexKeys(annStart, annEnd, childDepth)
          record.annotations = {
            paths: annPaths.slice(annStart, annEnd),
            types: annTypes.slice(annStart, annEnd),
            depths: annDepths.slice(annStart, annEnd),
            indexKeys: annIndexKeys.slice(annStart, annEnd),
          }
        }
        record.json = out
        record.done = true
        return out
      }
      default:
        // symbol, function
        throw BAIL
    }
  }

  const json = walk(root, '', 0, '', '')
  const res: SuperJSONResult = {json: json as SuperJSONResult['json']}

  if (annPaths.length) {
    const rootIsContainer = typeof root === 'object' && root !== null && !(root instanceof Date)
    if (!rootIsContainer) {
      // The root itself was transformed (e.g. serialize(undefined)).
      res.meta = {values: [annTypes[0]] as any}
    } else {
      const values: Record<string, [string]> = {}
      for (let i = 0; i < annPaths.length; i++) values[annPaths[i]!] = [annTypes[i]!]
      res.meta = {values: values as any}
    }
  }

  // Mirror superjson's generateReferentialEqualityAnnotations (dedupe: false).
  const result: Record<string, string[]> = {}
  let hasResult = false
  let rootEqualityPaths: string[] | undefined
  identities.forEach((record) => {
    if (!record.more) return
    const paths = [{path: record.path, depth: record.depth}, ...record.more].sort((a, b) => a.depth - b.depth)
    const [representative, ...identical] = paths
    if (representative!.depth === 0) {
      rootEqualityPaths = identical.map((p) => p.path)
    } else {
      result[representative!.path] = identical.map((p) => p.path)
      hasResult = true
    }
  })
  const equalities = rootEqualityPaths
    ? hasResult
      ? [rootEqualityPaths, result]
      : [rootEqualityPaths]
    : hasResult
      ? result
      : undefined
  if (equalities) {
    res.meta = {...res.meta, referentialEqualities: equalities as any}
  }
  return res
}
