/**
 * CLI Integration Tests
 *
 * Tests the CLI against a real daemon instance with an isolated testnet.
 * Creates 2 test accounts and tests various workflows.
 */

import {describe, test, expect, beforeAll, afterAll} from 'bun:test'
import {startDaemon, runCli, type TestContext} from './setup'
import {
  generateTestAccount,
  registerAccount,
  type TestAccount,
} from './account-helpers'

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
        const result = await runCli(
          ['account', 'get', account1.accountId, '--pretty'],
          {server: ctx.daemonUrl},
        )
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Test Account Alpha')
      },
      TEST_TIMEOUT,
    )
  })

  // ===== Document Commands =====

  describe('Document Commands', () => {
    test(
      'document get account home document',
      async () => {
        const result = await runCli(
          ['document', 'get', `hm://${account1.accountId}`],
          {server: ctx.daemonUrl},
        )
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('document')
      },
      TEST_TIMEOUT,
    )

    test(
      'document get with --md outputs markdown',
      async () => {
        const result = await runCli(
          ['document', 'get', `hm://${account1.accountId}`, '--md'],
          {server: ctx.daemonUrl},
        )
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('# Test Account Alpha')
      },
      TEST_TIMEOUT,
    )

    test(
      'document get with --md --frontmatter includes frontmatter',
      async () => {
        const result = await runCli(
          ['document', 'get', `hm://${account1.accountId}`, '--md', '--frontmatter'],
          {server: ctx.daemonUrl},
        )
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('---')
        expect(result.stdout).toContain('title: "Test Account Alpha"')
      },
      TEST_TIMEOUT,
    )

    test(
      'document get -q shows minimal output',
      async () => {
        const result = await runCli(
          ['document', 'get', `hm://${account1.accountId}`, '-q'],
          {server: ctx.daemonUrl},
        )
        expect(result.exitCode).toBe(0)
        // Should show name or id
        expect(result.stdout).toMatch(/Test Account Alpha|z6Mk/)
      },
      TEST_TIMEOUT,
    )

    test(
      'document get -m fetches metadata only',
      async () => {
        const result = await runCli(
          ['document', 'get', `hm://${account1.accountId}`, '-m'],
          {server: ctx.daemonUrl},
        )
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
        const result = await runCli(
          ['document', 'get', 'hm://z6MknonexistentAAAAAAAAAAAAAAAAAAAA/test'],
          {server: ctx.daemonUrl},
        )
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
        const result = await runCli(
          ['comment', 'list', `hm://${account1.accountId}`],
          {server: ctx.daemonUrl},
        )
        expect(result.exitCode).toBe(0)
      },
      TEST_TIMEOUT,
    )

    test(
      'comment discussions on document',
      async () => {
        const result = await runCli(
          ['comment', 'discussions', `hm://${account1.accountId}`],
          {server: ctx.daemonUrl},
        )
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
        const result = await runCli(
          ['document', 'changes', `hm://${account1.accountId}`],
          {server: ctx.daemonUrl},
        )
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('changes')
      },
      TEST_TIMEOUT,
    )

    test(
      'document changes -q shows compact output',
      async () => {
        const result = await runCli(
          ['document', 'changes', `hm://${account1.accountId}`, '-q'],
          {server: ctx.daemonUrl},
        )
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
        const result = await runCli(
          ['citations', `hm://${account1.accountId}`],
          {server: ctx.daemonUrl},
        )
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
        const result = await runCli(
          ['account', 'capabilities', `hm://${account1.accountId}`],
          {server: ctx.daemonUrl},
        )
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
        const result = await runCli(
          ['document', 'stats', `hm://${account1.accountId}`],
          {server: ctx.daemonUrl},
        )
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
        const mnemonic =
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
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
        const result = await runCli(
          ['key', 'import', 'invalid mnemonic words'],
          {server: ctx.daemonUrl},
        )
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
        const result = await runCli(
          ['account', 'get', account1.accountId, '--yaml'],
          {server: ctx.daemonUrl},
        )
        expect(result.exitCode).toBe(0)
        // YAML has different structure than JSON
        expect(result.stdout).toMatch(/type:\s/)
      },
      TEST_TIMEOUT,
    )

    test(
      '--pretty outputs readable format',
      async () => {
        const result = await runCli(
          ['account', 'get', account1.accountId, '--pretty'],
          {server: ctx.daemonUrl},
        )
        expect(result.exitCode).toBe(0)
        // Pretty format has indentation
        expect(result.stdout).toContain('\n')
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
        const result1 = await runCli(
          ['document', 'get', `hm://${account1.accountId}`, '-q'],
          {server: ctx.daemonUrl},
        )
        const result2 = await runCli(
          ['document', 'get', `hm://${account2.accountId}`, '-q'],
          {server: ctx.daemonUrl},
        )

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
