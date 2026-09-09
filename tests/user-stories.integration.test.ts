/**
 * User stories, on the CLI and through an agent — the executable form of the CLI and agent
 * columns in hypermedia/user-stories.md. (The app column is the desktop e2e suite,
 * frontend/apps/desktop/tests/user-stories/.)
 *
 * One real environment for both: a daemon and the built web app, which serves the HM API the
 * CLI and the agents service publish through. Every `it` is one step a person takes; every
 * `it.todo` is a step the page marks missing, phrased as the command or call it should become.
 * The page's status columns are what this file says.
 *
 *   cd tests && pnpm test -- user-stories        (SKIP_BUILD=true to reuse a built web app)
 */
import {spawn} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {generateTestAccount, registerAccount, type TestAccount} from '../frontend/apps/cli/src/test/account-helpers'
import {setupTestEnv, type TestEnv} from './integration'

const REPO = path.resolve(__dirname, '..')
const CLI = path.join(REPO, 'frontend/apps/cli')
const AGENTS = path.join(REPO, 'agents')
const ONYX = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'
const KIND = (k: string) => `${ONYX}/hypermedia-${k}`
const TIMEOUT = 180_000

let env: TestEnv
let author: TestAccount
let workDir: string

type Run = {stdout: string; stderr: string; exitCode: number}
function run(cmd: string, args: string[], opts: {cwd: string; env?: Record<string, string>}): Promise<Run> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      env: {...process.env, ...opts.env},
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d))
    proc.stderr.on('data', (d) => (stderr += d))
    proc.on('close', (code) => resolve({stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0}))
  })
}

/** The CLI, against the environment's HM API, signing as the story's author (a mnemonic in the environment, as CI does). */
const cli = (args: string[]) =>
  run('bun', ['run', 'src/index.ts', '--server', env.web.baseUrl, ...args], {
    cwd: CLI,
    env: {SEED_CLI_MNEMONIC: author.mnemonic, FORCE_COLOR: '0'},
  })
async function cliJson<T = any>(args: string[]): Promise<T> {
  const result = await cli([...args, '--json'])
  if (result.exitCode !== 0) throw new Error(`cli ${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`)
  const parsed = JSON.parse(result.stdout) as any
  // `document get --json` answers with the resource: {type: 'document', document: {...}}.
  if (args[0] === 'document' && args[1] === 'get') {
    if (parsed?.type !== 'document' || !parsed.document?.metadata)
      throw new Error(`document get did not return a document for ${args[2]}:\n${result.stdout.slice(0, 600)}`)
    return parsed.document as T
  }
  return parsed as T
}
const url = (p: string) => `hm://${author.accountId}${p ? '/' + p : ''}`
const write = (rel: string, content: string) => {
  const file = path.join(workDir, rel)
  mkdirSync(path.dirname(file), {recursive: true})
  writeFileSync(file, content)
  return file
}

beforeAll(async () => {
  env = await setupTestEnv({skipBuild: process.env.SKIP_BUILD === 'true'})
  author = generateTestAccount()
  await registerAccount(env.web.baseUrl, author, 'Story Author')
  workDir = mkdtempSync(path.join(tmpdir(), 'seed-user-stories-'))
}, 600_000)

afterAll(async () => {
  if (workDir) rmSync(workDir, {recursive: true, force: true})
  await env?.cleanup()
})

// ── The CLI ──────────────────────────────────────────────────────────────────

describe('CLI · 1. Understand the document model', () => {
  it(
    'document get --md shows metadata as frontmatter and blocks with ids',
    async () => {
      const notes = write('notes.md', '---\nname: Notes\n---\nA first paragraph.\n\nA second paragraph.\n')
      const created = await cli(['document', 'create', '-f', notes, '-p', 'notes'])
      expect(created.exitCode, created.stderr).toBe(0)
      const md = await cli(['document', 'get', '--md', url('notes')])
      expect(md.exitCode, md.stderr).toBe(0)
      expect(md.stdout).toContain('name: Notes')
      expect(md.stdout).toContain('A first paragraph.')
      expect(md.stdout).toMatch(/<!-- id:[A-Za-z0-9_-]+ -->/)
    },
    TIMEOUT,
  )

  it(
    'document get --json is the document as the API returns it: metadata and a block tree',
    async () => {
      const doc = await cliJson(['document', 'get', url('notes')])
      expect(doc.metadata?.name).toBe('Notes')
      expect(doc.content?.[0]?.block?.type).toBe('Paragraph')
    },
    TIMEOUT,
  )

  it.todo('document schema <id> — the effective schema a document conforms to, resolved and printed')
})

