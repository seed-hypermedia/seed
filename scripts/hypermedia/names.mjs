// Schema names for the hypermedia/ library, shared by the scripts beside this file.
//
// A schema's name is its path inside hypermedia/ without `.schema.json`
// (`string`, `block/image`, `rpc/type/document`, `example/person`),
// which is also the path its document publishes at: hm://<library>/<name>.
// Names from before the folder reorganization (`hypermedia-string`, the bare
// primitive `string`, the dev authorities) resolve through schemas.aliases.json.

import {readdirSync, readFileSync, statSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const HM_DIR = resolve(REPO_ROOT, 'hypermedia')
export const LOCK_PATH = resolve(HM_DIR, 'schemas.lock.json')
export const HYPERMEDIA_UID = 'z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'

/** Dev authorities from before the Hypermedia account, and the name prefix each implied. */
export const LEGACY_AUTHORITY = [
  ['hypermedia-', 'hyper.media'],
  ['hypermedia-', 'seed.hyper.media'],
  ['seed-', 'seed.hyper.media'],
  ['example-', 'example.com'],
]

/** Old name -> current name. */
export const ALIASES = JSON.parse(readFileSync(resolve(HM_DIR, 'schemas.aliases.json'), 'utf8')).aliases

/** Current name -> the prefixed name it had before (e.g. block/image -> hypermedia-block-image). */
export const LEGACY_NAME = Object.fromEntries(
  Object.entries(ALIASES)
    .filter(([old]) => /^(hypermedia|seed|example)-/.test(old))
    .map(([old, name]) => [name, old]),
)

/** Every schema file under hypermedia/, relative to it (`block/image.schema.json`), sorted. */
export function listSchemaFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (!entry.startsWith('.') && entry !== 'node_modules') walk(full)
      } else if (entry.endsWith('.schema.json')) {
        out.push(relative(HM_DIR, full))
      }
    }
  }
  walk(HM_DIR)
  return out.sort()
}

export const nameOfFile = (file) => file.replace(/\.schema\.json$/, '')
export const fileOfName = (name) => `${name}.schema.json`
export const nameToUrl = (name) => `hm://${HYPERMEDIA_UID}/${name}`

/**
 * A schema reference -> its current name. Accepts an hm:// URL (Hypermedia account or a
 * legacy dev authority), a bare name, or a file name. `has(name)` says whether a
 * name exists; a name that does not resolves through the aliases, else is returned as is.
 */
export function refToName(ref, has) {
  const m = /^hm:\/\/([^/]+)\/(.+)$/.exec(ref)
  let name
  if (!m) name = ref.replace(/\.schema\.json$|\.json$/, '')
  else if (m[1] === HYPERMEDIA_UID) name = m[2]
  else {
    const prefix = LEGACY_AUTHORITY.find(([, authority]) => authority === m[1])?.[0]
    name = prefix ? `${prefix}${m[2]}` : m[2]
  }
  if (has(name)) return name
  return ALIASES[name] ?? name
}
