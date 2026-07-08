#!/usr/bin/env node
/**
 * SSR parity harness: compares the pre-hydration server-rendered paint
 * (JavaScript disabled) against the fully hydrated page, per URL.
 *
 * Reports per-page pixel diff (pixelmatch) and writes diff images for any
 * page over threshold. Used to prove the editor-mount swap is visually
 * invisible.
 *
 * Usage:
 *   node scripts/ssr-parity-check.mjs [--base http://localhost:3000] \
 *     [--width 1280] [--height 2000] [--out /tmp/ssr-parity] [paths...]
 */
import {mkdirSync, writeFileSync} from 'fs'
import {createRequire} from 'module'
import {join} from 'path'

const require = createRequire(import.meta.url)
const {chromium} = require('playwright')
const {PNG} = require('pngjs')
const pixelmatch = require('pixelmatch')

const args = process.argv.slice(2)
function opt(name, dflt) {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return dflt
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const BASE = opt('base', 'http://localhost:3000')
const WIDTH = parseInt(opt('width', '1280'), 10)
const HEIGHT = parseInt(opt('height', '2000'), 10)
const OUT = opt('out', '/tmp/ssr-parity')
const PATHS = args.length
  ? args
  : [
      '/',
      '/notes',
      '/issues',
      '/projects',
      '/design',
      '/tech-talks/document-block-types',
      '/tech-talks/ssr-performance-optimization-plan',
      '/notes/datoms-and-rdf',
      '/notes/knowledge-base-sketches-and-ideas',
      '/tech-talks/improving-editor-block-rendering',
      '/tech-talks/system-components',
      '/tech-talks/performance',
    ]

mkdirSync(OUT, {recursive: true})

async function shoot(browser, path, js) {
  const ctx = await browser.newContext({javaScriptEnabled: js, viewport: {width: WIDTH, height: HEIGHT}})
  const page = await ctx.newPage()
  try {
    await page.goto(BASE + path, {waitUntil: 'networkidle', timeout: 45000})
  } catch {
    // Pages with third-party iframes may never reach networkidle.
    await page.waitForTimeout(4000)
  }
  // Hydrated pages need time for the editor mount + image settle; the
  // JS-disabled paint only needs images.
  await page.waitForTimeout(js ? 3000 : 800)
  const shot = await page.screenshot()
  await ctx.close()
  return shot
}

const browser = await chromium.launch()
let failures = 0
for (const path of PATHS) {
  const slug = path.replace(/\W+/g, '_').replace(/^_+|_+$/g, '') || 'home'
  try {
    const [ssrShot, hydShot] = [await shoot(browser, path, false), await shoot(browser, path, true)]
    const a = PNG.sync.read(ssrShot)
    const b = PNG.sync.read(hydShot)
    if (a.width !== b.width || a.height !== b.height) {
      console.log(`${path}  SIZE MISMATCH ${a.width}x${a.height} vs ${b.width}x${b.height}`)
      failures++
      continue
    }
    const diff = new PNG({width: a.width, height: a.height})
    const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {threshold: 0.1})
    const pct = (100 * n) / (a.width * a.height)
    const ok = n === 0
    console.log(`${ok ? 'OK  ' : 'DIFF'} ${path}  ${n}px (${pct.toFixed(3)}%)`)
    if (!ok) {
      failures++
      writeFileSync(join(OUT, `${slug}.ssr.png`), ssrShot)
      writeFileSync(join(OUT, `${slug}.hyd.png`), hydShot)
      writeFileSync(join(OUT, `${slug}.diff.png`), PNG.sync.write(diff))
    }
  } catch (e) {
    console.log(`ERR  ${path}  ${e.message.slice(0, 120)}`)
    failures++
  }
}
await browser.close()
console.log(failures === 0 ? '\nAll pages pixel-identical.' : `\n${failures} page(s) differ — images in ${OUT}`)
process.exit(failures === 0 ? 0 : 1)
