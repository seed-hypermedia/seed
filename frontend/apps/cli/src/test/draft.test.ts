/**
 * Draft command tests.
 *
 * These tests are purely local — no daemon or server is required.
 * Each test uses a temporary directory with the SEED_CLI_DRAFTS_DIR env var
 * so draft files are isolated and don't depend on CWD or the real app data dir.
 */

import {describe, test, expect, beforeEach, afterEach} from 'bun:test'
import {mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'
import {runCli} from './setup'

const TEST_TIMEOUT = 30000

/** Temp directories for each test. */
let workDir: string
let draftsDir: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'seed-draft-test-'))
  draftsDir = join(workDir, 'drafts')
})

afterEach(() => {
  rmSync(workDir, {recursive: true, force: true})
})

/** Run CLI with SEED_CLI_DRAFTS_DIR pointing to the temp drafts directory. */
function run(args: string[], opts: {env?: Record<string, string>; cwd?: string} = {}) {
  return runCli(args, {
    ...opts,
    env: {SEED_CLI_DRAFTS_DIR: draftsDir, ...opts.env},
  })
}

/** Write a file to the temp working directory. */
function writeTestFile(name: string, content: string): string {
  const filePath = join(workDir, name)
  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

const SAMPLE_MD = `---
name: My Test Document
summary: A brief description
---

# Introduction

This is a test paragraph with **bold** text.

## Section One

- First item
- Second item
`

/** Sample BlockNote editor blocks matching the desktop draft JSON format. */
const SAMPLE_JSON_DRAFT = {
  content: [
    {
      id: 'block1',
      type: 'heading',
      props: {level: 2, childrenType: 'Group', listLevel: '1'},
      content: [{type: 'text', text: 'Strategy and Methodology', styles: {}}],
      children: [
        {
          id: 'block2',
          type: 'paragraph',
          props: {},
          content: [{type: 'text', text: 'This is a test paragraph.', styles: {}}],
          children: [],
        },
      ],
    },
    {
      id: 'block3',
      type: 'paragraph',
      props: {},
      content: [
        {type: 'text', text: 'Another paragraph with ', styles: {}},
        {type: 'text', text: 'bold text', styles: {bold: true}},
      ],
      children: [],
    },
  ],
  deps: [],
}

/** Sample index.json matching the desktop draft index format. */
const SAMPLE_INDEX = [
  {
    id: 'testdraft01',
    editUid: 'z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno',
    editPath: ['docs', 'test-doc'],
    metadata: {name: 'Strategy Document'},
    visibility: 'PUBLIC',
    lastUpdateTime: Date.now(),
  },
]

describe('draft create', () => {
  test(
    'saves markdown to <drafts-dir>/<slug>.md',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)

      const result = await run(['draft', 'create', '-f', inputFile])

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('Draft saved to')
      expect(result.stderr).toContain('my-test-document')

      // Verify the draft file was created in the env-specified drafts dir
      const draftPath = join(draftsDir, 'my-test-document.md')
      expect(existsSync(draftPath)).toBe(true)

      // Verify content is preserved
      const saved = readFileSync(draftPath, 'utf-8')
      expect(saved).toContain('My Test Document')
      expect(saved).toContain('# Introduction')
      expect(saved).toContain('**bold**')
    },
    TEST_TIMEOUT,
  )

  test(
    'respects -o flag for custom output path',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      const outputPath = join(workDir, 'custom-output.md')

      const result = await run(['draft', 'create', '-f', inputFile, '-o', outputPath])

      expect(result.exitCode).toBe(0)
      expect(existsSync(outputPath)).toBe(true)
    },
    TEST_TIMEOUT,
  )

  test(
    'errors on collision without -o',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)

      // First create
      const first = await run(['draft', 'create', '-f', inputFile])
      expect(first.exitCode).toBe(0)

      // Second create should fail
      const second = await run(['draft', 'create', '-f', inputFile])
      expect(second.exitCode).not.toBe(0)
      expect(second.stderr).toContain('already exists')
      expect(second.stderr).toContain('draft rm')
    },
    TEST_TIMEOUT,
  )

  test(
    'allows overwrite with explicit -o to the same path',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      const outputPath = join(draftsDir, 'my-test-document.md')

      // First create
      const first = await run(['draft', 'create', '-f', inputFile])
      expect(first.exitCode).toBe(0)

      // Overwrite with -o targeting the same file
      const second = await run(['draft', 'create', '-f', inputFile, '-o', outputPath])
      expect(second.exitCode).toBe(0)
    },
    TEST_TIMEOUT,
  )

  test(
    'generates slug from document title',
    async () => {
      const content = `---
name: Hello World! Special Characters & More
---

Some content.
`
      const inputFile = writeTestFile('input.md', content)
      const result = await run(['draft', 'create', '-f', inputFile])

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('hello-world-special-characters-more')
    },
    TEST_TIMEOUT,
  )

  test(
    'errors when no -f is provided',
    async () => {
      const result = await run(['draft', 'create'])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('requires -f')
    },
    TEST_TIMEOUT,
  )

  test(
    'errors when file does not exist',
    async () => {
      const result = await run(['draft', 'create', '-f', '/nonexistent/file.md'])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('no such file or directory')
    },
    TEST_TIMEOUT,
  )

  test(
    'creates drafts directory if missing',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      expect(existsSync(draftsDir)).toBe(false)

      const result = await run(['draft', 'create', '-f', inputFile])
      expect(result.exitCode).toBe(0)
      expect(existsSync(draftsDir)).toBe(true)
    },
    TEST_TIMEOUT,
  )
})

