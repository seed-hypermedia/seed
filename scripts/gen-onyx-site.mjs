// Generate a Markdown document for every Onyx schema in schemas/*.json, written
// to schemas/site/<name>.md. Each doc describes one concept (a type); the sync
// step (scripts/sync-onyx-seed.mjs) publishes it with a `schemaDefinition`
// metadata field linking to that schema's IPFS CID. Cross-references become
// hm:// links under the onyx identity, so the whole tour is one linked site.
//
//   node scripts/gen-onyx-site.mjs
import {readFileSync, writeFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'

const BASE = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'
const AUTHORITY = [
  ['onyx-', 'hyper.media'],
  ['hypermedia-', 'seed.hyper.media'],
  ['example-', 'example.com'],
]
const SRC = 'schemas'
const OUT = 'schemas/site'

const files = readdirSync(SRC).filter((f) => f.endsWith('.json') && f !== 'schemas.lock.json')
const schemas = {}
for (const f of files) schemas[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(SRC, f), 'utf8'))

const KIND_URL = /^hm:\/\/hyper\.media\/([a-z]+)$/
const kindOf = (t) => (typeof t === 'string' ? KIND_URL.exec(t)?.[1] ?? t : t)
function refToName(ref) {
  const m = /^hm:\/\/([^/]+)\/(.+)$/.exec(ref)
  if (!m) return ref.replace(/\.json$/, '')
  const [, auth, name] = m
  const prefix = AUTHORITY.find(([, a]) => a === auth)?.[0]
  return prefix ? `${prefix}${name}` : name
}
const link = (name) => `[${name}](${BASE}/${name})`

function collectRefs(node, acc = new Set()) {
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) {
    for (const s of node) collectRefs(s, acc)
    return acc
  }
  if (typeof node.ref === 'string') acc.add(refToName(node.ref))
  for (const [k, v] of Object.entries(node)) if (k !== 'ref' && v && typeof v === 'object') collectRefs(v, acc)
  return acc
}
const dependencies = (name) => [...collectRefs(schemas[name])].filter((n) => n !== name && schemas[n]).sort()

const isInstance = (s) => !!(s && s.$type && 'value' in s)
const isPrimitive = (name) =>
  name.startsWith('onyx-') &&
  ['null', 'boolean', 'integer', 'float', 'string', 'bytes', 'list', 'map', 'link', 'any'].includes(
    name.replace(/^onyx-/, ''),
  )
const isMeta = (name) => name === 'onyx-schema' || (name.startsWith('onyx-') && name.endsWith('-schema'))

/** A one-line description of a schema node, with hm:// links for references. */
function summarize(node) {
  if (!node) return 'any'
  if (node.var !== undefined) return `type variable \`⟨${node.var}⟩\``
  if (node.anyOf) return 'one of ' + node.anyOf.map(summarize).join(' | ')
  if (node.ref && !node.type) {
    const b = refToName(node.ref)
    if (node.args)
      return `${link(b)}⟨${Object.entries(node.args)
        .map(([p, v]) => `${p} = ${summarize(v)}`)
        .join(', ')}⟩`
    return schemas[b] ? link(b) : `\`${b}\``
  }
  const k = kindOf(node.type)
  if (k === 'link')
    return (
      '`link`' +
      (node.ref ? ` → ${schemas[refToName(node.ref)] ? link(refToName(node.ref)) : refToName(node.ref)}` : '')
    )
  if (k === 'list') return `list of ${summarize(node.items)}`
  if (k === 'map') {
    if (node.properties) return `map { ${Object.keys(node.properties).length} fields }`
    if (node.values) return `map ⟨ * : ${summarize(node.values)} ⟩`
    return 'map'
  }
  if (node.enum) return (k ? `\`${k}\` ` : '') + 'enum: ' + node.enum.map((v) => `\`${kindOf(v)}\``).join(' ')
  return k ? `\`${k}\`` : 'any'
}

