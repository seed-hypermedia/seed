/**
 * CLI Fixture Tests
 *
 * Full integration tests with daemon + web server using fixture data.
 * Includes write operation tests (update, comment-create, comment-delete).
 */

import {describe, test, expect, beforeAll, afterAll} from 'bun:test'
import {writeFileSync, mkdtempSync, rmSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'
import {startFullIntegrationWithFixture, runCli, type FullTestContext} from './setup'
import {FIXTURE_ACCOUNT_ID, FIXTURE_HIERARCHY_HM_ID} from './fixture-seed'
import {generateTestAccount, registerAccount, type TestAccount} from './account-helpers'
import {getCliVersion} from '../version'

let ctx: FullTestContext
const CLI_VERSION = getCliVersion()

const TEST_TIMEOUT = 180000 // 3 minutes for daemon + web server startup

// Test mnemonic for write operations (well-known BIP-39 test vector).
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const TEST_KEY_NAME = 'cli-fixture-test'

async function listComments(server: string, targetId: string): Promise<any[]> {
  const result = await runCli(['comment', 'list', targetId], {server})
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout).comments || []
}

async function getCommentByText(server: string, targetId: string, text: string): Promise<any> {
  const comments = await listComments(server, targetId)
  return comments.find((comment: any) => JSON.stringify(comment.content).includes(text))
}

