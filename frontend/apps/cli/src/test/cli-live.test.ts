/**
 * CLI Integration Tests against live dev server
 *
 * These tests use the existing dev.hyper.media server.
 * For account creation and write operations, we'll need isolated daemon tests.
 */

import {describe, test, expect} from 'bun:test'
import {runCli} from './setup'

const DEV_SERVER = 'https://hyper.media'
const TEST_TIMEOUT = 30000

// Known accounts on server for testing
const KNOWN_ACCOUNT = 'z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou'
const KNOWN_ACCOUNT_NAME = 'Gabo H Beaumont'

describe('CLI Read Operations (Live Dev Server)', () => {
  // ===== Basic CLI Commands =====

  describe('Basic Commands', () => {
    test('--help shows usage', async () => {
      const result = await runCli(['--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage: seed')
      expect(result.stdout).toContain('CLI for Seed Hypermedia')
    }, TEST_TIMEOUT)

    test('--version shows version', async () => {
      const result = await runCli(['--version'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/)
    }, TEST_TIMEOUT)
  })

  // ===== Account Commands =====

  describe('Account Commands', () => {
    test('accounts list shows accounts', async () => {
      const result = await runCli(['accounts'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('accounts')
    }, TEST_TIMEOUT)

    test('accounts -q shows compact output', async () => {
      const result = await runCli(['accounts', '-q'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.split('\n').filter(Boolean)
      expect(lines.length).toBeGreaterThan(0)
      // Each line should be id\tname format
      expect(lines[0]).toMatch(/^hm:\/\/z/)
    }, TEST_TIMEOUT)

    test('account shows account info', async () => {
      const result = await runCli(['account', KNOWN_ACCOUNT], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(KNOWN_ACCOUNT)
    }, TEST_TIMEOUT)

    test('account with --pretty shows formatted output', async () => {
      const result = await runCli(['account', KNOWN_ACCOUNT, '--pretty'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(KNOWN_ACCOUNT_NAME)
    }, TEST_TIMEOUT)

    test('account not found returns proper error', async () => {
      const result = await runCli(['account', 'z6MknonexistentAAAAAAAAAAAAAAAAAAAA'], {server: DEV_SERVER})
      expect(result.stdout).toContain('not-found')
    }, TEST_TIMEOUT)
  })

  // ===== Document Commands =====

  describe('Document Commands', () => {
    test('get fetches document', async () => {
      const result = await runCli(['get', `hm://${KNOWN_ACCOUNT}`], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('document')
    }, TEST_TIMEOUT)

    test('get with --md outputs markdown', async () => {
      const result = await runCli(['get', `hm://${KNOWN_ACCOUNT}`, '--md'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`# ${KNOWN_ACCOUNT_NAME}`)
    }, TEST_TIMEOUT)

    test('get with --md --frontmatter includes frontmatter', async () => {
      const result = await runCli(
        ['get', `hm://${KNOWN_ACCOUNT}`, '--md', '--frontmatter'],
        {server: DEV_SERVER}
      )
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('---')
      expect(result.stdout).toContain(`title: "${KNOWN_ACCOUNT_NAME}"`)
    }, TEST_TIMEOUT)

    test('get -q shows minimal output', async () => {
      const result = await runCli(['get', `hm://${KNOWN_ACCOUNT}`, '-q'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(new RegExp(`${KNOWN_ACCOUNT_NAME}|z6Mk`))
    }, TEST_TIMEOUT)

    test('get -m fetches metadata only', async () => {
      const result = await runCli(['get', `hm://${KNOWN_ACCOUNT}`, '-m'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      // ResourceMetadata returns id and metadata fields
      expect(result.stdout).toContain(KNOWN_ACCOUNT)
      expect(result.stdout).toContain('id')
    }, TEST_TIMEOUT)
  })

  // ===== Search Commands =====

  describe('Search Commands', () => {
    test('search finds documents', async () => {
      const result = await runCli(['search', 'test'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
    }, TEST_TIMEOUT)

    test('search -q shows compact output', async () => {
      const result = await runCli(['search', 'seed', '-q'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.split('\n').filter(Boolean)
      if (lines.length > 0) {
        expect(lines[0]).toMatch(/^hm:\/\//)
      }
    }, TEST_TIMEOUT)

    test('search with no results', async () => {
      const result = await runCli(['search', 'xyznonexistent123456789'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
    }, TEST_TIMEOUT)
  })

  // ===== Query Commands =====

  describe('Query Commands', () => {
    test('query lists documents in space', async () => {
      const result = await runCli(['query', KNOWN_ACCOUNT], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
    }, TEST_TIMEOUT)

    test('children lists child documents', async () => {
      const result = await runCli(['children', KNOWN_ACCOUNT], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
    }, TEST_TIMEOUT)

    test('query with --yaml outputs yaml', async () => {
      const result = await runCli(['query', KNOWN_ACCOUNT, '--yaml'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
    }, TEST_TIMEOUT)
  })

  // ===== Comments Commands =====

  describe('Comments Commands', () => {
    test('comments on document', async () => {
      const result = await runCli(['comments', `hm://${KNOWN_ACCOUNT}`], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
    }, TEST_TIMEOUT)

    test('discussions on document', async () => {
      const result = await runCli(['discussions', `hm://${KNOWN_ACCOUNT}`], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
    }, TEST_TIMEOUT)
  })

  // ===== Changes Commands =====

  describe('Changes Commands', () => {
    test('changes shows document history', async () => {
      const result = await runCli(['changes', `hm://${KNOWN_ACCOUNT}`], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('changes')
    }, TEST_TIMEOUT)

    test('changes -q shows compact output', async () => {
      const result = await runCli(['changes', `hm://${KNOWN_ACCOUNT}`, '-q'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
    }, TEST_TIMEOUT)
  })

  // ===== Citations =====

  describe('Citations Commands', () => {
    test('citations shows backlinks', async () => {
      const result = await runCli(['citations', `hm://${KNOWN_ACCOUNT}`], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
    }, TEST_TIMEOUT)
  })

  // ===== Capabilities =====

  describe('Capabilities Commands', () => {
    test('capabilities shows access control', async () => {
      const result = await runCli(['capabilities', `hm://${KNOWN_ACCOUNT}`], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
    }, TEST_TIMEOUT)
  })

  // ===== Activity =====

  describe('Activity Commands', () => {
    test('activity shows events', async () => {
      const result = await runCli(['activity'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
    }, TEST_TIMEOUT)

    test('activity with --limit', async () => {
      const result = await runCli(['activity', '--limit', '5'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
    }, TEST_TIMEOUT)
  })

  // ===== Stats =====

  describe('Stats Commands', () => {
    test('stats shows interaction summary', async () => {
      const result = await runCli(['stats', `hm://${KNOWN_ACCOUNT}`], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('citations')
    }, TEST_TIMEOUT)
  })

  // ===== Key Management =====

  describe('Key Management Commands', () => {
    test('key derive computes account id', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const result = await runCli(['key', 'derive', mnemonic])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^z6Mk/)
    }, TEST_TIMEOUT)

    test('key import with invalid mnemonic fails', async () => {
      const result = await runCli(['key', 'import', 'invalid mnemonic words'])
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Invalid mnemonic')
    }, TEST_TIMEOUT)
  })

  // ===== Output Formats =====

  describe('Output Formats', () => {
    test('--json outputs valid JSON', async () => {
      const result = await runCli(['account', KNOWN_ACCOUNT, '--json'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      expect(() => JSON.parse(result.stdout)).not.toThrow()
    }, TEST_TIMEOUT)

    test('--yaml outputs YAML format', async () => {
      const result = await runCli(['account', KNOWN_ACCOUNT, '--yaml'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/type:\s/)
    }, TEST_TIMEOUT)

    test('--pretty outputs readable format', async () => {
      const result = await runCli(['account', KNOWN_ACCOUNT, '--pretty'], {server: DEV_SERVER})
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('\n')
    }, TEST_TIMEOUT)
  })

  // ===== Error Handling =====

  describe('Error Handling', () => {
    test('unknown command shows error', async () => {
      const result = await runCli(['unknowncommand'])
      expect(result.exitCode).toBe(1)
    }, TEST_TIMEOUT)

    test('missing required argument shows error', async () => {
      const result = await runCli(['get'])
      expect(result.exitCode).toBe(1)
    }, TEST_TIMEOUT)
  })

  // ===== Markdown Resolution =====

  describe('Markdown Resolution', () => {
    test('get --md --resolve works on documents', async () => {
      const result = await runCli(
        ['get', `hm://${KNOWN_ACCOUNT}`, '--md', '--resolve'],
        {server: DEV_SERVER}
      )
      expect(result.exitCode).toBe(0)
      // Should output markdown with title
      expect(result.stdout).toContain(`# ${KNOWN_ACCOUNT_NAME}`)
    }, TEST_TIMEOUT)
  })
})
