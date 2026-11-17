// The concept rule for hypermedia/: a page that uses a term links the page that defines it.
//
//   node scripts/hypermedia/concepts.mjs            # report every page that names a concept without linking its page
//   node scripts/hypermedia/concepts.mjs --fix      # link the first mention on each such page
//   node scripts/hypermedia/concepts.mjs --terms    # print the registry: term, how it is matched, defining page
//
// The registry is the two glossaries, so a term is defined in exactly one place:
//
//   glossary.md        - **Term, alias.** Definition. See [Page](./path.md).      the first link after "See" defines it
//   agent/glossary.md  - [term](./page.md): definition.                            the link on the term defines it
//                      - term: another word for a [session](./session.md).        the first link defines it
//
// A term is matched as a whole word, in running text only: not in code blocks, headings, existing links or
// HTML comments. How a term is matched:
//
//   prose   any case, with a plural `s`               (blob, capability, wake source)
//   exact   as the agent glossary spells it           (Space, Log, Runs: the agent's nouns, plain English in lower case)
//   code    only inside backticks                     (`read`, `plan`: the agent verbs, which are plain English verbs)
//   off     never checked                             (file, page, key…: too often used in their everyday sense)
//
// A page satisfies a term when it links the defining page anywhere, is that page, or is a glossary.
// check.mjs runs this; `--fix` is the way to make a new page pass.

import {readFileSync, writeFileSync} from 'node:fs'
import {posix, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {HM_DIR} from './names.mjs'
import {listPageFiles} from './tree.mjs'

const GLOSSARIES = ['glossary.md', 'agent/glossary.md']

/** Words whose everyday sense is too common for a link to be right every time. */
const OFF = new Set(
  `file files page pages key keys link links path paths version versions name names role roles change
   changes tool tools app apps peer peers type types schema schemas kind value values node list map
   string read write call plan step log child brief script park contract memory turn thread threads run
   runs home draft drafts query queries attachment status continuation condition claim subscription
   collaborator receipt journal promotion grants grant firing actor resource resources directory
   history latest authority follow join member members push head generation library union alias
   redirect discovery relay literal variant primitive mention mentions embed embeds collection revision
   stash fork branch republish projection extension generic envelope include property reference op ts
   operation timestamp metadata attributes discussion citation backlink signature annotation visibility
   assistant model provider owner writer public private delegate sync profile profiles contact contacts node nodes workflow workflows
   program programs gate gates host hosts source sources arm arms inspector sandbox`.split(/\s+/),
)
/** Terms matched only in backticks: the agent's verbs and other names that read as plain English. */
const CODE = new Set(
  'read write call plan step delegate status continue_session script park brief child contract execute search query attributes'.split(
    ' ',
  ),
)
/** Terms matched exactly as the glossary spells them. */
const EXACT = new Set(['Space', 'Log', 'Runs'])

/** Places where a registered word is used in another sense and no link would be right: {file: [terms]}. */
const EXCEPTIONS = {}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The registry: [{term, mode, page, source}] from the glossaries. */
export function loadRegistry(dir = HM_DIR) {
  const entries = []
  const seen = new Set()
  const add = (term, page, source) => {
    term = term.trim().replace(/`/g, '')
    // "Operation (op)" names a term and a short form.
    const paren = /^(.*?)\s*\((.+)\)$/.exec(term)
    if (paren) {
      add(paren[1], page, source)
      add(paren[2], page, source)
      return
    }
    if (!term || term.length < 3 || !page || /\band\b/.test(term)) return
    const key = `${source} ${term.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    const lower = term.toLowerCase()
    const mode = EXACT.has(term) && source === 'agent/glossary.md' ? 'exact' : CODE.has(lower) ? 'code' : OFF.has(lower) ? 'off' : 'prose'
    entries.push({term, mode, page, source})
  }
  for (const file of GLOSSARIES) {
    const base = posix.dirname(file)
    const target = (link) => posix.normalize(posix.join(base, link.replace(/[#?].*$/, '')))
    for (const raw of readFileSync(resolve(dir, file), 'utf8').split('\n')) {
      const line = raw.replace(/<!--.*?-->/g, '').trim()
      // - **Term, alias.** … See [Page](./path.md).
      let m = /^-\s+\*\*(.+?)\.?\*\*\.?\s+(.*)$/.exec(line)
      if (m) {
        const see = /\bSee\b[^[]*\[[^\]]*\]\((\.{1,2}\/[^)\s]+\.md[^)\s]*)\)/.exec(m[2]) || /\[[^\]]*\]\((\.{1,2}\/[^)\s]+\.md[^)\s]*)\)/.exec(m[2])
        if (see) for (const term of m[1].split(/,\s*|\s+or\s+/)) add(term, target(see[1]), file)
        continue
      }
      // - [term](./page.md): …
      m = /^-\s+\[([^\]]+)\]\((\.{1,2}\/[^)\s]+\.md[^)\s]*)\)\s*[:,]/.exec(line)
      if (m) {
        add(m[1], target(m[2]), file)
        continue
      }
      // - term: … [x](./x.md)
      m = /^-\s+([^:[\]]{3,40}):\s+.*?\[[^\]]*\]\((\.{1,2}\/[^)\s]+\.md[^)\s]*)\)/.exec(line)
      if (m) add(m[1], target(m[2]), file)
    }
  }
  return entries.filter((e) => e.mode !== 'off')
}