describe('draft get', () => {
  test(
    'displays draft content by slug',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const result = await run(['draft', 'get', 'my-test-document'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('My Test Document')
      expect(result.stdout).toContain('# Introduction')
    },
    TEST_TIMEOUT,
  )

  test(
    'displays draft content by file path',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const draftPath = join(draftsDir, 'my-test-document.md')
      const result = await run(['draft', 'get', draftPath])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('My Test Document')
    },
    TEST_TIMEOUT,
  )

  test(
    '--pretty renders markdown with ANSI styling',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const result = await run(['draft', 'get', 'my-test-document', '--pretty'])

      expect(result.exitCode).toBe(0)
      // Pretty output should contain the content but with ANSI codes
      expect(result.stdout).toContain('Introduction')
      expect(result.stdout).toContain('bold')
    },
    TEST_TIMEOUT,
  )

  test(
    'errors for nonexistent draft',
    async () => {
      const result = await run(['draft', 'get', 'nonexistent'])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('not found')
    },
    TEST_TIMEOUT,
  )

  test(
    '-o writes output to file',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const outFile = join(workDir, 'output.md')
      const result = await run(['draft', 'get', 'my-test-document', '-o', outFile])

      expect(result.exitCode).toBe(0)
      expect(existsSync(outFile)).toBe(true)
      const content = readFileSync(outFile, 'utf-8')
      expect(content).toContain('My Test Document')
    },
    TEST_TIMEOUT,
  )

  test(
    'reads desktop JSON draft and renders as markdown',
    async () => {
      // Set up a JSON draft with an index
      mkdirSync(draftsDir, {recursive: true})
      writeFileSync(join(draftsDir, 'testdraft01.json'), JSON.stringify(SAMPLE_JSON_DRAFT), 'utf-8')
      writeFileSync(join(draftsDir, 'index.json'), JSON.stringify(SAMPLE_INDEX), 'utf-8')

      const result = await run(['draft', 'get', 'testdraft01'])

      expect(result.exitCode).toBe(0)
      // Should contain the converted markdown content
      expect(result.stdout).toContain('Strategy and Methodology')
      expect(result.stdout).toContain('test paragraph')
      // Should contain metadata from index.json rendered as frontmatter
      expect(result.stdout).toContain('Strategy Document')
    },
    TEST_TIMEOUT,
  )

  test(
    'reads desktop JSON draft by direct .json path',
    async () => {
      mkdirSync(draftsDir, {recursive: true})
      writeFileSync(join(draftsDir, 'testdraft01.json'), JSON.stringify(SAMPLE_JSON_DRAFT), 'utf-8')
      writeFileSync(join(draftsDir, 'index.json'), JSON.stringify(SAMPLE_INDEX), 'utf-8')

      const jsonPath = join(draftsDir, 'testdraft01.json')
      const result = await run(['draft', 'get', jsonPath])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Strategy and Methodology')
    },
    TEST_TIMEOUT,
  )

  test(
    'reads JSON draft without index.json (no metadata)',
    async () => {
      mkdirSync(draftsDir, {recursive: true})
      writeFileSync(join(draftsDir, 'orphan123.json'), JSON.stringify(SAMPLE_JSON_DRAFT), 'utf-8')

      const result = await run(['draft', 'get', 'orphan123'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Strategy and Methodology')
    },
    TEST_TIMEOUT,
  )
})

