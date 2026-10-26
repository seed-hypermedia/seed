// Runs Electronegativity over the desktop app and fails on HIGH-severity findings with FIRM or
// CERTAIN confidence. Lower severities are printed for review but do not fail the build; the
// desktop sets contextIsolation and sandbox explicitly, so a new HIGH finding means a new window
// or preload was added without them.
//
// Usage: node scripts/electron-static-scan.mjs [report.csv]
import {spawnSync} from 'node:child_process'
import {existsSync, readFileSync, unlinkSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronVersion = JSON.parse(
  readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'),
).devDependencies.electron.replace(/^[^\d]*/, '')
const report = path.resolve(process.argv[2] ?? path.join(desktopRoot, 'electronegativity.csv'))
if (existsSync(report)) unlinkSync(report)

const scan = spawnSync(
  'npx',
  // -x means "exclude checks" in this tool, not paths; it skips node_modules on its own.
  ['--yes', '@doyensec/electronegativity@1.10.3', '-i', desktopRoot, '-o', report, '-e', electronVersion],
  {stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8'},
)
if (!existsSync(report)) {
  console.error(scan.stdout, scan.stderr)
  console.error('electronegativity produced no report')
  process.exit(1)
}

// The CSV quotes every field after the first; a sample can contain commas, so parse by regex.
const rows = readFileSync(report, 'utf8')
  .split('\n')
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const match = /^([A-Z_]+),"([A-Z]+)","([A-Z]+)","([^"]*)","([^"]*)"/.exec(line)
    return match && {issue: match[1], severity: match[2], confidence: match[3], file: match[4], location: match[5]}
  })
  .filter(Boolean)

const blocking = rows.filter((row) => row.severity === 'HIGH' && row.confidence !== 'TENTATIVE')
for (const row of rows) {
  const relative = path.relative(desktopRoot, row.file)
  console.log(`${row.severity.padEnd(6)} ${row.confidence.padEnd(9)} ${row.issue} ${relative}:${row.location}`)
}
console.log(`\n${rows.length} findings, ${blocking.length} blocking (HIGH, not tentative)`)
if (blocking.length) process.exit(1)
