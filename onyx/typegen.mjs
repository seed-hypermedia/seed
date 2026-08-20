// Typegen: generate TypeScript type definitions from the Onyx schemas.
//
//   node typegen.mjs            -> write frontend/packages/client/src/onyx-types.generated.ts
//   node typegen.mjs --check    -> fail if the generated file is out of date (for CI)
//
// Phase 2 of the Onyx integration plan (notes/onyx-integration-plan.md): every
// schema in onyx/*.json becomes a TS type, so app code can type values by the
// SAME content-addressed schemas the data references — instead of hand-written
// Zod duplicating them in hm-types.ts.
//
// Mapping:
//   map          -> object type ({props} & Record<string, V> when open via `values`)
//   list         -> Array<T>
//   scalars      -> string / number / boolean / null / OnyxBytes; constraints -> JSDoc
//   link         -> OnyxLink (the dag-json {'/': cid} form)
//   any          -> unknown
//   enum         -> literal union
//   anyOf        -> union
//   ref          -> the referenced schema's generated type name
//   extension    -> Base & {added/overridden fields} (literal `type` narrows the base)
//   generics     -> params -> <T = Default>, var -> T, args -> Name<Arg> (1:1 with TS)
//   name/descr.  -> JSDoc
//
// Instances ({$type, value} files) are data, not types: skipped.
// Primitive schemas (onyx-string, onyx-map, ...) inline to TS primitives.

import {readFileSync, writeFileSync, readdirSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(DIR, '../frontend/packages/client/src/onyx-types.generated.ts')
const CHECK = process.argv.includes('--check')

const ONYX = 'z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'

// ── Load schemas ─────────────────────────────────────────────────────────────

const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'schemas.lock.json')
const schemas = {}
for (const f of files.sort()) {
  const basename = f.replace(/\.json$/, '')
  schemas[basename] = JSON.parse(readFileSync(resolve(DIR, f), 'utf8'))
}

const isInstance = (s) => s && typeof s === 'object' && typeof s.$type === 'string' && 'value' in s

// ── Names ────────────────────────────────────────────────────────────────────

const KINDS = ['null', 'boolean', 'integer', 'float', 'string', 'bytes', 'list', 'map', 'link', 'any']
const PRIMITIVES = new Set(KINDS.map((k) => `onyx-${k}`))

/** basename -> exported TS type name (hypermedia-block-image -> HMBlockImage). */
function tsName(basename) {
  const prefixes = [
    ['hypermedia-', 'HM'],
    ['seed-', 'Seed'],
    ['example-', 'Example'],
    ['onyx-', 'Onyx'],
  ]
  for (const [p, out] of prefixes) {
    if (basename.startsWith(p)) {
      return out + pascal(basename.slice(p.length))
    }
  }
  return pascal(basename)
}

