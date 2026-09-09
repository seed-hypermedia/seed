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

/**
 * The Person type, published as a page with a co-located schema file (story 5's step). Stories
 * 4 and 6 need it too; the import is idempotent, so each caller may run it.
 */
async function publishPersonType(): Promise<Run> {
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
          born: {value: {type: KIND('string'), format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$'}},
        },
      },
      null,
      2,
    ) + '\n',
  )
  return cli(['space', 'import', 'self', '-d', dir])
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

  it(
    'document validate --json names the schema a document conforms to, or says it has none',
    async () => {
      const report = await cliJson(['document', 'validate', url('notes')])
      expect(report.schema).toBeNull()
    },
    TIMEOUT,
  )
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

  it(
    'document update --metadata sets custom keys',
    async () => {
      const updated = await cli([
        'document',
        'update',
        url('notes'),
        '--metadata',
        '{"surname":"Jones","nickname":"Smitty"}',
      ])
      expect(updated.exitCode, updated.stderr).toBe(0)
      const doc = await cliJson(['document', 'get', url('notes')])
      expect(doc.metadata.surname).toBe('Jones')
      expect(doc.metadata.nickname).toBe('Smitty')
    },
    TIMEOUT,
  )
  it(
    'document create -f page.md keeps custom frontmatter keys',
    async () => {
      const page = write('page.md', '---\nname: Page\ncolor: teal\nweight: 3\n---\nA page with attributes.\n')
      const created = await cli(['document', 'create', '-f', page, '-p', 'page'])
      expect(created.exitCode, created.stderr).toBe(0)
      const doc = await cliJson(['document', 'get', url('page')])
      expect(doc.metadata.color).toBe('teal')
      expect(doc.metadata.weight).toBe(3)
    },
    TIMEOUT,
  )
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

  it(
    'document update --children-schema types a folder',
    async () => {
      const created = await cli([
        'document',
        'create',
        '-f',
        write('team.md', '---\nname: Team\n---\nThe team.\n'),
        '-p',
        'team',
      ])
      expect(created.exitCode, created.stderr).toBe(0)
      const updated = await cli(['document', 'update', url('team'), '--children-schema', url('types/person')])
      expect(updated.exitCode, updated.stderr).toBe(0)
      const doc = await cliJson(['document', 'get', url('team')])
      expect(doc.metadata.childrenSchema).toBe(url('types/person'))
    },
    TIMEOUT,
  )
})

describe('CLI · 4. See whether a document respects its schema', () => {
  it(
    'document validate passes a page that conforms to its inherited type',
    async () => {
      const published = await publishPersonType()
      expect(published.exitCode, published.stderr).toBe(0)
      const ok = await cli(['document', 'update', url('people/bob'), '--metadata', '{"born":"1990-01-02"}'])
      expect(ok.exitCode, ok.stderr).toBe(0)
      const result = await cli(['document', 'validate', url('people/bob')])
      expect(result.exitCode, result.stderr + result.stdout).toBe(0)
      const report = await cliJson(['document', 'validate', url('people/bob')])
      expect(report.via).toBe('inherited')
      expect(report.violations).toEqual([])
    },
    TIMEOUT,
  )

  it(
    'document validate lists violations and exits 1',
    async () => {
      const bad = await cli(['document', 'update', url('people/bob'), '--metadata', '{"born":"yesterday"}'])
      expect(bad.exitCode, bad.stderr).toBe(0)
      const result = await cli(['document', 'validate', url('people/bob')])
      expect(result.exitCode).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/born/)
    },
    TIMEOUT,
  )
  it(
    'space import --check refuses to publish a file that violates its schema',
    async () => {
      const dir = path.join(workDir, 'site')
      write('site/people/carol.md', '---\nname: Carol\nborn: not-a-date\n---\nCarol.\n')
      const refused = await cli(['space', 'import', 'self', '-d', dir, '--check'])
      expect(refused.exitCode).toBe(1)
      expect(refused.stdout + refused.stderr).toContain('would violate a schema')
      const missing = await cli(['document', 'get', url('people/carol')])
      expect(missing.exitCode).not.toBe(0)
    },
    TIMEOUT,
  )
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

  it(
    'document create --schema-definition publishes a type page in one command',
    async () => {
      const schemaFile = write(
        'place.schema.json',
        JSON.stringify({type: KIND('struct'), properties: {name: {value: {type: KIND('string')}, required: true}}}) +
          '\n',
      )
      const page = write('place.md', '---\nname: Place\n---\nA place has a name.\n')
      const created = await cli([
        'document',
        'create',
        '-f',
        page,
        '-p',
        'types/place',
        '--schema-definition',
        schemaFile,
      ])
      expect(created.exitCode, created.stderr).toBe(0)
      const doc = await cliJson(['document', 'get', url('types/place')])
      expect(doc.metadata.schemaDefinition).toMatch(/^ipfs:\/\/bafy/)
    },
    TIMEOUT,
  )
  it(
    'schema validate checks a schema against the meta-schema',
    async () => {
      const good = await cli(['schema', 'validate', path.join(workDir, 'place.schema.json')])
      expect(good.exitCode, good.stderr).toBe(0)
      const badFile = write(
        'bad.schema.json',
        JSON.stringify({type: KIND('string'), items: {type: KIND('integer')}}) + '\n',
      )
      const bad = await cli(['schema', 'validate', badFile])
      expect(bad.exitCode).toBe(1)
      const remote = await cli(['schema', 'validate', url('types/person')])
      expect(remote.exitCode, remote.stderr).toBe(0)
    },
    TIMEOUT,
  )
})

