import {describe, test, expect, beforeEach, afterEach} from 'bun:test'
import {mkdtemp, rm, readFile, writeFile, mkdir, access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  VERSION,
  DEFAULT_COMPOSE_URL,
  NOTIFY_SERVICE_HOST,
  LIGHTNING_URL_MAINNET,
  LIGHTNING_URL_TESTNET,
  type SeedConfig,
  type DeployPaths,
  type ShellRunner,
  makePaths,
  makeShellRunner,
  configExists,
  readConfig,
  writeConfig,
  generateSecret,
  parseDaemonEnv,
  parseWebEnv,
  parseImageTag,
  inferEnvironment,
  type OldInstallInfo,
  extractDns,
  generateCaddyfile,
  sha256,
  buildComposeEnv,
  getWorkspaceDirs,
  checkContainersHealthy,
  containersMatchReleaseChannel,
  detectForeignStack,
  assertNoForeignStack,
  getRunningInstallDir,
  getContainerImages,
  checkForNewImages,
  checkGpuAcceleration,
  ensureSeedDir,
  environmentPresets,
  configWarnings,
  DEFAULT_RELEASE_CHANNEL,
  validateDockerImageTag,
  buildCrontab,
  parseArgs,
  extractSeedCronLines,
  removeSeedCronLines,
  DEFAULT_SEED_DIR,
  DEPLOY_SCRIPT_PATH,
  DEFAULT_DATA_DIR,
  selfUpdate,
  getOpsBaseUrl,
  getDeployScriptUrl,
  DEV_DEPLOY_SCRIPT_URL,
  composeProjectName,
  removeLegacyAutoupdaters,
  freeConflictingPortBindings,
  removeLegacyHostCronLines,
  removeLegacyHostCron,
  describeBindFailure,
  describePullFailure,
} from './deploy'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTestConfig(overrides: Partial<SeedConfig> = {}): SeedConfig {
  return {
    domain: 'https://node1.seed.run',
    email: 'ops@seed.hypermedia',
    compose_url: DEFAULT_COMPOSE_URL,
    compose_sha: '',
    compose_envs: {LOG_LEVEL: 'info'},
    environment: 'prod',
    release_channel: 'latest',
    testnet: false,
    link_secret: 'testSecret1',
    analytics: false,
    gateway: false,
    last_script_run: '',
    ...overrides,
  }
}

function makeNoopShell(): ShellRunner {
  return {
    run(_cmd: string): string {
      throw new Error('command not found')
    },
    runSafe(_cmd: string): string | null {
      return null
    },
    exec(_cmd: string): Promise<{stdout: string; stderr: string}> {
      return Promise.reject(new Error('command not found'))
    },
  }
}