describe('draft list', () => {
  test(
    'shows "No drafts found" when empty',
    async () => {
      const result = await run(['draft', 'list'])
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('No drafts found')
    },
    TEST_TIMEOUT,
  )

  test(
    'lists drafts with title and slug',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const result = await run(['draft', 'list'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('my-test-document')
      expect(result.stdout).toContain('My Test Document')
      expect(result.stdout).toContain('md')
    },
    TEST_TIMEOUT,
  )

  test(
    'quiet mode outputs one slug per line',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const result = await run(['draft', 'list', '-q'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('my-test-document')
    },
    TEST_TIMEOUT,
  )

  test(
    'lists multiple drafts',
    async () => {
      const md1 = writeTestFile('doc1.md', '---\nname: Alpha Doc\n---\nContent one.')
      const md2 = writeTestFile('doc2.md', '---\nname: Beta Doc\n---\nContent two.')

      await run(['draft', 'create', '-f', md1])
      await run(['draft', 'create', '-f', md2])

      const result = await run(['draft', 'list', '-q'])
      expect(result.exitCode).toBe(0)

      const slugs = result.stdout.split('\n').sort()
      expect(slugs).toEqual(['alpha-doc', 'beta-doc'])
    },
    TEST_TIMEOUT,
  )

  test(
    '--json outputs structured data',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const result = await run(['draft', 'list', '--json'])

      expect(result.exitCode).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBe(1)
      expect(data[0].slug).toBe('my-test-document')
      expect(data[0].title).toBe('My Test Document')
      expect(data[0].format).toBe('md')
    },
    TEST_TIMEOUT,
  )

  test(
    'lists both .md and .json drafts',
    async () => {
      // Create an .md draft
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      // Create a .json draft manually
      writeFileSync(join(draftsDir, 'testdraft01.json'), JSON.stringify(SAMPLE_JSON_DRAFT), 'utf-8')
      writeFileSync(join(draftsDir, 'index.json'), JSON.stringify(SAMPLE_INDEX), 'utf-8')

      const result = await run(['draft', 'list', '--json'])
      expect(result.exitCode).toBe(0)

      const data = JSON.parse(result.stdout)
      expect(data.length).toBe(2)

      const mdDraft = data.find((d: any) => d.format === 'md')
      const jsonDraft = data.find((d: any) => d.format === 'json')
      expect(mdDraft).toBeDefined()
      expect(jsonDraft).toBeDefined()
      expect(mdDraft.slug).toBe('my-test-document')
      expect(jsonDraft.slug).toBe('testdraft01')
      expect(jsonDraft.title).toBe('Strategy Document')
    },
    TEST_TIMEOUT,
  )

  test(
    'quiet mode lists both .md and .json slugs',
    async () => {
      // Create an .md draft
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      // Create a .json draft manually
      writeFileSync(join(draftsDir, 'testdraft01.json'), JSON.stringify(SAMPLE_JSON_DRAFT), 'utf-8')

      const result = await run(['draft', 'list', '-q'])
      expect(result.exitCode).toBe(0)

      const slugs = result.stdout.split('\n').sort()
      expect(slugs).toEqual(['my-test-document', 'testdraft01'])
    },
    TEST_TIMEOUT,
  )
})

describe('draft rm', () => {
  test(
    'removes a draft by slug with --force',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const draftPath = join(draftsDir, 'my-test-document.md')
      expect(existsSync(draftPath)).toBe(true)

      const result = await run(['draft', 'rm', 'my-test-document', '--force'])
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('Removed')
      expect(existsSync(draftPath)).toBe(false)
    },
    TEST_TIMEOUT,
  )

  test(
    'removes a draft by file path with --force',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const draftPath = join(draftsDir, 'my-test-document.md')
      const result = await run(['draft', 'rm', draftPath, '--force'])
      expect(result.exitCode).toBe(0)
      expect(existsSync(draftPath)).toBe(false)
    },
    TEST_TIMEOUT,
  )

  test(
    'errors when draft does not exist',
    async () => {
      const result = await run(['draft', 'rm', 'nonexistent', '--force'])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('not found')
    },
    TEST_TIMEOUT,
  )

  test(
    '--all --force removes all drafts',
    async () => {
      const md1 = writeTestFile('doc1.md', '---\nname: Alpha Doc\n---\nContent one.')
      const md2 = writeTestFile('doc2.md', '---\nname: Beta Doc\n---\nContent two.')

      await run(['draft', 'create', '-f', md1])
      await run(['draft', 'create', '-f', md2])

      // Verify both exist
      const listBefore = await run(['draft', 'list', '-q'])
      expect(listBefore.stdout.split('\n').length).toBe(2)

      // Remove all
      const result = await run(['draft', 'rm', '--all', '--force'])
      expect(result.exitCode).toBe(0)

      // Verify empty
      const listAfter = await run(['draft', 'list'])
      expect(listAfter.stderr).toContain('No drafts found')
    },
    TEST_TIMEOUT,
  )

  test(
    'errors when no slug and no --all',
    async () => {
      const result = await run(['draft', 'rm', '--force'])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('Specify a draft')
    },
    TEST_TIMEOUT,
  )
})
