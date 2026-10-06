// Consistency checks for hypermedia/ — the library of schemas and the pages that publish them.
//
//   node scripts/hypermedia/check.mjs
//
// Run by CI and before a sync. Every check is cheap and offline; anything needing the network
// belongs in the sync itself. Failures print the offending file and exit 1.
//
// The rest of the toolchain beside this file: names.mjs (the name<->file<->URL mapping every script
// shares), validate.mjs (the reference validator), publish.mjs (CIDs -> schemas.lock.json),
// gen-registry.mjs and typegen.mjs (the bundled registry and TS types).
//
//   1. spelling      a schema node names what it is with `type`; `ref` and `$type` are retired
//   2. pairing       every schema file has a page, and no page carries schemaDefinition in its frontmatter
//   3. meta-schema   validate.mjs: each schema is a valid Hypermedia schema, self-description holds
//   4. lockfile      schemas.lock.json matches the files (publish.mjs --check)
//   5. generated     the bundled registry and TS types match the files
//   6. conformance   a page's own attributes satisfy the schema its `attributesSchema` names
//   7. bindings      `attributesSchema` / `childAttributesSchema` / `schemaDefinition` resolve
//   8. frontmatter   every page has a name and a whole one-sentence summary
//   9. tables        every table row has as many cells as its header (a raw `|` inside inline code splits a row)

import {execFileSync} from 'node:child_process'
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parse as parseYaml} from 'yaml'
import {HM_DIR, listSchemaFiles, nameOfFile, refToName} from './names.mjs'

/** A reference's library name, checked against the files on disk. */
const nameOf = (ref) => refToName(ref, (name) => existsSync(resolve(HM_DIR, `${name}.schema.json`)))
import {load, validate} from './validate.mjs'

const DIR = dirname(fileURLToPath(import.meta.url))
const node = process.execPath
const failures = []
const fail = (file, message) => failures.push(`${file}: ${message}`)
const ok = (message) => console.log(`  ok   ${message}`)
const section = (title) => console.log(`\n== ${title} ==`)

const schemaFiles = listSchemaFiles()
const pages = listPages()

/** Every markdown page under hypermedia/, with its parsed frontmatter. */
function listPages() {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(full)
      } else if (entry.name.endsWith('.md') && entry.name !== 'README.md') {
        out.push({file: full.slice(HM_DIR.length + 1), frontmatter: frontmatterOf(full)})
      }
    }
  }
  walk(HM_DIR)
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

/** A page's frontmatter, or {} when it has none. */
function frontmatterOf(path) {
  const text = readFileSync(path, 'utf8')
  const m = /^---\n([\s\S]*?)\n---/.exec(text)
  if (!m) return {}
  try {
    return parseYaml(m[1]) ?? {}
  } catch (err) {
    fail(path.slice(HM_DIR.length + 1), `frontmatter is not valid YAML: ${err.message}`)
    return {}
  }
}

// 1. Spelling ────────────────────────────────────────────────────────────────
// `type` names what a value is — a kind, or another schema; every other key refines it. The old
// `ref` spelling still resolves for schemas published before the change, but never in the library.
section('The library spells a type reference as `type`')
for (const file of schemaFiles) {
  const raw = JSON.parse(readFileSync(resolve(HM_DIR, file), 'utf8'))
  const offenders = []
  walkSchema(raw, (node) => {
    if (typeof node.ref === 'string') offenders.push('ref')
    if (typeof node.$type === 'string') offenders.push('$type')
  })
  if (offenders.length) fail(file, `uses the retired key(s) ${[...new Set(offenders)].join(', ')}`)
}
if (!failures.length) ok(`${schemaFiles.length} schema files use \`type\``)

/** Visit every schema NODE (not property names, which are data). */
function walkSchema(node, visit) {
  if (Array.isArray(node)) return node.forEach((n) => walkSchema(n, visit))
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value && typeof value === 'object') {
      for (const entry of Object.values(value)) if (entry && typeof entry === 'object') walkSchema(entry.value, visit)
    } else if (key === 'values' || key === 'items') walkSchema(value, visit)
    else if ((key === 'anyOf' || key === 'allOf') && Array.isArray(value)) value.forEach((n) => walkSchema(n, visit))
    else if ((key === 'params' || key === 'args') && value && typeof value === 'object') {
      for (const n of Object.values(value)) walkSchema(n, visit)
    }
  }
}

// 2. Pairing ─────────────────────────────────────────────────────────────────
section('Every schema has a page, and no page repeats its schemaDefinition')
const pageFiles = new Set(pages.map((p) => p.file))
for (const file of schemaFiles) {
  const page = `${nameOfFile(file)}.md`
  if (!pageFiles.has(page)) fail(file, `no page at ${page}`)
}
for (const page of pages) {
  const schemaFile = `${page.file.replace(/\.md$/, '')}.schema.json`
  // The sync sets `schemaDefinition` from the schema file beside the page, so the frontmatter never carries it.
  if ('schemaDefinition' in page.frontmatter)
    fail(page.file, `frontmatter carries schemaDefinition; remove it, the sync sets it from ${schemaFile}`)
}
if (!failures.length) ok(`${schemaFiles.length} schemas paired with pages`)

