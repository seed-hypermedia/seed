/**
 * CLI Fixture Tests
 *
 * Full integration tests with daemon + web server using fixture data.
 * Includes write operation tests (update, comment-create).
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
        const result = await runCli(['get', HIERARCHY_TEST_DOC], {
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
        const result = await runCli(['get', HIERARCHY_TEST_DOC, '--md'], {
          server: ctx.webServerUrl,
        })
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
          ['get', HIERARCHY_TEST_DOC, '--md', '--frontmatter'],
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
      'update --title changes document title',
      async () => {
        const newTitle = `Updated Title ${Date.now()}`
        const result = await runCli(
          [
            'update',
            writeAccountHmId,
            '--title',
            newTitle,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Document updated')

        // Verify by reading back.
        const getResult = await runCli(['get', writeAccountHmId, '--md'], {
          server: ctx.webServerUrl,
        })
        expect(getResult.exitCode).toBe(0)
        expect(getResult.stdout).toContain(`# ${newTitle}`)
      },
      TEST_TIMEOUT,
    )

    test(
      'update --summary sets document summary',
      async () => {
        const summary = 'A test summary from CLI fixture tests'
        const result = await runCli(
          [
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

        // Verify by reading metadata.
        const getResult = await runCli(['get', writeAccountHmId, '-m'], {
          server: ctx.webServerUrl,
        })
        expect(getResult.exitCode).toBe(0)
        expect(getResult.stdout).toContain(summary)
      },
      TEST_TIMEOUT,
    )

    test(
      'update with no flags shows error',
      async () => {
        const result = await runCli(
          ['update', writeAccountHmId, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('No updates specified')
      },
      TEST_TIMEOUT,
    )

    test(
      'update with missing key shows error',
      async () => {
        const result = await runCli(
          [
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

    test(
      'comment-create creates a comment',
      async () => {
        const commentText = `Test comment from CLI fixture ${Date.now()}`
        const result = await runCli(
          [
            'comment-create',
            writeAccountHmId,
            '--body',
            commentText,
            '--key',
            TEST_KEY_NAME,
          ],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).toBe(0)
        expect(result.stderr + result.stdout).toContain('Comment created')

        // Verify by listing comments.
        const commentsResult = await runCli(['comments', writeAccountHmId], {
          server: ctx.webServerUrl,
        })
        expect(commentsResult.exitCode).toBe(0)
        expect(commentsResult.stdout).toContain(commentText)
      },
      TEST_TIMEOUT,
    )

    test(
      'comment-create with no body shows error',
      async () => {
        const result = await runCli(
          ['comment-create', writeAccountHmId, '--key', TEST_KEY_NAME],
          {server: ctx.webServerUrl},
        )
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('--body or --file')
      },
      TEST_TIMEOUT,
    )
  })
})