describe('CLI · 6. Create a blob that follows a custom schema exactly', () => {
  it(
    'blob validate reports violations against a type document',
    async () => {
      const bad = write('bad-person.json', JSON.stringify({name: 42}) + '\n')
      const result = await cli(['blob', 'validate', '-f', bad, '--schema', url('types/person')])
      expect(result.exitCode).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/name/)
      const good = write('good-person.json', JSON.stringify({name: 'Bob', born: '1990-01-02'}) + '\n')
      const ok = await cli(['blob', 'validate', '-f', good, '--schema', url('types/person')])
      expect(ok.exitCode, ok.stderr).toBe(0)
    },
    TIMEOUT,
  )
  it(
    'blob create publishes a conforming object with a schema link; blob get and verify read it back',
    async () => {
      const refused = await cli([
        'blob',
        'create',
        '-f',
        path.join(workDir, 'bad-person.json'),
        '--schema',
        url('types/person'),
      ])
      expect(refused.exitCode).toBe(1)
      const created = await cli([
        'blob',
        'create',
        '-f',
        path.join(workDir, 'good-person.json'),
        '--schema',
        url('types/person'),
        '-q',
      ])
      expect(created.exitCode, created.stderr).toBe(0)
      const cid = created.stdout.trim().replace('ipfs://', '')
      expect(cid).toMatch(/^bafy/)
      const got = await cliJson(['blob', 'get', cid])
      expect(got.name).toBe('Bob')
      expect(got.schema['/']).toMatch(/^bafy/)
      const verified = await cli(['blob', 'verify', cid])
      expect(verified.exitCode, verified.stderr).toBe(0)
    },
    TIMEOUT,
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
  it(
    'blob sign publishes a signed instance of the Vote type',
    async () => {
      const vote = write('vote.json', JSON.stringify({target: url('notes'), choice: 'yes'}) + '\n')
      const dry = await cliJson(['blob', 'sign', '-f', vote, '--schema', url('types/vote'), '--dry-run'])
      expect(dry.value.type).toBe('Vote')
      expect(dry.value.signer['/'].bytes).toBeTruthy()
      expect(dry.signer).toBe(author.accountId)
      const signed = await cli(['blob', 'sign', '-f', vote, '--schema', url('types/vote'), '-q'])
      expect(signed.exitCode, signed.stderr).toBe(0)
      const cid = signed.stdout.trim().replace('ipfs://', '')
      const got = await cliJson(['blob', 'get', cid])
      expect(got.type).toBe('Vote')
      expect(got.choice).toBe('yes')
      expect(typeof got.ts).toBe('number')
    },
    TIMEOUT,
  )
  it(
    'blob sign refuses fields the type rejects; blob verify checks signature and schema',
    async () => {
      const bad = write('bad-vote.json', JSON.stringify({target: url('notes'), choice: 'maybe'}) + '\n')
      const refused = await cli(['blob', 'sign', '-f', bad, '--schema', url('types/vote')])
      expect(refused.exitCode).toBe(1)
      expect(refused.stdout + refused.stderr).toMatch(/choice/)
      const signed = await cli([
        'blob',
        'sign',
        '-f',
        path.join(workDir, 'vote.json'),
        '--schema',
        url('types/vote'),
        '-q',
      ])
      const cid = signed.stdout.trim().replace('ipfs://', '')
      const verified = await cliJson(['blob', 'verify', cid, '--schema', url('types/vote')])
      expect(verified.signature.ok).toBe(true)
      expect(verified.signature.signer).toBe(author.accountId)
      expect(verified.schema.violations).toEqual([])
      expect(verified.ok).toBe(true)
    },
    TIMEOUT,
  )
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
    it('read hm://<doc> names the schema the document conforms to and its required fields', () =>
      passed('read hm://<doc> names the schema the document conforms to and its required fields'))
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
    it('a write to a typed document returns schema violations as warnings beside the published id', () =>
      passed('a write to a typed document returns schema violations as warnings beside the published id'))
    it('a read of a typed document says which required fields are missing', () =>
      passed('a read of a typed document says which required fields are missing'))
  })
  describe('5. Define a custom schema as a document', () => {
    it('write ipfs:// with JSON content and options.schema = the meta-schema publishes a schema blob', () =>
      passed('write ipfs:// with JSON content and options.schema = the meta-schema publishes a schema blob'))
    it('write hm://…/types/person with options.metadata.schemaDefinition binds the blob to the page', () =>
      passed('write hm://…/types/person with options.metadata.schemaDefinition binds the blob to the page'))
  })
  describe('6. Create a blob that follows a custom schema exactly', () => {
    it('write ipfs:// with JSON content and options.schema = hm://…/types/person publishes a validated object', () =>
      passed('write ipfs:// with JSON content and options.schema = hm://…/types/person publishes a validated object'))
  })
  describe('7. Extend the signed blob envelope into a new signed type', () => {
    it('write ipfs:// with a schema that refs hypermedia-blob publishes the signed type’s schema blob', () =>
      passed('write ipfs:// with a schema that refs hypermedia-blob publishes the signed type’s schema blob'))
  })
  describe('8. Create an instance of the signed type and sign it', () => {
    it('write ipfs:// with options.schema = hm://…/types/vote and options.sign = true publishes a signed blob', () =>
      passed('write ipfs:// with options.schema = hm://…/types/vote and options.sign = true publishes a signed blob'))
  })
})