describe('CLI · 2. Give a document custom metadata', () => {
  it(
    'space export → add a custom key in frontmatter → space import publishes it',
    async () => {
      const dir = path.join(workDir, 'site')
      const exported = await cli(['space', 'export', url(''), '-d', dir])
      expect(exported.exitCode, exported.stderr).toBe(0)
      const file = path.join(dir, 'notes.md')
      const before = readFileSync(file, 'utf8')
      expect(before.startsWith('---\n')).toBe(true)
      writeFileSync(file, before.replace(/^---\n/, `---\nsurname: Smith\nschema: ${url('types/person')}\n`))
      const imported = await cli(['space', 'import', 'self', '-d', dir])
      expect(imported.exitCode, imported.stderr).toBe(0)
      const doc = await cliJson(['document', 'get', url('notes')])
      expect(doc.metadata.surname).toBe('Smith')
      expect(doc.metadata.schema).toBe(url('types/person'))
    },
    TIMEOUT,
  )

  it.todo(`document update <id> --metadata '{"surname":"Smith"}' sets a custom key`)
  it.todo('document create -f page.md keeps custom frontmatter keys instead of dropping them')
})

describe('CLI · 3. Give the direct children of a document a type', () => {
  it(
    'childrenSchema on a folder, published through space import, is read back on the folder',
    async () => {
      const dir = path.join(workDir, 'site')
      write('site/people.md', `---\nname: People\nchildrenSchema: ${url('types/person')}\n---\nEveryone we know.\n`)
      const imported = await cli(['space', 'import', 'self', '-d', dir])
      expect(imported.exitCode, imported.stderr).toBe(0)
      const folder = await cliJson(['document', 'get', url('people')])
      expect(folder.metadata.childrenSchema).toBe(url('types/person'))
    },
    TIMEOUT,
  )

  it(
    'a page created under the folder carries no schema of its own (the type is inherited)',
    async () => {
      const bob = write('bob.md', '---\nname: Bob\n---\nBob is a person.\n')
      const created = await cli(['document', 'create', '-f', bob, '-p', 'people/bob'])
      expect(created.exitCode, created.stderr).toBe(0)
      const doc = await cliJson(['document', 'get', url('people/bob')])
      expect(doc.metadata.schema).toBeUndefined()
    },
    TIMEOUT,
  )

  it.todo(`document update <folder> --metadata '{"childrenSchema":"hm://…/types/person"}'`)
})

describe('CLI · 4. See whether a document respects its schema', () => {
  it.todo('document validate <id> resolves the effective schema and prints each violation (exit 1 when any)')
  it.todo('space import --check validates every file against its schema before publishing')
})

describe('CLI · 5. Define a custom schema as a document', () => {
  it(
    'a .schema.json beside a page is published as a blob and bound as the page’s schemaDefinition',
    async () => {
      const dir = path.join(workDir, 'site')
      write('site/types.md', '---\nname: Types\n---\nThe types of this space.\n')
      write('site/types/person.md', '---\nname: Person\n---\nA person: a name and an optional birth date.\n')
      write(
        'site/types/person.schema.json',
        JSON.stringify(
          {
            type: KIND('struct'),
            properties: {
              name: {value: {type: KIND('string')}, required: true, description: 'Full name'},
              born: {value: {type: KIND('string'), format: 'date'}},
            },
          },
          null,
          2,
        ) + '\n',
      )
      const imported = await cli(['space', 'import', 'self', '-d', dir])
      expect(imported.exitCode, imported.stderr).toBe(0)
      const page = await cliJson(['document', 'get', url('types/person')])
      expect(page.metadata.schemaDefinition).toMatch(/^ipfs:\/\/bafy/)
    },
    TIMEOUT,
  )

  it(
    'document cid <cid> reads the schema blob back',
    async () => {
      const page = await cliJson(['document', 'get', url('types/person')])
      const blob = await cli(['document', 'cid', page.metadata.schemaDefinition.replace('ipfs://', '')])
      expect(blob.exitCode, blob.stderr).toBe(0)
      expect(blob.stdout).toContain('Full name')
    },
    TIMEOUT,
  )

  it.todo('document create --schema-definition person.schema.json publishes a type page in one command')
  it.todo('schema validate person.schema.json checks a schema file against the meta-schema')
})

describe('CLI · 6. Create a blob that follows a custom schema exactly', () => {
  it.todo('blob validate --schema hm://…/types/person -f bob.json prints violations')
  it.todo(
    'blob create --schema hm://…/types/person -f bob.json publishes a conforming DAG-CBOR object with a schema link',
  )
})