function category(name, s) {
  if (isInstance(s)) return 'instance'
  if (name === 'onyx-schema') return 'the meta-schema'
  if (isMeta(name)) return 'a meta-schema variant'
  if (isPrimitive(name)) return 'a primitive'
  if (name.startsWith('hypermedia-')) return 'a Hypermedia Network blob schema'
  if (name.startsWith('example-')) return 'an example schema'
  return 'a schema'
}

function shapeSection(name, s) {
  if (isInstance(s)) {
    const t = refToName(s.$type)
    return `This is example **data** — an instance of ${
      schemas[t] ? link(t) : '`' + t + '`'
    }.\n\n\`\`\`json\n${JSON.stringify(s.value, null, 2)}\n\`\`\``
  }
  const lines = []
  const hasExt = s.ref && !s.type && ['properties', 'required', 'values', 'items'].some((k) => s[k] !== undefined)
  if (s.anyOf) {
    lines.push('A **union** — a value matches one of these variants:\n')
    for (const v of s.anyOf) lines.push(`- ${summarize(v)}`)
  } else if (hasExt) {
    const parent = refToName(s.ref)
    lines.push(`**Extends** ${schemas[parent] ? link(parent) : '`' + parent + '`'} with these added fields:\n`)
    const req = new Set(s.required || [])
    for (const [k, v] of Object.entries(s.properties || {}))
      lines.push(`- \`${k}\`${req.has(k) ? ' *(required)*' : ''} — ${summarize(v)}`)
  } else if (s.ref && !s.type && s.args) {
    const parent = refToName(s.ref)
    lines.push(
      `An **instantiation** of the generic ${schemas[parent] ? link(parent) : '`' + parent + '`'}, binding: ` +
        Object.entries(s.args)
          .map(([p, v]) => `\`${p}\` = ${summarize(v)}`)
          .join(', ') +
        '.',
    )
  } else if (s.ref && !s.type) {
    const parent = refToName(s.ref)
    lines.push(`An **alias** of ${schemas[parent] ? link(parent) : '`' + parent + '`'}.`)
  } else if (kindOf(s.type) === 'map' && s.properties) {
    lines.push(`A ${s.values ? 'map' : '**closed struct**'} with these fields:\n`)
    const req = new Set(s.required || [])
    for (const [k, v] of Object.entries(s.properties))
      lines.push(`- \`${k}\`${req.has(k) ? ' *(required)*' : ''} — ${summarize(v)}`)
  } else if (kindOf(s.type) === 'map' && s.values) {
    lines.push(`An **open map** — every value: ${summarize(s.values)}.`)
  } else if (kindOf(s.type) === 'list') {
    lines.push(`A **list** of ${summarize(s.items)}.`)
  } else if (s.type) {
    lines.push(
      `Kind: \`${kindOf(s.type)}\`.` +
        (s.enum ? ' One of: ' + s.enum.map((v) => `\`${kindOf(v)}\``).join(', ') + '.' : ''),
    )
  }
  if (s.params)
    lines.push(
      '\n**Generic** over ' +
        Object.entries(s.params)
          .map(([p, d]) => `\`⟨${p}⟩\` (default ${summarize(d)})`)
          .join(', ') +
        '.',
    )
  return lines.join('\n')
}

let count = 0
for (const [name, s] of Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b))) {
  const title = s.name || name
  const cat = category(name, s)
  const desc = s.description ? s.description + '\n\n' : ''
  const summary = (s.description || `${title} — ${cat}.`).replace(/\n/g, ' ').slice(0, 160)
  const deps = dependencies(name)
  const depLine = deps.length ? `\n## Depends on\n\n${deps.map((d) => `- ${link(d)}`).join('\n')}\n` : ''
  const instanceNote = isInstance(s)
    ? ''
    : `\nThis document describes the **${name}** type — ${cat}. Its formal schema is attached (the \`schemaDefinition\` in this document's metadata), so the app can show it and create values of this type.\n`
  const md = `---
name: ${JSON.stringify(title)}
summary: ${JSON.stringify(summary)}
---

# ${title}

${desc}${instanceNote}
## Shape

${shapeSection(name, s)}
${depLine}`
  writeFileSync(join(OUT, `${name}.md`), md)
  count++
}
console.log(`generated ${count} schema docs into ${OUT}/`)
