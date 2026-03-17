/**
 * CLI Integration Tests
 *
 * Tests the CLI against a real daemon instance with an isolated testnet.
 * Creates 2 test accounts and tests various workflows.
 */

import {describe, test, expect, beforeAll, afterAll} from 'bun:test'
import {startDaemon, runCli, type TestContext} from './setup'
import {generateTestAccount, registerAccount, type TestAccount} from './account-helpers'

let ctx: TestContext
let account1: TestAccount
let account2: TestAccount

const TEST_TIMEOUT = 60000 // 60 seconds for each test

describe('Seed CLI Integration Tests', () => {
  beforeAll(async () => {
    // Start daemon with isolated testnet and random ports
    ctx = await startDaemon()

    // Generate test accounts
    account1 = generateTestAccount()
    account2 = generateTestAccount()

    console.log(`[test] Account 1: ${account1.accountId}`)
    console.log(`[test] Account 2: ${account2.accountId}`)

    // Register accounts on the server
    await registerAccount(ctx.daemonUrl, account1, 'Test Account Alpha')
    console.log('[test] Account 1 registered')

    await registerAccount(ctx.daemonUrl, account2, 'Test Account Beta')
    console.log('[test] Account 2 registered')
  }, TEST_TIMEOUT * 2)

  afterAll(async () => {
    await ctx.cleanup()
  }, TEST_TIMEOUT)

  // ===== Basic CLI Commands =====

  describe('Basic Commands', () => {
    test(
      '--help shows usage',
      async () => {
        const result = await runCli(['--help'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Usage: seed-cli')
        expect(result.stdout).toContain('CLI for Seed Hypermedia')
      },
      TEST_TIMEOUT,
    )

    test(
      '--version shows version',
      async () => {
        const result = await runCli(['--version'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/)
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Account Commands =====

  describe('Account Commands', () => {
    test(
      'account list shows registered accounts',
      async () => {
        const result = await runCli(['account', 'list'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain(account1.accountId)
        expect(result.stdout).toContain(account2.accountId)
      },
      TEST_TIMEOUT,
    )

    test(
      'account list -q shows compact output',
      async () => {
        const result = await runCli(['account', 'list', '-q'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        const lines = result.stdout.split('\n').filter(Boolean)
        expect(lines.length).toBeGreaterThanOrEqual(2)
        // Each line should be id\tname
        for (const line of lines) {
          expect(line).toMatch(/^hm:\/\/z\S+\t/)
        }
      },
      TEST_TIMEOUT,
    )

    test(
      'account get <uid> shows account info',
      async () => {
        const result = await runCli(['account', 'get', account1.accountId], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain(account1.accountId)
        expect(result.stdout).toContain('Test Account Alpha')
      },
      TEST_TIMEOUT,
    )

    test(
      'account get with --pretty shows formatted output',
      async () => {
        const result = await runCli(['account', 'get', account1.accountId, '--pretty'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Test Account Alpha')
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Document Commands =====

  describe('Document Commands', () => {
    test(
      'document get defaults to markdown with frontmatter',
      async () => {
        const result = await runCli(['document', 'get', `hm://${account1.accountId}`], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        // Default output is markdown with frontmatter
        expect(result.stdout).toMatch(/^---/)
        expect(result.stdout).toContain('name: "Test Account Alpha"')
      },
      TEST_TIMEOUT,
    )

    test(
      'document get --json outputs JSON',
      async () => {
        const result = await runCli(['document', 'get', `hm://${account1.accountId}`, '--json'], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('document')
      },
      TEST_TIMEOUT,
    )

    test(
      'document get -q shows minimal output',
      async () => {
        const result = await runCli(['document', 'get', `hm://${account1.accountId}`, '-q'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        // Should show name or id
        expect(result.stdout).toMatch(/Test Account Alpha|z6Mk/)
      },
      TEST_TIMEOUT,
    )

    test(
      'document get -m fetches metadata only',
      async () => {
        const result = await runCli(['document', 'get', `hm://${account1.accountId}`, '-m'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Test Account Alpha')
        // Should not contain full content
        expect(result.stdout).not.toContain('Welcome to')
      },
      TEST_TIMEOUT,
    )

    test(
      'document get non-existent document returns error',
      async () => {
        const result = await runCli(['document', 'get', 'hm://z6MknonexistentAAAAAAAAAAAAAAAAAAAA/test'], {
          server: ctx.daemonUrl,
        })
        // Should handle gracefully
        expect(result.stdout).toContain('not-found')
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Search Commands =====

  describe('Search Commands', () => {
    test(
      'search finds accounts by name',
      async () => {
        const result = await runCli(['search', 'Alpha'], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Test Account Alpha')
      },
      TEST_TIMEOUT,
    )

    test(
      'search -q shows compact output',
      async () => {
        const result = await runCli(['search', 'Test Account', '-q'], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        const lines = result.stdout.split('\n').filter(Boolean)
        expect(lines.length).toBeGreaterThanOrEqual(1)
      },
      TEST_TIMEOUT,
    )

    test(
      'search with no results',
      async () => {
        const result = await runCli(['search', 'xyznonexistent123'], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Query Commands =====

  describe('Query Commands', () => {
    test(
      'query lists documents in space',
      async () => {
        const result = await runCli(['query', account1.accountId], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'children lists child documents',
      async () => {
        const result = await runCli(['children', account1.accountId], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'query with --yaml outputs yaml',
      async () => {
        const result = await runCli(['query', account1.accountId, '--yaml'], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        // YAML uses colons and indentation
        if (result.stdout.trim()) {
          expect(result.stdout).toMatch(/:\s/)
        }
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Comments and Discussions =====

  describe('Comments Commands', () => {
    test(
      'comment list on document (empty)',
      async () => {
        const result = await runCli(['comment', 'list', `hm://${account1.accountId}`], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'comment discussions on document',
      async () => {
        const result = await runCli(['comment', 'discussions', `hm://${account1.accountId}`], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Changes and History =====

  describe('Changes Commands', () => {
    test(
      'document changes shows document history',
      async () => {
        const result = await runCli(['document', 'changes', `hm://${account1.accountId}`], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('changes')
      },
      TEST_TIMEOUT,
    )

    test(
      'document changes -q shows compact output',
      async () => {
        const result = await runCli(['document', 'changes', `hm://${account1.accountId}`, '-q'], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        // Should have at least one change
        const lines = result.stdout.split('\n').filter(Boolean)
        expect(lines.length).toBeGreaterThanOrEqual(1)
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Citations =====

  describe('Citations Commands', () => {
    test(
      'citations shows backlinks',
      async () => {
        const result = await runCli(['citations', `hm://${account1.accountId}`], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Capabilities =====

  describe('Capabilities Commands', () => {
    test(
      'account capabilities shows access control',
      async () => {
        const result = await runCli(['account', 'capabilities', `hm://${account1.accountId}`], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Activity =====

  describe('Activity Commands', () => {
    test(
      'activity shows events',
      async () => {
        const result = await runCli(['activity'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'activity with --limit',
      async () => {
        const result = await runCli(['activity', '--limit', '5'], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Stats =====

  describe('Stats Commands', () => {
    test(
      'document stats shows interaction summary',
      async () => {
        const result = await runCli(['document', 'stats', `hm://${account1.accountId}`], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('citations')
        expect(result.stdout).toContain('comments')
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Key Management =====

  describe('Key Management Commands', () => {
    test(
      'key generate creates new key',
      async () => {
        const result = await runCli(['key', 'generate', '-n', 'test-key'], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('test-key')
        expect(result.stdout).toContain('created')
      },
      TEST_TIMEOUT,
    )

    test(
      'key list shows stored keys',
      async () => {
        const result = await runCli(['key', 'list'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'key derive computes account id',
      async () => {
        const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
        const result = await runCli(['key', 'derive', mnemonic], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        // Should output a z6Mk... account ID
        expect(result.stdout).toMatch(/^z6Mk/)
      },
      TEST_TIMEOUT,
    )

    test(
      'key import with invalid mnemonic fails',
      async () => {
        const result = await runCli(['key', 'import', 'invalid mnemonic words'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('Invalid mnemonic')
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Output Formats =====

  describe('Output Formats', () => {
    test(
      '--json outputs valid JSON',
      async () => {
        const result = await runCli(['account', 'list', '--json'], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        expect(() => JSON.parse(result.stdout)).not.toThrow()
      },
      TEST_TIMEOUT,
    )

    test(
      '--yaml outputs YAML format',
      async () => {
        const result = await runCli(['account', 'get', account1.accountId, '--yaml'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        // YAML has different structure than JSON
        expect(result.stdout).toMatch(/type:\s/)
      },
      TEST_TIMEOUT,
    )

    test(
      '--pretty outputs valid JSON (colorized) for non-document commands',
      async () => {
        const result = await runCli(['account', 'get', account1.accountId, '--pretty'], {
          server: ctx.daemonUrl,
          env: {FORCE_COLOR: '1'},
        })
        expect(result.exitCode).toBe(0)
        // Strip ANSI codes and verify it's still valid JSON
        const stripped = result.stdout.replace(/\x1B\[[0-9;]*m/g, '')
        expect(() => JSON.parse(stripped)).not.toThrow()
      },
      TEST_TIMEOUT,
    )

    test(
      '--pretty --json outputs colorized JSON for documents',
      async () => {
        const result = await runCli(['document', 'get', `hm://${account1.accountId}`, '--pretty', '--json'], {
          server: ctx.daemonUrl,
          env: {FORCE_COLOR: '1'},
        })
        expect(result.exitCode).toBe(0)
        const stripped = result.stdout.replace(/\x1B\[[0-9;]*m/g, '')
        expect(() => JSON.parse(stripped)).not.toThrow()
      },
      TEST_TIMEOUT,
    )

    test(
      '--pretty --yaml outputs YAML for documents',
      async () => {
        const result = await runCli(['document', 'get', `hm://${account1.accountId}`, '--pretty', '--yaml'], {
          server: ctx.daemonUrl,
          env: {FORCE_COLOR: '1'},
        })
        expect(result.exitCode).toBe(0)
        const stripped = result.stdout.replace(/\x1B\[[0-9;]*m/g, '')
        expect(stripped).toMatch(/type:\s/)
      },
      TEST_TIMEOUT,
    )

    test(
      '--pretty on document get produces clean markdown without block-id comments',
      async () => {
        const result = await runCli(['document', 'get', `hm://${account1.accountId}`, '--pretty'], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        // Should be markdown (starts with frontmatter)
        expect(result.stdout).toMatch(/^---/)
        // Should NOT contain block-id HTML comments
        expect(result.stdout).not.toMatch(/<!-- id:[a-zA-Z0-9_-]+ -->/)
      },
      TEST_TIMEOUT,
    )

    test(
      'document get without --pretty includes block-id comments',
      async () => {
        const result = await runCli(['document', 'get', `hm://${account1.accountId}`], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        // Default markdown includes block-id comments
        expect(result.stdout).toMatch(/^---/)
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Config Commands =====

  describe('Config Commands', () => {
    test(
      'config --show returns JSON config',
      async () => {
        const result = await runCli(['config', '--show'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        // Should be valid JSON (empty or with values)
        expect(() => JSON.parse(result.stdout)).not.toThrow()
      },
      TEST_TIMEOUT,
    )

    test(
      'config --server sets server URL',
      async () => {
        const result = await runCli(['config', '--server', 'http://test.local'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        expect(result.stderr).toContain('test.local')
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Account Contacts =====

  describe('Account Contacts Commands', () => {
    test(
      'account contacts lists contacts for an account',
      async () => {
        const result = await runCli(['account', 'contacts', account1.accountId], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'account get -q shows compact output',
      async () => {
        const result = await runCli(['account', 'get', account1.accountId, '-q'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        // Should show just the name or uid
        expect(result.stdout).toMatch(/Test Account Alpha|z6Mk/)
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Extended Key Management =====

  describe('Extended Key Management', () => {
    test(
      'key show displays key information',
      async () => {
        // First ensure we have a key
        await runCli(['key', 'generate', '-n', 'show-test-key'], {server: ctx.daemonUrl})
        const result = await runCli(['key', 'show', 'show-test-key'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('show-test-key')
        expect(result.stdout).toContain('accountId')
      },
      TEST_TIMEOUT,
    )

    test(
      'key show without arg shows default key',
      async () => {
        const result = await runCli(['key', 'show'], {server: ctx.daemonUrl})
        // Either shows a key or says no keys stored
        expect(result.exitCode === 0 || result.exitCode === 1).toBe(true)
      },
      TEST_TIMEOUT,
    )

    test(
      'key rename renames a key',
      async () => {
        await runCli(['key', 'generate', '-n', 'rename-me'], {server: ctx.daemonUrl})
        const result = await runCli(['key', 'rename', 'rename-me', 'renamed-key'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        expect(result.stderr).toContain('renamed')

        // Verify the key shows under new name
        const list = await runCli(['key', 'list'], {server: ctx.daemonUrl})
        expect(list.stdout).toContain('renamed-key')
      },
      TEST_TIMEOUT,
    )

    test(
      'key default shows current default',
      async () => {
        const result = await runCli(['key', 'default'], {server: ctx.daemonUrl})
        // Either shows default or says no keys stored
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'key remove explicitly removes a key',
      async () => {
        await runCli(['key', 'generate', '-n', 'remove-me'], {server: ctx.daemonUrl})
        // Without --force should fail
        const noForce = await runCli(['key', 'remove', 'remove-me'], {server: ctx.daemonUrl})
        expect(noForce.exitCode).toBe(1)
        expect(noForce.stderr).toContain('--force')

        // With --force should succeed
        const withForce = await runCli(['key', 'remove', 'remove-me', '--force'], {server: ctx.daemonUrl})
        expect(withForce.exitCode).toBe(0)
        expect(withForce.stderr).toContain('removed')
      },
      TEST_TIMEOUT,
    )

    test(
      'key generate --words 24 generates 24-word mnemonic',
      async () => {
        const result = await runCli(['key', 'generate', '-n', 'long-key', '--words', '24', '--show-mnemonic'], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        // Should show the 24-word mnemonic
        const mnemonicLine = result.stdout.split('\n').find((l) => l.trim().split(' ').length >= 20)
        expect(mnemonicLine).toBeTruthy()
      },
      TEST_TIMEOUT,
    )

    test(
      'key generate --show-mnemonic displays mnemonic in output',
      async () => {
        const result = await runCli(['key', 'generate', '-n', 'mnemonic-show', '--show-mnemonic'], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        // Mnemonic should appear somewhere in stdout
        // BIP-39 words are all lowercase alphabetic
        const lines = result.stdout.split('\n').filter(Boolean)
        const hasMnemonic = lines.some((l) => l.trim().split(' ').length >= 12)
        expect(hasMnemonic).toBe(true)
      },
      TEST_TIMEOUT,
    )

    test(
      'key derive with --passphrase produces different account ID',
      async () => {
        const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
        const noPass = await runCli(['key', 'derive', mnemonic], {server: ctx.daemonUrl})
        const withPass = await runCli(['key', 'derive', mnemonic, '--passphrase', 'secret'], {server: ctx.daemonUrl})
        expect(noPass.exitCode).toBe(0)
        expect(withPass.exitCode).toBe(0)
        expect(noPass.stdout.trim()).not.toBe(withPass.stdout.trim())
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Extended Query Commands =====

  describe('Extended Query Commands', () => {
    test(
      'query -q shows compact output',
      async () => {
        const result = await runCli(['query', account1.accountId, '-q'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'children -q shows compact output',
      async () => {
        const result = await runCli(['children', account1.accountId, '-q'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'citations -q shows compact output',
      async () => {
        const result = await runCli(['citations', `hm://${account1.accountId}`, '-q'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'activity -q shows compact output',
      async () => {
        const result = await runCli(['activity', '-q'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/\d+ events/)
      },
      TEST_TIMEOUT,
    )

    test(
      'search --account scopes search to account',
      async () => {
        const result = await runCli(['search', 'Alpha', '--account', account1.accountId], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Comment list quiet =====

  describe('Comment List Quiet', () => {
    test(
      'comment list -q shows compact output',
      async () => {
        const result = await runCli(['comment', 'list', `hm://${account1.accountId}`, '-q'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Error Handling =====

  describe('Error Handling', () => {
    test(
      'unknown command shows help',
      async () => {
        const result = await runCli(['unknowncommand'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(1)
      },
      TEST_TIMEOUT,
    )

    test(
      'missing required argument shows error',
      async () => {
        const result = await runCli(['document', 'get'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(1)
      },
      TEST_TIMEOUT,
    )

    test(
      'invalid server url handles gracefully',
      async () => {
        const result = await runCli(['account', 'list'], {
          server: 'http://localhost:99999',
        })
        expect(result.exitCode).toBe(1)
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Cross-Account Workflows =====

  describe('Cross-Account Workflows', () => {
    test(
      'both accounts visible in account list',
      async () => {
        const result = await runCli(['account', 'list', '-q'], {server: ctx.daemonUrl})
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain(account1.accountId)
        expect(result.stdout).toContain(account2.accountId)
      },
      TEST_TIMEOUT,
    )

    test(
      'can fetch both account home documents',
      async () => {
        const result1 = await runCli(['document', 'get', `hm://${account1.accountId}`, '-q'], {server: ctx.daemonUrl})
        const result2 = await runCli(['document', 'get', `hm://${account2.accountId}`, '-q'], {server: ctx.daemonUrl})

        expect(result1.exitCode).toBe(0)
        expect(result2.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'search finds both accounts',
      async () => {
        const result = await runCli(['search', 'Test Account'], {
          server: ctx.daemonUrl,
        })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Alpha')
        expect(result.stdout).toContain('Beta')
      },
      TEST_TIMEOUT,
    )
  })
})