describe('CLI · 7. Extend the signed blob envelope into a new signed type', () => {
  it(
    'a schema that extends hypermedia-blob with a literal type tag publishes as a signed type page',
    async () => {
      const dir = path.join(workDir, 'site')
      write('site/types/vote.md', '---\nname: Vote\n---\nA signed vote on a document.\n')
      write(
        'site/types/vote.schema.json',
        JSON.stringify(
          {
            ref: `${ONYX}/hypermedia-blob`,
            properties: {
              type: {value: 'Vote', required: true},
              target: {value: {ref: `${ONYX}/hypermedia-hm-url`}, required: true},
              choice: {value: {anyOf: ['yes', 'no']}, required: true},
            },
          },
          null,
          2,
        ) + '\n',
      )
      const imported = await cli(['space', 'import', 'self', '-d', dir])
      expect(imported.exitCode, imported.stderr).toBe(0)
      const page = await cliJson(['document', 'get', url('types/vote')])
      const blob = await cli(['document', 'cid', page.metadata.schemaDefinition.replace('ipfs://', '')])
      expect(blob.stdout).toContain('hypermedia-blob')
      expect(blob.stdout).toContain('"Vote"')
    },
    TIMEOUT,
  )
})

describe('CLI · 8. Create an instance of the signed type and sign it', () => {
  it.todo(
    'blob sign --schema hm://…/types/vote -f vote.json --key <name> fills signer/ts, signs canonical CBOR with sig zeroed, publishes',
  )
  it.todo('blob verify <cid> checks the signature and the schema')
})

// ── An agent ─────────────────────────────────────────────────────────────────
//
// The agents service is Bun-only, so its stories run in agents/scripts/user-stories.ts and
// report one JSON line per step. The steps below are declared here, by name, so each is one
// test; the runner and this list must agree.

type StepReport = {story: string; step: string; status: 'pass' | 'fail' | 'todo'; detail?: string}
let agentSteps: StepReport[] = []
let agentRunnerOutput = ''

describe('Agent', () => {
  beforeAll(async () => {
    const result = await run('bun', ['scripts/user-stories.ts', '--hm-server', env.web.baseUrl], {cwd: AGENTS})
    agentRunnerOutput = `${result.stdout}\n${result.stderr}`
    agentSteps = result.stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as StepReport)
  }, 600_000)

  const passed = (step: string) => {
    const report = agentSteps.find((s) => s.step === step)
    expect(report, `no report for "${step}" — runner output:\n${agentRunnerOutput}`).toBeDefined()
    expect(report!.status, report!.detail).toBe('pass')
  }

  it('setup: a signing identity with the publish grant, an agent, a session', () => {
    const setup = agentSteps.find((s) => s.story === 'setup')
    expect(setup, agentRunnerOutput).toBeDefined()
    expect(setup!.status, setup!.detail).toBe('pass')
  })

  describe('1. Understand the document model', () => {
    it('write a document, then read it back as markdown with its metadata', () =>
      passed('write a document, then read it back as markdown with its metadata'))
    it.todo('read hm://<doc> names the schema the document conforms to and its required fields')
  })
  describe('2. Give a document custom metadata', () => {
    it('write with options.metadata sets custom keys and the schema field', () =>
      passed('write with options.metadata sets custom keys and the schema field'))
  })
  describe('3. Give the direct children of a document a type', () => {
    it('write childrenSchema on a folder; a child written under it carries no schema of its own', () =>
      passed('write childrenSchema on a folder; a child written under it carries no schema of its own'))
  })
  describe('4. See whether a document respects its schema', () => {
    it.todo('a write to a typed document returns schema violations as warnings beside the published id')
    it.todo('a read of a typed document says which required fields are missing')
  })
  describe('5. Define a custom schema as a document', () => {
    it.todo('write ipfs:// with JSON content and options.schema = the meta-schema publishes a schema blob')
    it.todo('write hm://…/types/person with options.metadata.schemaDefinition binds the blob to the page')
  })
  describe('6. Create a blob that follows a custom schema exactly', () => {
    it.todo('write ipfs:// with JSON content and options.schema = hm://…/types/person publishes a validated object')
  })
  describe('7. Extend the signed blob envelope into a new signed type', () => {
    it.todo('write ipfs:// with a schema that refs hypermedia-blob publishes the signed type’s schema blob')
  })
  describe('8. Create an instance of the signed type and sign it', () => {
    it.todo('write ipfs:// with options.schema = hm://…/types/vote and options.sign = true publishes a signed blob')
  })
})
