/**
 * Draft command tests.
 *
 * These tests are purely local — no daemon or server is required.
 * Each test uses a temporary directory with the SEED_CLI_DRAFTS_DIR env var
 * so draft files are isolated and don't depend on CWD or the real app data dir.
 */

import {describe, test, expect, beforeEach, afterEach} from 'bun:test'
import {mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync} from 'fs'
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

/**
 * Find draft files in the drafts directory (excludes index.json).
 * Returns filenames sorted alphabetically.
 */
function findDraftFiles(ext?: '.json' | '.md'): string[] {
  if (!existsSync(draftsDir)) return []
  return readdirSync(draftsDir)
    .filter((f) => f !== 'index.json' && (!ext || f.endsWith(ext)))
    .sort()
}

/**
 * Read the index.json from the drafts directory.
 */
function readIndex(): Array<{id: string; metadata?: {name?: string}; [key: string]: unknown}> {
  const indexPath = join(draftsDir, 'index.json')
  if (!existsSync(indexPath)) return []
  return JSON.parse(readFileSync(indexPath, 'utf-8'))
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
    'saves draft as JSON by default',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)

      const result = await run(['draft', 'create', '-f', inputFile])

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('Draft saved to')

      // Verify a .json draft file was created
      const jsonFiles = findDraftFiles('.json')
      expect(jsonFiles.length).toBe(1)

      // Verify JSON content matches HMDraftContent schema
      const saved = JSON.parse(readFileSync(join(draftsDir, jsonFiles[0]), 'utf-8'))
      expect(Array.isArray(saved.content)).toBe(true)
      expect(Array.isArray(saved.deps)).toBe(true)
      expect(saved.content.length).toBeGreaterThan(0)

      // Verify editor blocks have expected structure
      const block = saved.content[0]
      expect(block).toHaveProperty('id')
      expect(block).toHaveProperty('type')
      expect(block).toHaveProperty('content')

      // Verify index.json was created with metadata
      const index = readIndex()
      expect(index.length).toBe(1)
      expect(index[0].metadata?.name).toBe('My Test Document')
    },
    TEST_TIMEOUT,
  )

  test(
    'respects -o flag for custom output path',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      const outputPath = join(workDir, 'custom-output.json')

      const result = await run(['draft', 'create', '-f', inputFile, '-o', outputPath])

      expect(result.exitCode).toBe(0)
      expect(existsSync(outputPath)).toBe(true)

      // Verify it's valid JSON draft content
      const saved = JSON.parse(readFileSync(outputPath, 'utf-8'))
      expect(Array.isArray(saved.content)).toBe(true)
    },
    TEST_TIMEOUT,
  )

  test(
    'creates unique filenames (no collisions with nanoid)',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)

      const first = await run(['draft', 'create', '-f', inputFile])
      expect(first.exitCode).toBe(0)

      const second = await run(['draft', 'create', '-f', inputFile])
      expect(second.exitCode).toBe(0)

      // Both should succeed and create separate files
      const jsonFiles = findDraftFiles('.json')
      expect(jsonFiles.length).toBe(2)

      // Index should have 2 entries
      const index = readIndex()
      expect(index.length).toBe(2)
    },
    TEST_TIMEOUT,
  )

  test(
    '--markdown flag saves as raw markdown',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)

      const result = await run(['draft', 'create', '-f', inputFile, '--markdown'])

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('Draft saved to')

      // Verify a .md draft file was created (not .json)
      const mdFiles = findDraftFiles('.md')
      expect(mdFiles.length).toBe(1)
      expect(findDraftFiles('.json').length).toBe(0)

      // Verify markdown content is preserved
      const saved = readFileSync(join(draftsDir, mdFiles[0]), 'utf-8')
      expect(saved).toContain('My Test Document')
      expect(saved).toContain('# Introduction')
      expect(saved).toContain('**bold**')
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
    'displays JSON draft content as markdown by draft ID',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      // Get the draft ID from the created file
      const jsonFiles = findDraftFiles('.json')
      expect(jsonFiles.length).toBe(1)
      const draftId = jsonFiles[0].replace(/\.json$/, '')

      const result = await run(['draft', 'get', draftId])

      expect(result.exitCode).toBe(0)
      // JSON drafts are converted to markdown for display
      expect(result.stdout).toContain('My Test Document')
      expect(result.stdout).toContain('Introduction')
    },
    TEST_TIMEOUT,
  )

  test(
    'displays JSON draft content by file path',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const jsonFiles = findDraftFiles('.json')
      const draftPath = join(draftsDir, jsonFiles[0])
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

      const jsonFiles = findDraftFiles('.json')
      const draftId = jsonFiles[0].replace(/\.json$/, '')

      const result = await run(['draft', 'get', draftId, '--pretty'])

      expect(result.exitCode).toBe(0)
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

      const jsonFiles = findDraftFiles('.json')
      const draftId = jsonFiles[0].replace(/\.json$/, '')

      const outFile = join(workDir, 'output.md')
      const result = await run(['draft', 'get', draftId, '-o', outFile])

      expect(result.exitCode).toBe(0)
      expect(existsSync(outFile)).toBe(true)
      const content = readFileSync(outFile, 'utf-8')
      expect(content).toContain('My Test Document')
    },
    TEST_TIMEOUT,
  )

  test(
    'reads manually-created JSON draft and renders as markdown',
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
    'reads JSON draft by direct .json path',
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

  test(
    'displays --markdown draft content by slug',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile, '--markdown'])

      // --markdown creates <slug>_<id>.md, resolvable by slug prefix
      const mdFiles = findDraftFiles('.md')
      expect(mdFiles.length).toBe(1)
      const slug = mdFiles[0].replace(/_[^_]+\.md$/, '')

      const result = await run(['draft', 'get', slug])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('My Test Document')
      expect(result.stdout).toContain('# Introduction')
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
    'lists JSON drafts with title',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const result = await run(['draft', 'list'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('My Test Document')
      expect(result.stdout).toContain('json')
    },
    TEST_TIMEOUT,
  )

  test(
    'quiet mode outputs one ID per line',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const result = await run(['draft', 'list', '-q'])

      expect(result.exitCode).toBe(0)
      // Quiet output is the draft ID (nanoid stripped from filename)
      const output = result.stdout.trim()
      expect(output.length).toBeGreaterThan(0)
      // Should match the file in draftsDir
      expect(existsSync(join(draftsDir, `${output}.json`))).toBe(true)
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

      const ids = result.stdout.trim().split('\n')
      expect(ids.length).toBe(2)
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
      expect(data[0].title).toBe('My Test Document')
      expect(data[0].format).toBe('json')
    },
    TEST_TIMEOUT,
  )

  test(
    'lists both .md and .json drafts',
    async () => {
      // Create a JSON draft via CLI (default)
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      // Create a separate .json draft manually (simulates desktop-created)
      writeFileSync(join(draftsDir, 'testdraft01.json'), JSON.stringify(SAMPLE_JSON_DRAFT), 'utf-8')
      // Update index.json to include both the CLI-created and manually-created drafts
      const existingIndex = readIndex()
      writeFileSync(
        join(draftsDir, 'index.json'),
        JSON.stringify([...existingIndex, ...SAMPLE_INDEX]),
        'utf-8',
      )

      // Also create an .md draft with --markdown
      const md2 = writeTestFile('doc2.md', '---\nname: Markdown Draft\n---\nContent.')
      await run(['draft', 'create', '-f', md2, '--markdown'])

      const result = await run(['draft', 'list', '--json'])
      expect(result.exitCode).toBe(0)

      const data = JSON.parse(result.stdout)
      const mdDraft = data.find((d: any) => d.format === 'md')
      const jsonDrafts = data.filter((d: any) => d.format === 'json')
      expect(mdDraft).toBeDefined()
      expect(jsonDrafts.length).toBe(2)
    },
    TEST_TIMEOUT,
  )

  test(
    'quiet mode lists both .md and .json slugs',
    async () => {
      // Create a JSON draft via CLI
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      // Create a .json draft manually
      mkdirSync(draftsDir, {recursive: true})
      writeFileSync(join(draftsDir, 'testdraft01.json'), JSON.stringify(SAMPLE_JSON_DRAFT), 'utf-8')

      const result = await run(['draft', 'list', '-q'])
      expect(result.exitCode).toBe(0)

      const slugs = result.stdout.trim().split('\n').sort()
      expect(slugs.length).toBe(2)
      expect(slugs).toContain('testdraft01')
    },
    TEST_TIMEOUT,
  )
})

