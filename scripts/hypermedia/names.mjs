// Schema names for the hypermedia/ library, shared by the scripts beside this file.
//
// A schema's name is its path inside hypermedia/ without `.schema.json`
// (`string`, `block/image`, `schema/map-schema`, `example/person`),
// which is also the path its document publishes at. References use hm://hyper.media/<name>.

import {readdirSync, statSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const HM_DIR = resolve(REPO_ROOT, 'hypermedia')
export const LOCK_PATH = resolve(HM_DIR, 'schemas.lock.json')
/**
 * The authority schema references use: hm://hyper.media/<name>. It is a name, not a key, so a schema's bytes
 * (and its CID) do not depend on which space publishes the library. The sync resolves it to the publishing
 * space's key for page links and frontmatter bindings.
 */
export const LIBRARY_AUTHORITY = 'hyper.media'

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
export const nameToUrl = (name) => `hm://${LIBRARY_AUTHORITY}/${name}`

/**
 * A schema reference -> its library name. Accepts an hm://hyper.media/<name> URL, a bare
 * name, or a file name. A reference into any other authority is not a library name and is
 * returned as is; `has(name)` lets a caller tell the two apart.
 */
export function refToName(ref, has) {
  const m = /^hm:\/\/([^/]+)\/(.+)$/.exec(ref)
  if (!m) return ref.replace(/\.schema\.json$|\.json$/, '')
  if (m[1] !== LIBRARY_AUTHORITY) return ref
  const name = m[2]
  return has(name) ? name : name
}
