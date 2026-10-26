import {describe, test, expect, beforeEach, afterEach} from 'bun:test'
import {mkdtemp, rm, readFile, writeFile, mkdir, access, stat} from 'node:fs/promises'
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
  stopStackByProject,
  takeOverHost,
  autoUpdates,
  clearSeedCron,
  migrateLegacyCron,
  handleForeignStack,
  getRunningInstallDir,
  installWrapper,
  resolveBunPath,
  getContainerImages,
  checkForNewImages,
  expectedServiceImages,
  rollbackImageTargets,
  rollbackTagRefs,
  checkGpuAcceleration,
  ensureSeedDir,
  environmentPresets,
  configWarnings,
  DEFAULT_RELEASE_CHANNEL,
  validateDockerImageTag,
  validateDockerImageRef,
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
  composeFileName,
  isEnterprise,
  composeProfiles,
  notifyHost,
  agentsHost,
  enterpriseTestnetName,
  buildEnterpriseConfig,
  VAULT_ADMIN_SECRET_LENGTH,
  ENTERPRISE_OPEN_PATHS,
  NOTIFY_PROXY_PATHS,
  SESSION_CHECK_URI,
  SESSION_SECRET_LENGTH,
  headlessEnterpriseConfig,
  smtpFromEnv,
  requiredContainers,
  shellQuote,
  deviceDirectives,
  injectServiceDirectives,
  backupMembers,
  extractInvitationLinks,
  parseInviteArgs,
  enterpriseIsolationChecks,
  bootstrapOptionsFrom,
  bootstrapSpace,
  describeBootstrap,
  ownerKeyPath,
  OWNER_KEY_DIR,
  emailRelayFromEnv,
  emailRelayOf,
  describeNotify,
  redactConfig,
  setSiteUrl,
  describeSiteUrl,
  siteUrlCheck,
  BOOTSTRAP_ATTEMPTS,
  BOOTSTRAP_RETRY_MS,
  redirectHostnames,
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

