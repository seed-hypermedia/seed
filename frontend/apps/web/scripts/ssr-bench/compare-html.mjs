#!/usr/bin/env node
/**
 * Compare two `bench.mjs --dump-html` directories: is the rendered markup the
 * same, and how did the loader data handed to the browser change?
 *
 *   node scripts/ssr-bench/compare-html.mjs <before-dir> <after-dir>
 *
 * The markup is everything outside the Remix handoff script, with build-specific
 * asset hashes normalized away. The handoff is decoded and its top-level route
 * payload fields are listed when they differ.
 */
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {deserialize} from 'superjson'

const [beforeDir, afterDir] = process.argv.slice(2)
const MARK = 'window.__remixContext = '

function split(html) {
  const i = html.indexOf(MARK)
  const j = html.indexOf(';</script>', i)
  const markup = (html.slice(0, i) + html.slice(j))
    // asset file names carry content hashes that differ per build
    .replace(/\/assets\/[\w.-]+?-[\w-]{8}\.(js|css)/g, '/assets/<hashed>.$1')
    .replace(/"(?:url|imports|module)":"[^"]*"/g, '"<asset>"')
    .replace(/window\.__remixManifest = .*?;<\/script>/s, '<manifest>')
  return {markup, handoff: JSON.parse(html.slice(i + MARK.length, j))}
}

let allSame = true
for (const file of readdirSync(beforeDir).filter((f) => f.endsWith('.html'))) {
  const a = split(readFileSync(join(beforeDir, file), 'utf8'))
  const b = split(readFileSync(join(afterDir, file), 'utf8'))
  const sameMarkup = a.markup === b.markup
  allSame &&= sameMarkup
  const aBytes = JSON.stringify(a.handoff).length
  const bBytes = JSON.stringify(b.handoff).length
  console.log(
    `${file.padEnd(26)} markup ${sameMarkup ? 'identical' : 'DIFFERENT'}  handoff ${(aBytes / 1024).toFixed(
      0,
    )} KiB -> ${(bBytes / 1024).toFixed(0)} KiB`,
  )
  if (!sameMarkup) {
    let k = 0
    while (k < a.markup.length && a.markup[k] === b.markup[k]) k++
    console.log(
      `  first difference at ${k}:\n  - ${a.markup.slice(k - 80, k + 120)}\n  + ${b.markup.slice(k - 80, k + 120)}`,
    )
  }
  for (const route of Object.keys(a.handoff.state.loaderData)) {
    const da = deserialize(a.handoff.state.loaderData[route])
    const db = deserialize(b.handoff.state.loaderData[route])
    if (!da || typeof da !== 'object') continue
    for (const key of new Set([...Object.keys(da), ...Object.keys(db)])) {
      const ja = JSON.stringify(da[key], (_k, v) => (typeof v === 'bigint' ? `${v}n` : v))
      const jb = JSON.stringify(db[key], (_k, v) => (typeof v === 'bigint' ? `${v}n` : v))
      if (ja !== jb) console.log(`  ${route}.${key}: ${ja?.length ?? 0} -> ${jb?.length ?? 0} chars`)
    }
  }
}
process.exit(allSame ? 0 : 1)