const matcher = ({term, mode}) => {
  if (mode === 'code') return new RegExp('`' + escapeRe(term) + '`', 'g')
  const body = escapeRe(term).replace(/\\?[ -]/g, '[ -]')
  return new RegExp(`(?<![\\w/.\`-])${body}(?:e?s)?(?![\\w/\`-])`, mode === 'exact' ? 'g' : 'gi')
}

/** The same line with everything that is not running text blanked out, so offsets still line up. */
function maskLine(line, keepCode) {
  const blank = (s) => ' '.repeat(s.length)
  let out = line.replace(/<!--.*?-->/g, blank)
  out = out.replace(/!?\[(?:[^\[\]]|\[[^\]]*\])*\]\([^)]*\)/g, blank) // links and images, label included
  out = out.replace(/<[^<>\s]+>/g, blank) // autolinks and embeds
  if (!keepCode) out = out.replace(/`[^`]*`/g, blank)
  return out
}

/** The lines of a page that hold running text: [{index, text}] (no frontmatter, code fences, headings or embeds). */
function proseLines(text) {
  const lines = text.split('\n')
  const out = []
  let inFront = lines[0] === '---'
  let inCode = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (inFront) {
      if (i > 0 && line === '---') inFront = false
      continue
    }
    if (/^\s*(```|\$\$)/.test(line)) {
      inCode = !inCode
      continue
    }
    if (inCode || /^\s*#{1,6}\s/.test(line) || /type:(Embed|Query)/.test(line) || /^\s*\|\s*:?-{3}/.test(line)) continue
    out.push({index: i, text: line})
  }
  return {lines, prose: out}
}