function pascal(kebab) {
  return kebab
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

/** Resolve a ref/type URL to a local schema basename, or a bare kind name. */
function urlToBasename(url) {
  const m = /^hm:\/\/([^/]+)\/(.+)$/.exec(url)
  if (!m) return url
  const [, auth, name] = m
  if (auth !== ONYX && auth !== 'hyper.media') return null
  if (schemas[name]) return name
  if (schemas[`onyx-${name}`]) return `onyx-${name}`
  return name
}

const KIND_TS = {
  null: 'null',
  boolean: 'boolean',
  integer: 'number',
  float: 'number',
  string: 'string',
  bytes: 'OnyxBytes',
  link: 'OnyxLink',
  any: 'unknown',
  // bare map/list refs (no properties/items) are fully open:
  map: 'Record<string, unknown>',
  list: 'unknown[]',
}

/** The kind a `type:` URL names, or null if it isn't a kind URL. */
function kindOf(typeUrl) {
  const basename = urlToBasename(typeUrl)
  if (basename === null) return null
  const bare = basename.replace(/^onyx-/, '')
  return KINDS.includes(bare) ? bare : null
}

// ── Emission ─────────────────────────────────────────────────────────────────

const indent = (s, pad) => s.replace(/\n/g, `\n${pad}`)

function literal(v) {
  return typeof v === 'string' ? JSON.stringify(v) : String(v)
}

/** Emit the TS type expression for one schema node. `env` maps in-scope type vars. */
function emit(node, env, pad = '') {
  if (node === null || node === undefined) return 'unknown'
  if (typeof node === 'string') {
    // A bare type URL used as a node (shorthand).
    const k = kindOf(node)
    if (k) return KIND_TS[k]
    const basename = urlToBasename(node)
    return basename && schemas[basename] ? tsName(basename) : 'unknown'
  }

  if (node.var) {
    return env.has(node.var) ? node.var : 'unknown'
  }

  if (node.enum) {
    return node.enum.map(literal).join(' | ')
  }

  if (node.anyOf) {
    const parts = node.anyOf.map((v) => emit(v, env, pad))
    return parts.join(' | ')
  }

  if (node.ref) {
    const basename = urlToBasename(node.ref)
    if (!basename) return 'unknown'
    if (PRIMITIVES.has(basename) || (KINDS.includes(basename.replace(/^onyx-/, '')) && !schemas[basename])) {
      const bare = basename.replace(/^onyx-/, '')
      if (KINDS.includes(bare)) {
        const base = KIND_TS[bare]
        // Extension of a primitive (rare) still needs the added properties.
        if (node.properties) return `${base} & ${emitMapBody(node, env, pad)}`
        return base
      }
    }
    if (!schemas[basename]) return 'unknown'
    let base = tsName(basename)
    const targetParams = schemas[basename].params
    if (targetParams) {
      const order = Object.keys(targetParams)
      const args = order.map((p) => (node.args && node.args[p] ? emit(node.args[p], env, pad) : emit(targetParams[p], env, pad)))
      base = `${base}<${args.join(', ')}>`
    }
    // Extension: base & {added/overridden fields}
    if (node.properties) {
      return `${base} & ${emitMapBody(node, env, pad)}`
    }
    return base
  }

  const kind = node.type ? kindOf(node.type) : null

  if (kind === 'map' || (!kind && (node.properties || node.values))) {
    return emitMapBody(node, env, pad)
  }
  if (kind === 'list') {
    const item = node.items ? emit(node.items, env, pad) : 'unknown'
    return /[|&]/.test(item) ? `Array<${item}>` : `${item}[]`
  }
  if (kind) {
    return KIND_TS[kind]
  }
  if (node.type) {
    // `type:` pointing at a non-kind schema behaves like a ref for typing.
    return emit({ref: node.type, properties: node.properties, args: node.args}, env, pad)
  }
  return 'unknown'
}

/** Emit an object-type body from a map node's properties/required/values. */
function emitMapBody(node, env, pad) {
  const props = node.properties || {}
  const required = new Set(node.required || [])
  const inner = pad + '  '
  const lines = []
  for (const [key, child] of Object.entries(props)) {
    const doc = childDoc(child, inner)
    const opt = required.has(key) ? '' : '?'
    const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)
    lines.push(`${doc}${inner}${safeKey}${opt}: ${emit(child, env, inner)}`)
  }
  let body = lines.length ? `{\n${lines.join('\n')}\n${pad}}` : '{}'
  if (node.values) {
    const v = `Record<string, ${emit(node.values, env, pad)}>`
    body = lines.length ? `${body} & ${v}` : v
  } else if (!lines.length) {
    body = 'Record<string, never>'
  }
  return body
}

/** A property's JSDoc line (from its own name/description/constraints), or ''. */
function childDoc(child, pad) {
  if (!child || typeof child !== 'object') return ''
  const bits = []
  if (child.description) bits.push(child.description)
  for (const c of ['minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum']) {
    if (child[c] !== undefined) bits.push(`${c}: ${JSON.stringify(child[c])}`)
  }
  if (!bits.length) return ''
  return `${pad}/** ${bits.join(' · ').replace(/\*\//g, '*\\/')} */\n`
}

/** Emit one exported type declaration for a top-level schema. */
function emitSchema(basename) {
  const schema = schemas[basename]
  const name = tsName(basename)
  const env = new Set(Object.keys(schema.params || {}))
  const generics = schema.params
    ? `<${Object.entries(schema.params)
        .map(([p, d]) => `${p} = ${emit(d, new Set(), '')}`)
        .join(', ')}>`
    : ''
  const docLines = []
  if (schema.name) docLines.push(schema.name)
  if (schema.description) docLines.push(schema.description)
  docLines.push(`Schema: hm://${ONYX}/${basename.startsWith('onyx-') ? basename.slice(5) : basename}`)
  const doc = `/**\n * ${docLines.join('\n * ').replace(/\*\//g, '*\\/')}\n */`
  return `${doc}\nexport type ${name}${generics} = ${emit(schema, env, '')}\n`
}

// ── Main ─────────────────────────────────────────────────────────────────────

const out = []
out.push(`// AUTO-GENERATED by onyx/typegen.mjs (do not edit by hand).
// TypeScript types for every Onyx schema in onyx/*.json — the same
// content-addressed schemas published under hm://${ONYX}.
// Regenerate: node onyx/typegen.mjs

/** A dag-json IPLD link: { '/': <cid> }. */
export type OnyxLink = {'/': string}

/** Binary data: decoded bytes, or the dag-json envelope form. */
export type OnyxBytes = Uint8Array | {'/': {bytes: string}}
`)

const generated = Object.keys(schemas)
  .filter((b) => !isInstance(schemas[b]) && !PRIMITIVES.has(b))
  .sort()
for (const basename of generated) {
  out.push(emitSchema(basename))
}

const content = out.join('\n')

if (CHECK) {
  let existing = ''
  try {
    existing = readFileSync(OUT, 'utf8')
  } catch {}
  if (existing !== content) {
    console.error(`FAILED: ${OUT} is out of date. Run: node onyx/typegen.mjs`)
    process.exit(1)
  }
  console.log(`OK: ${OUT} is up to date (${generated.length} types).`)
} else {
  writeFileSync(OUT, content)
  console.log(`wrote ${OUT}: ${generated.length} types from ${Object.keys(schemas).length} schemas`)
}
