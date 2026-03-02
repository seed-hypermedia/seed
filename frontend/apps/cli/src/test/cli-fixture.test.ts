/**
 * CLI Fixture Tests
 *
 * Full integration tests with daemon + web server using fixture data.
 * Includes write operation tests (update, comment-create, comment-delete).
 */

import {describe, test, expect, beforeAll, afterAll} from 'bun:test'
import {
  startFullIntegrationWithFixture,
  runCli,
  type FullTestContext,
} from './setup'
import {
  generateTestAccount,
  registerAccount,
  type TestAccount,
} from './account-helpers'

let ctx: FullTestContext

// Fixture account ID (from test-fixtures/desktop/daemon/keys/account_keys.json)
const FIXTURE_ACCOUNT = 'z6MksCerY4A2EWyue418ARHgMLAndpchBcKo639cJme73ZQQ'
const HIERARCHY_TEST_DOC = `hm://${FIXTURE_ACCOUNT}/hierarchy-test`

const TEST_TIMEOUT = 180000 // 3 minutes for daemon + web server startup

// Test mnemonic for write operations (well-known BIP-39 test vector).
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const TEST_KEY_NAME = 'cli-fixture-test'

describe('CLI Full Integration Tests', () => {
  beforeAll(async () => {
    ctx = await startFullIntegrationWithFixture()
    console.log(
      `[test] Full integration ready: daemon=${ctx.daemonUrl}, web=${ctx.webServerUrl}`,
    )
  }, TEST_TIMEOUT)

  afterAll(async () => {
    // Clean up the test key from the OS keyring (best effort).
    try {
      await runCli(['key', 'remove', TEST_KEY_NAME, '--force'])
    } catch {
      // Ignore — key may not have been created if tests failed early.
    }
    await ctx.cleanup()
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
        expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/)
      },
      TEST_TIMEOUT,
    )
  })

  describe('Fixture Data via API', () => {
    test(
      'get hierarchy-test document as JSON',
      async () => {
        const result = await runCli(['document', 'get', HIERARCHY_TEST_DOC], {
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
      'get --md returns correct markdown structure',
      async () => {
        const result = await runCli(
          ['document', 'get', HIERARCHY_TEST_DOC, '--md'],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).toBe(0)

        // Validate the markdown content matches the fixture document
        expect(result.stdout).toContain('# Hierarchy Test')
        expect(result.stdout).toContain('Text before first heading')
        expect(result.stdout).toContain('# First Heading')
        expect(result.stdout).toContain('under first heading')
        expect(result.stdout).toContain('## Second Level Heading A')
        expect(result.stdout).toContain(
          'Under First Heading > Second Level Heading A',
        )
        expect(result.stdout).toContain('under first heading, at the end')
        expect(result.stdout).toContain('# Second Heading')
        expect(result.stdout).toContain('In second heading')
        expect(result.stdout).toContain('Text after all sections')
      },
      TEST_TIMEOUT,
    )

    test(
      'get --md --frontmatter includes YAML frontmatter',
      async () => {
        const result = await runCli(
          ['document', 'get', HIERARCHY_TEST_DOC, '--md', '--frontmatter'],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).toBe(0)

        // Validate frontmatter structure
        expect(result.stdout).toMatch(/^---/)
        expect(result.stdout).toContain('title: "Hierarchy Test"')
        expect(result.stdout).toContain(`authors: [${FIXTURE_ACCOUNT}]`)
        expect(result.stdout).toContain('version: bafy')
        expect(result.stdout).toMatch(/---\n\n# Hierarchy Test/)
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
      const importResult = await runCli([
        'key',
        'import',
        '-n',
        TEST_KEY_NAME,
        TEST_MNEMONIC,
      ])
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
      const {deriveKeyPairFromMnemonic} = await import(
        '../utils/key-derivation'
      )
      const keyPair = deriveKeyPairFromMnemonic(TEST_MNEMONIC, '')
      writeAccount = {
        keyPair,
        mnemonic: TEST_MNEMONIC,
        accountId: keyPair.accountId,
      }

      writeAccountHmId = `hm://${writeAccount.accountId}`

      // 4. Register the account on the web server.
      await registerAccount(
        ctx.webServerUrl,
        writeAccount,
        'CLI Write Test Account',
      )
      console.log(`[test] Write test account registered on web server`)

      // 5. Wait for the account to be indexed and verify it's accessible.
      await new Promise((r) => setTimeout(r, 2000))
      const verifyResult = await runCli(['document', 'get', writeAccountHmId], {
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
      'document update --title changes document title',
      async () => {
        const newTitle = `Updated Title ${Date.now()}`
        const result = await runCli(
          [
            'document',
            'update',
            writeAccountHmId,
            '--title',
            newTitle,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        if (result.exitCode !== 0) {
          console.log('[test] update --title stderr:', result.stderr)
          console.log('[test] update --title stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Document updated')

        // Verify by reading back.
        const getResult = await runCli(
          ['document', 'get', writeAccountHmId, '--md'],
          {server: ctx.webServerUrl},
        )
        expect(getResult.exitCode).toBe(0)
        expect(getResult.stdout).toContain(`# ${newTitle}`)
      },
      TEST_TIMEOUT,
    )

    test(
      'document update --summary sets document summary',
      async () => {
        const summary = 'A test summary from CLI fixture tests'
        const result = await runCli(
          [
            'document',
            'update',
            writeAccountHmId,
            '--summary',
            summary,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Document updated')

        // Verify by reading full resource (ResourceMetadata doesn't return summary).
        const getResult = await runCli(
          ['document', 'get', writeAccountHmId],
          {server: ctx.webServerUrl},
        )
        expect(getResult.exitCode).toBe(0)
        expect(getResult.stdout).toContain(summary)
      },
      TEST_TIMEOUT,
    )

    test(
      'document update with no flags shows error',
      async () => {
        const result = await runCli(
          ['document', 'update', writeAccountHmId, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('No updates specified')
      },
      TEST_TIMEOUT,
    )

    test(
      'document update with missing key shows error',
      async () => {
        const result = await runCli(
          [
            'document',
            'update',
            writeAccountHmId,
            '--title',
            'X',
            '--key',
            'nonexistent-key-name',
          ],
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
          [
            'comment',
            'create',
            writeAccountHmId,
            '--body',
            commentText,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        if (result.exitCode !== 0) {
          console.log('[test] comment create stderr:', result.stderr)
          console.log('[test] comment create stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Comment created')

        // Verify by listing comments.
        const commentsResult = await runCli(
          ['comment', 'list', writeAccountHmId],
          {server: ctx.webServerUrl},
        )
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
      'comment create with no body shows error',
      async () => {
        const result = await runCli(
          ['comment', 'create', writeAccountHmId, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
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

        const result = await runCli(
          [
            'comment',
            'delete',
            createdCommentId,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
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
        const result = await runCli(
          [
            'comment',
            'delete',
            'fake-author/fake-tsid',
            '--key',
            'nonexistent-key-name',
          ],
          {server: ctx.webServerUrl},
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

        const result = await runCli(
          [
            'document',
            'create',
            writeAccount.accountId,
            '--path',
            uniqueSlug,
            '--title',
            'CLI Test Document',
            '--body',
            'Hello from CLI test',
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        if (result.exitCode !== 0) {
          console.log('[test] document create stderr:', result.stderr)
          console.log('[test] document create stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Document created')

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Verify document exists
        const getResult = await runCli(
          ['document', 'get', createdDocHmId],
          {server: ctx.webServerUrl},
        )
        expect(getResult.exitCode).toBe(0)
        const data = JSON.parse(getResult.stdout)
        expect(data.type).toBe('document')
        expect(data.document.metadata.name).toBe('CLI Test Document')
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

        const createResult = await runCli(
          [
            'document',
            'create',
            writeAccount.accountId,
            '--path',
            deleteSlug,
            '--title',
            'Doc To Delete',
            '--body',
            'This will be deleted',
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        expect(createResult.exitCode).toBe(0)

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Verify it exists
        const existsResult = await runCli(
          ['document', 'get', deleteHmId],
          {server: ctx.webServerUrl},
        )
        expect(existsResult.exitCode).toBe(0)

        // Delete it
        const deleteResult = await runCli(
          [
            'document',
            'delete',
            deleteHmId,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        if (deleteResult.exitCode !== 0) {
          console.log('[test] document delete stderr:', deleteResult.stderr)
          console.log('[test] document delete stdout:', deleteResult.stdout)
        }
        expect(deleteResult.exitCode).toBe(0)
        expect(deleteResult.stderr + deleteResult.stdout).toContain('Document deleted')

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Verify the document is deleted (should fail or return deleted status)
        const getResult = await runCli(
          ['document', 'get', deleteHmId],
          {server: ctx.webServerUrl},
        )
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

        const createResult = await runCli(
          [
            'document',
            'create',
            writeAccount.accountId,
            '--path',
            sourceSlug,
            '--title',
            'Fork Source',
            '--body',
            'Content to fork',
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        expect(createResult.exitCode).toBe(0)

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Fork to destination
        const destSlug = `fork-dest-${Date.now()}`
        const destHmId = `hm://${writeAccount.accountId}/${destSlug}`

        const forkResult = await runCli(
          [
            'document',
            'fork',
            sourceHmId,
            destHmId,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        if (forkResult.exitCode !== 0) {
          console.log('[test] document fork stderr:', forkResult.stderr)
          console.log('[test] document fork stdout:', forkResult.stdout)
        }
        expect(forkResult.exitCode).toBe(0)
        expect(forkResult.stderr + forkResult.stdout).toContain('Document forked')

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Verify destination exists with same content
        const getResult = await runCli(
          ['document', 'get', destHmId],
          {server: ctx.webServerUrl},
        )
        expect(getResult.exitCode).toBe(0)
        const data = JSON.parse(getResult.stdout)
        expect(data.type).toBe('document')
        expect(data.document.metadata.name).toBe('Fork Source')

        // Verify source still exists
        const sourceResult = await runCli(
          ['document', 'get', sourceHmId],
          {server: ctx.webServerUrl},
        )
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

        const createResult = await runCli(
          [
            'document',
            'create',
            writeAccount.accountId,
            '--path',
            moveSourceSlug,
            '--title',
            'Move Source',
            '--body',
            'Content to move',
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        expect(createResult.exitCode).toBe(0)

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Move to destination
        const moveDestSlug = `move-dest-${Date.now()}`
        const moveDestHmId = `hm://${writeAccount.accountId}/${moveDestSlug}`

        const moveResult = await runCli(
          [
            'document',
            'move',
            moveSourceHmId,
            moveDestHmId,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        if (moveResult.exitCode !== 0) {
          console.log('[test] document move stderr:', moveResult.stderr)
          console.log('[test] document move stdout:', moveResult.stdout)
        }
        expect(moveResult.exitCode).toBe(0)
        expect(moveResult.stderr + moveResult.stdout).toContain('Document moved')

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Verify destination exists with same content
        const destResult = await runCli(
          ['document', 'get', moveDestHmId],
          {server: ctx.webServerUrl},
        )
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

        const createResult = await runCli(
          [
            'document',
            'create',
            writeAccount.accountId,
            '--path',
            redirectSlug,
            '--title',
            'Redirect Source',
            '--body',
            'Will redirect',
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

        const targetResult = await runCli(
          [
            'document',
            'create',
            writeAccount.accountId,
            '--path',
            targetSlug,
            '--title',
            'Redirect Target',
            '--body',
            'Target content',
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        expect(targetResult.exitCode).toBe(0)

        // Wait for indexing
        await new Promise((r) => setTimeout(r, 2000))

        // Redirect source to target
        const redirectResult = await runCli(
          [
            'document',
            'redirect',
            redirectHmId,
            '--to',
            targetHmId,
            '--key',
            TEST_KEY_NAME,
          ],
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
          [
            'document',
            'delete',
            `hm://${writeAccount.accountId}/nonexistent`,
            '--key',
            'nonexistent-key-name',
          ],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('not found')
      },
      TEST_TIMEOUT,
    )

    // --- Contact Tests ---

    const contactName = `Test Contact ${Date.now()}`

    test(
      'contact create creates a contact',
      async () => {
        const result = await runCli(
          [
            'contact',
            'create',
            '--subject',
            FIXTURE_ACCOUNT,
            '--name',
            contactName,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        if (result.exitCode !== 0) {
          console.log('[test] contact create stderr:', result.stderr)
          console.log('[test] contact create stdout:', result.stdout)
        }
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Contact created')
        expect(result.stderr + result.stdout).toContain('Contact ID:')
      },
      TEST_TIMEOUT,
    )

    test(
      'contact list shows both directions by default',
      async () => {
        // Wait for indexing after create
        await new Promise((r) => setTimeout(r, 2000))

        // writeAccount created a contact with subject=FIXTURE_ACCOUNT,
        // so listing writeAccount should show it (as signer).
        const result = await runCli(
          ['contact', 'list', writeAccount.accountId],
          {server: ctx.webServerUrl},
        )
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
        expect(found.subject).toBe(FIXTURE_ACCOUNT)
        expect(found.account).toBe(writeAccount.accountId)
      },
      TEST_TIMEOUT,
    )

    test(
      'contact list --account filters to contacts signed by the account',
      async () => {
        const result = await runCli(
          ['contact', 'list', writeAccount.accountId, '--account'],
          {server: ctx.webServerUrl},
        )
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
        // FIXTURE_ACCOUNT is the subject of the contact we created
        const result = await runCli(
          ['contact', 'list', FIXTURE_ACCOUNT, '--subject'],
          {server: ctx.webServerUrl},
        )
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
          expect(c.subject).toBe(FIXTURE_ACCOUNT)
        }
        const found = contacts.find((c: any) => c.name === contactName)
        expect(found).toBeTruthy()
      },
      TEST_TIMEOUT,
    )

    test(
      'contact list with no account ID shows error',
      async () => {
        const result = await runCli(
          ['contact', 'list'],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).not.toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'contact delete deletes a contact',
      async () => {
        // List contacts to find the one we created
        const listResult = await runCli(
          ['contact', 'list', writeAccount.accountId],
          {server: ctx.webServerUrl},
        )
        expect(listResult.exitCode).toBe(0)
        const contacts = JSON.parse(listResult.stdout)
        const target = contacts.find((c: any) => c.name === contactName)
        expect(target).toBeTruthy()

        const result = await runCli(
          [
            'contact',
            'delete',
            target.id,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
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
        const result = await runCli(
          [
            'contact',
            'delete',
            'fake-author/fake-tsid',
            '--key',
            'nonexistent-key-name',
          ],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('not found')
      },
      TEST_TIMEOUT,
    )
  })
})