function makeMockShell(responses: Record<string, string>): ShellRunner {
  return {
    run(cmd: string): string {
      for (const [pattern, response] of Object.entries(responses)) {
        if (cmd.includes(pattern)) return response
      }
      throw new Error(`command not mocked: ${cmd}`)
    },
    runSafe(cmd: string): string | null {
      try {
        return this.run(cmd)
      } catch {
        return null
      }
    },
    exec(cmd: string): Promise<{stdout: string; stderr: string}> {
      try {
        return Promise.resolve({stdout: this.run(cmd), stderr: ''})
      } catch (e) {
        return Promise.reject(e)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// makePaths
// ---------------------------------------------------------------------------

describe('makePaths', () => {
  test('creates paths from default seed dir', () => {
    const paths = makePaths('/opt/seed')
    expect(paths.seedDir).toBe('/opt/seed')
    expect(paths.configPath).toBe('/opt/seed/config.json')
    expect(paths.composePath).toBe('/opt/seed/docker-compose.yml')
    expect(paths.deployLog).toBe('/opt/seed/deploy.log')
  })

  test('creates paths from custom seed dir', () => {
    const paths = makePaths('/tmp/test-seed')
    expect(paths.seedDir).toBe('/tmp/test-seed')
    expect(paths.configPath).toBe('/tmp/test-seed/config.json')
    expect(paths.composePath).toBe('/tmp/test-seed/docker-compose.yml')
    expect(paths.deployLog).toBe('/tmp/test-seed/deploy.log')
  })
})

// ---------------------------------------------------------------------------
// extractDns
// ---------------------------------------------------------------------------

describe('extractDns', () => {
  test('strips https:// prefix', () => {
    expect(extractDns('https://node1.seed.run')).toBe('node1.seed.run')
  })

  test('strips http:// prefix', () => {
    expect(extractDns('http://node1.seed.run')).toBe('node1.seed.run')
  })

  test('strips trailing slashes', () => {
    expect(extractDns('https://node1.seed.run/')).toBe('node1.seed.run')
    expect(extractDns('https://node1.seed.run///')).toBe('node1.seed.run')
  })

  test('handles bare domain (no protocol)', () => {
    expect(extractDns('node1.seed.run')).toBe('node1.seed.run')
  })

  test('preserves port numbers', () => {
    expect(extractDns('https://localhost:3000')).toBe('localhost:3000')
  })

  test('preserves subdomains', () => {
    expect(extractDns('https://deep.sub.domain.example.com')).toBe('deep.sub.domain.example.com')
  })

  test('handles empty string', () => {
    expect(extractDns('')).toBe('')
  })

  test('handles just protocol', () => {
    expect(extractDns('https://')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// sha256
// ---------------------------------------------------------------------------

describe('sha256', () => {
  test('produces a 64-char hex string', () => {
    const hash = sha256('hello world')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test("known hash for 'hello world'", () => {
    expect(sha256('hello world')).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
  })

  test('different inputs produce different hashes', () => {
    expect(sha256('input A')).not.toBe(sha256('input B'))
  })

  test('same input produces same hash', () => {
    expect(sha256('deterministic')).toBe(sha256('deterministic'))
  })

  test('handles empty string', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  test('handles unicode content', () => {
    const hash = sha256('hello 世界 🌍')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ---------------------------------------------------------------------------
// generateSecret
// ---------------------------------------------------------------------------

describe('generateSecret', () => {
  test('default length is 10', () => {
    expect(generateSecret()).toHaveLength(10)
  })

  test('custom lengths', () => {
    expect(generateSecret(5)).toHaveLength(5)
    expect(generateSecret(20)).toHaveLength(20)
    expect(generateSecret(1)).toHaveLength(1)
    expect(generateSecret(0)).toBe('')
  })

  test('only alphanumeric characters', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateSecret(50)).toMatch(/^[A-Za-z0-9]*$/)
    }
  })

  test('successive calls produce different values', () => {
    const secrets = new Set(Array.from({length: 20}, () => generateSecret()))
    expect(secrets.size).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// environmentPresets
// ---------------------------------------------------------------------------

describe('environmentPresets', () => {
  test('prod uses mainnet', () => {
    const p = environmentPresets('prod')
    expect(p.testnet).toBe(false)
  })

  test('dev uses testnet', () => {
    const p = environmentPresets('dev')
    expect(p.testnet).toBe(true)
  })
})

describe('configWarnings', () => {
  test('no warnings for a stable mainnet production config', () => {
    expect(configWarnings(makeTestConfig({testnet: false, release_channel: 'latest'}))).toEqual([])
  })

  test('warns loudly when on the testnet/devnet network', () => {
    const warnings = configWarnings(makeTestConfig({testnet: true, release_channel: 'dev'}))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('TESTNET')
    expect(warnings[0]).toContain('reconfigure')
  })

  test('warns about non-stable image channel on mainnet without changing the network', () => {
    const warnings = configWarnings(makeTestConfig({testnet: false, release_channel: 'dev'}))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('mainnet')
    expect(warnings[0]).toContain('never change your P2P network')
  })

  test('custom image channel on mainnet is treated like dev channel', () => {
    expect(configWarnings(makeTestConfig({testnet: false, release_channel: 'feature-branch'}))).toHaveLength(1)
  })

  test('testnet warning takes precedence over channel warning (single, network-focused message)', () => {
    // On testnet we only emit the network warning, not the channel one.
    const warnings = configWarnings(makeTestConfig({testnet: true, release_channel: 'latest'}))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('TESTNET')
  })
})

describe('DEFAULT_RELEASE_CHANNEL', () => {
  test('defaults to stable, independent of environment', () => {
    // The release channel must never derive from the environment: a missing
    // stored channel always falls back to "latest" regardless of prod/dev.
    expect(DEFAULT_RELEASE_CHANNEL).toBe('latest')
  })
})

describe('validateDockerImageTag', () => {
  test('accepts preset and custom Docker tags', () => {
    expect(validateDockerImageTag('latest')).toBeUndefined()
    expect(validateDockerImageTag('dev')).toBeUndefined()
    expect(validateDockerImageTag('feature-branch')).toBeUndefined()
    expect(validateDockerImageTag('release_2026.05')).toBeUndefined()
  })

  test('rejects tags Docker cannot pull', () => {
    expect(validateDockerImageTag('')).toBe('Required')
    expect(validateDockerImageTag(' feature')).toContain('spaces')
    expect(validateDockerImageTag('feature/foo')).toContain('Docker image tag')
    expect(validateDockerImageTag('-feature')).toContain('Docker image tag')
    expect(validateDockerImageTag('a'.repeat(129))).toContain('128')
  })
})

// ---------------------------------------------------------------------------
// generateCaddyfile
// ---------------------------------------------------------------------------

describe('generateCaddyfile', () => {
  test('contains expected Caddy directives', () => {
    const caddy = generateCaddyfile(makeTestConfig())
    expect(caddy).toContain('{$SEED_SITE_HOSTNAME}')
    expect(caddy).toContain('encode zstd gzip')
    expect(caddy).toContain('reverse_proxy /.metrics* grafana:')
    expect(caddy).toContain('reverse_proxy @ipfsroute seed-daemon:')
    expect(caddy).toContain('reverse_proxy * seed-web:')
  })

  test('contains IPFS route matcher', () => {
    const caddy = generateCaddyfile(makeTestConfig())
    expect(caddy).toContain('@ipfsroute')
    expect(caddy).toContain('path /ipfs/*')
  })

  test('uses env var placeholders for ports', () => {
    const caddy = generateCaddyfile(makeTestConfig())
    expect(caddy).toContain('{$SEED_SITE_MONITORING_PORT:3001}')
    expect(caddy).toContain('{$SEED_SITE_BACKEND_GRPCWEB_PORT:56001}')
    expect(caddy).toContain('{$SEED_SITE_LOCAL_PORT:3000}')
  })

  test('output is consistent regardless of config values', () => {
    const caddy1 = generateCaddyfile(makeTestConfig({domain: 'https://a.com'}))
    const caddy2 = generateCaddyfile(makeTestConfig({domain: 'https://b.com'}))
    expect(caddy1).toBe(caddy2)
  })
})

// ---------------------------------------------------------------------------
// parseDaemonEnv
// ---------------------------------------------------------------------------

describe('parseDaemonEnv', () => {
  test('extracts log level', () => {
    const json = JSON.stringify(['SEED_LOG_LEVEL=debug', 'OTHER=value'])
    const result = parseDaemonEnv(json)
    expect(result.logLevel).toBe('debug')
    expect(result.testnet).toBe(false)
  })

  test('detects testnet when SEED_P2P_TESTNET_NAME has a value', () => {
    const json = JSON.stringify(['SEED_LOG_LEVEL=info', 'SEED_P2P_TESTNET_NAME=dev'])
    expect(parseDaemonEnv(json).testnet).toBe(true)
  })

  test('no testnet when SEED_P2P_TESTNET_NAME is empty', () => {
    const json = JSON.stringify(['SEED_P2P_TESTNET_NAME='])
    expect(parseDaemonEnv(json).testnet).toBe(false)
  })

  test('null logLevel when not present', () => {
    expect(parseDaemonEnv(JSON.stringify(['UNRELATED=foo'])).logLevel).toBeNull()
  })

  test('handles invalid JSON', () => {
    const result = parseDaemonEnv('not valid json')
    expect(result.logLevel).toBeNull()
    expect(result.testnet).toBe(false)
  })

  test('handles empty array', () => {
    const result = parseDaemonEnv('[]')
    expect(result.logLevel).toBeNull()
    expect(result.testnet).toBe(false)
  })

  test('handles empty string', () => {
    const result = parseDaemonEnv('')
    expect(result.logLevel).toBeNull()
    expect(result.testnet).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseWebEnv
// ---------------------------------------------------------------------------

describe('parseWebEnv', () => {
  test('extracts hostname', () => {
    const json = JSON.stringify(['SEED_BASE_URL=https://node1.seed.run'])
    expect(parseWebEnv(json).hostname).toBe('https://node1.seed.run')
  })

  test('detects gateway mode', () => {
    expect(parseWebEnv(JSON.stringify(['SEED_IS_GATEWAY=true'])).gateway).toBe(true)
  })

  test("gateway false when value is 'false'", () => {
    expect(parseWebEnv(JSON.stringify(['SEED_IS_GATEWAY=false'])).gateway).toBe(false)
  })

  test('detects traffic stats', () => {
    expect(parseWebEnv(JSON.stringify(['SEED_ENABLE_STATISTICS=true'])).trafficStats).toBe(true)
  })

  test('extracts all fields together', () => {
    const json = JSON.stringify([
      'SEED_BASE_URL=https://gateway.hyper.media',
      'SEED_IS_GATEWAY=true',
      'SEED_ENABLE_STATISTICS=true',
      'OTHER=ignored',
    ])
    const result = parseWebEnv(json)
    expect(result.hostname).toBe('https://gateway.hyper.media')
    expect(result.gateway).toBe(true)
    expect(result.trafficStats).toBe(true)
  })

  test('handles invalid JSON', () => {
    const result = parseWebEnv('garbage')
    expect(result.hostname).toBeNull()
    expect(result.gateway).toBe(false)
    expect(result.trafficStats).toBe(false)
  })

  test('handles empty string', () => {
    const result = parseWebEnv('')
    expect(result.hostname).toBeNull()
    expect(result.gateway).toBe(false)
    expect(result.trafficStats).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseImageTag
// ---------------------------------------------------------------------------

describe('parseImageTag', () => {
  test('extracts tag from full image string', () => {
    expect(parseImageTag('seedhypermedia/web:latest')).toBe('latest')
    expect(parseImageTag('seedhypermedia/web:dev')).toBe('dev')
    expect(parseImageTag('seedhypermedia/site:v1.2.3')).toBe('v1.2.3')
  })

  test("returns 'latest' when no tag specified", () => {
    expect(parseImageTag('seedhypermedia/web')).toBe('latest')
  })

  test('handles registry prefix', () => {
    expect(parseImageTag('docker.io/seedhypermedia/web:main')).toBe('main')
  })

  test('handles multiple colons (registry:port/image:tag)', () => {
    expect(parseImageTag('registry:5000/seedhypermedia/web:dev')).toBe('dev')
  })

  test('handles empty string', () => {
    expect(parseImageTag('')).toBe('latest')
  })
})

// ---------------------------------------------------------------------------
// inferEnvironment
// ---------------------------------------------------------------------------

function makeOldInstall(overrides: Partial<OldInstallInfo> = {}): OldInstallInfo {
  return {
    workspace: '/home/user/.seed-site',
    secret: null,
    secretConsumed: false,
    hostname: 'https://example.com',
    logLevel: 'info',
    imageTag: 'latest',
    testnet: false,
    gateway: false,
    trafficStats: false,
    ...overrides,
  }
}

describe('inferEnvironment', () => {
  test("returns 'dev' when testnet is true", () => {
    expect(inferEnvironment(makeOldInstall({testnet: true}))).toBe('dev')
  })

  test("returns 'dev' when testnet is true even with dev image tag", () => {
    expect(inferEnvironment(makeOldInstall({testnet: true, imageTag: 'dev'}))).toBe('dev')
  })

  test("returns 'prod' when not testnet even with dev image tag (network is independent of image channel)", () => {
    // Regression: a site on mainnet that ran the `dev` image channel must NOT
    // be inferred onto the devnet network during migration.
    expect(inferEnvironment(makeOldInstall({testnet: false, imageTag: 'dev'}))).toBe('prod')
  })

  test("returns 'prod' when not testnet and image tag is 'latest'", () => {
    expect(inferEnvironment(makeOldInstall({testnet: false, imageTag: 'latest'}))).toBe('prod')
  })

  test("returns 'prod' when not testnet and image tag is a semver", () => {
    expect(inferEnvironment(makeOldInstall({testnet: false, imageTag: 'v1.2.3'}))).toBe('prod')
  })

  test("returns 'prod' when not testnet and image tag is null", () => {
    expect(inferEnvironment(makeOldInstall({testnet: false, imageTag: null}))).toBe('prod')
  })
})

// ---------------------------------------------------------------------------
// buildComposeEnv
// ---------------------------------------------------------------------------

describe('buildComposeEnv', () => {
  test('includes all required environment variables', () => {
    const env = buildComposeEnv(makeTestConfig(), makePaths('/opt/seed'))
    expect(env).toContain('SEED_SITE_HOSTNAME="https://node1.seed.run"')
    expect(env).toContain('SEED_SITE_DNS="node1.seed.run"')
    expect(env).toContain('SEED_SITE_TAG="latest"')
    expect(env).toContain('SEED_SITE_WORKSPACE="/opt/seed"')
    expect(env).toContain(`SEED_UID="${process.getuid!()}"`)
    expect(env).toContain(`SEED_GID="${process.getgid!()}"`)
    expect(env).toContain('SEED_LOG_LEVEL="info"')
    expect(env).toContain('SEED_IS_GATEWAY="false"')
    expect(env).toContain('SEED_ENABLE_STATISTICS="false"')
    expect(env).toContain('SEED_P2P_TESTNET_NAME=""')
    expect(env).toContain(`SEED_LIGHTNING_URL="${LIGHTNING_URL_MAINNET}"`)
    expect(env).toContain(`NOTIFY_SERVICE_HOST="${NOTIFY_SERVICE_HOST}"`)
    expect(env).toContain('SEED_SITE_MONITORING_WORKDIR="/opt/seed/monitoring"')
  })

  test('testnet flips lightning URL and testnet name', () => {
    const env = buildComposeEnv(makeTestConfig({testnet: true}), makePaths())
    expect(env).toContain(`SEED_LIGHTNING_URL="${LIGHTNING_URL_TESTNET}"`)
    expect(env).toContain('SEED_P2P_TESTNET_NAME="dev"')
  })

  test('mainnet uses mainnet lightning URL', () => {
    const env = buildComposeEnv(makeTestConfig({testnet: false}), makePaths())
    expect(env).toContain(`SEED_LIGHTNING_URL="${LIGHTNING_URL_MAINNET}"`)
    expect(env).toContain('SEED_P2P_TESTNET_NAME=""')
  })

  test('reflects gateway flag', () => {
    expect(buildComposeEnv(makeTestConfig({gateway: true}), makePaths())).toContain('SEED_IS_GATEWAY="true"')
    expect(buildComposeEnv(makeTestConfig({gateway: false}), makePaths())).toContain('SEED_IS_GATEWAY="false"')
  })

  test('reflects analytics flag', () => {
    expect(buildComposeEnv(makeTestConfig({analytics: true}), makePaths())).toContain('SEED_ENABLE_STATISTICS="true"')
    expect(buildComposeEnv(makeTestConfig({analytics: false}), makePaths())).toContain('SEED_ENABLE_STATISTICS="false"')
  })

  test('reflects release channel', () => {
    expect(buildComposeEnv(makeTestConfig({release_channel: 'dev'}), makePaths())).toContain('SEED_SITE_TAG="dev"')
    expect(buildComposeEnv(makeTestConfig({release_channel: 'latest'}), makePaths())).toContain(
      'SEED_SITE_TAG="latest"',
    )
    expect(buildComposeEnv(makeTestConfig({release_channel: 'feature-branch'}), makePaths())).toContain(
      'SEED_SITE_TAG="feature-branch"',
    )
  })

  test('reflects log level', () => {
    expect(
      buildComposeEnv(
        makeTestConfig({
          compose_envs: {LOG_LEVEL: 'debug'},
        }),
        makePaths(),
      ),
    ).toContain('SEED_LOG_LEVEL="debug"')
  })

  test('uses custom paths for workspace and monitoring', () => {
    const env = buildComposeEnv(makeTestConfig(), makePaths('/custom/path'))
    expect(env).toContain('SEED_SITE_WORKSPACE="/custom/path"')
    expect(env).toContain('SEED_SITE_MONITORING_WORKDIR="/custom/path/monitoring"')
  })

  test('handles domain with special characters', () => {
    const env = buildComposeEnv(makeTestConfig({domain: 'https://my-node.example.com'}), makePaths())
    expect(env).toContain('SEED_SITE_DNS="my-node.example.com"')
  })
})

// ---------------------------------------------------------------------------
// getWorkspaceDirs
// ---------------------------------------------------------------------------

describe('getWorkspaceDirs', () => {
  test('includes base and monitoring directories', () => {
    const dirs = getWorkspaceDirs(makePaths('/opt/seed'))
    expect(dirs).toContain('/opt/seed/proxy')
    expect(dirs).toContain('/opt/seed/proxy/data')
    expect(dirs).toContain('/opt/seed/proxy/config')
    expect(dirs).toContain('/opt/seed/web')
    expect(dirs).toContain('/opt/seed/daemon')
    expect(dirs).toContain('/opt/seed/monitoring')
    expect(dirs).toContain('/opt/seed/monitoring/grafana')
    expect(dirs).toContain('/opt/seed/monitoring/prometheus')
    expect(dirs).toHaveLength(8)
  })

  test('respects custom paths', () => {
    const dirs = getWorkspaceDirs(makePaths('/tmp/test-seed'))
    expect(dirs.every((d) => d.startsWith('/tmp/test-seed'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Config read/write/exists (integration with temp dirs)
// ---------------------------------------------------------------------------

describe('config read/write/exists', () => {
  let tmpDir: string
  let paths: DeployPaths

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'seed-test-'))
    paths = makePaths(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true, force: true})
  })

  test('configExists returns false when no config', async () => {
    expect(await configExists(paths)).toBe(false)
  })

  test('writeConfig creates directory and file', async () => {
    await writeConfig(makeTestConfig(), paths)
    expect(await configExists(paths)).toBe(true)
  })

  test('readConfig roundtrips correctly', async () => {
    const original = makeTestConfig({
      domain: 'https://roundtrip.example.com',
      email: 'test@example.com',
      compose_sha: 'abc123',
      compose_envs: {LOG_LEVEL: 'debug'},
      environment: 'dev',
      release_channel: 'dev',
      testnet: true,
      link_secret: 'mysecret',
      analytics: true,
      gateway: true,
      last_script_run: '2026-01-15T10:30:00Z',
    })
    await writeConfig(original, paths)
    expect(await readConfig(paths)).toEqual(original)
  })

  test('writeConfig overwrites existing config', async () => {
    await writeConfig(makeTestConfig({domain: 'https://first.com'}), paths)
    await writeConfig(makeTestConfig({domain: 'https://second.com'}), paths)
    expect((await readConfig(paths)).domain).toBe('https://second.com')
  })

  test('config file is pretty-printed JSON ending with newline', async () => {
    await writeConfig(makeTestConfig(), paths)
    const raw = await readFile(paths.configPath, 'utf-8')
    expect(raw).toContain('\n')
    expect(raw).toContain('  ')
    expect(raw.endsWith('\n')).toBe(true)
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  test('readConfig throws on missing file', async () => {
    await expect(readConfig(paths)).rejects.toThrow()
  })

  test('readConfig throws on invalid JSON', async () => {
    await mkdir(paths.seedDir, {recursive: true})
    await writeFile(paths.configPath, 'not json', 'utf-8')
    await expect(readConfig(paths)).rejects.toThrow()
  })

  test('config preserves all SeedConfig fields', async () => {
    await writeConfig(makeTestConfig(), paths)
    const loaded = await readConfig(paths)
    const expectedKeys: (keyof SeedConfig)[] = [
      'domain',
      'email',
      'compose_url',
      'compose_sha',
      'compose_envs',
      'environment',
      'release_channel',
      'testnet',
      'link_secret',
      'analytics',
      'gateway',
      'last_script_run',
    ]
    for (const key of expectedKeys) {
      expect(loaded).toHaveProperty(key)
    }
  })
})

// ---------------------------------------------------------------------------
// ensureSeedDir
// ---------------------------------------------------------------------------

describe('ensureSeedDir', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'seed-dir-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true, force: true})
  })

  test("creates directory if it doesn't exist", async () => {
    const seedDir = join(tmpDir, 'newseed')
    const paths = makePaths(seedDir)
    const shell = makeNoopShell()

    await ensureSeedDir(paths, shell)
    await access(seedDir) // should not throw
  })

  test('succeeds if directory already exists', async () => {
    const paths = makePaths(tmpDir)
    const shell = makeNoopShell()

    await ensureSeedDir(paths, shell)
    await access(tmpDir) // should not throw
  })

  test('creates nested directory structure', async () => {
    const seedDir = join(tmpDir, 'deep', 'nested', 'seed')
    const paths = makePaths(seedDir)
    const shell = makeNoopShell()

    await ensureSeedDir(paths, shell)
    await access(seedDir)
  })
})

// ---------------------------------------------------------------------------
// checkContainersHealthy / getContainerImages (mock shell)
// ---------------------------------------------------------------------------

describe('checkContainersHealthy', () => {
  test('false when no Docker available', async () => {
    expect(await checkContainersHealthy(makeNoopShell())).toBe(false)
  })

  test('false when some containers missing', async () => {
    const shell = makeMockShell({
      'seed-proxy': 'true',
      'seed-web': 'true',
    })
    expect(await checkContainersHealthy(shell)).toBe(false)
  })

  test('true when all containers running', async () => {
    const shell = makeMockShell({
      'seed-proxy': 'true',
      'seed-web': 'true',
      'seed-daemon': 'true',
    })
    expect(await checkContainersHealthy(shell)).toBe(true)
  })

  test('false when a container reports not running', async () => {
    const shell = makeMockShell({
      'seed-proxy': 'true',
      'seed-web': 'false',
      'seed-daemon': 'true',
    })
    expect(await checkContainersHealthy(shell)).toBe(false)
  })
})

describe('containersMatchReleaseChannel', () => {
  test('true when both containers run the configured tag', () => {
    const shell = makeMockShell({
      "inspect seed-web --format '{{.Config.Image}}'": 'seedhypermedia/web:monoid',
      "inspect seed-daemon --format '{{.Config.Image}}'": 'seedhypermedia/site:monoid',
    })
    expect(containersMatchReleaseChannel(shell, makeTestConfig({release_channel: 'monoid'}))).toBe(true)
  })

  test('false when a container runs a different tag than config (the desync bug)', () => {
    // Config says monoid but the containers are still on :dev — the fast-path
    // must NOT treat this as "no changes".
    const shell = makeMockShell({
      "inspect seed-web --format '{{.Config.Image}}'": 'seedhypermedia/web:dev',
      "inspect seed-daemon --format '{{.Config.Image}}'": 'seedhypermedia/site:dev',
    })
    expect(containersMatchReleaseChannel(shell, makeTestConfig({release_channel: 'monoid'}))).toBe(false)
  })

  test('false when only one container is off-tag', () => {
    const shell = makeMockShell({
      "inspect seed-web --format '{{.Config.Image}}'": 'seedhypermedia/web:dev',
      "inspect seed-daemon --format '{{.Config.Image}}'": 'seedhypermedia/site:latest',
    })
    expect(containersMatchReleaseChannel(shell, makeTestConfig({release_channel: 'latest'}))).toBe(false)
  })

  test('false when docker is unavailable', () => {
    expect(containersMatchReleaseChannel(makeNoopShell(), makeTestConfig())).toBe(false)
  })
})

describe('detectForeignStack / assertNoForeignStack', () => {
  const paths = makePaths('/opt/seed') // composeProjectName → "seed"

  test('null when no seed containers exist', () => {
    expect(detectForeignStack(makeNoopShell(), paths)).toBeNull()
  })

  test('null when the containers belong to our own project', () => {
    const shell = makeMockShell({
      "inspect seed-proxy --format '{{index .Config.Labels \"com.docker.compose.project\"}}'": 'seed',
      "inspect seed-web --format '{{index .Config.Labels \"com.docker.compose.project\"}}'": 'seed',
      "inspect seed-daemon --format '{{index .Config.Labels \"com.docker.compose.project\"}}'": 'seed',
    })
    expect(detectForeignStack(shell, paths)).toBeNull()
  })

  test('returns the foreign project name when another install owns a container', () => {
    const shell = makeMockShell({
      "inspect seed-proxy --format '{{index .Config.Labels \"com.docker.compose.project\"}}'": 'seed',
      "inspect seed-web --format '{{index .Config.Labels \"com.docker.compose.project\"}}'": 'seed',
      "inspect seed-daemon --format '{{index .Config.Labels \"com.docker.compose.project\"}}'": 'seed-group-feed',
    })
    expect(detectForeignStack(shell, paths)).toBe('seed-group-feed')
  })

  test('ignores legacy non-compose orphans (empty project label)', () => {
    // Empty label → not a foreign compose stack; freeConflictingPortBindings handles these.
    const shell = makeMockShell({
      "inspect seed-daemon --format '{{index .Config.Labels \"com.docker.compose.project\"}}'": '',
    })
    expect(detectForeignStack(shell, paths)).toBeNull()
  })

  test('assertNoForeignStack throws with a clear message on collision', () => {
    const shell = makeMockShell({
      "inspect seed-daemon --format '{{index .Config.Labels \"com.docker.compose.project\"}}'": 'seed-group-feed',
    })
    expect(() => assertNoForeignStack(shell, paths)).toThrow(/seed-group-feed/)
    expect(() => assertNoForeignStack(shell, paths)).toThrow(/can't share one host/)
  })

  test('assertNoForeignStack is a no-op for our own stack', () => {
    const shell = makeMockShell({
      "inspect seed-proxy --format '{{index .Config.Labels \"com.docker.compose.project\"}}'": 'seed',
      "inspect seed-web --format '{{index .Config.Labels \"com.docker.compose.project\"}}'": 'seed',
      "inspect seed-daemon --format '{{index .Config.Labels \"com.docker.compose.project\"}}'": 'seed',
    })
    expect(() => assertNoForeignStack(shell, paths)).not.toThrow()
  })
})

describe('getRunningInstallDir', () => {
  test('derives the install dir from the daemon /data mount source', () => {
    const shell = makeMockShell({
      'inspect seed-daemon --format': '/opt/seed-group-feed/daemon',
    })
    expect(getRunningInstallDir(shell)).toBe('/opt/seed-group-feed')
  })

  test('null when no daemon is running', () => {
    expect(getRunningInstallDir(makeNoopShell())).toBeNull()
  })
})

describe('getContainerImages', () => {
  test('empty map when no Docker available', async () => {
    expect((await getContainerImages(makeNoopShell())).size).toBe(0)
  })

  test('returns images for running containers', async () => {
    const shell = makeMockShell({
      'seed-proxy': 'sha256:abc123',
      'seed-web': 'sha256:def456',
      'seed-daemon': 'sha256:ghi789',
    })
    const images = await getContainerImages(shell)
    expect(images.size).toBe(3)
    expect(images.get('seed-proxy')).toBe('sha256:abc123')
    expect(images.get('seed-web')).toBe('sha256:def456')
    expect(images.get('seed-daemon')).toBe('sha256:ghi789')
  })
})

// ---------------------------------------------------------------------------
// checkForNewImages (mock shell)
// ---------------------------------------------------------------------------

describe('checkForNewImages', () => {
  const paths = makePaths('/opt/seed')
  const config: SeedConfig = {
    domain: 'https://example.com',
    email: 'test@example.com',
    compose_url: DEFAULT_COMPOSE_URL,
    compose_sha: 'abc',
    compose_env_sha: 'def',
    compose_envs: {LOG_LEVEL: 'info'},
    release_channel: 'dev',
    link_secret: 'secret',
    last_script_run: '',
    environment: 'dev',
    testnet: false,
    analytics: false,
    gateway: false,
  }

  test('returns false when no containers running', async () => {
    const result = await checkForNewImages(config, paths, makeNoopShell())
    expect(result).toBe(false)
  })

  test('returns false when pull fails', async () => {
    const shell = makeMockShell({
      'seed-proxy': 'sha256:aaa',
      'seed-web': 'sha256:bbb',
      'seed-daemon': 'sha256:ccc',
    })
    // exec (used by docker compose pull) will throw for unmatched commands
    const result = await checkForNewImages(config, paths, shell)
    expect(result).toBe(false)
  })

  test('returns false when images match', async () => {
    const shell = makeMockShell({
      // getContainerImages — docker inspect <container> --format '{{.Image}}'
      "inspect seed-proxy --format '{{.Image}}'": 'sha256:aaa',
      "inspect seed-web --format '{{.Image}}'": 'sha256:bbb',
      "inspect seed-daemon --format '{{.Image}}'": 'sha256:ccc',
      // docker compose pull
      'docker compose': '',
      // docker inspect <container> --format '{{.Config.Image}}'
      "inspect seed-proxy --format '{{.Config.Image}}'": 'caddy:2',
      "inspect seed-web --format '{{.Config.Image}}'": 'seedhypermedia/web:dev',
      "inspect seed-daemon --format '{{.Config.Image}}'": 'seedhypermedia/site:dev',
      // docker image inspect <image> --format '{{.Id}}'
      "image inspect caddy:2 --format '{{.Id}}'": 'sha256:aaa',
      "image inspect seedhypermedia/web:dev --format '{{.Id}}'": 'sha256:bbb',
      "image inspect seedhypermedia/site:dev --format '{{.Id}}'": 'sha256:ccc',
    })
    const result = await checkForNewImages(config, paths, shell)
    expect(result).toBe(false)
  })

  test('returns true when an image differs', async () => {
    const shell = makeMockShell({
      "inspect seed-proxy --format '{{.Image}}'": 'sha256:aaa',
      "inspect seed-web --format '{{.Image}}'": 'sha256:bbb',
      "inspect seed-daemon --format '{{.Image}}'": 'sha256:ccc',
      'docker compose': '',
      "inspect seed-proxy --format '{{.Config.Image}}'": 'caddy:2',
      "inspect seed-web --format '{{.Config.Image}}'": 'seedhypermedia/web:dev',
      "inspect seed-daemon --format '{{.Config.Image}}'": 'seedhypermedia/site:dev',
      "image inspect caddy:2 --format '{{.Id}}'": 'sha256:aaa',
      "image inspect seedhypermedia/web:dev --format '{{.Id}}'": 'sha256:NEW',
      "image inspect seedhypermedia/site:dev --format '{{.Id}}'": 'sha256:ccc',
    })
    const result = await checkForNewImages(config, paths, shell)
    expect(result).toBe(true)
  })

  test('detects an updated image even when the stack pull errors on another image', async () => {
    // Regression: a broken/un-pullable image (e.g. a bad custom tag) makes
    // `docker compose pull` exit non-zero. That must not mask a sibling image
    // that pulled successfully — otherwise the autoupdater silently no-ops.
    const shell = makeMockShell({
      "inspect seed-proxy --format '{{.Image}}'": 'sha256:aaa',
      "inspect seed-web --format '{{.Image}}'": 'sha256:bbb',
      "inspect seed-daemon --format '{{.Image}}'": 'sha256:ccc',
      // No 'docker compose' key → the pull exec throws (one image failing).
      "inspect seed-proxy --format '{{.Config.Image}}'": 'caddy:2',
      "inspect seed-web --format '{{.Config.Image}}'": 'seedhypermedia/web:monoid',
      "inspect seed-daemon --format '{{.Config.Image}}'": 'seedhypermedia/site:monoid',
      "image inspect caddy:2 --format '{{.Id}}'": 'sha256:aaa',
      // web unchanged (its pull failed), site updated to a new id.
      "image inspect seedhypermedia/web:monoid --format '{{.Id}}'": 'sha256:bbb',
      "image inspect seedhypermedia/site:monoid --format '{{.Id}}'": 'sha256:NEW',
    })
    const result = await checkForNewImages({...config, release_channel: 'monoid'}, paths, shell)
    expect(result).toBe(true)
  })

  test('uses the configured custom image tag when cron checks for updates', async () => {
    const shell = makeMockShell({
      "inspect seed-proxy --format '{{.Image}}'": 'sha256:aaa',
      "inspect seed-web --format '{{.Image}}'": 'sha256:bbb',
      "inspect seed-daemon --format '{{.Image}}'": 'sha256:ccc',
      'docker compose': '',
      "inspect seed-proxy --format '{{.Config.Image}}'": 'caddy:2',
      "inspect seed-web --format '{{.Config.Image}}'": 'seedhypermedia/web:feature-branch',
      "inspect seed-daemon --format '{{.Config.Image}}'": 'seedhypermedia/site:feature-branch',
      "image inspect caddy:2 --format '{{.Id}}'": 'sha256:aaa',
      "image inspect seedhypermedia/web:feature-branch --format '{{.Id}}'": 'sha256:bbb',
      "image inspect seedhypermedia/site:feature-branch --format '{{.Id}}'": 'sha256:ccc',
    })
    const result = await checkForNewImages({...config, release_channel: 'feature-branch'}, paths, shell)
    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// checkGpuAcceleration (mock shell)
// ---------------------------------------------------------------------------

describe('checkGpuAcceleration', () => {
  test('not-running when daemon is not running', () => {
    const result = checkGpuAcceleration(makeNoopShell())
    expect(result).toEqual({available: false, reason: 'not-running'})
  })

  test('no-dev-dri when /dev/dri is missing inside container', () => {
    const shell = makeMockShell({
      "docker inspect seed-daemon --format '{{.State.Status}}'": 'running',
      // docker exec ls /dev/dri/renderD* fails (not mocked → throws → runSafe returns null)
    })
    const result = checkGpuAcceleration(shell)
    expect(result).toEqual({available: false, reason: 'no-dev-dri'})
  })

  test('no-vulkan-icd when /dev/dri exists but no ICD files', () => {
    const shell = makeMockShell({
      "docker inspect seed-daemon --format '{{.State.Status}}'": 'running',
      'ls /dev/dri/renderD': '/dev/dri/renderD128',
      // docker exec ls /usr/share/vulkan/icd.d/*.json fails → runSafe returns null
    })
    const result = checkGpuAcceleration(shell)
    expect(result).toEqual({available: false, reason: 'no-vulkan-icd'})
  })

  test('available when /dev/dri and Vulkan ICD both present', () => {
    const shell = makeMockShell({
      "docker inspect seed-daemon --format '{{.State.Status}}'": 'running',
      'ls /dev/dri/renderD': '/dev/dri/renderD128',
      'ls /usr/share/vulkan/icd.d/': 'radeon_icd.x86_64.json',
    })
    const result = checkGpuAcceleration(shell)
    expect(result).toEqual({available: true})
  })
})

// ---------------------------------------------------------------------------
// makeShellRunner (real shell smoke tests)
// ---------------------------------------------------------------------------

describe('makeShellRunner', () => {
  test('run executes a basic command', () => {
    expect(makeShellRunner().run('echo hello')).toBe('hello')
  })

  test('runSafe returns null on failure', () => {
    expect(makeShellRunner().runSafe('false')).toBeNull()
  })

  test('exec resolves with stdout', async () => {
    expect((await makeShellRunner().exec('echo async')).stdout).toBe('async')
  })

  test('exec rejects on failure', async () => {
    await expect(makeShellRunner().exec('false')).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Full scenario: config -> compose env
// ---------------------------------------------------------------------------

describe('full config scenarios', () => {
  let tmpDir: string
  let paths: DeployPaths

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'seed-scenario-'))
    paths = makePaths(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true, force: true})
  })

  test('testnet config roundtrips and produces correct env', async () => {
    const config = makeTestConfig({
      domain: 'https://dev.hyper.media',
      testnet: true,
      release_channel: 'dev',
      gateway: true,
      analytics: true,
      compose_envs: {LOG_LEVEL: 'debug'},
    })

    await writeConfig(config, paths)
    const loaded = await readConfig(paths)
    const env = buildComposeEnv(loaded, paths)

    expect(env).toContain('SEED_SITE_HOSTNAME="https://dev.hyper.media"')
    expect(env).toContain('SEED_SITE_DNS="dev.hyper.media"')
    expect(env).toContain('SEED_SITE_TAG="dev"')
    expect(env).toContain('SEED_P2P_TESTNET_NAME="dev"')
    expect(env).toContain(`SEED_LIGHTNING_URL="${LIGHTNING_URL_TESTNET}"`)
    expect(env).toContain('SEED_IS_GATEWAY="true"')
    expect(env).toContain('SEED_ENABLE_STATISTICS="true"')
    expect(env).toContain('SEED_LOG_LEVEL="debug"')
  })

  test('production config roundtrips and produces correct env', async () => {
    const config = makeTestConfig({
      domain: 'https://node.example.com',
      testnet: false,
      release_channel: 'latest',
      gateway: false,
    })

    await writeConfig(config, paths)
    const loaded = await readConfig(paths)
    const env = buildComposeEnv(loaded, paths)

    expect(env).toContain('SEED_SITE_TAG="latest"')
    expect(env).toContain('SEED_P2P_TESTNET_NAME=""')
    expect(env).toContain(`SEED_LIGHTNING_URL="${LIGHTNING_URL_MAINNET}"`)
    expect(env).toContain('SEED_IS_GATEWAY="false"')
  })

  test('workspace dirs always include monitoring subdirs for daemon volumes', () => {
    const dirs = getWorkspaceDirs(paths)
    expect(dirs.some((d) => d.includes('monitoring'))).toBe(true)
    expect(dirs.some((d) => d.includes('monitoring/grafana'))).toBe(true)
    expect(dirs.some((d) => d.includes('monitoring/prometheus'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// buildCrontab
// ---------------------------------------------------------------------------

describe('buildCrontab', () => {
  const paths = makePaths('/opt/seed')

  test('adds seed lines to an empty crontab', () => {
    const result = buildCrontab('', paths)
    expect(result).toContain('# seed-deploy')
    expect(result).toContain('# seed-cleanup')
    // Runs the fixed script, pointed at the node's data dir with --dir.
    expect(result).toContain('/usr/local/lib/seed/deploy.js')
    expect(result).toContain('--dir "/opt/seed" upgrade')
    expect(result).toContain('--dir "/opt/seed" deploy')
    expect(result.endsWith('\n')).toBe(true)
  })

  test('preserves existing non-seed cron lines', () => {
    const existing = '0 * * * * /usr/bin/some-other-job # my-job'
    const result = buildCrontab(existing, paths)
    expect(result).toContain('some-other-job')
    expect(result).toContain('# seed-deploy')
    expect(result).toContain('# seed-cleanup')
  })

  test('replaces existing seed-deploy line without duplicating', () => {
    const existing = [
      '0 * * * * /usr/bin/some-other-job # my-job',
      '0 3 * * * /usr/bin/bun /old/path/deploy.js >> /old/path/log 2>&1 # seed-deploy',
    ].join('\n')
    const result = buildCrontab(existing, paths)

    // Should contain exactly one seed-deploy line (the new one)
    const deployLines = result.split('\n').filter((l) => l.includes('# seed-deploy'))
    expect(deployLines).toHaveLength(1)
    expect(deployLines[0]).toContain('--dir "/opt/seed"')
    expect(deployLines[0]).not.toContain('/old/path')

    // Other job preserved
    expect(result).toContain('some-other-job')
  })

  test('replaces existing seed-cleanup line without duplicating', () => {
    const existing = '30 0 * * * docker image prune -f # seed-cleanup'
    const result = buildCrontab(existing, paths)

    const cleanupLines = result.split('\n').filter((l) => l.includes('# seed-cleanup'))
    expect(cleanupLines).toHaveLength(1)
    // New version runs every hour
    expect(cleanupLines[0]).toContain('0 * * * *')
  })

  test('replaces both seed lines at once (idempotent)', () => {
    // First run
    const first = buildCrontab('0 * * * * /usr/bin/other # my-job', paths)
    // Second run with first output
    const second = buildCrontab(first, paths)

    expect(first).toBe(second)
  })

  test('does not leave blank lines when replacing', () => {
    const existing = [
      '0 * * * * /usr/bin/job-a # job-a',
      '*/10 * * * * /usr/bin/bun /opt/seed/deploy.js >> /opt/seed/deploy.log 2>&1 # seed-deploy',
      '0 0,4,8,12,16,20 * * * docker image prune -a -f # seed-cleanup',
    ].join('\n')
    const result = buildCrontab(existing, paths)

    // No double newlines (blank lines)
    expect(result).not.toContain('\n\n')
  })

  test('uses custom bun path in deploy cron line', () => {
    const result = buildCrontab('', paths, '/home/user/.bun/bin/bun')
    const deployLine = result.split('\n').find((l) => l.includes('# seed-deploy'))!
    expect(deployLine).toContain('/home/user/.bun/bin/bun')
    expect(deployLine).not.toContain('/usr/local/bin/bun')
    expect(deployLine).toContain('upgrade >> "/opt/seed/deploy.log"')
    expect(deployLine).toContain('deploy >> "/opt/seed/deploy.log"')
  })

  test('defaults bun path to /usr/local/bin/bun', () => {
    const result = buildCrontab('', paths)
    const deployLine = result.split('\n').find((l) => l.includes('# seed-deploy'))!
    expect(deployLine).toContain('/usr/local/bin/bun')
    expect(deployLine).toContain('--dir "/opt/seed" upgrade')
    expect(deployLine).toContain('--dir "/opt/seed" deploy')
  })
})

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  test("defaults to 'deploy' when no args given", () => {
    const result = parseArgs(['node', 'deploy.js'])
    expect(result.command).toBe('deploy')
    expect(result.args).toEqual([])
  })

  test('parses known commands', () => {
    const commands = [
      'deploy',
      'upgrade',
      'stop',
      'start',
      'restart',
      'doctor',
      'secret',
      'config',
      'logs',
      'cron',
      'backup',
      'restore',
      'uninstall',
    ] as const
    for (const cmd of commands) {
      const result = parseArgs(['node', 'deploy.js', cmd])
      expect(result.command).toBe(cmd)
    }
  })

  test('passes remaining args through', () => {
    const result = parseArgs(['node', 'deploy.js', 'logs', 'daemon'])
    expect(result.command).toBe('logs')
    expect(result.args).toEqual(['daemon'])
  })

  test('parses --help flag', () => {
    expect(parseArgs(['node', 'deploy.js', '--help']).command).toBe('help')
    expect(parseArgs(['node', 'deploy.js', '-h']).command).toBe('help')
  })

  test('parses --version flag', () => {
    expect(parseArgs(['node', 'deploy.js', '--version']).command).toBe('version')
    expect(parseArgs(['node', 'deploy.js', '-v']).command).toBe('version')
  })

  test('passes backup path as arg', () => {
    const result = parseArgs(['node', 'deploy.js', 'backup', '/tmp/backup.tar.gz'])
    expect(result.command).toBe('backup')
    expect(result.args).toEqual(['/tmp/backup.tar.gz'])
  })

  test('passes restore path as arg', () => {
    const result = parseArgs(['node', 'deploy.js', 'restore', '/tmp/backup.tar.gz'])
    expect(result.command).toBe('restore')
    expect(result.args).toEqual(['/tmp/backup.tar.gz'])
  })

  test('passes cron subcommand as arg', () => {
    const result = parseArgs(['node', 'deploy.js', 'cron', 'remove'])
    expect(result.command).toBe('cron')
    expect(result.args).toEqual(['remove'])
  })

  test('--reconfigure flag on deploy command', () => {
    const result = parseArgs(['node', 'deploy.js', 'deploy', '--reconfigure'])
    expect(result.command).toBe('deploy')
    expect(result.reconfigure).toBe(true)
    expect(result.args).toEqual([])
  })

  test('--reconfigure without explicit deploy command', () => {
    const result = parseArgs(['node', 'deploy.js', '--reconfigure'])
    expect(result.command).toBe('deploy')
    expect(result.reconfigure).toBe(true)
    expect(result.args).toEqual([])
  })

  test('--reconfigure is not set on other commands', () => {
    const result = parseArgs(['node', 'deploy.js', 'doctor'])
    expect(result.reconfigure).toBeFalsy()
  })

  test('--reconfigure is not set on plain deploy', () => {
    const result = parseArgs(['node', 'deploy.js'])
    expect(result.reconfigure).toBeFalsy()
  })

  test('--advanced sets the advanced flag and is stripped from args', () => {
    const bare = parseArgs(['node', 'deploy.js', '--advanced'])
    expect(bare.command).toBe('deploy')
    expect(bare.advanced).toBe(true)
    expect(bare.args).toEqual([])

    const withCmd = parseArgs(['node', 'deploy.js', 'deploy', '--advanced', '--reconfigure'])
    expect(withCmd.command).toBe('deploy')
    expect(withCmd.advanced).toBe(true)
    expect(withCmd.reconfigure).toBe(true)
    expect(withCmd.args).toEqual([])

    // Works after a subcommand too, without swallowing real args.
    const logs = parseArgs(['node', 'deploy.js', 'logs', 'daemon', '--advanced'])
    expect(logs.command).toBe('logs')
    expect(logs.advanced).toBe(true)
    expect(logs.args).toEqual(['daemon'])
  })

  test('advanced defaults to false when absent', () => {
    expect(parseArgs(['node', 'deploy.js', 'deploy']).advanced).toBeFalsy()
  })

  test('--dir <path> sets the data dir and is stripped from args', () => {
    const spaced = parseArgs(['node', 'deploy.js', 'deploy', '--dir', '/opt/seed-branch'])
    expect(spaced.command).toBe('deploy')
    expect(spaced.dir).toBe('/opt/seed-branch')
    expect(spaced.args).toEqual([])

    const eq = parseArgs(['node', 'deploy.js', '--dir=/opt/foo', 'doctor'])
    expect(eq.command).toBe('doctor')
    expect(eq.dir).toBe('/opt/foo')

    // Coexists with other flags, preserves real args.
    const combo = parseArgs(['node', 'deploy.js', 'logs', 'daemon', '--dir', '/opt/x', '--advanced'])
    expect(combo.command).toBe('logs')
    expect(combo.args).toEqual(['daemon'])
    expect(combo.dir).toBe('/opt/x')
    expect(combo.advanced).toBe(true)
  })

  test('dir is undefined when --dir absent', () => {
    expect(parseArgs(['node', 'deploy.js', 'deploy']).dir).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// extractSeedCronLines / removeSeedCronLines
// ---------------------------------------------------------------------------

describe('extractSeedCronLines', () => {
  test('extracts seed-deploy and seed-cleanup lines', () => {
    const crontab = [
      '0 * * * * /usr/bin/other # my-job',
      '*/10 * * * * /usr/bin/bun /opt/seed/deploy.js >> /opt/seed/deploy.log 2>&1 # seed-deploy',
      '0 0,4,8,12,16,20 * * * docker image prune -a -f # seed-cleanup',
    ].join('\n')
    const lines = extractSeedCronLines(crontab)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('# seed-deploy')
    expect(lines[1]).toContain('# seed-cleanup')
  })

  test('returns empty array when no seed lines present', () => {
    const crontab = '0 * * * * /usr/bin/other # my-job'
    expect(extractSeedCronLines(crontab)).toHaveLength(0)
  })
})

describe('removeSeedCronLines', () => {
  test('removes seed lines and preserves others', () => {
    const crontab = [
      '0 * * * * /usr/bin/other # my-job',
      '*/10 * * * * /usr/bin/bun /opt/seed/deploy.js # seed-deploy',
      '30 * * * * /usr/bin/another # another-job',
      '0 0 * * * docker image prune -a -f # seed-cleanup',
    ].join('\n')
    const result = removeSeedCronLines(crontab)
    expect(result).toContain('my-job')
    expect(result).toContain('another-job')
    expect(result).not.toContain('seed-deploy')
    expect(result).not.toContain('seed-cleanup')
  })

  test('returns empty crontab when only seed lines present', () => {
    const crontab = [
      '*/10 * * * * /usr/bin/bun /opt/seed/deploy.js # seed-deploy',
      '0 0 * * * docker image prune -a -f # seed-cleanup',
    ].join('\n')
    const result = removeSeedCronLines(crontab)
    expect(result).toBe('')
  })

  test('returns empty string (not a lone newline) for empty input', () => {
    expect(removeSeedCronLines('')).toBe('')
    expect(removeSeedCronLines('\n\n')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// composeProjectName
// ---------------------------------------------------------------------------

describe('composeProjectName', () => {
  test('uses basename of seedDir', () => {
    expect(composeProjectName(makePaths('/opt/seed'))).toBe('seed')
  })

  test('lowercases the basename', () => {
    expect(composeProjectName(makePaths('/Users/alice/Seed'))).toBe('seed')
  })

  test('preserves dashes in the basename', () => {
    expect(composeProjectName(makePaths('/tmp/seed-test-xyz'))).toBe('seed-test-xyz')
  })
})

// ---------------------------------------------------------------------------
// removeLegacyAutoupdaters / freeConflictingPortBindings
// ---------------------------------------------------------------------------

interface FakeDockerOptions {
  portIds?: string[]
  nameIds?: string[]
  ancestorIds?: string[]
  /** Map of container ID -> compose project label value. Missing IDs return empty string. */
  projectByCid?: Record<string, string>
  /** Make `docker rm -f <id>` throw for these IDs. */
  removeFailures?: string[]
}

interface FakeDocker {
  shell: ShellRunner
  removed: string[]
  inspected: string[]
}

function makeFakeDocker(opts: FakeDockerOptions = {}): FakeDocker {
  const removed: string[] = []
  const inspected: string[] = []
  const shell: ShellRunner = {
    run(cmd: string): string {
      if (cmd.includes('docker ps -aq')) {
        if (cmd.includes('ancestor=')) return (opts.ancestorIds ?? []).join('\n')
        if (cmd.includes('publish=')) return (opts.portIds ?? []).join('\n')
        if (cmd.includes('name=^')) return (opts.nameIds ?? []).join('\n')
        return ''
      }
      if (cmd.startsWith('docker inspect') && cmd.includes('com.docker.compose.project')) {
        const id = cmd.split(/\s+/)[2]
        inspected.push(id)
        return opts.projectByCid?.[id] ?? ''
      }
      if (cmd.startsWith('docker rm -f')) {
        const id = cmd.split(/\s+/)[3]
        if (opts.removeFailures?.includes(id)) {
          throw new Error(`docker rm failed for ${id}`)
        }
        removed.push(id)
        return ''
      }
      throw new Error(`unmocked: ${cmd}`)
    },
    runSafe(cmd: string): string | null {
      try {
        return this.run(cmd)
      } catch {
        return null
      }
    },
    exec(): Promise<{stdout: string; stderr: string}> {
      return Promise.reject(new Error('exec not used in these tests'))
    },
  }
  return {shell, removed, inspected}
}

describe('removeLegacyAutoupdaters', () => {
  test('no-op when no watchtower images are running', () => {
    const {shell, removed} = makeFakeDocker({})
    expect(removeLegacyAutoupdaters(shell)).toEqual([])
    expect(removed).toEqual([])
  })

  test('removes watchtower containers regardless of container name', () => {
    const {shell, removed} = makeFakeDocker({ancestorIds: ['wt-1', 'wt-2']})
    expect(removeLegacyAutoupdaters(shell)).toEqual(['wt-1', 'wt-2'])
    expect(removed).toEqual(['wt-1', 'wt-2'])
  })

  test('returns empty array when docker is unavailable', () => {
    expect(removeLegacyAutoupdaters(makeNoopShell())).toEqual([])
  })
})

describe('freeConflictingPortBindings', () => {
  test('no-op when no containers match port or name filters', () => {
    const {shell, removed} = makeFakeDocker({})
    expect(freeConflictingPortBindings(shell, 'seed')).toEqual([])
    expect(removed).toEqual([])
  })

  test('removes legacy container that publishes a conflicting port', () => {
    const {shell, removed, inspected} = makeFakeDocker({
      portIds: ['legacy-daemon'],
      // No project label -> not part of our compose project -> remove.
      projectByCid: {},
    })
    expect(freeConflictingPortBindings(shell, 'seed')).toEqual(['legacy-daemon'])
    expect(removed).toEqual(['legacy-daemon'])
    expect(inspected).toEqual(['legacy-daemon'])
  })

  test('removes stopped legacy container detected by name only', () => {
    const {shell, removed} = makeFakeDocker({
      // Stopped container -> publishes nothing, but matches by name.
      nameIds: ['stopped-seed-site'],
      projectByCid: {},
    })
    expect(freeConflictingPortBindings(shell, 'seed')).toEqual(['stopped-seed-site'])
    expect(removed).toEqual(['stopped-seed-site'])
  })

  test('skips compose-managed container with matching project label', () => {
    const {shell, removed, inspected} = makeFakeDocker({
      portIds: ['ours'],
      nameIds: ['ours'],
      projectByCid: {ours: 'seed'},
    })
    expect(freeConflictingPortBindings(shell, 'seed')).toEqual([])
    expect(removed).toEqual([])
    // Inspected exactly once thanks to dedup.
    expect(inspected).toEqual(['ours'])
  })

  test('removes orphan but keeps compose-managed container in mixed scenario', () => {
    const {shell, removed} = makeFakeDocker({
      portIds: ['ours', 'legacy'],
      projectByCid: {ours: 'seed'},
    })
    expect(freeConflictingPortBindings(shell, 'seed')).toEqual(['legacy'])
    expect(removed).toEqual(['legacy'])
  })

  test('dedupes IDs that appear in both port and name filters', () => {
    const {shell, removed, inspected} = makeFakeDocker({
      portIds: ['x'],
      nameIds: ['x'],
      projectByCid: {},
    })
    expect(freeConflictingPortBindings(shell, 'seed')).toEqual(['x'])
    expect(removed).toEqual(['x'])
    expect(inspected).toEqual(['x'])
  })

  test('honors a custom project name (test fixtures with non-default seed dir)', () => {
    const {shell, removed} = makeFakeDocker({
      portIds: ['ours-test'],
      projectByCid: {'ours-test': 'seed-test-xyz'},
    })
    expect(freeConflictingPortBindings(shell, 'seed-test-xyz')).toEqual([])
    expect(removed).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// removeLegacyHostCronLines / removeLegacyHostCron
// ---------------------------------------------------------------------------

describe('removeLegacyHostCronLines', () => {
  test('strips lines invoking website_deployment.sh', () => {
    const crontab = [
      '0 * * * * /usr/bin/other # my-job',
      '*/5 * * * * /opt/seed-site/website_deployment.sh',
      '30 * * * * /usr/bin/another # another-job',
    ].join('\n')
    const result = removeLegacyHostCronLines(crontab)
    expect(result).toContain('my-job')
    expect(result).toContain('another-job')
    expect(result).not.toContain('website_deployment.sh')
  })

  test('strips lines marked with # website-deploy comment', () => {
    const crontab = [
      '*/10 * * * * /usr/local/bin/whatever # website-deploy',
      '0 * * * * /usr/bin/other # my-job',
    ].join('\n')
    const result = removeLegacyHostCronLines(crontab)
    expect(result).toContain('my-job')
    expect(result).not.toContain('# website-deploy')
  })

  test('returns empty string when only legacy lines present', () => {
    const crontab = '*/5 * * * * /opt/seed-site/website_deployment.sh'
    expect(removeLegacyHostCronLines(crontab)).toBe('')
  })

  test('preserves seed-deploy and seed-cleanup lines', () => {
    const crontab = [
      '*/10 * * * * /opt/seed-site/website_deployment.sh',
      '*/10 * * * * /usr/bin/bun /opt/seed/deploy.js # seed-deploy',
      '0 * * * * docker image prune -f # seed-cleanup',
    ].join('\n')
    const result = removeLegacyHostCronLines(crontab)
    expect(result).toContain('# seed-deploy')
    expect(result).toContain('# seed-cleanup')
    expect(result).not.toContain('website_deployment.sh')
  })
})

describe('removeLegacyHostCron', () => {
  test('returns false when crontab unavailable', () => {
    expect(removeLegacyHostCron(makeNoopShell())).toBe(false)
  })

  test('returns false when no legacy markers present', () => {
    const shell = makeMockShell({'crontab -l': '0 * * * * /usr/bin/something'})
    expect(removeLegacyHostCron(shell)).toBe(false)
  })

  test('returns true and rewrites crontab when legacy markers present', () => {
    let written: string | null = null
    const shell: ShellRunner = {
      run(cmd: string): string {
        if (cmd.includes('crontab -l')) {
          return '*/5 * * * * /opt/seed-site/website_deployment.sh'
        }
        if (cmd.includes('crontab -')) {
          // The pipeline is `echo '<contents>' | crontab -`.
          const m = cmd.match(/echo '([\s\S]*)' \| crontab -/)
          if (m) written = m[1]
          return ''
        }
        throw new Error(`unmocked: ${cmd}`)
      },
      runSafe(cmd: string): string | null {
        try {
          return this.run(cmd)
        } catch {
          return null
        }
      },
      exec(): Promise<{stdout: string; stderr: string}> {
        return Promise.reject(new Error('unused'))
      },
    }
    expect(removeLegacyHostCron(shell)).toBe(true)
    expect(written).not.toBeNull()
    expect(written ?? '').not.toContain('website_deployment.sh')
  })
})

// ---------------------------------------------------------------------------
// describeBindFailure
// ---------------------------------------------------------------------------

describe('describeBindFailure', () => {
  test('extracts the offending port from a docker bind error', () => {
    const err =
      "Error response from daemon: driver failed programming external connectivity on endpoint seed-daemon (...): Bind for 0.0.0.0:56000 failed: port is already allocated"
    const msg = describeBindFailure(err)
    expect(msg).not.toBeNull()
    expect(msg!).toContain('Port 56000')
    expect(msg!).toContain('non-Docker process')
    expect(msg!).toContain(":56000")
  })

  test('returns null when the error is not a bind failure', () => {
    expect(describeBindFailure('something completely unrelated')).toBeNull()
    expect(describeBindFailure('Error: container exited with code 1')).toBeNull()
  })

  test('handles a different conflicting port', () => {
    const msg = describeBindFailure('Bind for 0.0.0.0:80 failed: port is already allocated')
    expect(msg).not.toBeNull()
    expect(msg!).toContain('Port 80')
  })
})

// ---------------------------------------------------------------------------
// describePullFailure
// ---------------------------------------------------------------------------

describe('describePullFailure', () => {
  test('detects an unknown manifest and names the release channel', () => {
    const err =
      'Error response from daemon: manifest for seedhypermedia/web:monoid not found: manifest unknown: manifest unknown'
    const msg = describePullFailure(err, 'monoid')
    expect(msg).not.toBeNull()
    expect(msg!).toContain("'monoid'")
    expect(msg!).toContain('seedhypermedia/web:monoid')
    expect(msg!).toContain('seedhypermedia/site:monoid')
  })

  test('detects pull access denied', () => {
    const err = 'pull access denied for seedhypermedia/site, repository does not exist or may require authorization'
    expect(describePullFailure(err, 'feature-x')).not.toBeNull()
  })

  test('detects requested-access-denied phrasing', () => {
    const err = 'denied: requested access to the resource is denied'
    expect(describePullFailure(err, 'foo')).not.toBeNull()
  })

  test('returns null for unrelated errors (e.g. bind/port conflicts)', () => {
    expect(describePullFailure('Bind for 0.0.0.0:80 failed: port is already allocated', 'dev')).toBeNull()
    expect(describePullFailure('container exited with code 1', 'dev')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// DEFAULT_SEED_DIR derivation
// ---------------------------------------------------------------------------

describe('DEFAULT_SEED_DIR / DEPLOY_SCRIPT_PATH', () => {
  test('default data dir falls back to the script dir for legacy script-in-data-dir installs', () => {
    // When NOT running from the fixed tool path (as here, under bun test), the
    // default data dir is the script's own directory — so a legacy install
    // whose wrapper/cron pass no --dir still resolves to its data.
    const {dirname} = require('node:path')
    expect(DEFAULT_SEED_DIR).toBe(dirname(process.argv[1]))
  })

  test('the tool installs to a fixed path separate from node data', () => {
    expect(DEPLOY_SCRIPT_PATH).toBe('/usr/local/lib/seed/deploy.js')
    expect(DEFAULT_DATA_DIR).toBe('/opt/seed')
  })
})

// ---------------------------------------------------------------------------
// buildCrontab: pruning safety margin
// ---------------------------------------------------------------------------

describe('buildCrontab pruning safety', () => {
  const paths = makePaths('/opt/seed')

  test('cleanup line includes --filter until=1h for safety margin', () => {
    const result = buildCrontab('', paths)
    const cleanupLine = result.split('\n').find((l) => l.includes('# seed-cleanup'))!
    expect(cleanupLine).toContain('--filter "until=1h"')
    expect(cleanupLine).toContain('docker image prune -f')
    // Must NOT use -a flag — it would delete rollback-tagged images
    expect(cleanupLine).not.toContain('prune -a')
  })
})

// ---------------------------------------------------------------------------
// selfUpdate
// ---------------------------------------------------------------------------

describe('selfUpdate', () => {
  let tmpDir: string
  let paths: DeployPaths

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'seed-selfupdate-'))
    paths = makePaths(tmpDir)
    await mkdir(tmpDir, {recursive: true})
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true, force: true})
  })

  test('is exported and callable', () => {
    expect(typeof selfUpdate).toBe('function')
  })

  test('handles fetch failure gracefully (no throw)', async () => {
    // getDeployScriptUrl honors SEED_REPO_URL, so this points the fetch at an
    // unreachable host. Pass an explicit deploy.js script path in the temp dir.
    const origUrl = process.env.SEED_REPO_URL
    process.env.SEED_REPO_URL = 'http://localhost:1/nonexistent'
    try {
      await selfUpdate(join(tmpDir, 'deploy.js')) // should not throw
    } finally {
      if (origUrl !== undefined) {
        process.env.SEED_REPO_URL = origUrl
      } else {
        delete process.env.SEED_REPO_URL
      }
    }
  })

  test('refuses to overwrite a path that is not a deploy.js (guards the test file)', async () => {
    // The script self-updates in place at process.argv[1]. The guard makes it
    // impossible to overwrite anything but a deploy.js — so even a successful
    // fetch could never corrupt the test file during `bun test`.
    await selfUpdate(process.argv[1]) // argv[1] ends in .test.ts → no-op
    const content = await readFile(process.argv[1], 'utf-8')
    expect(content).toContain('from "bun:test"')
  })

  test('targets the given script path, independent of the data dir', async () => {
    // With the tool/data split, --dir sets the data dir but the script updates
    // itself at its own path. A failed fetch leaves the target untouched (and
    // never writes into paths.seedDir).
    const scriptPath = join(tmpDir, 'deploy.js')
    const origUrl = process.env.SEED_REPO_URL
    process.env.SEED_REPO_URL = 'http://localhost:1/nonexistent'
    try {
      await selfUpdate(scriptPath)
    } finally {
      if (origUrl !== undefined) process.env.SEED_REPO_URL = origUrl
      else delete process.env.SEED_REPO_URL
    }
    // Nothing written into the data dir.
    expect(await configExists(paths)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getOpsBaseUrl
// ---------------------------------------------------------------------------

describe('getOpsBaseUrl', () => {
  test('returns default URL when no env vars are set', () => {
    const origDeploy = process.env.SEED_DEPLOY_URL
    const origRepo = process.env.SEED_REPO_URL
    delete process.env.SEED_DEPLOY_URL
    delete process.env.SEED_REPO_URL
    try {
      expect(getOpsBaseUrl()).toContain('/ops')
      expect(getOpsBaseUrl()).toContain('seed-hypermedia/seed')
    } finally {
      if (origDeploy !== undefined) process.env.SEED_DEPLOY_URL = origDeploy
      if (origRepo !== undefined) process.env.SEED_REPO_URL = origRepo
    }
  })

  test('SEED_DEPLOY_URL takes priority', () => {
    const origDeploy = process.env.SEED_DEPLOY_URL
    const origRepo = process.env.SEED_REPO_URL
    process.env.SEED_DEPLOY_URL = 'https://custom.example.com/ops'
    process.env.SEED_REPO_URL = 'https://should-be-ignored.example.com'
    try {
      expect(getOpsBaseUrl()).toBe('https://custom.example.com/ops')
    } finally {
      if (origDeploy !== undefined) {
        process.env.SEED_DEPLOY_URL = origDeploy
      } else {
        delete process.env.SEED_DEPLOY_URL
      }
      if (origRepo !== undefined) {
        process.env.SEED_REPO_URL = origRepo
      } else {
        delete process.env.SEED_REPO_URL
      }
    }
  })

  test('SEED_REPO_URL appends /ops', () => {
    const origDeploy = process.env.SEED_DEPLOY_URL
    const origRepo = process.env.SEED_REPO_URL
    delete process.env.SEED_DEPLOY_URL
    process.env.SEED_REPO_URL = 'https://repo.example.com'
    try {
      expect(getOpsBaseUrl()).toBe('https://repo.example.com/ops')
    } finally {
      if (origDeploy !== undefined) {
        process.env.SEED_DEPLOY_URL = origDeploy
      } else {
        delete process.env.SEED_DEPLOY_URL
      }
      if (origRepo !== undefined) {
        process.env.SEED_REPO_URL = origRepo
      } else {
        delete process.env.SEED_REPO_URL
      }
    }
  })
})

// ---------------------------------------------------------------------------
// getDeployScriptUrl
// ---------------------------------------------------------------------------

describe('getDeployScriptUrl', () => {
  test('always returns the S3 main-branch URL, independent of image channel', () => {
    // The script self-updates from main for every node; release_channel
    // (dev/latest/custom) never changes where the script comes from.
    const origDeploy = process.env.SEED_DEPLOY_URL
    const origRepo = process.env.SEED_REPO_URL
    delete process.env.SEED_DEPLOY_URL
    delete process.env.SEED_REPO_URL
    try {
      expect(getDeployScriptUrl()).toBe(DEV_DEPLOY_SCRIPT_URL)
    } finally {
      if (origDeploy !== undefined) process.env.SEED_DEPLOY_URL = origDeploy
      if (origRepo !== undefined) process.env.SEED_REPO_URL = origRepo
    }
  })

  test('honors a SEED_REPO_URL override for testing / branch builds', () => {
    const orig = process.env.SEED_REPO_URL
    process.env.SEED_REPO_URL = 'https://example.test'
    try {
      expect(getDeployScriptUrl()).toBe('https://example.test/ops/dist/deploy.js')
    } finally {
      if (orig !== undefined) process.env.SEED_REPO_URL = orig
      else delete process.env.SEED_REPO_URL
    }
  })

  test('returns constants with expected values', () => {
    expect(DEV_DEPLOY_SCRIPT_URL).toContain('seedappdev')
    expect(DEV_DEPLOY_SCRIPT_URL).toContain('deploy.js')
  })
})