describe('validateDockerImageRef', () => {
  test('accepts full image refs with registries and tags', () => {
    expect(validateDockerImageRef('ghcr.io/horacioh/seed-web:main')).toBeUndefined()
    expect(validateDockerImageRef('ghcr.io/horacioh/seed-site:sha-abcdef123456')).toBeUndefined()
    expect(validateDockerImageRef('registry.example.com:5000/ns/image:v1.2.3')).toBeUndefined()
  })

  test('rejects invalid full image refs', () => {
    expect(validateDockerImageRef('')).toBeUndefined()
    expect(validateDockerImageRef(' ghcr.io/horacioh/seed-web:main')).toContain('spaces')
    expect(validateDockerImageRef('ghcr.io/horacioh/seed-web')).toContain('tag')
    expect(validateDockerImageRef('ghcr.io/horacioh/seed-web:bad tag')).toContain('spaces')
    expect(validateDockerImageRef('ghcr.io/horacioh/seed-web:-bad')).toContain('tag')
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

  test('routes /hm/api/agents to the agents service only when enabled, open like the site', () => {
    expect(generateCaddyfile(makeTestConfig())).not.toContain('seed-agents')
    const caddy = generateCaddyfile(makeTestConfig({agents: true}))
    expect(caddy).toMatch(/@agentsroute \{\n\tpath \/hm\/api\/agents \/hm\/api\/agents\/\*\n\}/)
    expect(caddy).toContain('reverse_proxy @agentsroute seed-agents:3050')
    expect(caddy.indexOf('reverse_proxy @agentsroute')).toBeLessThan(caddy.indexOf('reverse_proxy * seed-web'))
    expect(caddy).not.toContain('forward_auth')
    // Site nodes use the hosted notify service; nothing routes to a local one.
    expect(caddy).not.toContain('seed-notify')
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

  test('reflects configured full image references', () => {
    const env = buildComposeEnv(
      makeTestConfig({
        web_image: 'ghcr.io/horacioh/seed-web:main',
        site_image: 'ghcr.io/horacioh/seed-site:main',
      }),
      makePaths(),
    )

    expect(env).toContain('SEED_WEB_IMAGE="ghcr.io/horacioh/seed-web:main"')
    expect(env).toContain('SEED_SITE_IMAGE="ghcr.io/horacioh/seed-site:main"')
  })

  test('omits full image references when official defaults are used', () => {
    const env = buildComposeEnv(makeTestConfig(), makePaths())
    expect(env).not.toContain('SEED_WEB_IMAGE=')
    expect(env).not.toContain('SEED_SITE_IMAGE=')
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
    await writeConfig(
      makeTestConfig({
        deploy_url: 'https://raw.githubusercontent.com/horacioh/seed/custom-images/ops',
        web_image: 'ghcr.io/horacioh/seed-web:main',
        site_image: 'ghcr.io/horacioh/seed-site:main',
      }),
      paths,
    )
    const loaded = await readConfig(paths)
    const expectedKeys: (keyof SeedConfig)[] = [
      'domain',
      'email',
      'deploy_url',
      'compose_url',
      'compose_sha',
      'compose_envs',
      'environment',
      'release_channel',
      'web_image',
      'site_image',
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
// docker-compose image refs
// ---------------------------------------------------------------------------

describe('docker-compose image refs', () => {
  test('web and site images can be overridden by full image refs while preserving defaults', async () => {
    const compose = await readFile(join(import.meta.dir, 'docker-compose.yml'), 'utf-8')

    expect(compose).toContain('image: ${SEED_WEB_IMAGE:-seedhypermedia/web:${SEED_SITE_TAG:-latest}}')
    expect(compose).toContain('image: ${SEED_SITE_IMAGE:-seedhypermedia/site:${SEED_SITE_TAG:-latest}}')
  })

  test('agents is an optional profile and the web app defaults to the hosted agents service', async () => {
    const compose = await readFile(join(import.meta.dir, 'docker-compose.yml'), 'utf-8')
    const agents = compose.slice(compose.indexOf('  seed-agents:'), compose.indexOf('  prometheus:'))
    expect(agents).toContain('image: ${SEED_AGENTS_IMAGE:-seedhypermedia/agents:${SEED_SITE_TAG:-latest}}')
    expect(agents).toMatch(/profiles:\n\s+- agents\n/)
    expect(agents).toContain('SEED_AGENTS_HM_SERVER_URL=${SEED_SITE_HOSTNAME}')
    expect(agents).toContain('${SEED_SITE_WORKSPACE}/agents:/data')
    expect(compose).toContain("SEED_AGENT_SERVER_URL=${SEED_AGENTS_HOST:-https://agentic.seed.hyper.media}'")
  })
})

// ---------------------------------------------------------------------------
// expectedServiceImages
// ---------------------------------------------------------------------------

describe('expectedServiceImages', () => {
  test('uses official image refs for default channels', () => {
    expect(expectedServiceImages(makeTestConfig({release_channel: 'dev'}))).toEqual([
      {container: 'seed-web', expectedImage: 'seedhypermedia/web:dev'},
      {container: 'seed-daemon', expectedImage: 'seedhypermedia/site:dev'},
    ])
  })

  test('uses configured full image refs when present', () => {
    expect(
      expectedServiceImages(
        makeTestConfig({
          web_image: 'ghcr.io/horacioh/seed-web:main',
          site_image: 'ghcr.io/horacioh/seed-site:main',
        }),
      ),
    ).toEqual([
      {container: 'seed-web', expectedImage: 'ghcr.io/horacioh/seed-web:main'},
      {container: 'seed-daemon', expectedImage: 'ghcr.io/horacioh/seed-site:main'},
    ])
  })
})

describe('rollbackImageTargets', () => {
  test('retags official rollback images to the configured release channel', () => {
    expect(rollbackImageTargets(makeTestConfig({release_channel: 'dev'}))).toEqual([
      {base: 'seedhypermedia/web', target: 'seedhypermedia/web:dev'},
      {base: 'seedhypermedia/site', target: 'seedhypermedia/site:dev'},
    ])
  })

  test('retags custom rollback images to the exact full image refs compose uses', () => {
    expect(
      rollbackImageTargets(
        makeTestConfig({
          web_image: 'ghcr.io/horacioh/seed-web:sha-abcdef123456',
          site_image: 'ghcr.io/horacioh/seed-site:sha-abcdef123456',
        }),
      ),
    ).toEqual([
      {base: 'ghcr.io/horacioh/seed-web', target: 'ghcr.io/horacioh/seed-web:sha-abcdef123456'},
      {base: 'ghcr.io/horacioh/seed-site', target: 'ghcr.io/horacioh/seed-site:sha-abcdef123456'},
    ])
  })
})

describe('rollbackTagRefs', () => {
  test('tags current and configured image bases when migrating to custom refs', () => {
    expect(
      rollbackTagRefs(
        'seed-web',
        'seedhypermedia/web:latest',
        makeTestConfig({web_image: 'ghcr.io/horacioh/seed-web:main'}),
      ),
    ).toEqual(['seedhypermedia/web:rollback', 'ghcr.io/horacioh/seed-web:rollback'])
  })

  test('dedupes rollback tags when image base is unchanged', () => {
    expect(rollbackTagRefs('seed-web', 'seedhypermedia/web:dev', makeTestConfig({release_channel: 'dev'}))).toEqual([
      'seedhypermedia/web:rollback',
    ])
  })

  test('only tags current base for unmanaged containers', () => {
    expect(rollbackTagRefs('seed-proxy', 'caddy:2', makeTestConfig())).toEqual(['caddy:rollback'])
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

  test('true when both configured image overrides match the running containers', () => {
    const shell = makeMockShell({
      "inspect seed-web --format '{{.Config.Image}}'": 'ghcr.io/horacioh/seed-web:main',
      "inspect seed-daemon --format '{{.Config.Image}}'": 'ghcr.io/horacioh/seed-site:main',
    })
    expect(
      containersMatchReleaseChannel(
        shell,
        makeTestConfig({
          release_channel: 'main',
          web_image: 'ghcr.io/horacioh/seed-web:main',
          site_image: 'ghcr.io/horacioh/seed-site:main',
        }),
      ),
    ).toBe(true)
  })

  test('false when the running containers use channel images instead of configured overrides', () => {
    const shell = makeMockShell({
      "inspect seed-web --format '{{.Config.Image}}'": 'seedhypermedia/web:main',
      "inspect seed-daemon --format '{{.Config.Image}}'": 'seedhypermedia/site:main',
    })
    expect(
      containersMatchReleaseChannel(
        shell,
        makeTestConfig({
          release_channel: 'main',
          web_image: 'ghcr.io/horacioh/seed-web:main',
          site_image: 'ghcr.io/horacioh/seed-site:main',
        }),
      ),
    ).toBe(false)
  })

  test('uses the release-channel image for a service without an override', () => {
    const shell = makeMockShell({
      "inspect seed-web --format '{{.Config.Image}}'": 'ghcr.io/horacioh/seed-web:main',
      "inspect seed-daemon --format '{{.Config.Image}}'": 'seedhypermedia/site:main',
    })
    expect(
      containersMatchReleaseChannel(
        shell,
        makeTestConfig({release_channel: 'main', web_image: 'ghcr.io/horacioh/seed-web:main'}),
      ),
    ).toBe(true)
  })
})

describe('detectForeignStack / assertNoForeignStack', () => {
  const paths = makePaths('/opt/seed') // composeProjectName → "seed"

  test('null when no seed containers exist', () => {
    expect(detectForeignStack(makeNoopShell(), paths)).toBeNull()
  })

  test('null when the containers belong to our own project', () => {
    const shell = makeMockShell({
      'inspect seed-proxy --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed',
      'inspect seed-web --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed',
      'inspect seed-daemon --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed',
    })
    expect(detectForeignStack(shell, paths)).toBeNull()
  })

  test('returns the foreign project name when another install owns a container', () => {
    const shell = makeMockShell({
      'inspect seed-proxy --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed',
      'inspect seed-web --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed',
      'inspect seed-daemon --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed-group-feed',
    })
    expect(detectForeignStack(shell, paths)).toBe('seed-group-feed')
  })

  test('ignores legacy non-compose orphans (empty project label)', () => {
    // Empty label → not a foreign compose stack; freeConflictingPortBindings handles these.
    const shell = makeMockShell({
      'inspect seed-daemon --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': '',
    })
    expect(detectForeignStack(shell, paths)).toBeNull()
  })

  test('assertNoForeignStack throws with a clear message on collision', () => {
    const shell = makeMockShell({
      'inspect seed-daemon --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed-group-feed',
    })
    expect(() => assertNoForeignStack(shell, paths)).toThrow(/seed-group-feed/)
    expect(() => assertNoForeignStack(shell, paths)).toThrow(/can't share one host/)
  })

  test('assertNoForeignStack is a no-op for our own stack', () => {
    const shell = makeMockShell({
      'inspect seed-proxy --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed',
      'inspect seed-web --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed',
      'inspect seed-daemon --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed',
    })
    expect(() => assertNoForeignStack(shell, paths)).not.toThrow()
  })
})

/** A mock shell that records every command and answers from `responses` (first `includes` match wins). */
function makeRecordingShell(responses: Record<string, string> = {}): {shell: ShellRunner; commands: string[]} {
  const commands: string[] = []
  const inner = makeMockShell(responses)
  const shell: ShellRunner = {
    run: (cmd) => {
      commands.push(cmd)
      return inner.run(cmd)
    },
    runSafe: (cmd) => {
      commands.push(cmd)
      return inner.runSafe(cmd)
    },
    exec: (cmd) => {
      commands.push(cmd)
      return inner.exec(cmd)
    },
  }
  return {shell, commands}
}

describe('stopStackByProject', () => {
  test('downs the stack by project label, not by compose file path', () => {
    const {shell, commands} = makeRecordingShell()
    stopStackByProject(shell, 'seed')
    expect(commands[0]).toBe('docker compose -p "seed" down --remove-orphans')
  })

  test('force-removes stragglers still carrying the project label', () => {
    const {shell, commands} = makeRecordingShell({
      'inspect seed-daemon --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed',
      'inspect seed-web --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'other',
    })
    stopStackByProject(shell, 'seed')
    expect(commands).toContain('docker rm -f seed-daemon 2>/dev/null')
    expect(commands.find((c) => c === 'docker rm -f seed-web 2>/dev/null')).toBeUndefined()
  })
})

describe('clearSeedCron', () => {
  test('strips seed-managed lines and keeps everything else', () => {
    const {shell, commands} = makeRecordingShell({
      'crontab -l':
        '0 0 * * * /backup.sh\n*/10 * * * * bun deploy # seed-deploy\n0 * * * * docker image prune # seed-cleanup',
    })
    clearSeedCron(shell)
    const install = commands.find((c) => c.includes('| crontab -'))!
    expect(install).toContain('/backup.sh')
    expect(install).not.toContain('# seed-deploy')
    expect(install).not.toContain('# seed-cleanup')
  })

  test('no-op when no seed-managed lines exist', () => {
    const {shell, commands} = makeRecordingShell({'crontab -l': '0 0 * * * /backup.sh'})
    clearSeedCron(shell)
    expect(commands.find((c) => c.includes('| crontab -'))).toBeUndefined()
  })
})

describe('resolveBunPath', () => {
  test('uses the running bun executable when PATH lookup fails', () => {
    expect(resolveBunPath(makeNoopShell())).toBe(process.execPath)
  })
})

describe('migrateLegacyCron', () => {
  const paths = makePaths('/opt/seed')
  const legacyCrontab = [
    '0 2 * * * /root/.bun/bin/bun "/opt/seed/deploy.js" upgrade >> "/opt/seed/deploy.log" 2>&1; /root/.bun/bin/bun "/opt/seed/deploy.js" deploy >> "/opt/seed/deploy.log" 2>&1 # seed-deploy',
    '0 0,4,8,12,16,20 * * * docker image prune -a -f --filter "until=1h" # seed-cleanup',
  ].join('\n')

  test('replaces a legacy schedule and writes the fixed script wrapper', async () => {
    const {shell, commands} = makeRecordingShell({
      'crontab -l': legacyCrontab,
      'command -v bun': '/root/.bun/bin/bun',
      'test -f': 'ok',
      'base64 -d': 'ok',
      'crontab -': 'ok',
    })

    await migrateLegacyCron(paths, shell, '/opt/seed/deploy.js')

    const cronWrite = commands.find((command) => command.includes('| crontab -'))!
    const crontab = cronWrite.match(/echo '([\s\S]*)' \| crontab -/)?.[1] ?? ''
    expect(crontab).toContain('*/10')
    expect(crontab).toContain('/usr/local/lib/seed/deploy.js')
    expect(crontab).toContain('--dir "/opt/seed"')
    expect(crontab).toContain('/root/.bun/bin/bun')
    expect(crontab).not.toContain('0 2 * * *')

    const wrapperWrite = commands.find((command) => command.includes('base64 -d >'))!
    const wrapperBase64 = wrapperWrite.match(/echo (\S+) \|/)![1]
    expect(Buffer.from(wrapperBase64, 'base64').toString('utf-8')).toContain('/usr/local/lib/seed/deploy.js')
  })

  test('does not rewrite an already-current seed crontab', async () => {
    const {shell, commands} = makeRecordingShell({
      'crontab -l': buildCrontab('', paths, '/root/.bun/bin/bun'),
      'command -v bun': '/root/.bun/bin/bun',
    })

    await migrateLegacyCron(paths, shell)

    expect(commands.find((command) => command.includes('| crontab -'))).toBeUndefined()
  })

  test('does not write when no seed cron line exists', async () => {
    const {shell, commands} = makeRecordingShell({'crontab -l': '0 0 * * * /backup.sh'})

    await migrateLegacyCron(paths, shell)

    expect(commands.find((command) => command.includes('| crontab -'))).toBeUndefined()
  })

  test('does not take over a seed cron line owned by another node', async () => {
    const {shell, commands} = makeRecordingShell({
      'crontab -l':
        '*/10 * * * * /usr/local/bin/bun /usr/local/lib/seed/deploy.js --dir "/opt/seed-other" deploy # seed-deploy',
    })

    await migrateLegacyCron(paths, shell)

    expect(commands.find((command) => command.includes('| crontab -'))).toBeUndefined()
  })

  test('leaves the legacy cron untouched when the script cannot be installed', async () => {
    const scriptDir = await mkdtemp(join(tmpdir(), 'seed-cron-migration-'))
    const scriptPath = join(scriptDir, 'deploy.js')
    await writeFile(scriptPath, 'legacy deploy script')
    const {shell, commands} = makeRecordingShell({
      'crontab -l': legacyCrontab,
      'command -v bun': '/root/.bun/bin/bun',
      'test -f': 'ok',
    })

    try {
      await migrateLegacyCron(paths, shell, scriptPath)
      expect(commands.filter((command) => command.includes('cp '))).toHaveLength(2)
      expect(commands.find((command) => command.includes('test -f'))).toBeDefined()
      expect(commands.find((command) => command.includes('| crontab -'))).toBeUndefined()
      expect(commands.find((command) => command.includes('base64 -d >'))).toBeUndefined()
    } finally {
      await rm(scriptDir, {recursive: true, force: true})
    }
  })

  test('uses sudo to copy the script and gives the cron user ownership', async () => {
    const scriptDir = await mkdtemp(join(tmpdir(), 'seed-cron-migration-'))
    const scriptPath = join(scriptDir, 'deploy.js')
    await writeFile(scriptPath, 'legacy deploy script')
    const {shell, commands} = makeRecordingShell({
      'crontab -l': legacyCrontab,
      'command -v bun': '/root/.bun/bin/bun',
      'sudo mkdir': 'ok',
      'test -f': 'ok',
      'base64 -d': 'ok',
      'crontab -': 'ok',
    })

    try {
      await migrateLegacyCron(paths, shell, scriptPath)
      const sudoCopy = commands.find((command) => command.includes('sudo mkdir'))!
      expect(sudoCopy).toContain('sudo chown "$(id -u):$(id -g)"')
      expect(commands.find((command) => command.includes('| crontab -'))).toBeDefined()
    } finally {
      await rm(scriptDir, {recursive: true, force: true})
    }
  })
})

describe('takeOverHost', () => {
  test('disarms the seed cron BEFORE stopping the stack (cron resurrection race)', () => {
    // If the old node's cron stays armed while its stack is down, a cron tick
    // mid-switch redeploys the old node and the takeover fails.
    const {shell, commands} = makeRecordingShell({
      'crontab -l': '*/10 * * * * bun deploy # seed-deploy',
    })
    takeOverHost(shell, 'seed')
    const cronIdx = commands.findIndex((c) => c.includes('| crontab -'))
    const downIdx = commands.findIndex((c) => c.includes('docker compose -p "seed" down'))
    expect(cronIdx).toBeGreaterThanOrEqual(0)
    expect(downIdx).toBeGreaterThanOrEqual(0)
    expect(cronIdx).toBeLessThan(downIdx)
  })
})

describe('handleForeignStack', () => {
  const paths = makePaths('/opt/seed-group-feed') // composeProjectName → "seed-group-feed"
  const foreignLabels = {
    'inspect seed-proxy --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed',
    'inspect seed-web --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed',
    'inspect seed-daemon --format \'{{index .Config.Labels "com.docker.compose.project"}}\'': 'seed',
  }

  test('no-op when no foreign stack exists', async () => {
    const {shell, commands} = makeRecordingShell()
    await handleForeignStack(shell, paths, false, false)
    expect(commands.find((c) => c.includes('down'))).toBeUndefined()
  })

  test('takes over without prompting when the takeover was already approved this run', async () => {
    const {shell, commands} = makeRecordingShell({...foreignLabels, 'crontab -l': ''})
    await handleForeignStack(shell, paths, false, true)
    expect(commands).toContain('docker compose -p "seed" down --remove-orphans')
  })

  test('headless: removes the stack when its install dir no longer exists (folder was moved)', async () => {
    const {shell, commands} = makeRecordingShell({
      ...foreignLabels,
      'range .Mounts': '/gone-install-dir/daemon',
    })
    await handleForeignStack(shell, paths, false, false)
    expect(commands).toContain('docker compose -p "seed" down --remove-orphans')
    // Orphan cleanup must not touch the cron — headless runs never reinstall it.
    expect(commands.find((c) => c.includes('crontab'))).toBeUndefined()
  })

  test('headless: still refuses when the foreign install dir exists on disk', async () => {
    const {shell} = makeRecordingShell({
      ...foreignLabels,
      'range .Mounts': `${tmpdir()}/daemon`,
    })
    await expect(handleForeignStack(shell, paths, false, false)).rejects.toThrow(/can't share one host/)
  })

  test("headless: still refuses when the foreign install dir can't be determined", async () => {
    const {shell} = makeRecordingShell(foreignLabels)
    await expect(handleForeignStack(shell, paths, false, false)).rejects.toThrow(/can't share one host/)
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

describe('installWrapper', () => {
  test('writes a wrapper that runs the fixed script with --dir <data dir>', () => {
    const commands: string[] = []
    const shell: ShellRunner = {
      run: () => '',
      runSafe: (cmd: string) => {
        commands.push(cmd)
        return cmd.includes('command -v bun') ? '/usr/local/bin/bun' : 'ok'
      },
      exec: () => Promise.reject(new Error('unused')),
    }
    installWrapper(makePaths('/opt/seed-branch'), shell)
    const writeCmd = commands.find((c) => c.includes('base64 -d >'))!
    const b64 = writeCmd.match(/echo (\S+) \|/)![1]
    const content = Buffer.from(b64, 'base64').toString('utf-8')
    // One fixed script, pointed at this node's data dir.
    expect(content).toContain('/usr/local/lib/seed/deploy.js')
    expect(content).toContain('--dir "/opt/seed-branch"')
    expect(content).toContain('/usr/local/bin/bun')
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

  test('uses configured full image refs when cron checks for updates', async () => {
    const shell = makeMockShell({
      "inspect seed-proxy --format '{{.Image}}'": 'sha256:aaa',
      "inspect seed-web --format '{{.Image}}'": 'sha256:bbb',
      "inspect seed-daemon --format '{{.Image}}'": 'sha256:ccc',
      'docker compose': '',
      "inspect seed-proxy --format '{{.Config.Image}}'": 'caddy:2',
      "inspect seed-web --format '{{.Config.Image}}'": 'ghcr.io/horacioh/seed-web:main',
      "inspect seed-daemon --format '{{.Config.Image}}'": 'ghcr.io/horacioh/seed-site:main',
      "image inspect caddy:2 --format '{{.Id}}'": 'sha256:aaa',
      "image inspect ghcr.io/horacioh/seed-web:main --format '{{.Id}}'": 'sha256:bbb',
      "image inspect ghcr.io/horacioh/seed-site:main --format '{{.Id}}'": 'sha256:ccc',
    })

    const result = await checkForNewImages(
      {
        ...config,
        web_image: 'ghcr.io/horacioh/seed-web:main',
        site_image: 'ghcr.io/horacioh/seed-site:main',
      },
      paths,
      shell,
    )
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
    const crontab = ['*/10 * * * * /usr/local/bin/whatever # website-deploy', '0 * * * * /usr/bin/other # my-job'].join(
      '\n',
    )
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
      'Error response from daemon: driver failed programming external connectivity on endpoint seed-daemon (...): Bind for 0.0.0.0:56000 failed: port is already allocated'
    const msg = describeBindFailure(err)
    expect(msg).not.toBeNull()
    expect(msg!).toContain('Port 56000')
    expect(msg!).toContain('non-Docker process')
    expect(msg!).toContain(':56000')
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
  test('returns the S3 main-branch URL without a custom deploy source', () => {
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

  test('uses the persisted deploy source for fork-managed nodes', () => {
    const origDeploy = process.env.SEED_DEPLOY_URL
    const origRepo = process.env.SEED_REPO_URL
    delete process.env.SEED_DEPLOY_URL
    delete process.env.SEED_REPO_URL
    try {
      expect(getDeployScriptUrl('https://raw.githubusercontent.com/horacioh/seed/custom-images/ops/')).toBe(
        'https://raw.githubusercontent.com/horacioh/seed/custom-images/ops/dist/deploy.js',
      )
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

// ---------------------------------------------------------------------------
// Enterprise profile
// ---------------------------------------------------------------------------

function makeEnterpriseConfig(overrides: Partial<SeedConfig> = {}): SeedConfig {
  return makeTestConfig({
    profile: 'enterprise',
    domain: 'https://example.org',
    vault_admin_secret: 'x'.repeat(VAULT_ADMIN_SECRET_LENGTH),
    session_secret: 's',
    service_secret: 'svc',
    notify: false,
    agents: false,
    ...overrides,
  })
}

describe('enterprise: profile helpers', () => {
  test('absent profile means site', () => {
    expect(isEnterprise(makeTestConfig())).toBe(false)
    expect(isEnterprise(makeTestConfig({profile: 'site'}))).toBe(false)
    expect(isEnterprise(makeEnterpriseConfig())).toBe(true)
  })

  test('compose file name follows the profile', () => {
    expect(composeFileName()).toBe('docker-compose.yml')
    expect(composeFileName('site')).toBe('docker-compose.yml')
    expect(composeFileName('enterprise')).toBe('docker-compose.enterprise.yml')
  })

  test('testnet name derives from the DNS name with dots replaced', () => {
    expect(enterpriseTestnetName('https://example.org')).toBe('ent-example-org')
    expect(enterpriseTestnetName('https://seed.acme.co.uk/')).toBe('ent-seed-acme-co-uk')
  })

  test('notify and agents live on the site origin, empty when disabled', () => {
    expect(notifyHost(makeEnterpriseConfig())).toBe('')
    expect(notifyHost(makeEnterpriseConfig({notify: true}))).toBe('https://example.org/hm/api/notify')
    expect(agentsHost(makeEnterpriseConfig())).toBe('')
    expect(agentsHost(makeEnterpriseConfig({agents: true}))).toBe('https://example.org/hm/api/agents')
    // The site profile keeps the hosted notify service, now on hyper.media itself.
    expect(NOTIFY_SERVICE_HOST).toBe('https://hyper.media/hm/api/notify')
    expect(notifyHost(makeTestConfig())).toBe(NOTIFY_SERVICE_HOST)
    expect(notifyHost(makeTestConfig({notify: true}))).toBe(NOTIFY_SERVICE_HOST)
    expect(agentsHost(makeTestConfig())).toBe('')
    expect(agentsHost(makeTestConfig({agents: true}))).toBe('https://node1.seed.run/hm/api/agents')
  })

  test('compose profiles follow the config', () => {
    expect(composeProfiles(makeEnterpriseConfig())).toEqual([])
    expect(composeProfiles(makeEnterpriseConfig({notify: true}))).toEqual(['notify'])
    expect(composeProfiles(makeEnterpriseConfig({notify: true, agents: true, metrics: true}))).toEqual([
      'notify',
      'agents',
      'metrics',
    ])
    // Site nodes never run notify; agents and metrics are optional.
    expect(composeProfiles(makeTestConfig({notify: true, metrics: true}))).toEqual(['metrics'])
    expect(composeProfiles(makeTestConfig({notify: true, agents: true, metrics: true}))).toEqual(['agents', 'metrics'])
  })

  test('required containers grow with the enabled services', () => {
    expect(requiredContainers()).toEqual(['seed-proxy', 'seed-web', 'seed-daemon'])
    expect(requiredContainers(makeTestConfig())).toEqual(['seed-proxy', 'seed-web', 'seed-daemon'])
    expect(requiredContainers(makeEnterpriseConfig())).toEqual(['seed-proxy', 'seed-web', 'seed-daemon', 'seed-vault'])
    expect(requiredContainers(makeEnterpriseConfig({notify: true, agents: true}))).toEqual([
      'seed-proxy',
      'seed-web',
      'seed-daemon',
      'seed-vault',
      'seed-notify',
      'seed-agents',
    ])
    expect(requiredContainers(makeTestConfig({agents: true}))).toEqual([
      'seed-proxy',
      'seed-web',
      'seed-daemon',
      'seed-agents',
    ])
  })

  test('expected images include vault, and notify/agents when enabled', () => {
    const base = expectedServiceImages(makeEnterpriseConfig({release_channel: 'dev'}))
    expect(base).toContainEqual({container: 'seed-vault', expectedImage: 'seedhypermedia/vault:dev'})
    expect(base.find((i) => i.container === 'seed-notify')).toBeUndefined()
    const full = expectedServiceImages(makeEnterpriseConfig({notify: true, agents: true}))
    expect(full).toContainEqual({container: 'seed-notify', expectedImage: 'seedhypermedia/notify:latest'})
    expect(full).toContainEqual({container: 'seed-agents', expectedImage: 'seedhypermedia/agents:latest'})
    // Site profile unchanged, plus agents when enabled.
    expect(expectedServiceImages(makeTestConfig()).map((i) => i.container)).toEqual(['seed-web', 'seed-daemon'])
    expect(expectedServiceImages(makeTestConfig({agents: true}))).toContainEqual({
      container: 'seed-agents',
      expectedImage: 'seedhypermedia/agents:latest',
    })
  })

  test('workspace dirs add vault/notify/agents for enterprise only', () => {
    const paths = makePaths('/opt/seed')
    expect(getWorkspaceDirs(paths)).not.toContain('/opt/seed/vault')
    expect(getWorkspaceDirs(paths, makeTestConfig())).not.toContain('/opt/seed/vault')
    const dirs = getWorkspaceDirs(paths, makeEnterpriseConfig())
    expect(dirs).toContain('/opt/seed/vault')
    expect(dirs).toContain('/opt/seed/notify')
    expect(dirs).toContain('/opt/seed/agents')
    // A site node with agents gets their data dir only.
    const site = getWorkspaceDirs(paths, makeTestConfig({agents: true}))
    expect(site).toContain('/opt/seed/agents')
    expect(site).not.toContain('/opt/seed/vault')
  })

  test('autoUpdates: sites always, enterprise nodes on the latest and dev channels', () => {
    expect(autoUpdates(makeTestConfig({release_channel: 'latest'}))).toBe(true)
    expect(autoUpdates(makeTestConfig({release_channel: 'dev'}))).toBe(true)
    expect(autoUpdates(makeEnterpriseConfig())).toBe(true)
    expect(autoUpdates(makeEnterpriseConfig({release_channel: 'latest'}))).toBe(true)
    expect(autoUpdates(makeEnterpriseConfig({release_channel: 'feat-enterprise-edition'}))).toBe(false)
    expect(autoUpdates(makeEnterpriseConfig({release_channel: 'dev'}))).toBe(true)
  })

  test('configWarnings: no network warnings, only a non-stable channel notice', () => {
    expect(configWarnings(makeEnterpriseConfig())).toEqual([])
    const warnings = configWarnings(makeEnterpriseConfig({release_channel: 'dev'}))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("'dev' image channel")
    expect(warnings[0]).not.toContain('mainnet')
  })
})

describe('enterprise: parseArgs --profile', () => {
  test('--profile enterprise on a bare run', () => {
    const result = parseArgs(['node', 'deploy.js', '--profile', 'enterprise'])
    expect(result.command).toBe('deploy')
    expect(result.profile).toBe('enterprise')
    expect(result.args).toEqual([])
  })

  test('--profile=enterprise with the deploy command and other flags', () => {
    const result = parseArgs(['node', 'deploy.js', 'deploy', '--profile=enterprise', '--dir', '/opt/ent', '--advanced'])
    expect(result.command).toBe('deploy')
    expect(result.profile).toBe('enterprise')
    expect(result.dir).toBe('/opt/ent')
    expect(result.advanced).toBe(true)
    expect(result.args).toEqual([])
  })

  test('--profile site is accepted; profile is undefined when absent', () => {
    expect(parseArgs(['node', 'deploy.js', '--profile', 'site']).profile).toBe('site')
    expect(parseArgs(['node', 'deploy.js']).profile).toBeUndefined()
  })

  test('unattended install flags are parsed and stripped', () => {
    const r = parseArgs([
      'node',
      'deploy.js',
      'deploy',
      '--profile',
      'enterprise',
      '--tag',
      'feat-enterprise-edition',
      '--hostname=https://example.org',
      '--email',
      'ops@example.org',
      '--log-level',
      'debug',
      '--agents',
      '--no-notify',
      '--yes',
    ])
    expect(r.command).toBe('deploy')
    expect(r.profile).toBe('enterprise')
    expect(r.args).toEqual([])
    expect(r.headless).toEqual({
      tag: 'feat-enterprise-edition',
      hostname: 'https://example.org',
      email: 'ops@example.org',
      logLevel: 'debug',
      agents: true,
      notify: false,
      yes: true,
    })
    expect(parseArgs(['node', 'deploy.js', 'doctor']).headless).toEqual({})
  })

  test('register and invite are commands with pass-through args', () => {
    const register = parseArgs(['node', 'deploy.js', 'register', 'z6MkAccount'])
    expect(register.command).toBe('register')
    expect(register.args).toEqual(['z6MkAccount'])
    const invite = parseArgs(['node', 'deploy.js', 'invite', 'a@example.org', '3'])
    expect(invite.command).toBe('invite')
    expect(invite.args).toEqual(['a@example.org', '3'])
  })
})

describe('enterprise: buildEnterpriseConfig defaults', () => {
  const answers = {
    domain: 'https://example.org',
    release_channel: 'latest',
    log_level: 'info' as const,
    agents: false,
    notify: false,
    email: '',
  }

  test('forces gateway/testnet/analytics off and generates secrets', () => {
    const config = buildEnterpriseConfig(answers)
    expect(config.profile).toBe('enterprise')
    expect(config.gateway).toBe(false)
    expect(config.testnet).toBe(false)
    expect(config.analytics).toBe(false)
    expect(config.environment).toBe('prod')
    expect(config.compose_url.endsWith('/docker-compose.enterprise.yml')).toBe(true)
    expect(config.link_secret).toMatch(/^[A-Za-z0-9]{10}$/)
    expect(config.vault_admin_secret).toMatch(/^[A-Za-z0-9]+$/)
    expect(config.vault_admin_secret!.length).toBeGreaterThanOrEqual(32)
    expect(config.session_secret).toMatch(/^[A-Za-z0-9]+$/)
    expect(config.session_secret!.length).toBeGreaterThanOrEqual(48)
    expect(config.session_secret).toBe(config.session_secret)
    expect(config.service_secret).toMatch(/^[A-Za-z0-9]{48,}$/)
    expect(config.service_secret).not.toBe(config.session_secret)
    expect(SESSION_SECRET_LENGTH).toBeGreaterThanOrEqual(48)
    expect(config.notify).toBe(false)
    expect(config.agents).toBe(false)
    expect(config.agents_kvm).toBe(false)
    expect(config.smtp).toBeUndefined()
  })

  test('keeps existing secrets, smtp and kvm flag on reconfigure', () => {
    const existing = makeEnterpriseConfig({
      link_secret: 'keepMe1234',
      vault_admin_secret: 'keepVault'.repeat(5),
      agents: true,
      agents_kvm: true,
      smtp: {host: 'smtp.example.org', port: 465, user: 'u', password: 'p', sender: 'Seed <s@example.org>'},
    })
    const config = buildEnterpriseConfig({...answers, agents: true, notify: true, smtp: existing.smtp}, existing)
    expect(config.link_secret).toBe('keepMe1234')
    expect(config.vault_admin_secret).toBe('keepVault'.repeat(5))
    expect(config.session_secret).toBe('s')
    expect(config.service_secret).toBe('svc')
    expect(config.agents_kvm).toBe(true)
    expect(config.smtp?.host).toBe('smtp.example.org')
    // Turning agents off also clears the kvm flag.
    expect(buildEnterpriseConfig({...answers, agents: false}, existing).agents_kvm).toBe(false)
  })

  test('config roundtrips through disk', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'seed-ent-'))
    try {
      const paths = makePaths(tmp)
      const config = buildEnterpriseConfig({
        ...answers,
        notify: true,
        smtp: {host: 'h', port: 587, user: 'u', password: 'p', sender: 's@h'},
      })
      await writeConfig(config, paths)
      const loaded = await readConfig(paths)
      expect(loaded.profile).toBe('enterprise')
      expect(loaded.vault_admin_secret).toBe(config.vault_admin_secret)
      expect(loaded.smtp).toEqual(config.smtp)
    } finally {
      await rm(tmp, {recursive: true, force: true})
    }
  })
})

describe('enterprise: headless config', () => {
  test('builds a config from flags and env without prompts', () => {
    const env = {
      SEED_SMTP_HOST: 'smtp.example.org',
      SEED_SMTP_USER: 'mailer',
      SEED_SMTP_PASSWORD: 'pw',
      SEED_SMTP_SENDER: 'Seed <seed@example.org>',
    }
    const config = headlessEnterpriseConfig(
      {hostname: 'https://example.org', tag: 'feat-enterprise-edition', notify: true, agents: true, yes: true},
      undefined,
      env,
    )
    expect(config.profile).toBe('enterprise')
    expect(config.domain).toBe('https://example.org')
    expect(config.release_channel).toBe('feat-enterprise-edition')
    expect(config.notify).toBe(true)
    expect(config.agents).toBe(true)
    expect(config.smtp).toEqual({
      host: 'smtp.example.org',
      port: undefined,
      user: 'mailer',
      password: 'pw',
      sender: 'Seed <seed@example.org>',
    })
    expect(config.compose_envs.LOG_LEVEL).toBe('info')
    expect(config.vault_admin_secret!.length).toBeGreaterThanOrEqual(32)
    expect(config.session_secret!.length).toBeGreaterThanOrEqual(48)
  })

  test('names the missing piece', () => {
    expect(() => headlessEnterpriseConfig({}, undefined, {})).toThrow(/--hostname/)
    expect(() => headlessEnterpriseConfig({hostname: 'example.org'}, undefined, {})).toThrow(/https:\/\//)
    expect(() => headlessEnterpriseConfig({hostname: 'https://x.org', tag: 'bad tag'}, undefined, {})).toThrow(/--tag/)
    expect(() => headlessEnterpriseConfig({hostname: 'https://x.org', logLevel: 'loud'}, undefined, {})).toThrow(
      /--log-level/,
    )
    expect(() => headlessEnterpriseConfig({hostname: 'https://x.org', notify: true}, undefined, {})).toThrow(
      /SEED_SMTP_HOST/,
    )
  })

  test('reuses an existing config for the values not given', () => {
    const existing = makeEnterpriseConfig({release_channel: 'dev', email: 'a@b.c', agents: true})
    const config = headlessEnterpriseConfig({hostname: 'https://example.org'}, existing, {})
    expect(config.release_channel).toBe('dev')
    expect(config.email).toBe('a@b.c')
    expect(config.agents).toBe(true)
    expect(config.vault_admin_secret).toBe(existing.vault_admin_secret)
    expect(config.session_secret).toBe('s')
    expect(smtpFromEnv({})).toBeUndefined()
    expect(smtpFromEnv({SEED_SMTP_HOST: 'h', SEED_SMTP_PORT: '2525'})?.port).toBe(2525)
  })
})

describe('enterprise: buildComposeEnv', () => {
  test('derives the private testnet name and the enterprise vars', () => {
    const env = buildComposeEnv(makeEnterpriseConfig(), makePaths('/opt/seed'))
    expect(env).toContain('SEED_P2P_TESTNET_NAME="ent-example-org"')
    expect(env).toContain(`SEED_VAULT_ADMIN_SECRET="${'x'.repeat(VAULT_ADMIN_SECRET_LENGTH)}"`)
    expect(env).toContain('SEED_SESSION_SECRET="s"')
    expect(env).toContain('SEED_SERVICE_SECRET="svc"')
    expect(env).toContain('SEED_UPSTREAM_API_URL="https://hyper.media"')
    expect(buildComposeEnv(makeEnterpriseConfig({upstream_api_url: ''}), makePaths('/opt/seed'))).toContain(
      'SEED_UPSTREAM_API_URL=""',
    )
    expect(env).toContain('SEED_CONTACT_EMAIL="ops@seed.hypermedia"')
    expect(env).toContain('SEED_SITE_NAME="example.org"')
    expect(buildComposeEnv(makeEnterpriseConfig({site_name: 'Botical'}), makePaths('/opt/seed'))).toContain(
      'SEED_SITE_NAME="Botical"',
    )
    expect(env).toContain('SEED_NOTIFY_HOST=""')
    expect(env).toContain('NOTIFY_SERVICE_HOST=""')
    expect(env).toContain('SEED_AGENTS_HOST=""')
    expect(env).toContain('SEED_AGENTS_EXEC_BACKEND=""')
    expect(env).toContain('SEED_SMTP_HOST=""')
    expect(env).toContain('SEED_SMTP_PORT="587"')
    expect(env).toContain('SEED_IS_GATEWAY="false"')
    expect(env).toContain('SEED_ENABLE_STATISTICS="false"')
    expect(env).not.toContain('COMPOSE_PROFILES=')
  })

  test('passes compose profiles, hosts and smtp when enabled', () => {
    const env = buildComposeEnv(
      makeEnterpriseConfig({
        notify: true,
        agents: true,
        agents_kvm: true,
        metrics: true,
        smtp: {
          host: 'smtp.example.org',
          port: 2587,
          user: 'mailer',
          password: 'p@ss"w$rd',
          sender: 'Seed <seed@example.org>',
        },
      }),
      makePaths('/opt/seed'),
    )
    expect(env).toContain('COMPOSE_PROFILES="notify,agents,metrics"')
    expect(env).toContain('SEED_NOTIFY_HOST="https://example.org/hm/api/notify"')
    expect(env).toContain('NOTIFY_SERVICE_HOST="https://example.org/hm/api/notify"')
    expect(env).toContain('SEED_AGENTS_HOST="https://example.org/hm/api/agents"')
    expect(env).toContain('SEED_AGENTS_EXEC_BACKEND="microsandbox"')
    expect(env).toContain('SEED_SMTP_HOST="smtp.example.org"')
    expect(env).toContain('SEED_SMTP_PORT="2587"')
    expect(env).toContain('SEED_SMTP_USER="mailer"')
    expect(env).toContain(`SEED_SMTP_PASSWORD='p@ss"w$rd'`)
    expect(env).toContain(`SEED_SMTP_SENDER='Seed <seed@example.org>'`)
  })

  test('site profile env is unchanged (no enterprise vars, hosted notify)', () => {
    const env = buildComposeEnv(makeTestConfig(), makePaths('/opt/seed'))
    expect(env).not.toContain('SEED_VAULT_ADMIN_SECRET')
    expect(env).not.toContain('SEED_NOTIFY_HOST')
    expect(env).not.toContain('COMPOSE_PROFILES')
    expect(env).not.toContain('SEED_AGENTS_HOST')
    expect(env).toContain(`NOTIFY_SERVICE_HOST="${NOTIFY_SERVICE_HOST}"`)
  })

  test('site profile with agents passes its own agents URL and the profile', () => {
    const env = buildComposeEnv(makeTestConfig({agents: true, agents_kvm: true}), makePaths('/opt/seed'))
    expect(env).toContain('COMPOSE_PROFILES="agents"')
    expect(env).toContain('SEED_AGENTS_HOST="https://node1.seed.run/hm/api/agents"')
    expect(env).toContain('SEED_AGENTS_EXEC_BACKEND="microsandbox"')
    expect(env).not.toContain('SEED_SERVICE_SECRET')
  })

  test('shellQuote keeps plain values double-quoted and escapes the rest', () => {
    expect(shellQuote('https://example.org')).toBe('"https://example.org"')
    expect(shellQuote('')).toBe('""')
    expect(shellQuote('Seed <seed@example.org>')).toBe(`'Seed <seed@example.org>'`)
    expect(shellQuote(`it's $x`)).toBe(`'it'\\''s $x'`)
  })
})

describe('enterprise: generateCaddyfile', () => {
  test('a reconfiguration keeps redirect hostnames and adds the hostname it replaces', () => {
    const existing = makeEnterpriseConfig({
      domain: 'https://ee-test-1.hyper.media',
      redirect_hostnames: ['old.example.net'],
    })
    const moved = headlessEnterpriseConfig({hostname: 'https://seed.acme.org', yes: true}, existing, {})
    expect(moved.redirect_hostnames).toEqual(['old.example.net', 'ee-test-1.hyper.media'])
    const same = headlessEnterpriseConfig({hostname: 'https://ee-test-1.hyper.media', yes: true}, existing, {})
    expect(same.redirect_hostnames).toEqual(['old.example.net'])
    expect(
      headlessEnterpriseConfig({hostname: 'https://x.org', yes: true}, undefined, {}).redirect_hostnames,
    ).toBeUndefined()
  })

  test('earlier hostnames get a redirect block of their own', () => {
    const caddy = generateCaddyfile(
      makeEnterpriseConfig({
        redirect_hostnames: ['ee-test-1.hyper.media', 'https://Example.org/', 'ee-test-1.hyper.media'],
      }),
    )
    const blocks = caddy.split('\n\nee-test-1.hyper.media {')
    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toStartWith('\n\tredir https://example.org{uri} permanent\n}')
    // The current hostname never redirects to itself; duplicates collapse.
    expect(caddy.match(/redir https:\/\/example.org\{uri\} permanent/g)).toHaveLength(1)
    expect(redirectHostnames({domain: 'https://example.org', redirect_hostnames: ['example.org']})).toEqual([])
    expect(generateCaddyfile(makeEnterpriseConfig())).not.toContain('redir ')
  })

  test('main site block has the forward_auth gate, vault and ipfs routes', () => {
    const caddy = generateCaddyfile(makeEnterpriseConfig())
    expect(caddy).toContain('(gate) {')
    expect(caddy).toContain('forward_auth seed-web:3000 {')
    // The trailing "?" strips the original query (Remix `_data` navigations) from the subrequest.
    expect(caddy).toContain(`uri ${SESSION_CHECK_URI}?\n`)
    expect(caddy).toContain('copy_headers X-Forwarded-Uri')
    expect(caddy).toContain('\nexample.org {')
    expect(caddy).toContain('@vault path /vault /vault/*')
    expect(caddy).toContain('reverse_proxy seed-vault:3000')
    expect(caddy).toContain('@metrics path /.metrics*')
    expect(caddy).toContain('request_body {')
    expect(caddy).not.toContain('__Host-HM-Auth-Token')
    for (const path of ENTERPRISE_OPEN_PATHS) expect(caddy).toContain(path)
    // Pre-session calls: POST /ipfs/* to the daemon, POST /api/PublishBlobs and GET /api/Account to the web app.
    expect(caddy).toMatch(/@ipfs_upload \{\n\t\tmethod POST\n\t\tpath \/ipfs\/\*/)
    expect(caddy).toMatch(
      /@open_api_post \{\n\t\tmethod POST\n\t\tpath \/api\/PublishBlobs \/hm\/api\/enterprise-bootstrap \/hm\/api\/enterprise-site-url\n/,
    )
    expect(caddy).toMatch(/@open_api_get \{\n\t\tmethod GET HEAD\n\t\tpath \/api\/Account/)
    // Open blocks come before the gated ones; the gated ipfs/metrics/catch-all each import the gate.
    const open = caddy.indexOf('handle @open {')
    const ipfs = caddy.indexOf('handle @ipfs {')
    const rest = caddy.lastIndexOf('handle {')
    expect(open).toBeGreaterThan(0)
    expect(ipfs).toBeGreaterThan(open)
    expect(rest).toBeGreaterThan(ipfs)
    expect(caddy.slice(ipfs).match(/import gate/g)).toHaveLength(3)
    expect(caddy.slice(0, ipfs)).not.toContain('import gate')
    expect(caddy.slice(ipfs)).toContain('reverse_proxy seed-daemon:56001')
  })

  test('no notify or agents blocks when disabled', () => {
    const caddy = generateCaddyfile(makeEnterpriseConfig())
    expect(caddy).not.toContain('notify.example.org')
    expect(caddy).not.toContain('agents.example.org')
    expect(caddy).not.toContain('seed-notify')
    expect(caddy).not.toContain('seed-agents')
  })

  test('serves notify and agents on the site itself when enabled, with no extra hostnames', () => {
    const caddy = generateCaddyfile(makeEnterpriseConfig({notify: true, agents: true}))
    expect(caddy).not.toContain('notify.example.org')
    expect(caddy).not.toContain('agents.example.org')
    // One site block (plus the gate snippet): everything is on the site's origin.
    expect(caddy.match(/^\S.* \{$/gm)).toEqual(['(gate) {', 'example.org {'])
    const gateStart = caddy.indexOf('# Everything below requires a session.')

    // Notify: its prefix and the legacy API paths, open (signed requests and
    // email tokens are the credentials), before anything gated.
    const notify = caddy.indexOf('handle @notify {')
    expect(notify).toBeGreaterThan(0)
    expect(notify).toBeLessThan(gateStart)
    expect(caddy.slice(notify, caddy.indexOf('}', notify) + 1)).toMatch(
      /handle @notify \{\s*reverse_proxy seed-notify:3000\s*\}/,
    )
    const notifyLine = caddy.split('\n').find((l) => l.includes('@notify path'))!
    expect(notifyLine.trim().split(' ').slice(2)).toEqual([...NOTIFY_PROXY_PATHS])
    expect([...NOTIFY_PROXY_PATHS]).toEqual([
      '/hm/api/notify',
      '/hm/api/notify/*',
      '/hm/api/notifications',
      '/hm/api/notification-config',
      '/hm/api/notification-inbox',
      '/hm/api/notification-read-state',
      '/hm/api/public-subscribe',
      '/hm/api/public-subscribe/*',
      '/hm/api/email-notif-token',
      '/hm/api/unsubscribe',
    ])
    // The settings page is the web app's, open to token holders who are not members.
    expect(ENTERPRISE_OPEN_PATHS).toContain('/hm/email-notifications*')

    // Inbound webhooks come from outside services and carry their own secret.
    const webhook = caddy.indexOf('@agents_webhook {')
    expect(webhook).toBeGreaterThan(0)
    expect(webhook).toBeLessThan(gateStart)
    expect(caddy).toMatch(/@agents_webhook \{\n\t\tmethod POST\n\t\tpath \/hm\/api\/agents\/webhooks\/\*\n/)

    // Members only: /hm/api/agents (API and WebSocket) sits behind the gate, before the catch-all.
    const gated = caddy.indexOf('@agents path /hm/api/agents /hm/api/agents/*')
    expect(gated).toBeGreaterThan(gateStart)
    expect(caddy.slice(gated, caddy.indexOf('}', gated + 30) + 1)).toMatch(
      /handle @agents \{\s*import gate\s*reverse_proxy seed-agents:3050/,
    )
    expect(gated).toBeLessThan(caddy.lastIndexOf('handle {'))
    expect(caddy).not.toContain(' /agents/')
    // The upload cap covers the whole site block, the agents route included.
    expect(caddy.indexOf('max_size 512MB')).toBeLessThan(gated)
  })

  test('site profile Caddyfile is untouched', () => {
    const caddy = generateCaddyfile(makeTestConfig())
    expect(caddy).toContain('{$SEED_SITE_HOSTNAME}')
    expect(caddy).not.toContain('forward_auth')
  })
})

describe('enterprise: compose template', () => {
  test('daemon publishes no ports, services use the shared tag with overrides', async () => {
    const compose = await readFile(join(import.meta.dir, 'docker-compose.enterprise.yml'), 'utf-8')
    expect(compose).toContain('image: ${SEED_WEB_IMAGE:-seedhypermedia/web:${SEED_SITE_TAG:-latest}}')
    expect(compose).toContain('image: ${SEED_SITE_IMAGE:-seedhypermedia/site:${SEED_SITE_TAG:-latest}}')
    expect(compose).toContain('seedhypermedia/vault:${SEED_SITE_TAG:-latest}')
    expect(compose).toContain('seedhypermedia/notify:${SEED_SITE_TAG:-latest}')
    expect(compose).toContain('seedhypermedia/agents:${SEED_SITE_TAG:-latest}')
    // The daemon block has no ports and no public-network flags.
    const daemon = compose.slice(
      compose.indexOf('container_name: seed-daemon'),
      compose.indexOf('container_name: seed-vault'),
    )
    expect(daemon).not.toMatch(/^\s+ports:/m)
    expect(daemon).toContain('-p2p.isolated=true')
    expect(daemon).toContain('-lndhub.disabled=true')
    expect(daemon).toContain('-p2p.listen-addrs=/ip4/127.0.0.1/tcp/56000')
    expect(daemon).toContain('-p2p.bootstrap-peers=none')
    expect(daemon).toContain('-syncing.no-discovery=true')
    expect(daemon).toMatch(/-p2p\.testnet-name=\$\{SEED_P2P_TESTNET_NAME\} \$\{SEED_SITE_HOSTNAME\}"'/)
    expect(daemon).not.toContain('lndhub.mainnet')
    expect(daemon).not.toContain('announce-addrs')
    expect(daemon).not.toContain('force-reachability-public')
    expect(daemon).not.toContain('no-sync-back')
    // The web app publishes no host port at all; only the proxy does.
    const web = compose.slice(
      compose.indexOf('container_name: seed-web'),
      compose.indexOf('container_name: seed-daemon'),
    )
    expect(web).not.toMatch(/^\s+ports:/m)
    expect(compose.match(/^\s+ports:/gm)).toHaveLength(1)
    for (const v of [
      'SEED_REQUIRE_SIGN_IN=1',
      'SEED_SESSION_SECRET=${SEED_SESSION_SECRET}',
      'SEED_SERVICE_SECRET=${SEED_SERVICE_SECRET}',
      'SEED_UPSTREAM_API_URL=${SEED_UPSTREAM_API_URL}',
      'SEED_AGENTS_HM_SERVER_SECRET=${SEED_SERVICE_SECRET}',
      'SEED_VAULT_INTERNAL_URL=http://seed-vault:3000',
      'SEED_VAULT_ADMIN_SECRET=${SEED_VAULT_ADMIN_SECRET}',
      'SEED_AGENT_SERVER_URL=${SEED_AGENTS_HOST}',
      'SEED_HOST_URL=',
      'NODE_ENV=production',
      'SEED_VAULT_INVITE_ONLY=true',
      'SEED_VAULT_RP_NAME=${SEED_SITE_NAME}',
      'SEED_VAULT_DEFAULT_NOTIFY_SERVER=${SEED_NOTIFY_HOST}',
      'NOTIFY_SMTP_PORT=${SEED_SMTP_PORT:-587}',
      'SEED_DEV_ADMIN_EMAIL=${SEED_CONTACT_EMAIL}',
      'NOTIFY_TRUSTED_PREVALIDATORS=${SEED_SITE_HOSTNAME}',
    ]) {
      expect(compose).toContain(v)
    }
  })

  test('kvm device injection targets the agents service only', () => {
    const compose = [
      'services:',
      '  seed-daemon:',
      '    container_name: seed-daemon',
      '    volumes:',
      '      - a:/data',
      '  seed-agents:',
      '    container_name: seed-agents',
      '    volumes:',
      '      - b:/data',
    ].join('\n')
    const out = injectServiceDirectives(compose, 'seed-agents', deviceDirectives(['/dev/kvm'], ['108']))
    const lines = out.split('\n')
    const agentsIdx = lines.indexOf('    container_name: seed-agents')
    expect(lines.slice(agentsIdx + 1, agentsIdx + 6)).toEqual([
      '    devices:',
      '      - /dev/kvm:/dev/kvm',
      '    group_add:',
      '      - 108',
      '    volumes:',
    ])
    // The daemon block is untouched.
    expect(lines.slice(0, agentsIdx - 1)).not.toContain('    devices:')
    expect(deviceDirectives(['/dev/dri'], [])).toEqual(['    devices:', '      - /dev/dri:/dev/dri'])
  })
})

describe('enterprise: invite arguments', () => {
  test('parseInviteArgs: email, role flags, --no-email and a count', () => {
    expect(parseInviteArgs(['a@example.org'])).toEqual({
      email: 'a@example.org',
      role: 'reader',
      send: true,
      count: undefined,
    })
    expect(parseInviteArgs(['a@example.org', '--role', 'writer'])).toMatchObject({role: 'writer', send: true})
    expect(parseInviteArgs(['--role=writer', 'a@example.org', '--no-email'])).toMatchObject({
      email: 'a@example.org',
      role: 'writer',
      send: false,
    })
    expect(parseInviteArgs(['a@example.org', '--writer', '3'])).toMatchObject({role: 'writer', count: 3})
    expect(parseInviteArgs(['a@example.org', '--role', 'admin']).error).toContain('--role must be reader or writer')
    expect(parseInviteArgs(['a@example.org', 'bogus']).error).toContain("unexpected argument 'bogus'")
  })
})

describe('enterprise: backup, invite, doctor helpers', () => {
  test('backup members add existing enterprise data dirs only', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'seed-ent-backup-'))
    try {
      const paths = makePaths(tmp)
      await mkdir(join(tmp, 'vault'), {recursive: true})
      const site = await backupMembers(paths, makeTestConfig())
      expect(site).toEqual(['config.json', 'backup-meta.json', 'docker-compose.yml', 'web', 'daemon', 'proxy'])
      await mkdir(join(tmp, 'agents'), {recursive: true})
      expect(await backupMembers(paths, makeTestConfig({agents: true}))).toContain('agents')
      expect(await backupMembers(paths, makeTestConfig())).not.toContain('agents')
      await rm(join(tmp, 'agents'), {recursive: true, force: true})
      const ent = await backupMembers(paths, makeEnterpriseConfig())
      expect(ent).toContain('vault')
      expect(ent).not.toContain('notify')
      expect(ent).not.toContain('agents')
    } finally {
      await rm(tmp, {recursive: true, force: true})
    }
  })

  test('extractInvitationLinks tolerates several response shapes', () => {
    const base = 'https://example.org/vault'
    expect(
      extractInvitationLinks({invitations: [{code: 'abc', link: 'https://example.org/vault/invite/abc'}]}, base),
    ).toEqual(['https://example.org/vault/invite/abc'])
    expect(extractInvitationLinks({links: ['https://x/1', 'https://x/2']}, base)).toEqual([
      'https://x/1',
      'https://x/2',
    ])
    expect(extractInvitationLinks({codes: ['c1']}, base)).toEqual(['https://example.org/vault?invite=c1'])
    expect(extractInvitationLinks({code: 'solo'}, base)).toEqual(['https://example.org/vault?invite=solo'])
    expect(extractInvitationLinks({code: 'solo', email: 'a+b@x.io'}, base)).toEqual([
      'https://example.org/vault?invite=solo&email=a%2Bb%40x.io',
    ])
    // The vault's real shape (201 body).
    expect(
      extractInvitationLinks(
        {
          invitations: [
            {
              code: 'abc',
              email: null,
              link: 'https://example.org/vault?invite=abc',
              createTime: 1,
              usedTime: null,
              used: false,
            },
          ],
        },
        base,
      ),
    ).toEqual(['https://example.org/vault?invite=abc'])
    expect(extractInvitationLinks({ok: true}, base)).toEqual([])
    expect(extractInvitationLinks('nope', base)).toEqual([])
  })

  test('isolation checks pass on a locked-down node', () => {
    const shell = makeMockShell({
      'docker port seed-daemon': '',
      '/hm/api/config': '{"requireSignIn":true,"peerId":"12D3"}',
      '/vault/': '200',
      '"https://example.org/"': '302 https://example.org/hm/sign-in?next=%2F',
      '/hm/api/session': '401',
    })
    const lines = enterpriseIsolationChecks(shell, makeEnterpriseConfig())
    expect(lines.filter((l) => l.includes('\u2714'))).toHaveLength(5)
    expect(lines.join('\n')).toContain('/hm/api/session without a session → 401')
    expect(lines.join('\n')).toContain('none published')
    expect(lines.join('\n')).toContain('requireSignIn: true')
    expect(lines.join('\n')).toContain('302 https://example.org/hm/sign-in?next=%2F')
  })

  test('isolation checks flag published daemon ports and a missing gate', () => {
    const shell = makeMockShell({
      'docker port seed-daemon': '56000/tcp -> 0.0.0.0:56000',
      '/hm/api/config': '{"requireSignIn":false}',
      '/vault/': '502',
      '"https://example.org/"': '200 ',
      '/hm/api/session': '204',
    })
    const out = enterpriseIsolationChecks(shell, makeEnterpriseConfig()).join('\n')
    expect(out).toContain('PUBLISHED: 56000/tcp -> 0.0.0.0:56000')
    expect(out).toContain('requireSignIn: false')
    expect(out).toContain('GET / without a session answered 200')
    expect(out).toContain('/hm/api/session without a session answered 204')
    expect(out).toContain('answered 502')
    expect(out).not.toContain('\u2714')
  })
})

describe("enterprise: the organization's space", () => {
  let tmpDir: string
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'seed-bootstrap-'))
  })
  afterEach(async () => {
    await rm(tmpDir, {recursive: true, force: true})
  })

  const KEY_FILE = {createTime: '2026-10-13T00:00:00.000Z', publicKey: 'z6MkOwner', keyB64: 'AAAA'}

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})
  }

  /** A fetch that answers from a queue and records every call. */
  function fakeFetch(answers: Array<Response | Error>) {
    const calls: Array<{url: string; init: RequestInit}> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({url, init})
      const next = answers.shift()
      if (!next) throw new Error('no more answers')
      if (next instanceof Error) throw next
      return next
    }) as unknown as typeof fetch
    return {fetchImpl, calls}
  }

  test('parseArgs takes --site-name, --owner-password and the bootstrap-space command', () => {
    const run = parseArgs([
      'node',
      'deploy.js',
      'bootstrap-space',
      '--site-name',
      'Acme Research',
      '--owner-password=hunter2',
    ])
    expect(run.command).toBe('bootstrap-space')
    expect(run.args).toEqual([])
    expect(run.headless).toEqual({siteName: 'Acme Research', ownerPassword: 'hunter2'})
    const first = parseArgs(['node', 'deploy.js', '--profile', 'enterprise', '--site-name', 'Acme'])
    expect(first.command).toBe('deploy')
    expect(first.headless.siteName).toBe('Acme')
  })

  test('bootstrapOptionsFrom reads the password from the flag, then the environment', () => {
    expect(bootstrapOptionsFrom({}, {})).toEqual({siteName: undefined, ownerPassword: undefined})
    expect(bootstrapOptionsFrom({siteName: 'Acme'}, {SEED_OWNER_PASSWORD: 'env-pw'})).toEqual({
      siteName: 'Acme',
      ownerPassword: 'env-pw',
    })
    expect(bootstrapOptionsFrom({ownerPassword: 'flag-pw'}, {SEED_OWNER_PASSWORD: 'env-pw'}).ownerPassword).toBe(
      'flag-pw',
    )
  })

  test('the config carries site_name (bare hostname by default) and keeps owner_account_uid', () => {
    const answers = {
      domain: 'https://seed.acme.org',
      release_channel: 'latest',
      log_level: 'info' as const,
      agents: false,
      notify: false,
      email: '',
    }
    expect(buildEnterpriseConfig(answers).site_name).toBe('seed.acme.org')
    expect(buildEnterpriseConfig({...answers, site_name: '  Acme  '}).site_name).toBe('Acme')
    const existing = makeEnterpriseConfig({site_name: 'Acme', owner_account_uid: 'z6MkOwner'})
    const rebuilt = buildEnterpriseConfig(answers, existing)
    expect(rebuilt.site_name).toBe('Acme')
    expect(rebuilt.owner_account_uid).toBe('z6MkOwner')
    expect(
      headlessEnterpriseConfig({hostname: 'https://seed.acme.org', siteName: 'Acme HQ'}, undefined, {}).site_name,
    ).toBe('Acme HQ')
    expect(headlessEnterpriseConfig({hostname: 'https://seed.acme.org'}, undefined, {}).site_name).toBe('seed.acme.org')
    expect(headlessEnterpriseConfig({hostname: 'https://seed.acme.org'}, existing, {}).owner_account_uid).toBe(
      'z6MkOwner',
    )
  })

  test('ownerKeyPath lives under owner-key/ in the install directory', () => {
    const paths = makePaths('/opt/seed')
    expect(ownerKeyPath(paths, 'z6MkOwner')).toBe(`/opt/seed/${OWNER_KEY_DIR}/z6MkOwner.hmkey.json`)
  })

  test('bootstrapSpace creates the space, keeps the key file owner-only and records the account', async () => {
    const paths = makePaths(tmpDir)
    const config = makeEnterpriseConfig({site_name: 'Acme'})
    await writeConfig(config, paths)
    const {fetchImpl, calls} = fakeFetch([
      jsonResponse(200, {
        accountUid: 'z6MkOwner',
        name: 'Acme',
        keyFile: KEY_FILE,
        keyFileName: 'z6MkOwner.hmkey.json',
      }),
    ])
    const result = await bootstrapSpace(config, paths, {ownerPassword: 'pw'}, {fetch: fetchImpl})

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://example.org/hm/api/enterprise-bootstrap')
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${config.vault_admin_secret}`)
    expect(JSON.parse(calls[0].init.body as string)).toEqual({name: 'Acme', ownerPassword: 'pw'})

    const keyPath = ownerKeyPath(paths, 'z6MkOwner')
    expect(result).toEqual({status: 'created', accountUid: 'z6MkOwner', name: 'Acme', keyPath})
    expect(JSON.parse(await readFile(keyPath, 'utf-8'))).toEqual(KEY_FILE)
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600)
    expect((await stat(join(tmpDir, OWNER_KEY_DIR))).mode & 0o777).toBe(0o700)
    const saved = await readConfig(paths)
    expect(saved.owner_account_uid).toBe('z6MkOwner')
    expect(saved.site_name).toBe('Acme')
    expect(config.owner_account_uid).toBe('z6MkOwner')
  })

  test('bootstrapSpace names the space from the flag, then config, then the bare hostname', async () => {
    const paths = makePaths(tmpDir)
    const config = makeEnterpriseConfig({site_name: undefined})
    await writeConfig(config, paths)
    const answer = () => jsonResponse(200, {accountUid: 'z6MkOwner', name: 'x', keyFile: KEY_FILE})
    const a = fakeFetch([answer()])
    await bootstrapSpace(config, paths, {siteName: 'From flag'}, {fetch: a.fetchImpl})
    expect(JSON.parse(a.calls[0].init.body as string)).toEqual({name: 'From flag'})
    const b = fakeFetch([answer()])
    await bootstrapSpace(makeEnterpriseConfig({site_name: undefined}), paths, {}, {fetch: b.fetchImpl})
    expect(JSON.parse(b.calls[0].init.body as string)).toEqual({name: 'example.org'})
  })

  test('bootstrapSpace is idempotent: an already registered site is reported, not an error', async () => {
    const paths = makePaths(tmpDir)
    const config = makeEnterpriseConfig()
    const {fetchImpl} = fakeFetch([
      jsonResponse(409, {message: 'This site is already registered', accountUid: 'z6MkExisting'}),
    ])
    const result = await bootstrapSpace(config, paths, {}, {fetch: fetchImpl})
    expect(result).toEqual({status: 'exists', accountUid: 'z6MkExisting'})
    expect(config.owner_account_uid).toBeUndefined()
    await expect(access(join(tmpDir, OWNER_KEY_DIR))).rejects.toThrow()
  })

  test('bootstrapSpace waits for the web app: retries connection errors and 5xx, then succeeds', async () => {
    const paths = makePaths(tmpDir)
    const config = makeEnterpriseConfig()
    await writeConfig(config, paths)
    const {fetchImpl, calls} = fakeFetch([
      new Error('ECONNREFUSED'),
      jsonResponse(502, 'Bad Gateway'),
      jsonResponse(200, {accountUid: 'z6MkOwner', name: 'example.org', keyFile: KEY_FILE}),
    ])
    const slept: number[] = []
    const logged: string[] = []
    const result = await bootstrapSpace(
      config,
      paths,
      {},
      {
        fetch: fetchImpl,
        sleep: async (ms) => {
          slept.push(ms)
        },
        log: (line) => logged.push(line),
      },
    )
    expect(result.status).toBe('created')
    expect(calls).toHaveLength(3)
    expect(slept).toEqual([BOOTSTRAP_RETRY_MS, BOOTSTRAP_RETRY_MS])
    expect(logged[0]).toContain('ECONNREFUSED')
    expect(logged[1]).toContain('HTTP 502')
  })

  test('bootstrapSpace gives up after the attempts with the last failure', async () => {
    const paths = makePaths(tmpDir)
    const {fetchImpl, calls} = fakeFetch(Array.from({length: BOOTSTRAP_ATTEMPTS}, () => new Error('ECONNREFUSED')))
    await expect(
      bootstrapSpace(makeEnterpriseConfig(), paths, {}, {fetch: fetchImpl, sleep: async () => {}}),
    ).rejects.toThrow(/after 6 attempts: .*ECONNREFUSED/)
    expect(calls).toHaveLength(BOOTSTRAP_ATTEMPTS)
  })

  test('bootstrapSpace does not retry a refusal, and explains a missing route', async () => {
    const paths = makePaths(tmpDir)
    const unauthorized = fakeFetch([jsonResponse(401, {message: 'Unauthorized'})])
    await expect(bootstrapSpace(makeEnterpriseConfig(), paths, {}, {fetch: unauthorized.fetchImpl})).rejects.toThrow(
      /HTTP 401/,
    )
    expect(unauthorized.calls).toHaveLength(1)
    const missing = fakeFetch([new Response('Not Found', {status: 404})])
    await expect(bootstrapSpace(makeEnterpriseConfig(), paths, {}, {fetch: missing.fetchImpl})).rejects.toThrow(
      /no bootstrap route.*bootstrap-space/,
    )
    expect(missing.calls).toHaveLength(1)
  })

  test('bootstrapSpace refuses a site node or one without the admin secret', async () => {
    const paths = makePaths(tmpDir)
    const {fetchImpl, calls} = fakeFetch([])
    await expect(bootstrapSpace(makeTestConfig(), paths, {}, {fetch: fetchImpl})).rejects.toThrow(/enterprise/)
    await expect(
      bootstrapSpace(makeEnterpriseConfig({vault_admin_secret: undefined}), paths, {}, {fetch: fetchImpl}),
    ).rejects.toThrow(/vault_admin_secret/)
    expect(calls).toHaveLength(0)
  })

  test('describeBootstrap tells the operator the account, the key file and how to take root', () => {
    const config = makeEnterpriseConfig()
    const created = describeBootstrap(config, {
      status: 'created',
      accountUid: 'z6MkOwner',
      name: 'Acme',
      keyPath: '/opt/seed/owner-key/z6MkOwner.hmkey.json',
    })
    expect(created[0]).toBe('Created the organization\'s space "Acme": z6MkOwner')
    expect(created[1]).toContain('/opt/seed/owner-key/z6MkOwner.hmkey.json')
    expect(created.join('\n')).toContain('https://example.org/vault/settings')
    expect(created.join('\n')).toContain('seed-cli key import /opt/seed/owner-key/z6MkOwner.hmkey.json')
    expect(created.join('\n')).toContain('never stored')
    expect(describeBootstrap(config, {status: 'exists', accountUid: 'z6MkExisting'})).toEqual([
      'The site is already registered to the space z6MkExisting; nothing to create.',
    ])
  })
})

describe('enterprise: email relay', () => {
  test('parseArgs takes --email-relay-url and --email-relay-token', () => {
    const run = parseArgs([
      'node',
      'deploy.js',
      'deploy',
      '--profile',
      'enterprise',
      '--email-relay-url',
      'https://host.example.com/relay',
      '--email-relay-token=tok',
    ])
    expect(run.command).toBe('deploy')
    expect(run.headless.emailRelayUrl).toBe('https://host.example.com/relay')
    expect(run.headless.emailRelayToken).toBe('tok')
  })

  test('emailRelayFromEnv and emailRelayOf', () => {
    expect(emailRelayFromEnv({})).toBeUndefined()
    expect(emailRelayFromEnv({SEED_EMAIL_RELAY_URL: 'https://r', SEED_EMAIL_RELAY_TOKEN: 't'})).toEqual({
      url: 'https://r',
      token: 't',
    })
    expect(emailRelayFromEnv({SEED_EMAIL_RELAY_URL: 'https://r'})).toEqual({url: 'https://r', token: ''})
    expect(emailRelayOf(undefined)).toBeUndefined()
    expect(emailRelayOf(makeEnterpriseConfig())).toBeUndefined()
    expect(emailRelayOf(makeEnterpriseConfig({email_relay_url: 'https://r', email_relay_token: 't'}))).toEqual({
      url: 'https://r',
      token: 't',
    })
  })

  test('headless config takes the relay from flags, then the environment, then the existing config', () => {
    const fromFlags = headlessEnterpriseConfig(
      {hostname: 'https://example.org', emailRelayUrl: 'https://flag/relay', emailRelayToken: 'flag-tok'},
      undefined,
      {SEED_EMAIL_RELAY_URL: 'https://env/relay', SEED_EMAIL_RELAY_TOKEN: 'env-tok'},
    )
    expect(fromFlags.email_relay_url).toBe('https://flag/relay')
    expect(fromFlags.email_relay_token).toBe('flag-tok')

    const fromEnv = headlessEnterpriseConfig({hostname: 'https://example.org'}, undefined, {
      SEED_EMAIL_RELAY_URL: 'https://env/relay',
      SEED_EMAIL_RELAY_TOKEN: 'env-tok',
    })
    expect(fromEnv.email_relay_url).toBe('https://env/relay')
    expect(fromEnv.email_relay_token).toBe('env-tok')

    const existing = makeEnterpriseConfig({email_relay_url: 'https://old/relay', email_relay_token: 'old-tok'})
    const kept = headlessEnterpriseConfig({hostname: 'https://example.org'}, existing, {})
    expect(kept.email_relay_url).toBe('https://old/relay')
    expect(kept.email_relay_token).toBe('old-tok')

    // The token may come from the environment when only the URL is a flag.
    const mixed = headlessEnterpriseConfig(
      {hostname: 'https://example.org', emailRelayUrl: 'https://flag/relay'},
      undefined,
      {
        SEED_EMAIL_RELAY_TOKEN: 'env-tok',
      },
    )
    expect(mixed.email_relay_token).toBe('env-tok')
  })

  test('with a relay, --notify no longer needs SMTP; a relay needs a token and a URL', () => {
    const config = headlessEnterpriseConfig({hostname: 'https://example.org', notify: true}, undefined, {
      SEED_EMAIL_RELAY_URL: 'https://env/relay',
      SEED_EMAIL_RELAY_TOKEN: 'env-tok',
    })
    expect(config.notify).toBe(true)
    expect(config.smtp).toBeUndefined()
    expect(() => headlessEnterpriseConfig({hostname: 'https://x.org', notify: true}, undefined, {})).toThrow(
      /SEED_SMTP_HOST.*SEED_EMAIL_RELAY_URL/,
    )
    expect(() =>
      headlessEnterpriseConfig({hostname: 'https://x.org', emailRelayUrl: 'https://r/relay'}, undefined, {}),
    ).toThrow(/--email-relay-token/)
    expect(() =>
      headlessEnterpriseConfig({hostname: 'https://x.org', emailRelayUrl: 'r.example.com'}, undefined, {
        SEED_EMAIL_RELAY_TOKEN: 't',
      }),
    ).toThrow(/--email-relay-url/)
  })

  test('buildEnterpriseConfig keeps, sets or clears the relay', () => {
    const answers = {
      domain: 'https://example.org',
      release_channel: 'latest',
      log_level: 'info' as const,
      agents: false,
      notify: false,
      email: '',
    }
    const existing = makeEnterpriseConfig({email_relay_url: 'https://old/relay', email_relay_token: 'old-tok'})
    expect(buildEnterpriseConfig(answers).email_relay_url).toBeUndefined()
    const kept = buildEnterpriseConfig(answers, existing)
    expect(kept.email_relay_url).toBe('https://old/relay')
    expect(kept.email_relay_token).toBe('old-tok')
    const set = buildEnterpriseConfig({...answers, email_relay: {url: 'https://new/relay', token: 'new-tok'}}, existing)
    expect(set.email_relay_url).toBe('https://new/relay')
    expect(set.email_relay_token).toBe('new-tok')
    const cleared = buildEnterpriseConfig({...answers, email_relay: null}, existing)
    expect(cleared.email_relay_url).toBeUndefined()
    expect(cleared.email_relay_token).toBeUndefined()
  })

  test('the relay reaches compose as SEED_EMAIL_RELAY_URL / SEED_EMAIL_RELAY_TOKEN', async () => {
    const env = buildComposeEnv(
      makeEnterpriseConfig({notify: true, email_relay_url: 'https://host/relay', email_relay_token: 'se$cret'}),
      makePaths('/opt/seed'),
    )
    expect(env).toContain('SEED_EMAIL_RELAY_URL="https://host/relay"')
    expect(env).toContain(`SEED_EMAIL_RELAY_TOKEN='se$cret'`)
    expect(env).toContain('SEED_SMTP_HOST=""')
    const without = buildComposeEnv(makeEnterpriseConfig(), makePaths('/opt/seed'))
    expect(without).toContain('SEED_EMAIL_RELAY_URL=""')
    expect(without).toContain('SEED_EMAIL_RELAY_TOKEN=""')
    expect(buildComposeEnv(makeTestConfig(), makePaths('/opt/seed'))).not.toContain('SEED_EMAIL_RELAY')

    const compose = await readFile(join(import.meta.dir, 'docker-compose.enterprise.yml'), 'utf-8')
    const vault = compose.slice(
      compose.indexOf('container_name: seed-vault'),
      compose.indexOf('container_name: seed-notify'),
    )
    expect(vault).toContain('SEED_VAULT_EMAIL_RELAY_URL=${SEED_EMAIL_RELAY_URL}')
    expect(vault).toContain('SEED_VAULT_EMAIL_RELAY_TOKEN=${SEED_EMAIL_RELAY_TOKEN}')
    const notify = compose.slice(
      compose.indexOf('container_name: seed-notify'),
      compose.indexOf('container_name: seed-agents'),
    )
    expect(notify).toContain('NOTIFY_EMAIL_RELAY_URL=${SEED_EMAIL_RELAY_URL}')
    expect(notify).toContain('NOTIFY_EMAIL_RELAY_TOKEN=${SEED_EMAIL_RELAY_TOKEN}')
  })

  test('config output redacts the relay token with the other secrets', () => {
    const redacted = redactConfig(
      makeEnterpriseConfig({
        email_relay_url: 'https://host/relay',
        email_relay_token: 'top-secret',
        smtp: {host: 'h', user: 'u', password: 'pw', sender: 's@h'},
      }),
    )
    expect(redacted.email_relay_url).toBe('https://host/relay')
    expect(redacted.email_relay_token).toBe('****')
    expect(redacted.smtp?.password).toBe('****')
    expect(redacted.vault_admin_secret).toBe('****')
    expect(redacted.session_secret).toBe('****')
    expect(redacted.service_secret).toBe('****')
    expect(redacted.link_secret).toBe('****')
    expect(JSON.stringify(redacted)).not.toContain('top-secret')
    expect(redactConfig(makeEnterpriseConfig()).email_relay_token).toBeUndefined()
  })

  test('describeNotify says how mail leaves the box', () => {
    expect(describeNotify(makeEnterpriseConfig())).toBe('false')
    expect(describeNotify(makeEnterpriseConfig({notify: true, email_relay_url: 'https://host/relay'}))).toBe(
      'yes (email relay https://host/relay)',
    )
    expect(
      describeNotify(
        makeEnterpriseConfig({notify: true, smtp: {host: 'smtp.h', user: 'u', password: 'p', sender: 'Seed <s@h>'}}),
      ),
    ).toBe('yes (smtp.h, sender Seed <s@h>)')
  })
})

describe('enterprise: hostname change', () => {
  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})
  }
  function fakeFetch(answers: Array<Response | Error>) {
    const calls: Array<{url: string; init: RequestInit}> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({url, init})
      const next = answers.shift()
      if (!next) throw new Error('no more answers')
      if (next instanceof Error) throw next
      return next
    }) as unknown as typeof fetch
    return {fetchImpl, calls}
  }

  test('parseArgs knows set-hostname', () => {
    const run = parseArgs(['node', 'deploy.js', 'set-hostname', 'https://new.example.org'])
    expect(run.command).toBe('set-hostname')
    expect(run.args).toEqual(['https://new.example.org'])
  })

  test('setSiteUrl posts to the site-url route with the admin secret and reports the change', async () => {
    const config = makeEnterpriseConfig({domain: 'https://new.example.org'})
    const {fetchImpl, calls} = fakeFetch([
      jsonResponse(200, {
        accountUid: 'z6MkOwner',
        siteUrl: 'https://new.example.org',
        changed: true,
        previousSiteUrl: 'https://example.org',
      }),
    ])
    const result = await setSiteUrl(config, {fetch: fetchImpl})
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://new.example.org/hm/api/enterprise-site-url')
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${config.vault_admin_secret}`)
    expect(result).toEqual({
      accountUid: 'z6MkOwner',
      siteUrl: 'https://new.example.org',
      changed: true,
      previousSiteUrl: 'https://example.org',
    })
    const lines = describeSiteUrl(result)
    expect(lines[0]).toBe(
      'Republished the home document of z6MkOwner: siteUrl is now https://new.example.org (was https://example.org).',
    )
    expect(lines.join('\n')).toContain('Passkeys are bound to the hostname')
  })

  test('setSiteUrl reports an up-to-date document without changing anything', async () => {
    const {fetchImpl} = fakeFetch([
      jsonResponse(200, {
        accountUid: 'z6MkOwner',
        siteUrl: 'https://example.org',
        changed: false,
        previousSiteUrl: 'https://example.org',
      }),
    ])
    const result = await setSiteUrl(makeEnterpriseConfig(), {fetch: fetchImpl})
    expect(result.changed).toBe(false)
    expect(describeSiteUrl(result)).toEqual([
      'The space z6MkOwner already points at https://example.org; nothing to republish.',
    ])
  })

  test('setSiteUrl waits for the web app, then explains 401, 404 and 409', async () => {
    const slow = fakeFetch([
      new Error('ECONNREFUSED'),
      jsonResponse(502, 'Bad Gateway'),
      jsonResponse(200, {
        accountUid: 'z6MkOwner',
        siteUrl: 'https://example.org',
        changed: true,
        previousSiteUrl: null,
      }),
    ])
    const logged: string[] = []
    const result = await setSiteUrl(makeEnterpriseConfig(), {
      fetch: slow.fetchImpl,
      sleep: async () => {},
      log: (line) => logged.push(line),
    })
    expect(result.previousSiteUrl).toBeNull()
    expect(slow.calls).toHaveLength(3)
    expect(logged[0]).toContain('Site URL not updated yet')
    expect(logged[1]).toContain('HTTP 502')

    const unauthorized = fakeFetch([jsonResponse(401, {message: 'Unauthorized'})])
    await expect(setSiteUrl(makeEnterpriseConfig(), {fetch: unauthorized.fetchImpl})).rejects.toThrow(/HTTP 401/)
    expect(unauthorized.calls).toHaveLength(1)
    const missing = fakeFetch([new Response('Not Found', {status: 404})])
    await expect(setSiteUrl(makeEnterpriseConfig(), {fetch: missing.fetchImpl})).rejects.toThrow(
      /no site-url route.*set-hostname https:\/\/example.org/,
    )
    const unregistered = fakeFetch([jsonResponse(409, {message: 'This site is not registered to a space yet'})])
    await expect(setSiteUrl(makeEnterpriseConfig(), {fetch: unregistered.fetchImpl})).rejects.toThrow(
      /HTTP 409.*bootstrap-space/,
    )
    const gone = fakeFetch(Array.from({length: BOOTSTRAP_ATTEMPTS}, () => new Error('ECONNREFUSED')))
    await expect(setSiteUrl(makeEnterpriseConfig(), {fetch: gone.fetchImpl, sleep: async () => {}})).rejects.toThrow(
      /site URL after 6 attempts: .*ECONNREFUSED/,
    )
    await expect(setSiteUrl(makeTestConfig(), {fetch: gone.fetchImpl})).rejects.toThrow(/enterprise/)
  })

  test('doctor compares the hostname with the home document siteUrl from /hm/api/site-url', () => {
    expect(siteUrlCheck({hostname: 'https://example.org'})).toEqual([])
    expect(siteUrlCheck({hostname: 'https://example.org', siteUrl: null})).toEqual([])
    expect(siteUrlCheck({hostname: 'https://example.org', siteUrl: 'https://example.org'})).toEqual([
      "  ✔ Site URL       the space's home document points at https://example.org",
    ])
    const drift = siteUrlCheck({hostname: 'https://new.example.org', siteUrl: 'https://example.org'})
    expect(drift[0]).toContain('points at https://example.org, the site is https://new.example.org')
    expect(drift[1]).toContain('set-hostname https://new.example.org')

    const shell = makeMockShell({
      'docker port seed-daemon': '',
      '/hm/api/config': '{"requireSignIn":true,"peerId":"12D3"}',
      '/hm/api/site-url': '{"hostname":"https://example.org","siteUrl":"https://old.example.org"}',
      '/vault/': '200',
      '"https://example.org/"': '302 https://example.org/hm/sign-in?next=%2F',
      '/hm/api/session': '401',
    })
    const out = enterpriseIsolationChecks(shell, makeEnterpriseConfig()).join('\n')
    expect(out).toContain('⚠ Site URL')
    expect(out).toContain('https://old.example.org')
  })
})
