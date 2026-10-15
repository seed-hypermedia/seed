import {FiltersEngine} from '@ghostery/adblocker'
import {readFileSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

// Build an offline snapshot from full upstream lists supplied locally. No network access is used.
const directory = new URL('../src/browser-filter-lists/', import.meta.url)
const sources = ['easylist', 'easyprivacy'].map((name) => {
  const bytes = readFileSync(new URL(`${name}.txt`, directory))
  if (bytes.length > 8 * 1024 * 1024) throw new Error(`${name} exceeds the 8 MiB list limit`)
  const text = bytes.toString('utf8')
  if (!text.startsWith('[Adblock') || !text.includes('\n||')) throw new Error(`Invalid ${name} list`)
  return {
    name,
    url: `https://easylist.to/easylist/${name}.txt`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    text,
  }
})
const bytes = FiltersEngine.parse(sources.map((source) => source.text).join('\n'), {
  loadCosmeticFilters: false,
}).serialize()
if (bytes.length > 16 * 1024 * 1024) throw new Error('Engine exceeds the 16 MiB limit')
const output = new URL('engine.json', directory)
writeFileSync(
  output,
  JSON.stringify(
    {sources: sources.map(({text, ...source}) => source), engine: Buffer.from(bytes).toString('base64')},
    null,
    2,
  ) + '\n',
)
console.log(`Wrote ${bytes.length} engine bytes to ${fileURLToPath(output)}`)
