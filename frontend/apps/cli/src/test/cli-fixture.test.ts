/**
 * CLI Fixture Tests
 *
 * Full integration tests with daemon + web server using fixture data.
 */

import {describe, test, expect, beforeAll, afterAll} from 'bun:test'
import {startFullIntegrationWithFixture, runCli, type FullTestContext} from './setup'

let ctx: FullTestContext

// Fixture account ID (from test-fixtures/desktop/daemon/keys/account_keys.json)
const FIXTURE_ACCOUNT = 'z6MksCerY4A2EWyue418ARHgMLAndpchBcKo639cJme73ZQQ'
const HIERARCHY_TEST_DOC = `hm://${FIXTURE_ACCOUNT}/hierarchy-test`

const TEST_TIMEOUT = 180000 // 3 minutes for daemon + web server startup

describe('CLI Full Integration Tests', () => {
  beforeAll(async () => {
    ctx = await startFullIntegrationWithFixture()
    console.log(`[test] Full integration ready: daemon=${ctx.daemonUrl}, web=${ctx.webServerUrl}`)
  }, TEST_TIMEOUT)

  afterAll(async () => {
    await ctx.cleanup()
  }, TEST_TIMEOUT)

  describe('Infrastructure', () => {
    test('daemon is running', async () => {
      const response = await fetch(`${ctx.daemonUrl}/debug/version`)
      expect(response.ok).toBe(true)
      const version = await response.text()
      expect(version).toBeTruthy()
      console.log(`[test] Daemon version: ${version}`)
    }, TEST_TIMEOUT)

    test('web server is running', async () => {
      const response = await fetch(ctx.webServerUrl)
      // May return 200 or redirect, either is fine
      expect(response.status).toBeLessThan(500)
      console.log(`[test] Web server status: ${response.status}`)
    }, TEST_TIMEOUT)
  })

  describe('CLI Basic Commands', () => {
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
  })

  describe('Fixture Data via API', () => {
    test('get hierarchy-test document as JSON', async () => {
      const result = await runCli(['get', HIERARCHY_TEST_DOC], {server: ctx.webServerUrl})
      expect(result.exitCode).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data.type).toBe('document')
      expect(data.document.metadata.name).toBe('Hierarchy Test')
      expect(data.document.path).toBe('/hierarchy-test')
    }, TEST_TIMEOUT)

    test('get --md returns correct markdown structure', async () => {
      const result = await runCli(['get', HIERARCHY_TEST_DOC, '--md'], {server: ctx.webServerUrl})
      expect(result.exitCode).toBe(0)

      // Validate the markdown content matches the fixture document
      expect(result.stdout).toContain('# Hierarchy Test')
      expect(result.stdout).toContain('Text before first heading')
      expect(result.stdout).toContain('# First Heading')
      expect(result.stdout).toContain('under first heading')
      expect(result.stdout).toContain('## Second Level Heading A')
      expect(result.stdout).toContain('Under First Heading > Second Level Heading A')
      expect(result.stdout).toContain('under first heading, at the end')
      expect(result.stdout).toContain('# Second Heading')
      expect(result.stdout).toContain('In second heading')
      expect(result.stdout).toContain('Text after all sections')
    }, TEST_TIMEOUT)

    test('get --md --frontmatter includes YAML frontmatter', async () => {
      const result = await runCli(
        ['get', HIERARCHY_TEST_DOC, '--md', '--frontmatter'],
        {server: ctx.webServerUrl}
      )
      expect(result.exitCode).toBe(0)

      // Validate frontmatter structure
      expect(result.stdout).toMatch(/^---/)
      expect(result.stdout).toContain('title: "Hierarchy Test"')
      expect(result.stdout).toContain(`authors: [${FIXTURE_ACCOUNT}]`)
      expect(result.stdout).toContain('version: bafy')
      expect(result.stdout).toMatch(/---\n\n# Hierarchy Test/)
    }, TEST_TIMEOUT)
  })
})
