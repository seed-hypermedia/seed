// Claude Code PostToolUse hook: formats every file an agent writes with the repo's Prettier,
// so unformatted code can never reach a commit. Editors give humans format-on-save
// (.vscode/settings.json); this is the agent equivalent. Wired up in .claude/settings.json.
//
// Always exits 0: a formatter problem must not block the edit itself, and CI's
// `format:check` remains the backstop.
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {resolve, sep} from 'node:path'

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
try {
  const payload = JSON.parse(readFileSync(0, 'utf8'))
  const file = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path ?? payload?.tool_response?.filePath
  if (!file) process.exit(0)
  const abs = resolve(root, file)
  if (abs !== root && !abs.startsWith(root + sep)) process.exit(0)
  execFileSync(resolve(root, 'node_modules/.bin/prettier'), ['--ignore-unknown', '--write', abs], {
    cwd: root,
    stdio: 'ignore',
  })
} catch {}
process.exit(0)
