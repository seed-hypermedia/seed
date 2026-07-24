// One-shot: rewrite every schema reference so it points at a REAL published
// document URL under the onyx account, instead of the placeholder dev
// authorities (hyper.media / seed.hyper.media / example.com) that never
// resolved. Scheme (per the "clean primitives, prefixed rest" choice):
//   hm://hyper.media/<kind>       -> hm://<onyx>/<kind>            (onyx-<kind> stripped: map, string, schema…)
//   hm://seed.hyper.media/<name>  -> hm://<onyx>/hypermedia-<name>
//   hm://example.com/<name>       -> hm://<onyx>/example-<name>
//   hm://<onyx>/…                 -> unchanged (already onified)
// Applies to EVERY hm:// string in the schema (type, ref, $type, kind enums).
//
//   node scripts/onyx-onify-refs.mjs
import {readFileSync, writeFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'

const ONYX = 'z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'
const SRC = 'onyx'

function toOnyx(url) {
  const m = /^hm:\/\/([^/]+)\/(.+)$/.exec(url)
  if (!m) return url
  const [, auth, name] = m
  if (auth === ONYX) return url
  if (auth === 'hyper.media') return `hm://${ONYX}/${name}`
  if (auth === 'seed.hyper.media') return `hm://${ONYX}/hypermedia-${name}`
  if (auth === 'example.com') return `hm://${ONYX}/example-${name}`
  return url
}

function walk(node) {
  if (Array.isArray(node)) return node.map(walk)
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) out[k] = walk(v)
    return out
  }
  if (typeof node === 'string' && node.startsWith('hm://')) return toOnyx(node)
  return node
}

const files = readdirSync(SRC).filter((f) => f.endsWith('.json') && f !== 'schemas.lock.json')
let changed = 0
for (const f of files) {
  const before = readFileSync(join(SRC, f), 'utf8')
  const next = JSON.stringify(walk(JSON.parse(before)), null, 2) + '\n'
  if (next !== before) {
    writeFileSync(join(SRC, f), next)
    changed++
  }
}
console.log(`onified refs in ${changed}/${files.length} schema files`)
