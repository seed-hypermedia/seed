#!/usr/bin/env node
/**
 * Summarize a V8 .cpuprofile (from `node --cpu-prof scripts/ssr-bench/bench.mjs`):
 * top functions by self time, and inclusive time of the SSR cost centres
 * (Zod validation, superjson, React render, protobuf decode/toJson, logging).
 * Best read against an unminified build so function names survive.
 *
 *   node scripts/ssr-bench/profile-summary.mjs <file.cpuprofile> [--top 40] [--callers <url-or-name regex>]
 *
 * `--callers` attributes the inclusive time of matching frames to the call
 * sites that enter them (the 3 frames above the outermost match).
 */
import {readFileSync} from 'node:fs'

const [file, ...rest] = process.argv.slice(2)
const topN = rest.includes('--top') ? Number(rest[rest.indexOf('--top') + 1]) : 40
const profile = JSON.parse(readFileSync(file, 'utf8'))

const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const parent = new Map()
for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id)

// Sample weights: timeDeltas[i] is the time before sample i.
const weight = new Map()
let total = 0
profile.samples.forEach((id, i) => {
  const dt = profile.timeDeltas[i] || 0
  weight.set(id, (weight.get(id) || 0) + dt)
  total += dt
})

function label(n) {
  const cf = n.callFrame
  const url = (cf.url || '').replace(/^.*\/(node_modules|frontend)\//, '$1/')
  return `${cf.functionName || '(anonymous)'} ${url}:${cf.lineNumber + 1}`
}

const IDLE = new Set(['(idle)', '(program)', '(garbage collector)'])
const self = new Map()
for (const [id, w] of weight) {
  const key = label(byId.get(id))
  self.set(key, (self.get(key) || 0) + w)
}
const busy =
  total - [...weight].filter(([id]) => byId.get(id).callFrame.functionName === '(idle)').reduce((a, [, w]) => a + w, 0)

const CATEGORIES = {
  'zod validation': (cf) => /node_modules\/.*zod/.test(cf.url),
  'superjson serialize': (cf) => /superjson/.test(cf.url),
  'react-dom server render': (cf) => /react-dom.*server/.test(cf.url),
  'remix server runtime': (cf) => /@remix-run\/(server-runtime|router|node)/.test(cf.url),
  'protobuf (bufbuild)': (cf) => /@bufbuild\/protobuf/.test(cf.url),
  'connect / grpc-web transport': (cf) => /@connectrpc/.test(cf.url),
  'console / logging': (cf) =>
    /^(log|warn|error|info|formatWithOptions|inspect|formatValue)$/.test(cf.functionName) &&
    (!cf.url || /node:internal\/(console|util)/.test(cf.url)),
  'JSON.stringify/parse': (cf) => /^(stringify|parse)$/.test(cf.functionName) && !cf.url,
  'happy-dom (SSR document HTML)': (cf) => /happy-dom/.test(cf.url),
  renderDocumentToHTML: (cf) => cf.functionName === 'renderDocumentToHTML',
  'tanstack query': (cf) => /@tanstack/.test(cf.url),
  'garbage collector': (cf) => cf.functionName === '(garbage collector)',
}
const incl = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, 0]))
for (const [id, w] of weight) {
  const seen = new Set()
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const cf = byId.get(cur).callFrame
    for (const [name, test] of Object.entries(CATEGORIES)) {
      if (!seen.has(name) && test(cf)) {
        seen.add(name)
        incl[name] += w
      }
    }
  }
}

const pct = (w) => `${((w / busy) * 100).toFixed(1).padStart(5)}%`
console.log(
  `busy ${(busy / 1000).toFixed(0)} ms of ${(total / 1000).toFixed(0)} ms sampled (percentages are of busy time)\n`,
)
console.log('Inclusive time by cost centre:')
for (const [name, w] of Object.entries(incl).sort((a, b) => b[1] - a[1])) console.log(`  ${pct(w)}  ${name}`)
console.log(`\nTop ${topN} functions by self time:`)
for (const [key, w] of [...self]
  .filter(([k]) => !IDLE.has(k.split(' ')[0]) || k.startsWith('(garbage'))
  .sort((a, b) => b[1] - a[1])
  .slice(0, topN)) {
  console.log(`  ${pct(w)}  ${key}`)
}

const callersIdx = rest.indexOf('--callers')
if (callersIdx !== -1) {
  const re = new RegExp(rest[callersIdx + 1])
  const matches = (cf) => re.test(cf.url) || re.test(cf.functionName)
  const byCaller = new Map()
  let matched = 0
  for (const [id, w] of weight) {
    let outer
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) if (matches(byId.get(cur).callFrame)) outer = cur
    if (outer === undefined) continue
    matched += w
    const chain = []
    for (let cur = parent.get(outer); cur !== undefined && chain.length < 3; cur = parent.get(cur)) {
      chain.push(label(byId.get(cur)))
    }
    const key = chain.join('  <-  ')
    byCaller.set(key, (byCaller.get(key) || 0) + w)
  }
  console.log(`\nCallers of /${re.source}/ (${pct(matched)} inclusive):`)
  for (const [key, w] of [...byCaller].sort((a, b) => b[1] - a[1]).slice(0, topN)) console.log(`  ${pct(w)}  ${key}`)
}

const fnIdx = rest.indexOf('--fn')
if (fnIdx !== -1) {
  const names = rest[fnIdx + 1].split(',')
  const fnIncl = Object.fromEntries(names.map((n) => [n, 0]))
  for (const [id, w] of weight) {
    const seen = new Set()
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const name = byId.get(cur).callFrame.functionName
      if (Object.hasOwn(fnIncl, name) && !seen.has(name)) {
        seen.add(name)
        fnIncl[name] += w
      }
    }
  }
  console.log('\nInclusive time by function name:')
  for (const [name, w] of Object.entries(fnIncl)) console.log(`  ${pct(w)}  ${name}`)
}