describe('CLI Full Integration Tests', () => {
  beforeAll(async () => {
    ctx = await startFullIntegrationWithFixture()
    console.log(`[test] Full integration ready: daemon=${ctx.daemonUrl}, web=${ctx.webServerUrl}`)
  }, TEST_TIMEOUT)

  afterAll(async () => {
    // Clean up the test key from the OS keyring (best effort).
    try {
      await runCli(['key', 'remove', TEST_KEY_NAME, '--force'])
    } catch {
      // Ignore — key may not have been created if tests failed early.
    }
    await ctx?.cleanup()
  }, TEST_TIMEOUT)

  describe('Infrastructure', () => {
    test(
      'daemon is running',
      async () => {
        const response = await fetch(`${ctx.daemonUrl}/debug/version`)
        expect(response.ok).toBe(true)
        const version = await response.text()
        expect(version).toBeTruthy()
        console.log(`[test] Daemon version: ${version}`)
      },
      TEST_TIMEOUT,
    )

    test(
      'web server is running',
      async () => {
        const response = await fetch(ctx.webServerUrl)
        // May return 200 or redirect, either is fine
        expect(response.status).toBeLessThan(500)
        console.log(`[test] Web server status: ${response.status}`)
      },
      TEST_TIMEOUT,
    )
  })

  describe('CLI Basic Commands', () => {
    test(
      '--help shows usage',
      async () => {
        const result = await runCli(['--help'])
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Usage: seed-cli')
      },
      TEST_TIMEOUT,
    )

    test(
      '--version shows version',
      async () => {
        const result = await runCli(['--version'])
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe(CLI_VERSION)
      },
      TEST_TIMEOUT,
    )
  })

  describe('Fixture Data via API', () => {
    test(
      'get hierarchy-test document as JSON',
      async () => {
        const result = await runCli(['document', 'get', FIXTURE_HIERARCHY_HM_ID, '--json'], {
          server: ctx.webServerUrl,
        })
        expect(result.exitCode).toBe(0)
        const data = JSON.parse(result.stdout)
        expect(data.type).toBe('document')
        expect(data.document.metadata.name).toBe('Hierarchy Test')
        expect(data.document.path).toBe('/hierarchy-test')
      },
      TEST_TIMEOUT,
    )

    test(
      'get returns markdown with frontmatter by default',
      async () => {
        const result = await runCli(['document', 'get', FIXTURE_HIERARCHY_HM_ID], {server: ctx.webServerUrl})
        expect(result.exitCode).toBe(0)

        // Default output is markdown with frontmatter and block IDs
        expect(result.stdout).toMatch(/^---/)
        expect(result.stdout).toContain('name: "Hierarchy Test"')

        // Validate the markdown content matches the fixture document
        expect(result.stdout).toContain('Text before first heading')
        expect(result.stdout).toContain('# First Heading')
        expect(result.stdout).toContain('under first heading')
        expect(result.stdout).toContain('## Second Level Heading A')
        expect(result.stdout).toContain('Under First Heading > Second Level Heading A')
        expect(result.stdout).toContain('under first heading, at the end')
        expect(result.stdout).toContain('# Second Heading')
        expect(result.stdout).toContain('In second heading')
        expect(result.stdout).toContain('Text after all sections')

        // Block IDs are preserved as HTML comments
        expect(result.stdout).toMatch(/<!-- id:[A-Za-z0-9_-]+ -->/)

        // No system fields in frontmatter (authors, version)
        expect(result.stdout).not.toContain('authors:')
        expect(result.stdout).not.toContain('version:')
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Write Operations =====

  describe('Write Operations', () => {
    let writeAccount: TestAccount
    let writeAccountHmId: string

    beforeAll(async () => {
      // 1. Import the test key into the OS keyring via CLI.
      const importResult = await runCli(['key', 'import', '-n', TEST_KEY_NAME, TEST_MNEMONIC])
      expect(importResult.exitCode).toBe(0)
      console.log(`[test] Key imported: ${importResult.stdout}`)

      // 2. Derive the account ID so we can register it.
      const deriveResult = await runCli(['key', 'derive', TEST_MNEMONIC])
      expect(deriveResult.exitCode).toBe(0)
      const accountId = deriveResult.stdout.trim()
      console.log(`[test] Write test account ID: ${accountId}`)

      // 3. Generate a TestAccount object for registerAccount().
      writeAccount = generateTestAccount()
      // Override with the deterministic key from the mnemonic.
      const {deriveKeyPairFromMnemonic} = await import('../utils/key-derivation')
      const keyPair = deriveKeyPairFromMnemonic(TEST_MNEMONIC, '')
      writeAccount = {
        keyPair,
        mnemonic: TEST_MNEMONIC,
        accountId: keyPair.accountId,
      }

      writeAccountHmId = `hm://${writeAccount.accountId}`

      // 4. Register the account on the web server.
      await registerAccount(ctx.webServerUrl, writeAccount, 'CLI Write Test Account')
      console.log(`[test] Write test account registered on web server`)

      // 5. Wait for the account to be indexed and verify it's accessible.
      await new Promise((r) => setTimeout(r, 2000))
      const verifyResult = await runCli(['document', 'get', writeAccountHmId, '--json'], {
        server: ctx.webServerUrl,
      })
      console.log(
        `[test] Verify account doc: exitCode=${verifyResult.exitCode}, type=${
          JSON.parse(verifyResult.stdout || '{}').type || 'N/A'
        }`,
      )
      if (verifyResult.exitCode !== 0) {
        console.log(`[test] Verify stderr: ${verifyResult.stderr}`)
        console.log(`[test] Verify stdout: ${verifyResult.stdout}`)
      }
    }, TEST_TIMEOUT)

    afterAll(async () => {
      // Clean up the test key.
      try {
        await runCli(['key', 'remove', TEST_KEY_NAME, '--force'])
        console.log(`[test] Test key cleaned up`)
      } catch {
        // Best effort.
      }
    }, TEST_TIMEOUT)

    // --- Document Update Tests ---

    test(
      'document update --name changes document title',
      async () => {
        const newTitle = `Updated Title ${Date.now()}`
        const result = await runCli(
          ['document', 'update', writeAccountHmId, '--name', newTitle, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
        if (result.exitCode !== 0) {
          console.log('[test] update --name stderr:', result.stderr)
          console.log('[test] update --name stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Document updated')

        // Verify by reading back (default output is markdown with frontmatter).
        const getResult = await runCli(['document', 'get', writeAccountHmId], {server: ctx.webServerUrl})
        expect(getResult.exitCode).toBe(0)
        expect(getResult.stdout).toContain(`name: "${newTitle}"`)
      },
      TEST_TIMEOUT,
    )

    test(
      'document update --summary sets document summary',
      async () => {
        const summary = 'A test summary from CLI fixture tests'
        const result = await runCli(
          ['document', 'update', writeAccountHmId, '--summary', summary, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Document updated')

        // Verify by reading full resource (ResourceMetadata doesn't return summary).
        const getResult = await runCli(['document', 'get', writeAccountHmId], {server: ctx.webServerUrl})
        expect(getResult.exitCode).toBe(0)
        expect(getResult.stdout).toContain(summary)
      },
      TEST_TIMEOUT,
    )

    test(
      'document update with no flags shows error',
      async () => {
        const result = await runCli(['document', 'update', writeAccountHmId, '--key', TEST_KEY_NAME], {
          server: ctx.webServerUrl,
        })
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('No updates specified')
      },
      TEST_TIMEOUT,
    )

    test(
      'document update with missing key shows error',
      async () => {
        const result = await runCli(
          ['document', 'update', writeAccountHmId, '--name', 'X', '--key', 'nonexistent-key-name'],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('not found')
      },
      TEST_TIMEOUT,
    )

    // --- Comment Create Tests ---

    let createdCommentId: string

    test(
      'comment create creates a comment',
      async () => {
        const commentText = `Test comment from CLI fixture ${Date.now()}`
        const result = await runCli(
          ['comment', 'create', writeAccountHmId, '--body', commentText, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
        if (result.exitCode !== 0) {
          console.log('[test] comment create stderr:', result.stderr)
          console.log('[test] comment create stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Comment published')

        // Verify by listing comments.
        const commentsResult = await runCli(['comment', 'list', writeAccountHmId], {server: ctx.webServerUrl})
        expect(commentsResult.exitCode).toBe(0)
        expect(commentsResult.stdout).toContain(commentText)

        // Extract the comment ID for the delete test.
        const commentsData = JSON.parse(commentsResult.stdout)
        if (commentsData.comments && commentsData.comments.length > 0) {
          createdCommentId = commentsData.comments[0].id
          console.log(`[test] Created comment ID: ${createdCommentId}`)
        }
      },
      TEST_TIMEOUT,
    )

    test(
      'comment edit updates a comment',
      async () => {
        const originalText = `Original comment ${Date.now()}`
        const updatedText = `Updated comment ${Date.now()}`

        const createResult = await runCli(
          ['comment', 'create', writeAccountHmId, '--body', originalText, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
        expect(createResult.exitCode).toBe(0)

        const createdComment = await getCommentByText(ctx.webServerUrl, writeAccountHmId, originalText)
        expect(createdComment).toBeTruthy()

        const editResult = await runCli(
          ['comment', 'edit', createdComment.id, '--body', updatedText, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
        if (editResult.exitCode !== 0) {
          console.log('[test] comment edit stderr:', editResult.stderr)
          console.log('[test] comment edit stdout:', editResult.stdout)
        }
        expect(editResult.exitCode).toBe(0)
        expect(editResult.stderr + editResult.stdout).toContain('Comment updated')

        const getResult = await runCli(['comment', 'get', createdComment.id], {server: ctx.webServerUrl})
        expect(getResult.exitCode).toBe(0)
        const updatedComment = JSON.parse(getResult.stdout)
        expect(updatedComment.id).toBe(createdComment.id)
        expect(JSON.stringify(updatedComment.content)).toContain(updatedText)
      },
      TEST_TIMEOUT,
    )

    test(
      'comment edit preserves reply threading metadata',
      async () => {
        const parentText = `Reply parent ${Date.now()}`
        const replyText = `Reply child ${Date.now()}`
        const updatedReplyText = `Reply child edited ${Date.now()}`

        const parentResult = await runCli(
          ['comment', 'create', writeAccountHmId, '--body', parentText, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
        expect(parentResult.exitCode).toBe(0)

        const parentComment = await getCommentByText(ctx.webServerUrl, writeAccountHmId, parentText)
        expect(parentComment).toBeTruthy()

        const replyResult = await runCli(
          [
            'comment',
            'create',
            writeAccountHmId,
            '--body',
            replyText,
            '--reply',
            parentComment.id,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        expect(replyResult.exitCode).toBe(0)

        const replyComment = await getCommentByText(ctx.webServerUrl, writeAccountHmId, replyText)
        expect(replyComment).toBeTruthy()

        const editResult = await runCli(
          ['comment', 'edit', replyComment.id, '--body', updatedReplyText, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
        expect(editResult.exitCode).toBe(0)

        const getResult = await runCli(['comment', 'get', replyComment.id], {server: ctx.webServerUrl})
        expect(getResult.exitCode).toBe(0)
        const updatedReply = JSON.parse(getResult.stdout)
        expect(updatedReply.replyParent).toBe(parentComment.id)
        expect(updatedReply.replyParentVersion).toBeTruthy()
        expect(updatedReply.threadRoot).toBe(parentComment.id)
        expect(updatedReply.threadRootVersion).toBeTruthy()
        expect(JSON.stringify(updatedReply.content)).toContain(updatedReplyText)
      },
      TEST_TIMEOUT,
    )

    test(
      'comment edit --file preserves block-level comment wrapper',
      async () => {
        const docResult = await runCli(['document', 'get', FIXTURE_HIERARCHY_HM_ID, '--json'], {
          server: ctx.webServerUrl,
        })
        expect(docResult.exitCode).toBe(0)
        const docData = JSON.parse(docResult.stdout)
        const targetBlockId = docData.document.content[0]?.block?.id
        expect(targetBlockId).toBeTruthy()

        const originalText = `Block comment ${Date.now()}`
        const createResult = await runCli(
          [
            'comment',
            'create',
            `${FIXTURE_HIERARCHY_HM_ID}#${targetBlockId}`,
            '--body',
            originalText,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        expect(createResult.exitCode).toBe(0)

        const createdComment = await getCommentByText(ctx.webServerUrl, FIXTURE_HIERARCHY_HM_ID, originalText)
        expect(createdComment).toBeTruthy()

        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const commentFile = join(tmpDir, 'comment-edit.txt')
        const updatedText = `Block comment edited ${Date.now()}`
        writeFileSync(commentFile, updatedText)

        try {
          const editResult = await runCli(
            ['comment', 'edit', createdComment.id, '--file', commentFile, '--key', TEST_KEY_NAME],
            {server: ctx.webServerUrl},
          )
          expect(editResult.exitCode).toBe(0)

          const getResult = await runCli(['comment', 'get', createdComment.id], {server: ctx.webServerUrl})
          expect(getResult.exitCode).toBe(0)
          const updatedComment = JSON.parse(getResult.stdout)

          expect(updatedComment.content[0].block.type).toBe('Embed')
          expect(updatedComment.content[0].block.link).toContain(`#${targetBlockId}`)
          expect(updatedComment.content[0].children).toHaveLength(1)
          expect(updatedComment.content[0].children[0].block.text).toBe(updatedText)
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    test(
      'comment edit with no body shows error',
      async () => {
        const result = await runCli(['comment', 'edit', 'fake-author/fake-tsid', '--key', TEST_KEY_NAME], {
          server: ctx.webServerUrl,
        })
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('--body or --file')
      },
      TEST_TIMEOUT,
    )

    test(
      'comment create with no body shows error',
      async () => {
        const result = await runCli(['comment', 'create', writeAccountHmId, '--key', TEST_KEY_NAME], {
          server: ctx.webServerUrl,
        })
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('--body or --file')
      },
      TEST_TIMEOUT,
    )

    // --- Comment Delete Tests ---

    test(
      'comment delete deletes a comment',
      async () => {
        // Ensure we have a comment to delete from the create test.
        expect(createdCommentId).toBeTruthy()

        const result = await runCli(['comment', 'delete', createdCommentId, '--key', TEST_KEY_NAME], {
          server: ctx.webServerUrl,
        })
        if (result.exitCode !== 0) {
          console.log('[test] comment delete stderr:', result.stderr)
          console.log('[test] comment delete stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Comment deleted')
      },
      TEST_TIMEOUT,
    )

    test(
      'comment delete with missing key shows error',
      async () => {
        const result = await runCli(['comment', 'delete', 'fake-author/fake-tsid', '--key', 'nonexistent-key-name'], {
          server: ctx.webServerUrl,
        })
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('not found')
      },
      TEST_TIMEOUT,
    )

    test(
      'comment edit with missing key shows error',
      async () => {
        const result = await runCli(
          ['comment', 'edit', 'fake-author/fake-tsid', '--body', 'Updated', '--key', 'missing'],
          {
            server: ctx.webServerUrl,
          },
        )
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('not found')
      },
      TEST_TIMEOUT,
    )

    // --- Document Create Tests ---

    let createdDocPath: string
    let createdDocHmId: string

    test(
      'document create creates a document',
      async () => {
        const uniqueSlug = `test-doc-${Date.now()}`
        createdDocPath = `/${uniqueSlug}`
        createdDocHmId = `hm://${writeAccount.accountId}/${uniqueSlug}`

        const tmpDir1 = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFile1 = join(tmpDir1, 'content.md')
        writeFileSync(mdFile1, 'Hello from CLI test')

        const result = await runCli(
          [
            'document',
            'create',
            '--path',
            uniqueSlug,
            '--name',
            'CLI Test Document',
            '-f',
            mdFile1,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        rmSync(tmpDir1, {recursive: true, force: true})
        if (result.exitCode !== 0) {
          console.log('[test] document create stderr:', result.stderr)
          console.log('[test] document create stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Document published')

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Verify document exists
        const getResult = await runCli(['document', 'get', createdDocHmId, '--json'], {server: ctx.webServerUrl})
        expect(getResult.exitCode).toBe(0)
        const data = JSON.parse(getResult.stdout)
        expect(data.type).toBe('document')
        expect(data.document.metadata.name).toBe('CLI Test Document')
      },
      TEST_TIMEOUT,
    )

    test(
      'document create with markdown body has readable content',
      async () => {
        const slug = `md-body-${Date.now()}`
        const hmId = `hm://${writeAccount.accountId}/${slug}`
        const markdownBody = '## Introduction\n\nThis is a **bold** paragraph.\n\n- Item one\n- Item two'

        const tmpDirMd = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFileMd = join(tmpDirMd, 'content.md')
        writeFileSync(mdFileMd, markdownBody)

        const result = await runCli(
          [
            'document',
            'create',
            '--path',
            slug,
            '--name',
            'Markdown Body Test',
            '-f',
            mdFileMd,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        rmSync(tmpDirMd, {recursive: true, force: true})
        if (result.exitCode !== 0) {
          console.log('[test] md body create stderr:', result.stderr)
          console.log('[test] md body create stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)

        await new Promise((r) => setTimeout(r, 2000))

        // Read back as JSON and verify blocks
        const getResult = await runCli(['document', 'get', hmId, '--json'], {server: ctx.webServerUrl})
        expect(getResult.exitCode).toBe(0)
        const data = JSON.parse(getResult.stdout)
        expect(data.type).toBe('document')
        expect(data.document.metadata.name).toBe('Markdown Body Test')
        // Should have content blocks
        expect(data.document.content.length).toBeGreaterThan(0)

        // Read back as markdown (default) and verify text
        const mdResult = await runCli(['document', 'get', hmId], {server: ctx.webServerUrl})
        expect(mdResult.exitCode).toBe(0)
        expect(mdResult.stdout).toContain('Introduction')
        expect(mdResult.stdout).toContain('bold')
        expect(mdResult.stdout).toContain('Item one')
        expect(mdResult.stdout).toContain('Item two')
      },
      TEST_TIMEOUT,
    )

    test(
      'document create with -f reads markdown from file',
      async () => {
        const slug = `md-file-${Date.now()}`
        const hmId = `hm://${writeAccount.accountId}/${slug}`

        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFile = join(tmpDir, 'content.md')
        writeFileSync(mdFile, '## From File\n\nContent loaded from a file.')

        try {
          const result = await runCli(
            ['document', 'create', '--path', slug, '--name', 'File Body Test', '-f', mdFile, '--key', TEST_KEY_NAME],
            {server: ctx.webServerUrl},
          )
          if (result.exitCode !== 0) {
            console.log('[test] body-file create stderr:', result.stderr)
            console.log('[test] body-file create stdout:', result.stdout)
          }
          expect(result.exitCode).toBe(0)

          await new Promise((r) => setTimeout(r, 2000))

          const mdResult = await runCli(['document', 'get', hmId], {server: ctx.webServerUrl})
          expect(mdResult.exitCode).toBe(0)
          expect(mdResult.stdout).toContain('From File')
          expect(mdResult.stdout).toContain('Content loaded from a file')
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    test(
      'document create with -f accepts HMBlockNodes JSON file',
      async () => {
        const slug = `blocks-json-${Date.now()}`
        const hmId = `hm://${writeAccount.accountId}/${slug}`

        const blocksJson = JSON.stringify([
          {
            block: {
              type: 'Heading',
              id: 'hdr1',
              text: 'Block Heading',
              annotations: [],
              attributes: {childrenType: 'Group'},
            },
            children: [
              {
                block: {
                  type: 'Paragraph',
                  id: 'para1',
                  text: 'Paragraph under heading',
                  annotations: [],
                  attributes: {},
                },
              },
            ],
          },
          {
            block: {
              type: 'Paragraph',
              id: 'para2',
              text: 'Root-level paragraph',
              annotations: [],
              attributes: {},
            },
          },
        ])

        const tmpDirJ = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const jsonFile = join(tmpDirJ, 'blocks.json')
        writeFileSync(jsonFile, blocksJson)

        const result = await runCli(
          ['document', 'create', '--path', slug, '--name', 'Blocks JSON Test', '-f', jsonFile, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
        rmSync(tmpDirJ, {recursive: true, force: true})
        if (result.exitCode !== 0) {
          console.log('[test] blocks json create stderr:', result.stderr)
          console.log('[test] blocks json create stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)

        await new Promise((r) => setTimeout(r, 2000))

        // Read back as JSON and verify block structure
        const getResult = await runCli(['document', 'get', hmId, '--json'], {server: ctx.webServerUrl})
        expect(getResult.exitCode).toBe(0)
        const data = JSON.parse(getResult.stdout)
        expect(data.type).toBe('document')
        expect(data.document.metadata.name).toBe('Blocks JSON Test')
        expect(data.document.content.length).toBe(2)

        // Verify the heading block
        const headingBlock = data.document.content[0]
        expect(headingBlock.block.type).toBe('Heading')
        expect(headingBlock.block.text).toBe('Block Heading')
        // Heading should have a child paragraph
        expect(headingBlock.children.length).toBe(1)
        expect(headingBlock.children[0].block.text).toBe('Paragraph under heading')

        // Verify the root paragraph
        const paraBlock = data.document.content[1]
        expect(paraBlock.block.type).toBe('Paragraph')
        expect(paraBlock.block.text).toBe('Root-level paragraph')

        // Also verify via markdown output (default)
        const mdResult = await runCli(['document', 'get', hmId], {server: ctx.webServerUrl})
        expect(mdResult.exitCode).toBe(0)
        expect(mdResult.stdout).toContain('Block Heading')
        expect(mdResult.stdout).toContain('Paragraph under heading')
        expect(mdResult.stdout).toContain('Root-level paragraph')
      },
      TEST_TIMEOUT,
    )

    test(
      'document create with -f reads JSON from file',
      async () => {
        const slug = `blocks-file-${Date.now()}`
        const hmId = `hm://${writeAccount.accountId}/${slug}`

        const blocksJson = JSON.stringify([
          {
            block: {
              type: 'Paragraph',
              id: 'fp1',
              text: 'Block from JSON file',
              annotations: [],
              attributes: {},
            },
          },
        ])

        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const blocksFile = join(tmpDir, 'blocks.json')
        writeFileSync(blocksFile, blocksJson)

        try {
          const result = await runCli(
            [
              'document',
              'create',
              '--path',
              slug,
              '--name',
              'Blocks File Test',
              '-f',
              blocksFile,
              '--key',
              TEST_KEY_NAME,
            ],
            {server: ctx.webServerUrl},
          )
          if (result.exitCode !== 0) {
            console.log('[test] blocks-file create stderr:', result.stderr)
            console.log('[test] blocks-file create stdout:', result.stdout)
          }
          expect(result.exitCode).toBe(0)

          await new Promise((r) => setTimeout(r, 2000))

          const getResult = await runCli(['document', 'get', hmId, '--json'], {server: ctx.webServerUrl})
          expect(getResult.exitCode).toBe(0)
          const data = JSON.parse(getResult.stdout)
          expect(data.type).toBe('document')
          expect(data.document.content.length).toBe(1)
          expect(data.document.content[0].block.text).toBe('Block from JSON file')
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    test(
      'document create with no input shows error',
      async () => {
        const result = await runCli(['document', 'create', '--name', 'Error Test', '--key', TEST_KEY_NAME], {
          server: ctx.webServerUrl,
        })
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('No input provided')
      },
      TEST_TIMEOUT,
    )

    // --- Document Create Metadata Flags ---

    test(
      'document create --summary sets document summary',
      async () => {
        const slug = `meta-summary-${Date.now()}`
        const hmId = `hm://${writeAccount.accountId}/${slug}`
        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFile = join(tmpDir, 'content.md')
        writeFileSync(mdFile, 'Content')
        try {
          const result = await runCli(
            [
              'document',
              'create',
              '--path',
              slug,
              '--name',
              'Summary Test',
              '--summary',
              'My summary',
              '-f',
              mdFile,
              '--key',
              TEST_KEY_NAME,
            ],
            {server: ctx.webServerUrl},
          )
          expect(result.exitCode).toBe(0)
          await new Promise((r) => setTimeout(r, 2000))
          const getResult = await runCli(['document', 'get', hmId], {server: ctx.webServerUrl})
          expect(getResult.exitCode).toBe(0)
          expect(getResult.stdout).toContain('My summary')
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    test(
      'document create --layout sets layout metadata',
      async () => {
        const slug = `meta-layout-${Date.now()}`
        const hmId = `hm://${writeAccount.accountId}/${slug}`
        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFile = join(tmpDir, 'content.md')
        writeFileSync(mdFile, 'Content')
        try {
          const result = await runCli(
            [
              'document',
              'create',
              '--path',
              slug,
              '--name',
              'Layout Test',
              '--layout',
              'Seed/Experimental/Newspaper',
              '-f',
              mdFile,
              '--key',
              TEST_KEY_NAME,
            ],
            {server: ctx.webServerUrl},
          )
          expect(result.exitCode).toBe(0)
          await new Promise((r) => setTimeout(r, 2000))
          const getResult = await runCli(['document', 'get', hmId, '--json'], {server: ctx.webServerUrl})
          expect(getResult.exitCode).toBe(0)
          const data = JSON.parse(getResult.stdout)
          expect(data.document.metadata.layout).toBe('Seed/Experimental/Newspaper')
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    test(
      'document create --content-width sets content width',
      async () => {
        const slug = `meta-width-${Date.now()}`
        const hmId = `hm://${writeAccount.accountId}/${slug}`
        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFile = join(tmpDir, 'content.md')
        writeFileSync(mdFile, 'Content')
        try {
          const result = await runCli(
            [
              'document',
              'create',
              '--path',
              slug,
              '--name',
              'Width Test',
              '--content-width',
              'L',
              '-f',
              mdFile,
              '--key',
              TEST_KEY_NAME,
            ],
            {server: ctx.webServerUrl},
          )
          expect(result.exitCode).toBe(0)
          await new Promise((r) => setTimeout(r, 2000))
          const getResult = await runCli(['document', 'get', hmId, '--json'], {server: ctx.webServerUrl})
          expect(getResult.exitCode).toBe(0)
          const data = JSON.parse(getResult.stdout)
          expect(data.document.metadata.contentWidth).toBe('L')
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    test(
      'document create --display-author sets display author',
      async () => {
        const slug = `meta-author-${Date.now()}`
        const hmId = `hm://${writeAccount.accountId}/${slug}`
        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFile = join(tmpDir, 'content.md')
        writeFileSync(mdFile, 'Content')
        try {
          const result = await runCli(
            [
              'document',
              'create',
              '--path',
              slug,
              '--name',
              'Author Test',
              '--display-author',
              'Jane Doe',
              '-f',
              mdFile,
              '--key',
              TEST_KEY_NAME,
            ],
            {server: ctx.webServerUrl},
          )
          expect(result.exitCode).toBe(0)
          await new Promise((r) => setTimeout(r, 2000))
          const getResult = await runCli(['document', 'get', hmId, '--json'], {server: ctx.webServerUrl})
          expect(getResult.exitCode).toBe(0)
          const data = JSON.parse(getResult.stdout)
          expect(data.document.metadata.displayAuthor).toBe('Jane Doe')
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    test(
      'document create --display-publish-time sets publish time',
      async () => {
        const slug = `meta-pubtime-${Date.now()}`
        const hmId = `hm://${writeAccount.accountId}/${slug}`
        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFile = join(tmpDir, 'content.md')
        writeFileSync(mdFile, 'Content')
        try {
          const result = await runCli(
            [
              'document',
              'create',
              '--path',
              slug,
              '--name',
              'PubTime Test',
              '--display-publish-time',
              '2025-01-15',
              '-f',
              mdFile,
              '--key',
              TEST_KEY_NAME,
            ],
            {server: ctx.webServerUrl},
          )
          expect(result.exitCode).toBe(0)
          await new Promise((r) => setTimeout(r, 2000))
          const getResult = await runCli(['document', 'get', hmId, '--json'], {server: ctx.webServerUrl})
          expect(getResult.exitCode).toBe(0)
          const data = JSON.parse(getResult.stdout)
          expect(data.document.metadata.displayPublishTime).toBe('2025-01-15')
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    test(
      'document create --site-url sets site URL',
      async () => {
        const slug = `meta-siteurl-${Date.now()}`
        const hmId = `hm://${writeAccount.accountId}/${slug}`
        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFile = join(tmpDir, 'content.md')
        writeFileSync(mdFile, 'Content')
        try {
          const result = await runCli(
            [
              'document',
              'create',
              '--path',
              slug,
              '--name',
              'SiteUrl Test',
              '--site-url',
              'https://example.com',
              '-f',
              mdFile,
              '--key',
              TEST_KEY_NAME,
            ],
            {server: ctx.webServerUrl},
          )
          expect(result.exitCode).toBe(0)
          await new Promise((r) => setTimeout(r, 2000))
          const getResult = await runCli(['document', 'get', hmId, '--json'], {server: ctx.webServerUrl})
          expect(getResult.exitCode).toBe(0)
          const data = JSON.parse(getResult.stdout)
          expect(data.document.metadata.siteUrl).toBe('https://example.com')
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    test(
      'document create --show-outline sets outline visibility',
      async () => {
        const slug = `meta-outline-${Date.now()}`
        const hmId = `hm://${writeAccount.accountId}/${slug}`
        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFile = join(tmpDir, 'content.md')
        writeFileSync(mdFile, 'Content')
        try {
          const result = await runCli(
            [
              'document',
              'create',
              '--path',
              slug,
              '--name',
              'Outline Test',
              '--show-outline',
              '-f',
              mdFile,
              '--key',
              TEST_KEY_NAME,
            ],
            {server: ctx.webServerUrl},
          )
          expect(result.exitCode).toBe(0)
          await new Promise((r) => setTimeout(r, 2000))
          const getResult = await runCli(['document', 'get', hmId, '--json'], {server: ctx.webServerUrl})
          expect(getResult.exitCode).toBe(0)
          const data = JSON.parse(getResult.stdout)
          expect(data.document.metadata.showOutline).toBe(true)
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    test(
      'document create --show-activity sets activity visibility',
      async () => {
        const slug = `meta-activity-${Date.now()}`
        const hmId = `hm://${writeAccount.accountId}/${slug}`
        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFile = join(tmpDir, 'content.md')
        writeFileSync(mdFile, 'Content')
        try {
          const result = await runCli(
            [
              'document',
              'create',
              '--path',
              slug,
              '--name',
              'Activity Test',
              '--show-activity',
              '-f',
              mdFile,
              '--key',
              TEST_KEY_NAME,
            ],
            {server: ctx.webServerUrl},
          )
          expect(result.exitCode).toBe(0)
          await new Promise((r) => setTimeout(r, 2000))
          const getResult = await runCli(['document', 'get', hmId, '--json'], {server: ctx.webServerUrl})
          expect(getResult.exitCode).toBe(0)
          const data = JSON.parse(getResult.stdout)
          expect(data.document.metadata.showActivity).toBe(true)
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    // --- Document Create --dry-run ---

    test(
      'document create --dry-run outputs preview without publishing',
      async () => {
        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFile = join(tmpDir, 'content.md')
        writeFileSync(mdFile, '# Dry Run\n\nThis should not be published.')
        try {
          const result = await runCli(['document', 'create', '--name', 'Dry Run Test', '-f', mdFile, '--dry-run'], {
            server: ctx.webServerUrl,
          })
          expect(result.exitCode).toBe(0)
          // Should output markdown preview (no key needed for dry-run)
          expect(result.stdout).toContain('name: "Dry Run Test"')
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    test(
      'document create --dry-run --json outputs JSON preview',
      async () => {
        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFile = join(tmpDir, 'content.md')
        writeFileSync(mdFile, 'Preview content')
        try {
          const result = await runCli(
            ['document', 'create', '--name', 'JSON Preview', '-f', mdFile, '--dry-run', '--json'],
            {server: ctx.webServerUrl},
          )
          expect(result.exitCode).toBe(0)
          const data = JSON.parse(result.stdout)
          expect(data.metadata.name).toBe('JSON Preview')
          expect(data.blocks).toBeDefined()
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    // --- Document Update with file ---

    test(
      'document update -f appends content from file',
      async () => {
        const slug = `update-file-${Date.now()}`
        const hmId = `hm://${writeAccount.accountId}/${slug}`
        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFile = join(tmpDir, 'initial.md')
        writeFileSync(mdFile, 'Initial content')

        try {
          // Create document
          const createResult = await runCli(
            ['document', 'create', '--path', slug, '--name', 'Update File Test', '-f', mdFile, '--key', TEST_KEY_NAME],
            {server: ctx.webServerUrl},
          )
          expect(createResult.exitCode).toBe(0)
          await new Promise((r) => setTimeout(r, 2000))

          // Update with new content
          const updateFile = join(tmpDir, 'update.md')
          writeFileSync(updateFile, 'Appended content from file')

          const updateResult = await runCli(['document', 'update', hmId, '-f', updateFile, '--key', TEST_KEY_NAME], {
            server: ctx.webServerUrl,
          })
          expect(updateResult.exitCode).toBe(0)

          await new Promise((r) => setTimeout(r, 2000))

          // Verify content was appended
          const getResult = await runCli(['document', 'get', hmId], {server: ctx.webServerUrl})
          expect(getResult.exitCode).toBe(0)
          expect(getResult.stdout).toContain('Appended content from file')
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    // --- Document Get -o (output to file) ---

    test(
      'document get -o writes output to file',
      async () => {
        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const outputFile = join(tmpDir, 'output.md')
        try {
          const result = await runCli(['document', 'get', writeAccountHmId, '-o', outputFile], {
            server: ctx.webServerUrl,
          })
          expect(result.exitCode).toBe(0)
          expect(result.stderr).toContain('Written to')

          // Verify file was written
          const {existsSync: exists, readFileSync: read} = await import('fs')
          expect(exists(outputFile)).toBe(true)
          const content = read(outputFile, 'utf-8')
          expect(content).toContain('---')
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    // --- Comment Create from file ---

    test(
      'comment create --file reads comment from file',
      async () => {
        const tmpDir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const commentFile = join(tmpDir, 'comment.txt')
        writeFileSync(commentFile, 'Comment from file')
        try {
          const result = await runCli(
            ['comment', 'create', writeAccountHmId, '--file', commentFile, '--key', TEST_KEY_NAME],
            {server: ctx.webServerUrl},
          )
          expect(result.exitCode).toBe(0)
          expect(result.stderr + result.stdout).toContain('Comment published')
        } finally {
          rmSync(tmpDir, {recursive: true, force: true})
        }
      },
      TEST_TIMEOUT,
    )

    // --- Document Delete Tests ---

    test(
      'document delete deletes a document',
      async () => {
        // Create a document to delete
        const deleteSlug = `delete-test-${Date.now()}`
        const deleteHmId = `hm://${writeAccount.accountId}/${deleteSlug}`

        const tmpDirDel = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFileDel = join(tmpDirDel, 'content.md')
        writeFileSync(mdFileDel, 'This will be deleted')

        const createResult = await runCli(
          [
            'document',
            'create',
            '--path',
            deleteSlug,
            '--name',
            'Doc To Delete',
            '-f',
            mdFileDel,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        rmSync(tmpDirDel, {recursive: true, force: true})
        expect(createResult.exitCode).toBe(0)

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Verify it exists
        const existsResult = await runCli(['document', 'get', deleteHmId], {server: ctx.webServerUrl})
        expect(existsResult.exitCode).toBe(0)

        // Delete it
        const deleteResult = await runCli(['document', 'delete', deleteHmId, '--key', TEST_KEY_NAME], {
          server: ctx.webServerUrl,
        })
        if (deleteResult.exitCode !== 0) {
          console.log('[test] document delete stderr:', deleteResult.stderr)
          console.log('[test] document delete stdout:', deleteResult.stdout)
        }
        expect(deleteResult.exitCode).toBe(0)
        expect(deleteResult.stderr + deleteResult.stdout).toContain('Document deleted')

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Verify the document is deleted (should fail or return deleted status)
        const getResult = await runCli(['document', 'get', deleteHmId], {server: ctx.webServerUrl})
        // Deleted documents should return an error or have type 'deleted'
        if (getResult.exitCode === 0) {
          const data = JSON.parse(getResult.stdout)
          expect(data.type).not.toBe('document')
        } else {
          // Expected: document not found after deletion
          expect(getResult.exitCode).not.toBe(0)
        }
      },
      TEST_TIMEOUT,
    )

    // --- Document Fork Tests ---

    test(
      'document fork creates a copy at destination',
      async () => {
        // Create source document
        const sourceSlug = `fork-source-${Date.now()}`
        const sourceHmId = `hm://${writeAccount.accountId}/${sourceSlug}`

        const tmpDirFork = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFileFork = join(tmpDirFork, 'content.md')
        writeFileSync(mdFileFork, 'Content to fork')

        const createResult = await runCli(
          [
            'document',
            'create',
            '--path',
            sourceSlug,
            '--name',
            'Fork Source',
            '-f',
            mdFileFork,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        rmSync(tmpDirFork, {recursive: true, force: true})
        expect(createResult.exitCode).toBe(0)

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Fork to destination
        const destSlug = `fork-dest-${Date.now()}`
        const destHmId = `hm://${writeAccount.accountId}/${destSlug}`

        const forkResult = await runCli(['document', 'fork', sourceHmId, destHmId, '--key', TEST_KEY_NAME], {
          server: ctx.webServerUrl,
        })
        if (forkResult.exitCode !== 0) {
          console.log('[test] document fork stderr:', forkResult.stderr)
          console.log('[test] document fork stdout:', forkResult.stdout)
        }
        expect(forkResult.exitCode).toBe(0)
        expect(forkResult.stderr + forkResult.stdout).toContain('Document forked')

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Verify destination exists with same content
        const getResult = await runCli(['document', 'get', destHmId, '--json'], {server: ctx.webServerUrl})
        expect(getResult.exitCode).toBe(0)
        const data = JSON.parse(getResult.stdout)
        expect(data.type).toBe('document')
        expect(data.document.metadata.name).toBe('Fork Source')

        // Verify source still exists
        const sourceResult = await runCli(['document', 'get', sourceHmId], {server: ctx.webServerUrl})
        expect(sourceResult.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )

    // --- Document Move Tests ---

    test(
      'document move creates destination and redirects source',
      async () => {
        // Create source document
        const moveSourceSlug = `move-source-${Date.now()}`
        const moveSourceHmId = `hm://${writeAccount.accountId}/${moveSourceSlug}`

        const tmpDirMove = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFileMove = join(tmpDirMove, 'content.md')
        writeFileSync(mdFileMove, 'Content to move')

        const createResult = await runCli(
          [
            'document',
            'create',
            '--path',
            moveSourceSlug,
            '--name',
            'Move Source',
            '-f',
            mdFileMove,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        rmSync(tmpDirMove, {recursive: true, force: true})
        expect(createResult.exitCode).toBe(0)

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Move to destination
        const moveDestSlug = `move-dest-${Date.now()}`
        const moveDestHmId = `hm://${writeAccount.accountId}/${moveDestSlug}`

        const moveResult = await runCli(['document', 'move', moveSourceHmId, moveDestHmId, '--key', TEST_KEY_NAME], {
          server: ctx.webServerUrl,
        })
        if (moveResult.exitCode !== 0) {
          console.log('[test] document move stderr:', moveResult.stderr)
          console.log('[test] document move stdout:', moveResult.stdout)
        }
        expect(moveResult.exitCode).toBe(0)
        expect(moveResult.stderr + moveResult.stdout).toContain('Document moved')

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Verify destination exists with same content
        const destResult = await runCli(['document', 'get', moveDestHmId, '--json'], {server: ctx.webServerUrl})
        expect(destResult.exitCode).toBe(0)
        const data = JSON.parse(destResult.stdout)
        expect(data.type).toBe('document')
        expect(data.document.metadata.name).toBe('Move Source')
      },
      TEST_TIMEOUT,
    )

    // --- Document Redirect Tests ---

    test(
      'document redirect creates a redirect',
      async () => {
        // Create a document to redirect
        const redirectSlug = `redirect-source-${Date.now()}`
        const redirectHmId = `hm://${writeAccount.accountId}/${redirectSlug}`

        const tmpDirRedir = mkdtempSync(join(tmpdir(), 'seed-test-'))
        const mdFileRedir = join(tmpDirRedir, 'source.md')
        writeFileSync(mdFileRedir, 'Will redirect')

        const createResult = await runCli(
          [
            'document',
            'create',
            '--path',
            redirectSlug,
            '--name',
            'Redirect Source',
            '-f',
            mdFileRedir,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        expect(createResult.exitCode).toBe(0)

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Create a target document
        const targetSlug = `redirect-target-${Date.now()}`
        const targetHmId = `hm://${writeAccount.accountId}/${targetSlug}`

        const mdFileTarget = join(tmpDirRedir, 'target.md')
        writeFileSync(mdFileTarget, 'Target content')

        const targetResult = await runCli(
          [
            'document',
            'create',
            '--path',
            targetSlug,
            '--name',
            'Redirect Target',
            '-f',
            mdFileTarget,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        rmSync(tmpDirRedir, {recursive: true, force: true})
        expect(targetResult.exitCode).toBe(0)

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Redirect source to target
        const redirectResult = await runCli(
          ['document', 'redirect', redirectHmId, '--to', targetHmId, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
        if (redirectResult.exitCode !== 0) {
          console.log('[test] document redirect stderr:', redirectResult.stderr)
          console.log('[test] document redirect stdout:', redirectResult.stdout)
        }
        expect(redirectResult.exitCode).toBe(0)
        expect(redirectResult.stderr + redirectResult.stdout).toContain('Redirect created')
      },
      TEST_TIMEOUT,
    )

    test(
      'document delete with missing key shows error',
      async () => {
        const result = await runCli(
          ['document', 'delete', `hm://${writeAccount.accountId}/nonexistent`, '--key', 'nonexistent-key-name'],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('not found')
      },
      TEST_TIMEOUT,
    )

    // --- Contact Tests ---

    const contactName = `Test Contact ${Date.now()}`
    let createdContactId: string

    test(
      'contact create creates a contact',
      async () => {
        const result = await runCli(
          ['contact', 'create', '--subject', FIXTURE_ACCOUNT_ID, '--name', contactName, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
        if (result.exitCode !== 0) {
          console.log('[test] contact create stderr:', result.stderr)
          console.log('[test] contact create stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Contact created:')
        createdContactId = (result.stderr + result.stdout).match(/Contact created:\s+(\S+)/)?.[1] || ''
        expect(createdContactId).toBeTruthy()
      },
      TEST_TIMEOUT,
    )

    test(
      'contact list shows both directions by default',
      async () => {
        // Wait for indexing after create
        await new Promise((r) => setTimeout(r, 2000))

        // writeAccount created a contact with subject=FIXTURE_ACCOUNT_ID,
        // so listing writeAccount should show it (as signer).
        const result = await runCli(['contact', 'list', writeAccount.accountId], {server: ctx.webServerUrl})
        if (result.exitCode !== 0) {
          console.log('[test] contact list stderr:', result.stderr)
          console.log('[test] contact list stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)
        const contacts = JSON.parse(result.stdout)
        expect(Array.isArray(contacts)).toBe(true)
        expect(contacts.length).toBeGreaterThan(0)
        const found = contacts.find((c: any) => c.name === contactName)
        expect(found).toBeTruthy()
        expect(found.subject).toBe(FIXTURE_ACCOUNT_ID)
        expect(found.account).toBe(writeAccount.accountId)
      },
      TEST_TIMEOUT,
    )

    test(
      'contact list --account filters to contacts signed by the account',
      async () => {
        const result = await runCli(['contact', 'list', writeAccount.accountId, '--account'], {
          server: ctx.webServerUrl,
        })
        if (result.exitCode !== 0) {
          console.log('[test] contact list --account stderr:', result.stderr)
          console.log('[test] contact list --account stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)
        const contacts = JSON.parse(result.stdout)
        expect(Array.isArray(contacts)).toBe(true)
        expect(contacts.length).toBeGreaterThan(0)
        // All results should be signed by this account
        for (const c of contacts) {
          expect(c.account).toBe(writeAccount.accountId)
        }
        const found = contacts.find((c: any) => c.name === contactName)
        expect(found).toBeTruthy()
      },
      TEST_TIMEOUT,
    )

    test(
      'contact list --subject filters to contacts about the account',
      async () => {
        // FIXTURE_ACCOUNT_ID is the subject of the contact we created
        const result = await runCli(['contact', 'list', FIXTURE_ACCOUNT_ID, '--subject'], {server: ctx.webServerUrl})
        if (result.exitCode !== 0) {
          console.log('[test] contact list --subject stderr:', result.stderr)
          console.log('[test] contact list --subject stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)
        const contacts = JSON.parse(result.stdout)
        expect(Array.isArray(contacts)).toBe(true)
        expect(contacts.length).toBeGreaterThan(0)
        // All returned contacts should reference this subject
        for (const c of contacts) {
          expect(c.subject).toBe(FIXTURE_ACCOUNT_ID)
        }
        const found = contacts.find((c: any) => c.name === contactName)
        expect(found).toBeTruthy()
      },
      TEST_TIMEOUT,
    )

    test(
      'contact list with no account ID shows error',
      async () => {
        const result = await runCli(['contact', 'list'], {server: ctx.webServerUrl})
        expect(result.exitCode).not.toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'contact delete deletes a contact',
      async () => {
        expect(createdContactId).toBeTruthy()

        const result = await runCli(['contact', 'delete', createdContactId, '--key', TEST_KEY_NAME], {
          server: ctx.webServerUrl,
        })
        if (result.exitCode !== 0) {
          console.log('[test] contact delete stderr:', result.stderr)
          console.log('[test] contact delete stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Contact deleted')
      },
      TEST_TIMEOUT,
    )

    test(
      'contact delete with missing key shows error',
      async () => {
        const result = await runCli(['contact', 'delete', 'fake-author/fake-tsid', '--key', 'nonexistent-key-name'], {
          server: ctx.webServerUrl,
        })
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('not found')
      },
      TEST_TIMEOUT,
    )
  })
})