/** The pages a page links, as files relative to the folder. */
function linkedPages(file, text) {
  const out = new Set()
  for (const m of text.matchAll(/[(<](\.{1,2}\/[^)\s<>#?]+\.md)(?:[#?][^)\s<>]*)?[)>]/g))
    out.add(posix.normalize(posix.join(posix.dirname(file), m[1])))
  return out
}

/** Every (page, term) where the page names the term in running text and does not link its defining page. */
export function findUnlinkedConcepts(dir = HM_DIR, registry = loadRegistry(dir)) {
  const problems = []
  const all = registry.map((e) => ({...e, re: matcher(e)}))
  // The agent glossary speaks for the agent pages, where its words (Space, Log, session) have their own meaning.
  const agentTerms = new Set(all.filter((e) => e.source === 'agent/glossary.md').map((e) => e.term.toLowerCase()))
  const general = all.filter((e) => e.source !== 'agent/glossary.md')
  const forAgentPages = all.filter((e) => e.source === 'agent/glossary.md' || !agentTerms.has(e.term.toLowerCase()))
  // A term inside a longer term belongs to the longer one.
  const longer = new Map(
    all.map((e) => [
      e,
      all
        .filter((o) => o !== e && o.term.length > e.term.length && o.term.toLowerCase().includes(e.term.toLowerCase()))
        .map((o) => new RegExp(o.re.source, 'gi')),
    ]),
  )
  for (const file of listPageFiles(dir)) {
    if (GLOSSARIES.includes(file)) continue
    const compiled = file === 'agent.md' || file.startsWith('agent/') ? forAgentPages : general
    const text = readFileSync(resolve(dir, file), 'utf8')
    const linked = linkedPages(file, text)
    const {prose} = proseLines(text)
    for (const entry of compiled) {
      if (entry.page === file || linked.has(entry.page)) continue
      let found = null
      for (const {index, text: line} of prose) {
        const masked = maskLine(line, entry.mode === 'code')
        entry.re.lastIndex = 0
        for (let m; (m = entry.re.exec(masked)); ) {
          // `AGENT` is a role name, not the word agent; "Space index" is its own term, not a Space.
          const shouting = m[0] === m[0].toUpperCase() && entry.term !== entry.term.toUpperCase() && /[A-Z]{3}/.test(m[0])
          const insideLonger = (longer.get(entry) || []).some((re) => {
            re.lastIndex = 0
            for (let l; (l = re.exec(masked)); ) if (l.index <= m.index && l.index + l[0].length >= m.index + m[0].length) return true
            return false
          })
          if (shouting || insideLonger) continue
          found = {file, term: entry.term, page: entry.page, line: index, start: m.index, length: m[0].length}
          break
        }
        if (found) break
      }
      if (found && !(EXCEPTIONS[file] || []).includes(entry.term)) problems.push(found)
    }
  }
  return problems
}

/** Link the first mention of each unlinked concept. Returns the number of links added. */
export function fixUnlinkedConcepts(dir = HM_DIR) {
  let added = 0
  // One link per pass and page line keeps offsets simple; repeat until nothing is left to link.
  for (let pass = 0; pass < 50; pass++) {
    const byFile = new Map()
    for (const p of findUnlinkedConcepts(dir)) if (!byFile.has(p.file)) byFile.set(p.file, p)
    if (!byFile.size) break
    for (const [file, p] of byFile) {
      const path = resolve(dir, file)
      const lines = readFileSync(path, 'utf8').split('\n')
      const line = lines[p.line]
      const label = line.slice(p.start, p.start + p.length)
      const rel = posix.relative(posix.dirname(file), p.page)
      const href = rel.startsWith('.') ? rel : `./${rel}`
      lines[p.line] = `${line.slice(0, p.start)}[${label}](${href})${line.slice(p.start + p.length)}`
      writeFileSync(path, lines.join('\n'))
      added++
    }
  }
  return added
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--terms')) {
    for (const e of loadRegistry()) console.log(`${e.mode.padEnd(5)} ${e.term.padEnd(34)} ${e.page}`)
    process.exit(0)
  }
  if (process.argv.includes('--fix')) console.log(`linked ${fixUnlinkedConcepts()} first mention(s)`)
  const problems = findUnlinkedConcepts()
  for (const p of problems) console.error(`${p.file}:${p.line + 1}: "${p.term}" is used but ${p.page} is not linked`)
  if (problems.length) {
    console.error(`\n${problems.length} concept(s) used without a link to the page that defines them. \`node scripts/hypermedia/concepts.mjs --fix\` links the first mention.`)
    process.exit(1)
  }
  console.log(`Every concept a page names is linked to the page that defines it (${loadRegistry().length} terms).`)
}