// 3-5. The generators and the reference validator ────────────────────────────
const run = (script, args = []) => {
  try {
    execFileSync(node, [resolve(DIR, script), ...args], {stdio: 'pipe'})
    return null
  } catch (err) {
    return (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '') || err.message
  }
}
section('The meta-schema validates every schema (validate.mjs)')
const validateOut = run('validate.mjs')
if (validateOut) fail('validate.mjs', `failed:\n${validateOut}`)
else ok('every schema is a valid Hypermedia schema')

section('Generated artifacts are up to date')
const lockOut = run('publish.mjs', ['--check'])
if (lockOut) fail('schemas.lock.json', lockOut.trim())
else ok('schemas.lock.json matches the schema files')
for (const [script, generated] of [
  ['gen-registry.mjs', 'frontend/packages/client/src/schema-registry.generated.ts'],
  ['typegen.mjs', 'frontend/packages/client/src/schema-types.generated.ts'],
]) {
  const path = resolve(HM_DIR, '..', generated)
  const before = readFileSync(path, 'utf8')
  const out = run(script)
  const after = readFileSync(path, 'utf8')
  if (out) fail(script, `failed:\n${out}`)
  else if (before !== after) fail(generated, `was out of date; ${script} has just regenerated it — commit the change`)
  else ok(`${generated.split('/').pop()} matches the schema files`)
}

// 6-7. The pages ─────────────────────────────────────────────────────────────
// A page's attributes are data of the type it names, so the library's own examples prove the
// binding works. Only the declared keys are checked; a page may carry any other attribute.
section('Every page satisfies the schema it binds to')
const BINDINGS = ['attributesSchema', 'childAttributesSchema']
let bound = 0
for (const page of pages) {
  for (const key of BINDINGS) {
    const ref = page.frontmatter[key]
    if (ref === undefined) continue
    if (typeof ref !== 'string') {
      fail(page.file, `${key} is not a URL`)
      continue
    }
    if (!resolves(ref)) fail(page.file, `${key} names ${nameOf(ref)}, which is not in the library`)
  }
  const ref = page.frontmatter.attributesSchema
  if (typeof ref !== 'string' || !resolves(ref)) continue
  bound++
  const errs = validate(load(ref), page.frontmatter, '$', {}, {}).filter(
    // The page's own header and binding keys are not attributes of the type.
    (e) => !/unexpected key "(name|summary|icon|cover|attributesSchema|childAttributesSchema|schemaDefinition)"/.test(e),
  )
  for (const err of errs) fail(page.file, `does not satisfy ${nameOf(ref)}: ${err}`)
}
if (!failures.length) ok(`${bound} pages satisfy the type they bind to`)

// ─────────────────────────────────────────────────────────────────────────────
function resolves(ref) {
  try {
    return !!load(ref)
  } catch {
    return false
  }
}


// 8. Frontmatter ─────────────────────────────────────────────────────────────
// A page publishes with `name` as its title and `summary` as its subtitle and card blurb, so both must exist,
// and a summary must be a sentence rather than a byte-cut of the first paragraph.
section('Every page has a name and a whole summary')
{
  let bad = 0
  for (const page of pages) {
    const {name, summary} = page.frontmatter
    if (typeof name !== 'string' || !name.trim()) {
      fail(page.file, 'frontmatter has no `name`')
      bad++
    }
    if (typeof summary !== 'string' || !summary.trim()) {
      fail(page.file, 'frontmatter has no `summary`')
      bad++
      continue
    }
    const trimmed = summary.trim()
    const cutMidWord = trimmed.length >= 150 && /[A-Za-z0-9]$/.test(trimmed)
    if (cutMidWord || trimmed.endsWith('…') || trimmed.endsWith('...')) {
      fail(page.file, `summary looks truncated: "…${trimmed.slice(-40)}"`)
      bad++
    }
  }
  if (!bad) ok(`${pages.length} pages have a name and a whole summary`)
}



// 9. Tables ──────────────────────────────────────────────────────────────────
// Markdown splits a table row on every `|`, even inside inline code, and the Seed app then round-trips the
// extra cells as extra columns. Write `\|` or avoid the pipe.
section('Every table row matches its header')
{
  let bad = 0
  const cellCount = (line) => line.replace(/<!--.*?-->/g, '').trim().split(/(?<!\\)\|/).length - 2
  for (const page of pages) {
    const lines = readFileSync(resolve(HM_DIR, page.file), 'utf8').split('\n')
    let inCode = false
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith('```')) inCode = !inCode
      if (inCode || !/^\|\s*:?-{3}/.test(lines[i])) continue
      const header = cellCount(lines[i - 1])
      for (let j = i + 1; j < lines.length && lines[j].trim().startsWith('|'); j++) {
        const cells = cellCount(lines[j])
        if (cells !== header) {
          fail(page.file, `line ${j + 1}: table row has ${cells} cells, header has ${header} (escape a | inside code as \\|)`)
          bad++
        }
      }
    }
  }
  if (!bad) ok('every table row matches its header')
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} problem(s) in hypermedia/`)
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}
console.log(`\nhypermedia/ is consistent (${schemaFiles.length} schemas, ${pages.length} pages).`)
