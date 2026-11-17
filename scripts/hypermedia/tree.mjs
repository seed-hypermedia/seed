// The tree rule for hypermedia/: every page has a parent page, and every parent shows a card of each child.
//
//   node scripts/hypermedia/tree.mjs          # report what breaks the rule, exit 1 if anything does
//   node scripts/hypermedia/tree.mjs --fix    # append the missing child cards to their parent pages
//
// A page publishes at its path, and a folder's landing page sits beside the folder (`protocol.md` is the
// parent of `protocol/*.md`, `index.md` of every root page). A folder without its landing page publishes
// children under an address that holds no document, so the site shows them with no way up. A parent lists
// a child with a Card embed block:
//
//   <./protocol/documents.md> <!-- id:Ab3dE6gH type:Embed attrs:{"view":"Card"} -->
//
// check.mjs runs this offline; the sync (`requireChildCards` in frontend/apps/cli/src/sync-hypermedia.ts)
// runs the same rule on the parsed blocks and refuses to publish. `--fix` only adds cards, at the end of
// the parent page: move them where they belong. A missing parent page has to be written by hand.

import {randomBytes} from 'node:crypto'
import {readdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, posix, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {HM_DIR} from './names.mjs'

/** Every published markdown file under `dir`, relative with forward slashes, sorted. */
export function listPageFiles(dir = HM_DIR) {
  const out = []
  const walk = (d, prefix) => {
    for (const entry of readdirSync(d, {withFileTypes: true})) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(resolve(d, entry.name), `${prefix}${entry.name}/`)
      } else if (entry.name.endsWith('.md') && `${prefix}${entry.name}` !== 'README.md') {
        out.push(`${prefix}${entry.name}`)
      }
    }
  }
  walk(dir, '')
  return out.sort()
}

/** The file one level up: `a/b.md` is under `a.md`, `a.md` under `index.md`, which has no parent. */
export function parentFile(file) {
  if (file === 'index.md') return null
  const dir = posix.dirname(file)
  return dir === '.' ? 'index.md' : `${dir}.md`
}

const CARD_LINE = /^\s*<([^\s<>]+)>\s*<!--\s*id:\S+\s+type:Embed\s+attrs:(\{.*\})\s*-->\s*$/

/** The files a page's Card embeds point at. */
export function cardTargets(file, text) {
  const targets = new Set()
  let inCode = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) inCode = !inCode
    if (inCode) continue
    const m = CARD_LINE.exec(line)
    if (!m) continue
    let attrs
    try {
      attrs = JSON.parse(m[2])
    } catch {
      continue
    }
    if (attrs.view !== 'Card') continue
    const link = m[1].replace(/[#?].*$/, '')
    const own = /^hm:\/\/hyper\.media(\/.*)?$/.exec(link)
    if (own) targets.add(own[1] ? `${own[1].slice(1)}.md` : 'index.md')
    else if (/^\.{1,2}\//.test(link)) targets.add(posix.normalize(posix.join(posix.dirname(file), link)))
  }
  return targets
}

/** The link a parent page writes for a child: `./protocol/documents.md` from `protocol.md`. */
export function cardLink(parent, child) {
  return `./${posix.relative(posix.dirname(parent), child)}`
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const newBlockId = () => Array.from(randomBytes(8), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('')

/** A Card embed block of `child`, as a line of `parent`. */
export function cardLine(parent, child) {
  return `<${cardLink(parent, child)}> <!-- id:${newBlockId()} type:Embed attrs:{"view":"Card"} -->`
}

/**
 * What breaks the rule: `missingParents` maps a parent file that does not exist to its children,
 * `missingCards` maps an existing parent to the children it shows no card of.
 */
export function findTreeProblems(dir = HM_DIR) {
  const files = listPageFiles(dir)
  const all = new Set(files)
  const cards = new Map()
  const cardsOf = (file) => {
    if (!cards.has(file)) cards.set(file, cardTargets(file, readFileSync(resolve(dir, file), 'utf8')))
    return cards.get(file)
  }
  const missingParents = new Map()
  const missingCards = new Map()
  const add = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value])
  if (!all.has('index.md')) add(missingParents, 'index.md', '(every page)')
  for (const file of files) {
    const parent = parentFile(file)
    if (parent === null) continue
    if (!all.has(parent)) add(missingParents, parent, file)
    else if (!cardsOf(parent).has(file)) add(missingCards, parent, file)
  }
  return {files, missingParents, missingCards}
}

/** Append the missing cards to each parent page. Returns the files written. */
export function fixMissingCards(dir = HM_DIR) {
  const {missingCards} = findTreeProblems(dir)
  for (const [parent, children] of missingCards) {
    const path = resolve(dir, parent)
    const text = readFileSync(path, 'utf8').replace(/\n*$/, '\n')
    writeFileSync(path, `${text}\n${children.map((child) => cardLine(parent, child)).join('\n\n')}\n`)
  }
  return [...missingCards.keys()]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--fix')) {
    const written = fixMissingCards()
    for (const file of written) console.log(`added cards to ${file}`)
  }
  const {files, missingParents, missingCards} = findTreeProblems()
  for (const [parent, children] of missingParents)
    console.error(`${parent}: missing. It is the parent page of ${children.length} page(s): ${children.slice(0, 4).join(', ')}${children.length > 4 ? ', …' : ''}`)
  for (const [parent, children] of missingCards)
    for (const child of children) console.error(`${parent}: no Card embed of its child ${child}`)
  const count = missingParents.size + [...missingCards.values()].reduce((n, c) => n + c.length, 0)
  if (count) {
    console.error(`\n${count} tree problem(s). Write the missing parent pages; \`node scripts/hypermedia/tree.mjs --fix\` adds the cards.`)
    process.exit(1)
  }
  console.log(`hypermedia/ tree is whole: ${files.length} pages, each with a parent that shows its card.`)
}
