/**
 * CLI Fixture Tests
 *
 * Tests daemon startup with the test fixture data.
 * Note: Full CLI tests require the web server for /api/ endpoints.
 * This test verifies the fixture loads correctly using daemon-native endpoints.
 */

import {describe, test, expect, beforeAll, afterAll} from 'bun:test'
import {startDaemonWithFixture, runCli, type TestContext} from './setup'

let ctx: TestContext

// Fixture account ID (from test-fixtures/desktop/daemon/keys/account_keys.json)
const FIXTURE_ACCOUNT = 'z6MksCerY4A2EWyue418ARHgMLAndpchBcKo639cJme73ZQQ'

const TEST_TIMEOUT = 120000 // 2 minutes for daemon startup

describe('CLI Fixture Tests', () => {
  beforeAll(async () => {
    ctx = await startDaemonWithFixture()
    console.log(`[test] Fixture daemon ready at ${ctx.daemonUrl}`)
  }, TEST_TIMEOUT)

  afterAll(async () => {
    await ctx.cleanup()
  }, TEST_TIMEOUT)

  describe('Daemon with Fixture', () => {
    test('daemon starts successfully', async () => {
      // Verify daemon is running via debug endpoint
      const response = await fetch(`${ctx.daemonUrl}/debug/version`)
      expect(response.ok).toBe(true)
      const version = await response.text()
      expect(version).toBeTruthy()
      console.log(`[test] Daemon version: ${version}`)
    }, TEST_TIMEOUT)

    test('daemon config endpoint works', async () => {
      const response = await fetch(`${ctx.daemonUrl}/hm/api/config`)
      expect(response.ok).toBe(true)
      const config = await response.json()
      expect(config.peerId).toBeTruthy()
      console.log(`[test] Daemon peer ID: ${config.peerId}`)
    }, TEST_TIMEOUT)
  })

  describe('CLI Basic Commands (no server needed)', () => {
    test('--help shows usage', async () => {
      const result = await runCli(['--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage: seed')
    }, TEST_TIMEOUT)

    test('--version shows version', async () => {
      const result = await runCli(['--version'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/)
    }, TEST_TIMEOUT)

    test('key derive computes account id', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const result = await runCli(['key', 'derive', mnemonic])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^z6Mk/)
    }, TEST_TIMEOUT)
  })

  // Note: Full CLI tests (get, account, query, etc.) require the web server
  // for /api/ endpoints. Run those with `pnpm test` against a live server.
})