describe('draft rm', () => {
  test(
    'removes a JSON draft by ID with --force',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const jsonFiles = findDraftFiles('.json')
      expect(jsonFiles.length).toBe(1)
      const draftId = jsonFiles[0].replace(/\.json$/, '')

      const result = await run(['draft', 'rm', draftId, '--force'])
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('Removed')
      expect(existsSync(join(draftsDir, jsonFiles[0]))).toBe(false)
    },
    TEST_TIMEOUT,
  )

  test(
    'removes a draft by file path with --force',
    async () => {
      const inputFile = writeTestFile('input.md', SAMPLE_MD)
      await run(['draft', 'create', '-f', inputFile])

      const jsonFiles = findDraftFiles('.json')
      const draftPath = join(draftsDir, jsonFiles[0])
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
    '--all --force removes all drafts (both .md and .json)',
    async () => {
      const md1 = writeTestFile('doc1.md', '---\nname: Alpha Doc\n---\nContent one.')
      const md2 = writeTestFile('doc2.md', '---\nname: Beta Doc\n---\nContent two.')

      await run(['draft', 'create', '-f', md1])
      await run(['draft', 'create', '-f', md2])

      // Also create a --markdown draft
      const md3 = writeTestFile('doc3.md', '---\nname: Gamma Doc\n---\nContent three.')
      await run(['draft', 'create', '-f', md3, '--markdown'])

      // Verify all exist
      const listBefore = await run(['draft', 'list', '-q'])
      expect(listBefore.stdout.trim().split('\n').length).toBe(3)

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
