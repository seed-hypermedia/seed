#!/usr/bin/env bun
/**
 * Seed Node Deployment Script
 *
 * Manages the full lifecycle of a self-hosted Seed node:
 * - Fresh install wizard (interactive prompts for first-time setup)
 * - Migration wizard (detects old installations and migrates config)
 * - Headless deployment engine (idempotent, safe to run via cron)
 *
 * The presence of config.json in the seed directory is the single marker
 * of the new deployment system. When it exists, the script runs headless.
 * When it doesn't, it runs the interactive wizard.
 *
 * The TOOL and the DATA are separate:
 *  - The deploy SCRIPT (this file) is installed once at a fixed path
 *    (DEPLOY_SCRIPT_PATH) and self-updates in place. One copy, always current.
 *  - A node's DATA/config lives in its own directory, chosen with `--dir`
 *    (default /opt/seed). The same script manages any node via `--dir`.
 * The wrapper and cron always pass `--dir <data-dir>`. Legacy installs that
 * placed the script inside the data dir still work: without `--dir` the data
 * dir falls back to the script's own directory.
 */

import * as p from '@clack/prompts'
import {readFile, writeFile, mkdir, access, stat, chmod} from 'node:fs/promises'
import {execSync, exec as execCb} from 'node:child_process'
import {createHash, randomBytes} from 'node:crypto'
import {homedir} from 'node:os'
import {join, basename, dirname} from 'node:path'

export const VERSION = '0.6.0'

/**
 * Fixed install path for the deploy SCRIPT (the tool). New installs place it
 * here and invoke it via the wrapper/cron with `--dir <data-dir>`. Keeping the
 * single script here — separate from any node's data — is what stops per-dir
 * script copies from going stale.
 */
export const DEPLOY_SCRIPT_PATH = '/usr/local/lib/seed/deploy.js'

/** Default node DATA directory when `--dir` is not passed. */
export const DEFAULT_DATA_DIR = '/opt/seed'

/**
 * The node data directory to operate on when `--dir` is absent.
 * - Running from the fixed tool path → default to /opt/seed (data lives apart).
 * - Legacy "script-in-data-dir" install → the script's own directory, so old
 *   wrappers/crons that pass no `--dir` keep resolving to their data.
 */
export const DEFAULT_SEED_DIR =
  dirname(process.argv[1] || '') === dirname(DEPLOY_SCRIPT_PATH) ? DEFAULT_DATA_DIR : dirname(process.argv[1] || '')
export const DEFAULT_REPO_URL = 'https://raw.githubusercontent.com/seed-hypermedia/seed/main'

// SEED_DEPLOY_URL points at the ops/ directory (matches deploy.sh convention).
// SEED_REPO_URL points at the repo root (legacy, kept for compatibility).
// Both resolve to the same ops/ base for fetching compose + deploy.js.
//
// getOpsBaseUrl() re-reads env vars at call time so that overrides set after
// module load (e.g. in tests) take effect. The OPS_BASE_URL constant is kept
// for backward compatibility with code that only needs the value at startup.
export function getOpsBaseUrl(): string {
  return (
    process.env.SEED_DEPLOY_URL ||
    (process.env.SEED_REPO_URL ? `${process.env.SEED_REPO_URL}/ops` : `${DEFAULT_REPO_URL}/ops`)
  )
}
export const OPS_BASE_URL = getOpsBaseUrl()

export const DEFAULT_COMPOSE_URL = `${OPS_BASE_URL}/docker-compose.yml`
/** The hosted notify service, served on hyper.media's own origin. */
export const NOTIFY_SERVICE_HOST = 'https://hyper.media/hm/api/notify'
/** The public node an enterprise web app asks for other spaces' content (see `upstream_api_url`). */
export const DEFAULT_UPSTREAM_API_URL = 'https://hyper.media'
/** Where the agents service answers on a site's own origin. */
export const AGENTS_API_PATH = '/hm/api/agents'
/** Where the notify service answers on a site's own origin. */
export const NOTIFY_API_PATH = '/hm/api/notify'
export const LIGHTNING_URL_MAINNET = 'https://ln.seed.hyper.media'
export const LIGHTNING_URL_TESTNET = 'https://ln.testnet.seed.hyper.media'

function currentDeployUrl(): string {
  return getOpsBaseUrl().replace(/\/+$/, '')
}

/** Compose template file name for a deploy profile. */
export function composeFileName(profile: DeployProfile = 'site'): string {
  return profile === 'enterprise' ? 'docker-compose.enterprise.yml' : 'docker-compose.yml'
}

function currentComposeUrl(profile: DeployProfile = 'site'): string {
  return `${currentDeployUrl()}/${composeFileName(profile)}`
}

function configuredDeployUrl(existing?: SeedConfig): string {
  if (process.env.SEED_DEPLOY_URL || process.env.SEED_REPO_URL) return currentDeployUrl()
  if (existing?.deploy_url) return existing.deploy_url.replace(/\/+$/, '')
  return currentDeployUrl()
}

function configuredComposeUrl(existing?: SeedConfig, profile: DeployProfile = 'site'): string {
  if (process.env.SEED_DEPLOY_URL || process.env.SEED_REPO_URL) return currentComposeUrl(profile)
  if (existing?.deploy_url) return `${existing.deploy_url.replace(/\/+$/, '')}/${composeFileName(profile)}`
  if (existing?.compose_url) return existing.compose_url
  return currentComposeUrl(profile)
}

// deploy.js distribution URLs.
// Production: attached as a GitHub Release asset on each tagged release.
// Dev: uploaded to S3 alongside dev Docker images on each main push.
export const GITHUB_RELEASES_API = 'https://api.github.com/repos/seed-hypermedia/seed/releases/latest'
export const DEV_DEPLOY_SCRIPT_URL = 'https://seedappdev.s3.eu-west-2.amazonaws.com/dev/latest/deploy.js'

/**
 * The deploy.js self-update source.
 *
 * A configured deploy source keeps fork-specific orchestration code aligned
 * with its compose file and images. Environment overrides take priority for
 * testing and branch builds. Nodes without a custom source use upstream S3.
 */
export function getDeployScriptUrl(deployUrl?: string): string {
  if (process.env.SEED_DEPLOY_URL || process.env.SEED_REPO_URL) {
    return `${getOpsBaseUrl()}/dist/deploy.js`
  }
  if (deployUrl) {
    return `${deployUrl.replace(/\/+$/, '')}/dist/deploy.js`
  }
  return DEV_DEPLOY_SCRIPT_URL
}

// The bootstrap curl command. Used in user-facing hints when the seed-deploy
// CLI wrapper could not be installed to /usr/local/bin.
export const CURL_INSTALL_CMD = `curl -fsSL ${DEFAULT_REPO_URL}/ops/deploy.sh | sh`

/** Whether the shell wrapper was installed by deploy.sh. */
export const CLI_INSTALLED = process.env.SEED_DEPLOY_CLI_INSTALLED !== '0'

/**
 * Return a user-facing command string. When the `seed-deploy` CLI wrapper is
 * available, returns e.g. `seed-deploy doctor`. Otherwise returns the
 * equivalent curl one-liner with `sh -s -- doctor`.
 */
export function cmd(subcommand?: string): string {
  if (CLI_INSTALLED) {
    return subcommand ? `seed-deploy ${subcommand}` : 'seed-deploy'
  }
  if (subcommand) {
    return `${CURL_INSTALL_CMD} -s -- ${subcommand}`
  }
  return CURL_INSTALL_CMD
}

// ---------------------------------------------------------------------------
// Configurable paths — allows tests to inject a temp directory
// ---------------------------------------------------------------------------

export interface DeployPaths {
  seedDir: string
  configPath: string
  composePath: string
  deployLog: string
}

export function makePaths(seedDir: string = DEFAULT_SEED_DIR): DeployPaths {
  return {
    seedDir,
    configPath: join(seedDir, 'config.json'),
    composePath: join(seedDir, 'docker-compose.yml'),
    deployLog: join(seedDir, 'deploy.log'),
  }
}

// ---------------------------------------------------------------------------
// Shell command abstraction — allows tests to inject mocks
// ---------------------------------------------------------------------------

/** Default timeout for short one-shot shell commands. */
export const DEFAULT_EXEC_TIMEOUT_MS = 120_000

/**
 * Timeout for docker image transfers (`pull` / `up --quiet-pull`). The full
 * site+web image set is ~900 MB; the old 120s default SIGKILLed the pull
 * mid-download on ordinary links, and that error was swallowed — so the node
 * silently stalled on stale images forever. Kept under the 10-minute cron
 * interval so a slow pull can't overlap the next scheduled run.
 */
export const IMAGE_PULL_TIMEOUT_MS = 8 * 60_000

export interface ShellRunner {
  run(cmd: string): string
  runSafe(cmd: string): string | null
  exec(cmd: string, timeoutMs?: number): Promise<{stdout: string; stderr: string}>
}

export function makeShellRunner(): ShellRunner {
  return {
    run(cmd: string): string {
      return execSync(cmd, {encoding: 'utf-8', timeout: 30_000}).trim()
    },
    runSafe(cmd: string): string | null {
      try {
        return this.run(cmd)
      } catch {
        return null
      }
    },
    exec(cmd: string, timeoutMs = DEFAULT_EXEC_TIMEOUT_MS): Promise<{stdout: string; stderr: string}> {
      return new Promise((resolve, reject) => {
        execCb(cmd, {timeout: timeoutMs}, (err, stdout, stderr) => {
          if (err) {
            // child_process passes the command's output as separate args even
            // on failure, but they're lost if we reject with `err` alone. Fold
            // the real output into the message so callers (and the deploy log)
            // see the actual reason — e.g. an unknown image manifest, or a pull
            // timeout — instead of just "Command failed: <cmd>".
            const killed = (err as {killed?: boolean}).killed
            const detail = stderr.toString().trim() || stdout.toString().trim()
            if (killed) err.message = `${err.message} (killed after ${Math.round(timeoutMs / 1000)}s timeout)`
            if (detail) err.message = `${err.message}\n${detail}`
            reject(err)
          } else
            resolve({
              stdout: stdout.toString().trim(),
              stderr: stderr.toString().trim(),
            })
        })
      })
    },
  }
}

/**
 * Verify that the current user can reach the Docker daemon.
 * Called before any Docker-dependent command so the user gets
 * an immediate, actionable error instead of a cryptic failure
 * minutes later (e.g. after completing the setup wizard).
 */
function checkDockerAccess(shell: ShellRunner): void {
  if (shell.runSafe('docker info >/dev/null 2>&1') === null) {
    throw new Error(
      [
        'Cannot connect to Docker. Ensure Docker is installed and your user',
        'has permission to access the Docker socket.',
        '',
        '  Fix: sudo usermod -aG docker $USER',
        '  Then log out and back in, or run: newgrp docker',
      ].join('\n'),
    )
  }
}

/**
 * Deploy profiles.
 *  - `site` (default): a public site on the Seed P2P network.
 *  - `enterprise`: a single-tenant, web-only stack with no P2P connectivity,
 *    an invite-only identity vault and a sign-in gate on every page.
 */
export type DeployProfile = 'site' | 'enterprise'

export const DEPLOY_PROFILES: readonly DeployProfile[] = ['site', 'enterprise'] as const

/** SMTP settings shared by the vault and the notify service (enterprise profile). */
export interface SmtpConfig {
  host: string
  /**
   * STARTTLS port for the vault's and notify's mailers (default 587).
   */
  port?: number
  user: string
  password: string
  /** Sender address, e.g. "Seed <seed@example.org>" */
  sender: string
}

/** The hosting service's email relay: `POST url` with `Authorization: Bearer token`. */
export interface EmailRelayConfig {
  url: string
  token: string
}

export interface SeedConfig {
  /** Deploy profile; absent means `site`. */
  profile?: DeployProfile
  /** Public hostname for this node, e.g. "https://node1.seed.run" */
  domain: string
  /** Contact email — used to reach the operator about security updates */
  email: string
  /** URL to fetch deploy assets from, usually the raw GitHub ops directory */
  deploy_url?: string
  /** URL to fetch the docker-compose.yml from */
  compose_url: string
  /** SHA-256 of the last deployed docker-compose.yml — used to detect changes */
  compose_sha: string
  /** SHA-256 of the last deployed compose env vars — detects config changes */
  compose_env_sha?: string
  /** Environment variables passed through to compose services */
  compose_envs: {
    LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error'
  }
  /**
   * Deployment environment label. Cosmetic/derived only — it is kept in sync
   * with `testnet` (`dev` ⇒ testnet, `prod` ⇒ mainnet) for display and
   * backwards compatibility. It does NOT independently control the network.
   */
  environment: 'dev' | 'prod'
  /**
   * Docker image tag to pull: "latest" for stable, "dev" for main branch.
   * Orthogonal to `testnet`: the image channel never changes the P2P network.
   */
  release_channel: 'latest' | 'dev' | string
  /** Full Docker image ref for the web service; overrides release_channel when set */
  web_image?: string
  /** Full Docker image ref for the daemon/site service; overrides release_channel when set */
  site_image?: string
  /**
   * Whether to connect to the testnet (devnet) P2P network instead of mainnet.
   * This is the sole source of truth for the network and is chosen explicitly
   * by the operator — never inferred from the image tag / release channel.
   */
  testnet: boolean
  /** Random secret used for the initial site registration URL */
  link_secret: string
  /** Whether to enable Plausible.io web analytics for this site */
  analytics: boolean
  /** Whether this node acts as a public gateway serving all known content */
  gateway: boolean
  /** ISO 8601 timestamp of the last successful deployment */
  last_script_run: string

  // --- enterprise profile only ---

  /** Bearer secret for the vault's admin API (`seed-deploy invite`). Random, 32+ chars. */
  vault_admin_secret?: string
  /** HMAC secret the web app signs its session cookie with. Random, 48+ chars. */
  session_secret?: string
  /**
   * Lets the box's own services (the agents service) past the sign-in gate:
   * they read the site server-side with no session. Random, 48+ chars.
   */
  service_secret?: string
  /**
   * Mainnet node whose public HTTP API answers reads of other spaces (embeds of external
   * documents, the agents' guide) that the isolated daemon cannot have. Unset means
   * DEFAULT_UPSTREAM_API_URL; '' turns it off and keeps every read on the box.
   */
  upstream_api_url?: string
  /** Run the notify (email) service, served by the site itself under /hm/api/notify. */
  notify?: boolean
  /** SMTP settings for the vault and notify; required when `notify` is on and there is no email relay. */
  smtp?: SmtpConfig
  /**
   * The Seed hosting service's HTTPS email relay. With it the vault and notify
   * send through the relay instead of SMTP, so the instance needs no SMTP
   * account of its own.
   */
  email_relay_url?: string
  /** Bearer token for the email relay. */
  email_relay_token?: string
  /**
   * Run the agents service, served by the site itself under /hm/api/agents
   * (members only on an enterprise node). Any profile.
   */
  agents?: boolean
  /** Pass /dev/kvm to the agents container so sandboxed code execution works. */
  agents_kvm?: boolean
  /** Run the Prometheus + Grafana `metrics` compose profile. */
  metrics?: boolean
  /** Display name of the organization's space; the bare hostname by default. */
  site_name?: string
  /** Account of the organization's space once the first deploy created it. */
  owner_account_uid?: string
  /**
   * Earlier hostnames of an enterprise node (bare DNS names). Each keeps its
   * own certificate and redirects to `domain`, so the managed address a
   * hosting service gave the node still works after a custom domain is set.
   */
  redirect_hostnames?: string[]
}

/**
 * Hostnames that redirect to the node's current one: the earlier addresses
 * of an enterprise node, minus the current one and duplicates.
 */
export function redirectHostnames(config: Pick<SeedConfig, 'domain' | 'redirect_hostnames'>): string[] {
  const current = extractDns(config.domain).toLowerCase()
  return [...new Set((config.redirect_hostnames ?? []).map((h) => extractDns(h).toLowerCase()).filter(Boolean))].filter(
    (h) => h !== current,
  )
}

/**
 * `redirect_hostnames` for a (re)configured enterprise node: what the existing
 * config already had, plus its hostname when the new one differs, so a
 * reconfiguration keeps the old address reachable just like `set-hostname`.
 */
function enterpriseRedirects(domain: string, existing?: SeedConfig): Pick<SeedConfig, 'redirect_hostnames'> {
  const previous = existing && extractDns(existing.domain) !== extractDns(domain) ? [extractDns(existing.domain)] : []
  const list = redirectHostnames({domain, redirect_hostnames: [...(existing?.redirect_hostnames ?? []), ...previous]})
  return list.length ? {redirect_hostnames: list} : {}
}

/** Whether the config selects the enterprise profile. */
export function isEnterprise(config: Pick<SeedConfig, 'profile'>): boolean {
  return config.profile === 'enterprise'
}

/** Compose profiles to activate for a config (via COMPOSE_PROFILES). */
export function composeProfiles(config: SeedConfig): string[] {
  const profiles: string[] = []
  if (isEnterprise(config) && config.notify) profiles.push('notify')
  if (config.agents) profiles.push('agents')
  if (config.metrics) profiles.push('metrics')
  return profiles
}

/**
 * Public base URL of the notify service, or '' when it is not deployed. Site
 * nodes use the hosted one; an enterprise node serves its own on the site's
 * origin under /hm/api/notify, so it needs no second hostname.
 */
export function notifyHost(config: SeedConfig): string {
  if (!isEnterprise(config)) return NOTIFY_SERVICE_HOST
  return config.notify ? `https://${extractDns(config.domain)}${NOTIFY_API_PATH}` : ''
}

/**
 * Public base URL of the agents service, or '' when it is not deployed. It is
 * the site itself under /hm/api/agents; on an enterprise node that path sits
 * behind the same sign-in gate, so agents are for members only.
 */
export function agentsHost(config: SeedConfig): string {
  if (!config.agents) return ''
  return `https://${extractDns(config.domain)}${AGENTS_API_PATH}`
}

/**
 * The private P2P network name for an enterprise node. Derived from the DNS
 * name so two enterprise boxes can never accidentally share a testnet.
 */
export function enterpriseTestnetName(domain: string): string {
  return `ent-${extractDns(domain).replace(/[^A-Za-z0-9-]+/g, '-')}`
}

/**
 * Derives testnet flag from the environment label.
 */
export function environmentPresets(env: SeedConfig['environment']): {
  testnet: boolean
} {
  switch (env) {
    case 'dev':
      return {testnet: true}
    case 'prod':
    default:
      return {testnet: false}
  }
}

/**
 * Operator-facing warnings for config combinations that are easy to set
 * unintentionally and have caused confusion. These are notices, not errors —
 * the configuration is honored as-is. The two cases:
 *  - on testnet/devnet (often set by accident), so the node never sees mainnet;
 *  - tracking a non-stable image channel on mainnet, which churns images but,
 *    importantly, does NOT change the network (a common misconception).
 */
export function configWarnings(config: SeedConfig): string[] {
  const warnings: string[] = []
  if (isEnterprise(config)) {
    // No public network to be on by mistake; only the image channel matters.
    if (config.release_channel !== 'latest') {
      warnings.push(
        `Tracking the '${config.release_channel}' image channel (bleeding-edge images). ` +
          `On this channel the node updates only when '${cmd(
            'deploy',
          )}' is run by hand; on 'latest' it follows releases automatically.`,
      )
    }
    return warnings
  }
  if (config.testnet) {
    warnings.push(
      'This node is on the TESTNET (devnet) P2P network — it will NOT see or sync mainnet content. ' +
        `If this is a production site, run '${cmd('deploy --reconfigure')}' and choose Mainnet.`,
    )
  }
  if (!config.testnet && config.release_channel !== 'latest') {
    warnings.push(
      `Tracking the '${config.release_channel}' image channel on mainnet (bleeding-edge images, stable network). ` +
        'New images here update the code only — they never change your P2P network.',
    )
  }
  return warnings
}

/** Default release channel when none is stored. Independent of environment. */
export const DEFAULT_RELEASE_CHANNEL = 'latest'

const CUSTOM_RELEASE_CHANNEL = '__custom__'

function isPresetReleaseChannel(channel: string | null | undefined): channel is 'latest' | 'dev' {
  return channel === 'latest' || channel === 'dev'
}

/** Validate a Docker image tag entered at the setup/reconfigure boundary. */
export function validateDockerImageTag(tag: string): string | undefined {
  if (!tag) return 'Required'
  if (tag.trim() !== tag) return 'Remove leading or trailing spaces'
  if (tag.length > 128) return 'Must be 128 characters or fewer'
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(tag)) {
    return 'Use a Docker image tag: letters, numbers, _, . or -; must start with a letter, number or _'
  }
}

/** Validate an optional full Docker image reference entered at the setup/reconfigure boundary. */
export function validateDockerImageRef(ref: string): string | undefined {
  if (!ref) return undefined
  if (ref.trim() !== ref) return 'Remove leading or trailing spaces'
  if (/\s/.test(ref)) return 'Docker image refs cannot contain spaces'

  const lastSlash = ref.lastIndexOf('/')
  const lastColon = ref.lastIndexOf(':')
  if (lastColon <= lastSlash) return 'Include an explicit image tag, for example ghcr.io/horacioh/seed-web:main'

  const name = ref.slice(0, lastColon)
  const tag = ref.slice(lastColon + 1)
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(name) || name.includes('://')) {
    return 'Use a Docker image ref such as ghcr.io/horacioh/seed-web:main'
  }

  const tagError = validateDockerImageTag(tag)
  if (tagError) return `Invalid image tag: ${tagError}`
}

async function promptReleaseChannel(options: {
  initialTag: string | null | undefined
  advanced: boolean
}): Promise<string | symbol> {
  const initialTag = options.initialTag ?? DEFAULT_RELEASE_CHANNEL
  const hasCustomTag = !isPresetReleaseChannel(initialTag)
  // The custom-tag option is an advanced escape hatch (branch/test builds).
  // Only show it in --advanced mode, or when the node is already on a custom
  // tag (so a plain reconfigure never silently drops it).
  const showCustom = options.advanced || hasCustomTag
  const channelOptions = [
    {
      value: 'latest',
      label: 'Stable',
      hint: 'official releases, recommended for production',
    },
    {
      value: 'dev',
      label: 'Bleeding edge',
      hint: 'main branch builds, may be unstable',
    },
  ]
  if (showCustom) {
    channelOptions.push({
      value: CUSTOM_RELEASE_CHANNEL,
      label: 'Custom tag',
      hint: 'run images from a specific Docker tag or branch build',
    })
  }
  const selected = await p.select<string>({
    message: 'Release channel',
    initialValue: hasCustomTag ? CUSTOM_RELEASE_CHANNEL : initialTag,
    options: channelOptions,
  })

  if (p.isCancel(selected) || selected !== CUSTOM_RELEASE_CHANNEL) {
    return selected
  }

  return p.text({
    message: 'Custom Docker image tag',
    initialValue: hasCustomTag ? initialTag : undefined,
    // The placeholder is also what Tab fills in, so it must be the node's
    // current tag whenever one exists — never a made-up example over it.
    placeholder: hasCustomTag ? initialTag : 'feature-branch',
    validate: validateDockerImageTag,
  })
}

export async function configExists(paths: DeployPaths): Promise<boolean> {
  try {
    await access(paths.configPath)
    return true
  } catch {
    return false
  }
}

export async function readConfig(paths: DeployPaths): Promise<SeedConfig> {
  const raw = await readFile(paths.configPath, 'utf-8')
  return JSON.parse(raw) as SeedConfig
}

export async function writeConfig(config: SeedConfig, paths: DeployPaths): Promise<void> {
  await mkdir(paths.seedDir, {recursive: true})
  await writeFile(paths.configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

export function generateSecret(length = 10): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = randomBytes(length)
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('')
}

export function log(msg: string): void {
  const ts = new Date().toISOString()
  if (!process.stdout.isTTY) {
    console.log(`[${ts}] ${msg}`)
  }
}

const RESUME_HINT = `\nRun '${cmd()}' to resume installation at any time.\n`
const MANAGE_HINT = `Manage your node anytime with '${cmd()}'. Run '${cmd('--help')}' for options.`

// ---------------------------------------------------------------------------
// Old installation detection
// ---------------------------------------------------------------------------

export interface OldInstallInfo {
  workspace: string
  secret: string | null
  /** True when the old config.json exists but the secret field was already consumed (node registered). */
  secretConsumed: boolean
  hostname: string | null
  logLevel: string | null
  imageTag: string | null
  testnet: boolean
  gateway: boolean
  trafficStats: boolean
}

/**
 * Infer the network label from the old installation's state.
 *
 * The network is inferred SOLELY from the previously detected testnet setting.
 * It must never be inferred from the image tag: running the `dev` image channel
 * on mainnet is a legitimate setup, and treating `imageTag === 'dev'` as
 * "devnet" silently moved production sites onto the testnet during migration.
 */
export function inferEnvironment(old: OldInstallInfo): 'prod' | 'dev' {
  return old.testnet ? 'dev' : 'prod'
}

export function parseDaemonEnv(envJson: string): {
  logLevel: string | null
  testnet: boolean
} {
  let logLevel: string | null = null
  let testnet = false
  try {
    const envs: string[] = JSON.parse(envJson)
    for (const e of envs) {
      if (e.startsWith('SEED_LOG_LEVEL=')) logLevel = e.split('=')[1]
      if (e.startsWith('SEED_P2P_TESTNET_NAME=') && e.split('=')[1]) testnet = true
    }
  } catch {
    // invalid JSON from docker inspect — skip
  }
  return {logLevel, testnet}
}

export function parseWebEnv(envJson: string): {
  hostname: string | null
  gateway: boolean
  trafficStats: boolean
} {
  let hostname: string | null = null
  let gateway = false
  let trafficStats = false
  try {
    const envs: string[] = JSON.parse(envJson)
    for (const e of envs) {
      if (e.startsWith('SEED_BASE_URL=')) hostname = e.split('=')[1]
      if (e.startsWith('SEED_IS_GATEWAY=true')) gateway = true
      if (e.startsWith('SEED_ENABLE_STATISTICS=true')) trafficStats = true
    }
  } catch {
    // invalid JSON from docker inspect — skip
  }
  return {hostname, gateway, trafficStats}
}

/** Extract image tag from a Docker image string, e.g. "seedhypermedia/web:latest" -> "latest" */
export function parseImageTag(imageStr: string): string {
  const parts = imageStr.split(':')
  return parts.length > 1 ? parts[parts.length - 1] : 'latest'
}

export async function detectOldInstall(shell: ShellRunner): Promise<OldInstallInfo | null> {
  const home = homedir()
  const candidates = [join(home, '.seed-site'), '/shm/gateway', '/shm']

  let workspace: string | null = null
  for (const dir of candidates) {
    try {
      await access(dir)
      workspace = dir
      break
    } catch {
      // not found, try next
    }
  }

  const hasContainers = shell.runSafe("docker ps --format '{{.Names}}' 2>/dev/null | grep -q seed")
  if (!workspace && hasContainers === null) {
    return null
  }

  if (!workspace) {
    workspace = join(home, '.seed-site')
  }

  let secret: string | null = null
  let secretConsumed = false
  const secretPaths = [
    join(workspace, 'web', 'config.json'),
    '/shm/gateway/web/config.json',
    join(home, '.seed-site', 'web', 'config.json'),
  ]
  for (const sp of secretPaths) {
    try {
      const raw = await readFile(sp, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed.availableRegistrationSecret) {
        secret = parsed.availableRegistrationSecret
        break
      }
      // Config exists but secret is missing — it was consumed during registration.
      if (parsed.registeredAccountUid || parsed.sourcePeerId) {
        secretConsumed = true
      }
    } catch {
      // try next
    }
  }

  let hostname: string | null = null
  let logLevel: string | null = null
  let imageTag: string | null = null
  let testnet = false
  let gateway = false
  let trafficStats = false

  const daemonEnv = shell.runSafe("docker inspect seed-daemon --format '{{json .Config.Env}}' 2>/dev/null")
  if (daemonEnv) {
    const parsed = parseDaemonEnv(daemonEnv)
    logLevel = parsed.logLevel
    testnet = parsed.testnet
  }

  const webEnv = shell.runSafe("docker inspect seed-web --format '{{json .Config.Env}}' 2>/dev/null")
  if (webEnv) {
    const parsed = parseWebEnv(webEnv)
    hostname = parsed.hostname
    gateway = parsed.gateway
    trafficStats = parsed.trafficStats
  }

  const webImage = shell.runSafe("docker inspect seed-web --format '{{.Config.Image}}' 2>/dev/null")
  if (webImage) {
    imageTag = parseImageTag(webImage)
  }

  return {
    workspace,
    secret,
    secretConsumed,
    hostname,
    logLevel,
    imageTag,
    testnet,
    gateway,
    trafficStats,
  }
}

// ---------------------------------------------------------------------------
// Legacy / orphan container cleanup
// ---------------------------------------------------------------------------

/** Host ports the new compose stack publishes. Kept in sync with docker-compose.yml. */
export const SEED_PUBLISHED_PORTS = [80, 443, 3000, 56000] as const

/** Watchtower-style autoupdater images shipped by older installs. */
export const LEGACY_AUTOUPDATER_IMAGES = ['containrrr/watchtower', 'v2tec/watchtower'] as const

/**
 * Container names the new compose stack creates (and that legacy installs
 * created with `docker run --name`). Used to evict stopped non-compose
 * leftovers that would otherwise trigger a "name already in use" conflict
 * when compose tries to recreate them.
 */
export const LEGACY_CONTAINER_NAMES = [
  'seed-site',
  'seed-daemon',
  'seed-web',
  'seed-proxy',
  'seed-vault',
  'seed-notify',
  'seed-agents',
  'autoupdater',
  'prometheus',
  'grafana',
] as const

/** Compute the docker compose project name for the configured seed dir. */
export function composeProjectName(paths: DeployPaths): string {
  return basename(paths.seedDir).toLowerCase()
}

/**
 * Remove any container running a watchtower-style autoupdater image.
 * The new deploy system manages updates via cron; a leftover watchtower
 * would race the deploy by recreating legacy containers (under their old
 * non-compose identity) in response to image pulls, re-binding our P2P
 * port outside compose's tracking. Returns the IDs of removed containers.
 */
export function removeLegacyAutoupdaters(shell: ShellRunner): string[] {
  const filters = LEGACY_AUTOUPDATER_IMAGES.map((img) => `--filter "ancestor=${img}"`).join(' ')
  const out = shell.runSafe(`docker ps -aq ${filters} 2>/dev/null`)
  if (!out) return []
  const ids = out.split('\n').filter(Boolean)
  for (const id of ids) {
    shell.runSafe(`docker rm -f ${id} 2>/dev/null`)
  }
  if (ids.length > 0) {
    log(`Removed ${ids.length} legacy autoupdater container(s).`)
  }
  return ids
}

/**
 * Remove non-compose-managed containers that conflict with our stack —
 * either by publishing one of our ports or by carrying one of our
 * well-known container names. Containers that already belong to our
 * compose project are left alone (compose's own update path handles them
 * with a zero-downtime swap), so this is a true no-op on healthy re-runs
 * and a takeover for legacy or orphan containers. Returns removed IDs.
 */
export function freeConflictingPortBindings(shell: ShellRunner, projectName: string): string[] {
  const portFilters = SEED_PUBLISHED_PORTS.map((p) => `--filter "publish=${p}"`).join(' ')
  const portOut = shell.runSafe(`docker ps -aq ${portFilters} 2>/dev/null`) ?? ''

  const nameFilters = LEGACY_CONTAINER_NAMES.map((n) => `--filter "name=^${n}$"`).join(' ')
  const nameOut = shell.runSafe(`docker ps -aq ${nameFilters} 2>/dev/null`) ?? ''

  const allIds = Array.from(new Set([...portOut.split('\n').filter(Boolean), ...nameOut.split('\n').filter(Boolean)]))

  const removed: string[] = []
  for (const id of allIds) {
    const proj = shell.runSafe(
      `docker inspect ${id} --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null`,
    )
    if (proj === projectName) continue
    shell.runSafe(`docker rm -f ${id} 2>/dev/null`)
    removed.push(id)
  }
  if (removed.length > 0) {
    log(`Removed ${removed.length} legacy/orphan container(s) holding our published ports or names.`)
  }
  return removed
}

/**
 * Strip lines installed by the legacy `website_deployment.sh` from a
 * crontab string. Recognized markers: the script path itself and the
 * `# website-deploy` comment marker some variants used.
 */
export function removeLegacyHostCronLines(existing: string): string {
  const filtered = existing
    .split('\n')
    .filter((line) => !line.includes('website_deployment.sh') && !line.includes('# website-deploy'))
    .join('\n')
    .trim()
  return filtered ? filtered + '\n' : ''
}

/**
 * Install a cleaned crontab if the legacy `website_deployment.sh` lines
 * were present. No-op (returns false) when no legacy markers are found.
 */
export function removeLegacyHostCron(shell: ShellRunner): boolean {
  const existing = shell.runSafe('crontab -l 2>/dev/null') ?? ''
  if (!existing.includes('website_deployment.sh') && !existing.includes('# website-deploy')) {
    return false
  }
  const cleaned = removeLegacyHostCronLines(existing)
  try {
    shell.run(`echo '${cleaned}' | crontab -`)
    log('Removed legacy website_deployment.sh cron entries.')
    return true
  } catch (err) {
    log(`Warning: failed to remove legacy cron entries: ${err}`)
    return false
  }
}

/**
 * Detect a "Bind for 0.0.0.0:<port> failed" error from `docker compose up`
 * and produce a user-friendly remediation message. Returns null when the
 * error doesn't match the bind-failure pattern.
 */
export function describeBindFailure(errMsg: string): string | null {
  const match = errMsg.match(/Bind for 0\.0\.0\.0:(\d+) failed/)
  if (!match) return null
  const port = match[1]
  return [
    `Port ${port} is held by a non-Docker process.`,
    `Likely a leftover seed-daemon binary or systemd unit from an old installation.`,
    `Run \`ss -lntup '( sport = :${port} )'\` to identify it,`,
    `then stop it and re-run \`${cmd('deploy')}\`.`,
  ].join(' ')
}

/**
 * Detect a missing/inaccessible image error from `docker compose pull/up`
 * (manifest unknown, not found, access denied) and produce a user-friendly
 * message naming the release channel that couldn't be pulled. Returns null
 * when the error doesn't match a pull-failure pattern.
 */
export function describePullFailure(errMsg: string, releaseChannel: string): string | null {
  const isPullFailure =
    /manifest\s+(?:for\s+\S+\s+)?(?:unknown|not found)/i.test(errMsg) ||
    /not found:\s*manifest/i.test(errMsg) ||
    /repository .* not found|pull access denied|requested access to the resource is denied/i.test(errMsg) ||
    /Error response from daemon:.*(no such image|manifest)/i.test(errMsg)
  if (!isPullFailure) return null
  return [
    `Could not pull the '${releaseChannel}' images from the registry.`,
    `Both seedhypermedia/web:${releaseChannel} and seedhypermedia/site:${releaseChannel} must exist and be public.`,
    `Check the tag is correct (and that a build was pushed for it), or run \`${cmd('deploy --reconfigure')}\``,
    `and pick the Stable channel.`,
  ].join(' ')
}

// ---------------------------------------------------------------------------
// Data Migration
// ---------------------------------------------------------------------------

/**
 * Copies daemon/ and web/ data from an old installation into the current seed
 * directory. Only copies when the target directory is empty — if it already has
 * data this is a no-op. Called from deploy() so it works on both first-time
 * migration and subsequent headless runs.
 */
async function migrateDataFromOldInstall(paths: DeployPaths, shell: ShellRunner): Promise<void> {
  const oldInstall = await detectOldInstall(shell)
  if (!oldInstall || oldInstall.workspace === paths.seedDir) return

  // Always sweep legacy host cron + watchtower when an old install is
  // detected, even when data has already been migrated. Either would
  // otherwise relaunch legacy containers on its own schedule and re-bind
  // our published ports under non-compose identities.
  removeLegacyHostCron(shell)
  removeLegacyAutoupdaters(shell)

  // Check if the daemon dir is empty — if it already has data, migration
  // already happened (or the node was set up fresh). The daemon dir is the
  // most reliable indicator since it's never pre-populated by the deploy script.
  const daemonDir = join(paths.seedDir, 'daemon')
  const daemonEmpty = shell.runSafe(`find "${daemonDir}" -mindepth 1 -maxdepth 1 2>/dev/null | head -1`) === ''
  if (!daemonEmpty) return

  log('Stopping old containers before migrating data...')
  freeConflictingPortBindings(shell, composeProjectName(paths))

  // Copy all contents from old workspace into the new seed directory.
  // This preserves daemon identity, web state, proxy TLS certs, monitoring, etc.
  log(`Copying ${oldInstall.workspace} → ${paths.seedDir} ...`)
  if (!shell.runSafe(`cp -a "${oldInstall.workspace}/." "${paths.seedDir}/" 2>/dev/null`)) {
    shell.run(`sudo cp -a "${oldInstall.workspace}/." "${paths.seedDir}/"`)
  }
  log('Migrated all data from old installation.')

  // Fix file ownership on the web directory — old installs used UID 1001
  // (hardcoded in previous Dockerfile), but the new compose runs as host user.
  const webDir = join(paths.seedDir, 'web')
  const currentUid = String(process.getuid!())
  const currentGid = String(process.getgid!())
  const owner = shell.runSafe(`stat -c '%u:%g' "${webDir}" 2>/dev/null`)
  if (owner && owner !== `${currentUid}:${currentGid}`) {
    log(`Updating ownership of ${webDir} from ${owner} to ${currentUid}:${currentGid}`)
    if (!shell.runSafe(`chown -R ${currentUid}:${currentGid} "${webDir}" 2>/dev/null`)) {
      shell.runSafe(`sudo chown -R ${currentUid}:${currentGid} "${webDir}"`)
    }
  }
}

// ---------------------------------------------------------------------------
// Migration Wizard
// ---------------------------------------------------------------------------

async function runMigrationWizard(
  old: OldInstallInfo,
  paths: DeployPaths,
  shell: ShellRunner,
  advanced = false,
): Promise<SeedConfig> {
  p.intro(`Seed Node Migration v${VERSION}`)

  p.note(
    [
      `Detected an existing Seed installation at: ${old.workspace}`,
      '',
      "We'll import your current settings and migrate to the new deployment system.",
      `After migration, your node will be managed from ${paths.seedDir}/ and updated via cron.`,
      '',
      'Please review and confirm the detected values below.',
    ].join('\n'),
    'Existing installation found',
  )

  const answers = await p.group(
    {
      domain: () =>
        p.text({
          message: 'Public hostname (including https://)',
          placeholder: old.hostname || 'https://node1.seed.run',
          validate: (v) => {
            if (!v) return 'Required'
            if (!v.startsWith('https://') && !v.startsWith('http://')) return 'Must start with https:// or http://'
          },
        }),
      network: () =>
        p.select({
          message: 'P2P network',
          initialValue: inferEnvironment(old) === 'dev' ? 'testnet' : 'mainnet',
          options: [
            {
              value: 'mainnet',
              label: 'Mainnet',
              hint: 'the public Seed network — recommended for production',
            },
            {
              value: 'testnet',
              label: 'Testnet (devnet)',
              hint: 'isolated development network; will NOT see mainnet content',
            },
          ],
        }),
      release_channel: () =>
        promptReleaseChannel({
          initialTag: old.imageTag,
          advanced,
        }),
      web_image: () =>
        p.text({
          message: 'Full web image ref (optional)',
          placeholder: 'ghcr.io/horacioh/seed-web:main',
          validate: validateDockerImageRef,
        }),
      site_image: () =>
        p.text({
          message: 'Full site/daemon image ref (optional)',
          placeholder: 'ghcr.io/horacioh/seed-site:main',
          validate: validateDockerImageRef,
        }),
      log_level: () =>
        p.select({
          message: 'Log level',
          initialValue: old.logLevel ?? 'info',
          options: [
            {
              value: 'debug',
              label: 'Debug',
              hint: 'verbose, useful for troubleshooting',
            },
            {
              value: 'info',
              label: 'Info',
              hint: 'standard operational logging',
            },
            {value: 'warn', label: 'Warn', hint: 'only warnings and errors'},
            {value: 'error', label: 'Error', hint: 'only errors'},
          ],
        }),
      gateway: () =>
        p.confirm({
          message: 'Run as public gateway?',
          initialValue: old.gateway,
        }),
      email: () =>
        p.text({
          message: 'Contact email (optional) — lets us notify you about security updates. Not shared publicly.',
          placeholder: 'you@example.com',
          validate: (v) => {
            if (v && !v.includes('@')) return 'Must be a valid email'
          },
        }),
    },
    {
      onCancel: () => {
        p.cancel('Migration cancelled.')
        console.log(RESUME_HINT)
        process.exit(0)
      },
    },
  )

  const secret = old.secret ?? generateSecret()
  if (old.secret) {
    p.log.success(`Registration secret imported from existing installation.`)
  } else if (old.secretConsumed) {
    p.log.info(`Node is already registered (secret was consumed). Generated a new secret for future registrations.`)
  } else {
    p.log.warn(`No existing registration secret found. Generated a new one.`)
  }

  const testnet = answers.network === 'testnet'
  const env: SeedConfig['environment'] = testnet ? 'dev' : 'prod'

  const config: SeedConfig = {
    domain: answers.domain as string,
    email: (answers.email as string) || '',
    deploy_url: currentDeployUrl(),
    compose_url: currentComposeUrl(),
    compose_sha: '',
    compose_env_sha: '',
    compose_envs: {
      LOG_LEVEL: answers.log_level as SeedConfig['compose_envs']['LOG_LEVEL'],
    },
    environment: env,
    release_channel: answers.release_channel as string,
    web_image: (answers.web_image as string) || undefined,
    site_image: (answers.site_image as string) || undefined,
    testnet,
    link_secret: secret,
    analytics: old.trafficStats,
    gateway: answers.gateway as boolean,
    last_script_run: '',
  }

  const summary = Object.entries(config)
    .filter(([k]) => k !== 'analytics')
    .map(([k, v]) => `  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\n')
  p.note(summary, 'Configuration summary')

  const confirmed = await p.confirm({
    message: 'Write config and proceed with deployment?',
  })

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Migration cancelled.')
    console.log(RESUME_HINT)
    process.exit(0)
  }

  await writeConfig(config, paths)
  p.log.success(`Config written to ${paths.configPath}`)

  return config
}

// ---------------------------------------------------------------------------
// Fresh Install Wizard
// ---------------------------------------------------------------------------

async function runFreshWizard(paths: DeployPaths, existing?: SeedConfig, advanced = false): Promise<SeedConfig> {
  const isReconfig = !!existing
  p.intro(isReconfig ? `Seed Node Reconfiguration v${VERSION}` : `Seed Node Setup v${VERSION}`)

  if (!isReconfig) {
    p.note(
      [
        'Welcome! This wizard will configure your new Seed node.',
        '',
        'Seed is a peer-to-peer hypermedia publishing system. This script sets up',
        'the Docker containers, reverse proxy, and networking so your node is',
        'reachable on the public internet.',
        '',
        `This node's install location is ${paths.seedDir}/ (config + data live here).`,
        'Subsequent runs of this script will deploy automatically (headless mode).',
      ].join('\n'),
      'First-time setup',
    )
  } else {
    p.note(
      [
        'Editing your current configuration. Each prompt shows the current value — press Enter to keep it. Grey suggestions fill in with Tab.',
        '',
        `Configuration: ${paths.configPath}`,
      ].join('\n'),
      'Reconfiguration',
    )
  }

  const answers = await p.group(
    {
      domain: () =>
        p.text({
          message: 'Public hostname (including https://)',
          placeholder: existing?.domain || 'https://node1.seed.run',
          validate: (v) => {
            if (!v) return 'Required'
            if (!v.startsWith('https://') && !v.startsWith('http://')) return 'Must start with https:// or http://'
          },
        }),
      network: () =>
        p.select({
          message: 'P2P network',
          initialValue: existing?.testnet ? 'testnet' : 'mainnet',
          options: [
            {
              value: 'mainnet',
              label: 'Mainnet',
              hint: 'the public Seed network — recommended for production',
            },
            {
              value: 'testnet',
              label: 'Testnet (devnet)',
              hint: 'isolated development network; will NOT see mainnet content',
            },
          ],
        }),
      release_channel: () =>
        promptReleaseChannel({
          initialTag: existing?.release_channel,
          advanced,
        }),
      web_image: () =>
        p.text({
          message: 'Full web image ref (optional)',
          initialValue: existing?.web_image,
          placeholder: 'ghcr.io/horacioh/seed-web:main',
          validate: validateDockerImageRef,
        }),
      site_image: () =>
        p.text({
          message: 'Full site/daemon image ref (optional)',
          initialValue: existing?.site_image,
          placeholder: 'ghcr.io/horacioh/seed-site:main',
          validate: validateDockerImageRef,
        }),
      log_level: () =>
        p.select({
          message: 'Log level for Seed services',
          initialValue: existing?.compose_envs?.LOG_LEVEL ?? 'info',
          options: [
            {
              value: 'debug',
              label: 'Debug',
              hint: 'very verbose, useful for troubleshooting',
            },
            {
              value: 'info',
              label: 'Info',
              hint: 'standard operational logging — recommended',
            },
            {value: 'warn', label: 'Warn', hint: 'only warnings and errors'},
            {value: 'error', label: 'Error', hint: 'only critical errors'},
          ],
        }),
      gateway: () =>
        p.confirm({
          message: 'Run as a public gateway? (serves all known public content)',
          initialValue: existing?.gateway ?? false,
        }),
      agents: () =>
        p.confirm({
          message: 'Run the agents service? (served at <your domain>/hm/api/agents; calls model providers)',
          initialValue: existing?.agents ?? false,
        }),
      email: () =>
        p.text({
          message: 'Contact email (optional) — lets us notify you about security updates. Not shared publicly.',
          // On reconfigure with no stored email, show no suggestion at all:
          // Tab inserts the placeholder verbatim, and filling in the example
          // would silently make it the node's real contact address.
          placeholder: existing ? existing.email || undefined : 'you@example.com',
          validate: (v) => {
            if (v && !v.includes('@')) return 'Must be a valid email'
          },
        }),
    },
    {
      onCancel: () => {
        p.cancel(isReconfig ? 'Reconfiguration cancelled.' : 'Setup cancelled.')
        console.log(RESUME_HINT)
        process.exit(0)
      },
    },
  )

  const secret = existing?.link_secret ?? generateSecret()

  const testnet = answers.network === 'testnet'
  const env: SeedConfig['environment'] = testnet ? 'dev' : 'prod'

  const config: SeedConfig = {
    domain: answers.domain as string,
    email: (answers.email as string) || '',
    deploy_url: configuredDeployUrl(existing),
    compose_url: configuredComposeUrl(existing),
    compose_sha: existing?.compose_sha ?? '',
    compose_env_sha: existing?.compose_env_sha ?? '',
    compose_envs: {
      LOG_LEVEL: answers.log_level as SeedConfig['compose_envs']['LOG_LEVEL'],
    },
    environment: env,
    release_channel: answers.release_channel as string,
    web_image: (answers.web_image as string) || undefined,
    site_image: (answers.site_image as string) || undefined,
    testnet,
    link_secret: secret,
    // TODO: When re-enabling wizard analytics, publish a post/changelog
    // so self-hosters know how analytics works and when it is active again.
    analytics: existing?.analytics ?? false,
    gateway: answers.gateway as boolean,
    agents: answers.agents as boolean,
    // Set by hand in config.json on a host with /dev/kvm.
    agents_kvm: answers.agents ? existing?.agents_kvm ?? false : false,
    last_script_run: existing?.last_script_run ?? '',
  }

  const userFields: [string, string][] = [
    ['domain', config.domain],
    ['email', config.email],
    ['network', config.testnet ? 'testnet (devnet)' : 'mainnet'],
    ['release_channel', config.release_channel],
    ['web_image', config.web_image || '(default)'],
    ['site_image', config.site_image || '(default)'],
    ['log_level', config.compose_envs.LOG_LEVEL],
    ['gateway', String(config.gateway)],
    ['agents', String(config.agents)],
  ]
  const oldFields: Record<string, string> | undefined = existing
    ? {
        domain: existing.domain,
        email: existing.email,
        network: existing.testnet ? 'testnet (devnet)' : 'mainnet',
        release_channel: existing.release_channel,
        web_image: existing.web_image || '(default)',
        site_image: existing.site_image || '(default)',
        log_level: existing.compose_envs?.LOG_LEVEL ?? 'info',
        gateway: String(existing.gateway),
        agents: String(existing.agents ?? false),
      }
    : undefined
  const summary = userFields
    .map(([k, v]) => {
      if (oldFields && String(v) !== String(oldFields[k] ?? '')) {
        return `  \u270E ${k}: ${v}`
      }
      return `    ${k}: ${v}`
    })
    .join('\n')
  p.note(summary, 'Configuration summary')

  const confirmed = await p.confirm({
    message: isReconfig ? 'Save changes and redeploy?' : 'Write config and proceed with deployment?',
  })

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel(isReconfig ? 'Reconfiguration cancelled.' : 'Setup cancelled.')
    console.log(RESUME_HINT)
    process.exit(0)
  }

  await writeConfig(config, paths)
  p.log.success(`Config written to ${paths.configPath}`)

  return config
}

// ---------------------------------------------------------------------------
// Enterprise Wizard
// ---------------------------------------------------------------------------

/** Length of the generated vault admin secret (chars from generateSecret's alphabet, ~6 bits each). */
export const VAULT_ADMIN_SECRET_LENGTH = 40
/** Length of the generated web session-cookie HMAC secret. */
export const SESSION_SECRET_LENGTH = 64

/**
 * Settings an unattended enterprise install reads instead of the wizard:
 * flags for the public values, environment for the SMTP account (so the
 * password never lands in a shell history).
 */
export interface HeadlessOptions {
  hostname?: string
  tag?: string
  email?: string
  logLevel?: string
  agents?: boolean
  notify?: boolean
  yes?: boolean
  /** `--site-name`: display name of the organization's space. */
  siteName?: string
  /** `--owner-password`: encrypts the exported owner key file. Never stored. */
  ownerPassword?: string
  /** `--email-relay-url`: the hosting service's email relay (SEED_EMAIL_RELAY_URL works too). */
  emailRelayUrl?: string
  /** `--email-relay-token`: its bearer token (SEED_EMAIL_RELAY_TOKEN works too). */
  emailRelayToken?: string
}

/** What creating the organization's space needs beyond the config. */
export interface BootstrapOptions {
  siteName?: string
  /** Encrypts the exported owner key file; never written anywhere. */
  ownerPassword?: string
}

/**
 * The bootstrap answers from the flags, with the password also accepted from
 * `SEED_OWNER_PASSWORD` so it need not land in a shell history.
 */
export function bootstrapOptionsFrom(opts: HeadlessOptions, env: NodeJS.ProcessEnv = process.env): BootstrapOptions {
  return {
    siteName: opts.siteName || undefined,
    ownerPassword: opts.ownerPassword || env.SEED_OWNER_PASSWORD || undefined,
  }
}

export function smtpFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig | undefined {
  if (!env.SEED_SMTP_HOST) return undefined
  return {
    host: env.SEED_SMTP_HOST,
    port: env.SEED_SMTP_PORT && /^\d+$/.test(env.SEED_SMTP_PORT) ? Number(env.SEED_SMTP_PORT) : undefined,
    user: env.SEED_SMTP_USER ?? '',
    password: env.SEED_SMTP_PASSWORD ?? '',
    sender: env.SEED_SMTP_SENDER ?? '',
  }
}

export function emailRelayFromEnv(env: NodeJS.ProcessEnv = process.env): EmailRelayConfig | undefined {
  if (!env.SEED_EMAIL_RELAY_URL) return undefined
  return {url: env.SEED_EMAIL_RELAY_URL, token: env.SEED_EMAIL_RELAY_TOKEN ?? ''}
}

/** The relay a config holds, as one object, or undefined when none is set. */
export function emailRelayOf(
  config: Pick<SeedConfig, 'email_relay_url' | 'email_relay_token'> | undefined,
): EmailRelayConfig | undefined {
  if (!config?.email_relay_url) return undefined
  return {url: config.email_relay_url, token: config.email_relay_token ?? ''}
}

/**
 * Build an enterprise config without prompts, for installs over SSH without
 * a TTY (`seed-deploy deploy --profile enterprise --hostname … --tag … --yes`).
 * Throws with the missing piece named so the caller can print it.
 */
export function headlessEnterpriseConfig(
  opts: HeadlessOptions,
  existing?: SeedConfig,
  env: NodeJS.ProcessEnv = process.env,
): SeedConfig {
  const domain = opts.hostname ?? existing?.domain
  if (!domain) throw new Error('--hostname https://… is required for a non-interactive enterprise install')
  const urlError = validateUrl(domain)
  if (urlError) throw new Error(`--hostname: ${urlError}`)
  const tag = opts.tag ?? existing?.release_channel ?? DEFAULT_RELEASE_CHANNEL
  const tagError = validateDockerImageTag(tag)
  if (tagError) throw new Error(`--tag: ${tagError}`)
  const logLevel = opts.logLevel ?? existing?.compose_envs.LOG_LEVEL ?? 'info'
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error(`--log-level must be one of debug, info, warn, error (got '${logLevel}')`)
  }
  const notify = opts.notify ?? existing?.notify ?? false
  const smtp = smtpFromEnv(env) ?? existing?.smtp
  const relay: EmailRelayConfig | undefined = opts.emailRelayUrl
    ? {url: opts.emailRelayUrl, token: opts.emailRelayToken ?? env.SEED_EMAIL_RELAY_TOKEN ?? ''}
    : emailRelayFromEnv(env) ?? emailRelayOf(existing)
  if (relay) {
    const urlError = validateUrl(relay.url)
    if (urlError) throw new Error(`--email-relay-url: ${urlError}`)
    if (!relay.token) {
      throw new Error('--email-relay-url needs --email-relay-token (or SEED_EMAIL_RELAY_TOKEN in the environment)')
    }
  }
  if (notify && !smtp && !relay) {
    throw new Error(
      '--notify needs SEED_SMTP_HOST, SEED_SMTP_USER, SEED_SMTP_PASSWORD and SEED_SMTP_SENDER in the environment, ' +
        'or the email relay (--email-relay-url and --email-relay-token, or SEED_EMAIL_RELAY_URL and SEED_EMAIL_RELAY_TOKEN)',
    )
  }
  return buildEnterpriseConfig(
    {
      domain,
      release_channel: tag,
      web_image: existing?.web_image,
      site_image: existing?.site_image,
      log_level: logLevel as SeedConfig['compose_envs']['LOG_LEVEL'],
      agents: opts.agents ?? existing?.agents ?? false,
      notify,
      smtp,
      email_relay: relay ?? null,
      email: opts.email ?? existing?.email ?? '',
      site_name: opts.siteName,
    },
    existing,
  )
}

function validateUrl(v: string): string | undefined {
  if (!v) return 'Required'
  if (!v.startsWith('https://') && !v.startsWith('http://')) return 'Must start with https:// or http://'
}

/**
 * Build an enterprise config from wizard answers. Pure, so tests can cover the
 * forced values (no gateway, no testnet, no analytics) and secret generation
 * without driving the prompts.
 */
export function buildEnterpriseConfig(
  answers: {
    domain: string
    release_channel: string
    web_image?: string
    site_image?: string
    log_level: SeedConfig['compose_envs']['LOG_LEVEL']
    agents: boolean
    agents_kvm?: boolean
    notify: boolean
    smtp?: SmtpConfig
    /** The email relay: undefined keeps what the config has, null removes it. */
    email_relay?: EmailRelayConfig | null
    email: string
    /** Display name of the organization's space; the bare hostname when empty. */
    site_name?: string
  },
  existing?: SeedConfig,
): SeedConfig {
  const relay = answers.email_relay === undefined ? emailRelayOf(existing) : answers.email_relay ?? undefined
  return {
    profile: 'enterprise',
    domain: answers.domain,
    email: answers.email || '',
    deploy_url: configuredDeployUrl(existing),
    compose_url: configuredComposeUrl(existing, 'enterprise'),
    compose_sha: existing?.compose_sha ?? '',
    compose_env_sha: existing?.compose_env_sha ?? '',
    compose_envs: {LOG_LEVEL: answers.log_level},
    environment: 'prod',
    release_channel: answers.release_channel,
    web_image: answers.web_image || undefined,
    site_image: answers.site_image || undefined,
    // Forced: an enterprise node is never on a public network, never a
    // gateway, never reports statistics.
    testnet: false,
    gateway: false,
    analytics: false,
    link_secret: existing?.link_secret ?? generateSecret(),
    vault_admin_secret: existing?.vault_admin_secret ?? generateSecret(VAULT_ADMIN_SECRET_LENGTH),
    session_secret: existing?.session_secret ?? generateSecret(SESSION_SECRET_LENGTH),
    service_secret: existing?.service_secret ?? generateSecret(SESSION_SECRET_LENGTH),
    notify: answers.notify,
    smtp: answers.notify ? answers.smtp : existing?.smtp ?? undefined,
    email_relay_url: relay?.url || undefined,
    email_relay_token: relay?.url ? relay.token : undefined,
    agents: answers.agents,
    agents_kvm: answers.agents ? answers.agents_kvm ?? existing?.agents_kvm ?? false : false,
    metrics: existing?.metrics ?? false,
    site_name: answers.site_name?.trim() || existing?.site_name || extractDns(answers.domain),
    owner_account_uid: existing?.owner_account_uid,
    ...enterpriseRedirects(answers.domain, existing),
    last_script_run: existing?.last_script_run ?? '',
  }
}

/** One line for the configuration summary: off, or on and how mail leaves the box. */
export function describeNotify(config: SeedConfig): string {
  if (!config.notify) return 'false'
  if (config.email_relay_url) return `yes (email relay ${config.email_relay_url})`
  return `yes (${config.smtp?.host}, sender ${config.smtp?.sender})`
}

async function runEnterpriseWizard(
  paths: DeployPaths,
  existing?: SeedConfig,
  advanced = false,
  bootstrap?: BootstrapOptions,
): Promise<SeedConfig> {
  const isReconfig = !!existing
  p.intro(isReconfig ? `Seed Enterprise Reconfiguration v${VERSION}` : `Seed Enterprise Setup v${VERSION}`)

  if (!isReconfig) {
    p.note(
      [
        'This wizard configures a private, single-tenant Seed stack:',
        'web app, daemon (no peer-to-peer connectivity), identity vault (invite-only),',
        'and optionally email notifications and agents. Every page requires sign-in.',
        '',
        `This node's install location is ${paths.seedDir}/ (config + data live here).`,
        `Updates are manual: run '${cmd('deploy')}' when you want to update.`,
      ].join('\n'),
      'Enterprise Edition',
    )
  } else {
    p.note(
      [
        'Editing your current configuration. Each prompt shows the current value — press Enter to keep it.',
        '',
        `Configuration: ${paths.configPath}`,
      ].join('\n'),
      'Reconfiguration',
    )
  }

  const onCancel = () => {
    p.cancel(isReconfig ? 'Reconfiguration cancelled.' : 'Setup cancelled.')
    console.log(RESUME_HINT)
    process.exit(0)
  }

  // The relay in force once the prompts are answered: the advanced answer, or
  // what the config already has when the prompt was not shown.
  const relayUrlOf = (results: {email_relay_url?: unknown}) =>
    advanced ? ((results.email_relay_url as string | undefined) ?? '').trim() : existing?.email_relay_url ?? ''

  const answers = await p.group(
    {
      domain: () =>
        p.text({
          message: 'Public hostname (including https://)',
          placeholder: existing?.domain || 'https://seed.example.org',
          validate: validateUrl,
        }),
      site_name: ({results}) =>
        p.text({
          message: "Name of the organization's space (shown as the site's title)",
          initialValue: existing?.site_name,
          placeholder: extractDns((results.domain as string) || 'seed.example.org'),
        }),
      // The owner key file is exported once, on the first deploy; a password
      // given here only encrypts that file and is never stored.
      owner_password: () =>
        isReconfig || bootstrap?.ownerPassword
          ? Promise.resolve(undefined)
          : p.password({
              message: "Password for the space's owner key file (optional; Enter for none)",
            }),
      release_channel: () =>
        promptReleaseChannel({
          initialTag: existing?.release_channel,
          advanced,
        }),
      log_level: () =>
        p.select({
          message: 'Log level for Seed services',
          initialValue: existing?.compose_envs?.LOG_LEVEL ?? 'info',
          options: [
            {value: 'debug', label: 'Debug', hint: 'very verbose, useful for troubleshooting'},
            {value: 'info', label: 'Info', hint: 'standard operational logging — recommended'},
            {value: 'warn', label: 'Warn', hint: 'only warnings and errors'},
            {value: 'error', label: 'Error', hint: 'only critical errors'},
          ],
        }),
      agents: () =>
        p.confirm({
          message:
            'Run the agents service? (served at <your domain>/hm/api/agents, members only; calls model providers)',
          initialValue: existing?.agents ?? false,
        }),
      // The hosting service's email relay replaces the SMTP account; it is
      // handed out with the instance, so only --advanced asks for it.
      email_relay_url: () =>
        advanced
          ? p.text({
              message: 'Email relay URL from Seed hosting (optional; empty means SMTP, or no email)',
              initialValue: existing?.email_relay_url,
              placeholder: 'https://host.seed.hyper.media/api/email-relay',
              validate: (v) => (v ? validateUrl(v) : undefined),
            })
          : Promise.resolve(undefined),
      email_relay_token: ({results}) =>
        advanced && results.email_relay_url
          ? p.password({
              message: existing?.email_relay_token
                ? 'Email relay token (leave empty to keep the current one)'
                : 'Email relay token',
              validate: (v) => (v || existing?.email_relay_token ? undefined : 'Required'),
            })
          : Promise.resolve(undefined),
      notify: ({results}) =>
        p.confirm({
          message: relayUrlOf(results)
            ? 'Run the notify service for email notifications? (sends through the email relay)'
            : 'Run the notify service for email notifications? (needs an SMTP account)',
          initialValue: existing?.notify ?? false,
        }),
      smtp_host: ({results}) =>
        results.notify && !relayUrlOf(results)
          ? p.text({
              message: 'SMTP host',
              initialValue: existing?.smtp?.host,
              placeholder: 'smtp.example.org',
              validate: (v) => (v ? undefined : 'Required'),
            })
          : Promise.resolve(undefined),
      smtp_user: ({results}) =>
        results.notify && !relayUrlOf(results)
          ? p.text({
              message: 'SMTP user',
              initialValue: existing?.smtp?.user,
              validate: (v) => (v ? undefined : 'Required'),
            })
          : Promise.resolve(undefined),
      smtp_password: ({results}) =>
        results.notify && !relayUrlOf(results)
          ? p.password({
              message: existing?.smtp?.password
                ? 'SMTP password (leave empty to keep the current one)'
                : 'SMTP password',
              validate: (v) => (v || existing?.smtp?.password ? undefined : 'Required'),
            })
          : Promise.resolve(undefined),
      smtp_sender: ({results}) =>
        results.notify && !relayUrlOf(results)
          ? p.text({
              message: 'Sender address for emails',
              initialValue: existing?.smtp?.sender,
              placeholder: 'Seed <seed@example.org>',
              validate: (v) => (v && v.includes('@') ? undefined : 'Must contain an email address'),
            })
          : Promise.resolve(undefined),
      email: () =>
        p.text({
          message: 'Contact email (optional) — lets us notify you about security updates. Not shared publicly.',
          placeholder: existing ? existing.email || undefined : 'you@example.com',
          validate: (v) => {
            if (v && !v.includes('@')) return 'Must be a valid email'
          },
        }),
    },
    {onCancel},
  )

  const notify = answers.notify as boolean
  const relayUrl = relayUrlOf(answers)
  // Only the advanced prompts can change the relay; otherwise the config's stays.
  const email_relay: EmailRelayConfig | null | undefined = !advanced
    ? undefined
    : relayUrl
      ? {url: relayUrl, token: (answers.email_relay_token as string) || existing?.email_relay_token || ''}
      : null
  const smtp: SmtpConfig | undefined =
    notify && !relayUrl
      ? {
          host: answers.smtp_host as string,
          port: existing?.smtp?.port,
          user: answers.smtp_user as string,
          password: (answers.smtp_password as string) || existing?.smtp?.password || '',
          sender: answers.smtp_sender as string,
        }
      : existing?.smtp

  const config = buildEnterpriseConfig(
    {
      domain: answers.domain as string,
      release_channel: answers.release_channel as string,
      web_image: existing?.web_image,
      site_image: existing?.site_image,
      log_level: answers.log_level as SeedConfig['compose_envs']['LOG_LEVEL'],
      agents: answers.agents as boolean,
      notify,
      smtp,
      email_relay,
      email: (answers.email as string) || '',
      site_name: answers.site_name as string | undefined,
    },
    existing,
  )
  if (bootstrap && typeof answers.owner_password === 'string' && answers.owner_password) {
    bootstrap.ownerPassword = answers.owner_password
  }

  const userFields: [string, string][] = [
    ['domain', config.domain],
    ['site_name', config.site_name ?? ''],
    ['release_channel', config.release_channel],
    ['log_level', config.compose_envs.LOG_LEVEL],
    ['agents', String(config.agents)],
    ['notify', describeNotify(config)],
    ['email', config.email],
  ]
  const summary = userFields.map(([k, v]) => `    ${k}: ${v}`).join('\n')
  p.note(summary, 'Configuration summary')

  const confirmed = await p.confirm({
    message: isReconfig ? 'Save changes and redeploy?' : 'Write config and proceed with deployment?',
  })
  if (p.isCancel(confirmed) || !confirmed) onCancel()

  await writeConfig(config, paths)
  p.log.success(`Config written to ${paths.configPath}`)

  return config
}

// ---------------------------------------------------------------------------
// Deployment Engine
// ---------------------------------------------------------------------------

/** Extract the bare DNS name from a URL, e.g. "https://node.seed.run" -> "node.seed.run" */
export function extractDns(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

/**
 * Web-app paths that must work without a session on an enterprise node: the
 * sign-in flow itself, the endpoints the Seed app and `seed-deploy register`
 * call, and the static files the shell is built from. Mirrors
 * `isOpenPath` in frontend/apps/web/app/require-sign-in.ts; the `*` suffixes
 * also cover Remix's `.data` variants of the open pages.
 */
export const ENTERPRISE_OPEN_PATHS = [
  '/hm/sign-in*',
  '/hm/auth/callback*',
  '/hm/api/config',
  '/hm/api/site-url',
  '/hm/api/auth',
  '/hm/api/auth/*',
  '/hm/api/session',
  '/hm/api/version',
  '/hm/api/register',
  '/hm/register*',
  '/hm/create-site*',
  '/hm/email-notifications*',
  '/healthz',
  '/assets/*',
  '/build/*',
  '/favicon*',
  '/robots.txt',
  '/.well-known/*',
  '/__manifest*',
] as const

/** The web-app route Caddy's forward_auth asks whether a request has a session. */
export const SESSION_CHECK_URI = '/hm/api/session'

/**
 * Caddy upload cap for the enterprise profile. Caddy 2 ships `request_body`
 * without plugins; rate limiting would need the caddy-ratelimit plugin, which
 * the stock `caddy:2` image lacks, so it is not configured.
 */
export const ENTERPRISE_MAX_BODY = '512MB'

/**
 * Paths the notify service answers on a site's origin: its own prefix, plus
 * the API paths older Seed apps call on the advertised notify origin. Signed
 * requests and email tokens are their credentials, so they need no session.
 */
export const NOTIFY_PROXY_PATHS = [
  NOTIFY_API_PATH,
  `${NOTIFY_API_PATH}/*`,
  '/hm/api/notifications',
  '/hm/api/notification-config',
  '/hm/api/notification-inbox',
  '/hm/api/notification-read-state',
  '/hm/api/public-subscribe',
  '/hm/api/public-subscribe/*',
  '/hm/api/email-notif-token',
  '/hm/api/unsubscribe',
] as const

/** The notify service on the site's origin, open (it sits before the gate). */
function notifyOpenBlock(config: SeedConfig): string {
  if (!config.notify) return ''
  return `\t@notify path ${NOTIFY_PROXY_PATHS.join(' ')}
\thandle @notify {
\t\treverse_proxy seed-notify:3000
\t}
`
}

/**
 * Inbound webhook triggers are posted by outside services, which have no
 * session; the trigger's secret in the path is their credential.
 */
function agentsWebhookBlock(config: SeedConfig): string {
  if (!config.agents) return ''
  return `\t@agents_webhook {
\t\tmethod POST
\t\tpath ${AGENTS_API_PATH}/webhooks/*
\t}
\thandle @agents_webhook {
\t\treverse_proxy seed-agents:3050
\t}
`
}

/** The agents service (API and WebSocket under /hm/api/agents), for members only. */
function agentsGatedBlock(config: SeedConfig): string {
  if (!config.agents) return ''
  return `
\t@agents path ${AGENTS_API_PATH} ${AGENTS_API_PATH}/*
\thandle @agents {
\t\timport gate
\t\treverse_proxy seed-agents:3050
\t}
`
}

/**
 * Enterprise Caddyfile. Explicit site blocks (one per hostname) with a sign-in
 * gate: every request to the main site that is not open is first sent to the
 * web app's session check (`forward_auth`); 2xx lets it through, anything else
 * (401, or a 302 to the sign-in page) is returned to the client as-is. The
 * daemon's `/ipfs/*` reads sit behind the same gate. `handle` blocks with named
 * matchers are evaluated in the order written, so the open blocks come first.
 */
function generateEnterpriseCaddyfile(config: SeedConfig): string {
  const dns = extractDns(config.domain)
  const blocks: string[] = []

  blocks.push(`# Ask the web app whether the request carries a member session.
(gate) {
\tforward_auth seed-web:3000 {
\t\t# The trailing "?" drops the original query string from the subrequest:
\t\t# Remix treats "?_data=<route>" (a client-side navigation) as a data
\t\t# request for that route, which does not match the session route and
\t\t# fails with 403. The original URI still travels in X-Forwarded-Uri.
\t\turi ${SESSION_CHECK_URI}?
\t\tcopy_headers X-Forwarded-Uri
\t}
}

${dns} {
\tencode zstd gzip

\trequest_body {
\t\tmax_size ${ENTERPRISE_MAX_BODY}
\t}

\t# The vault serves itself under /vault; do not strip the prefix.
\t@vault path /vault /vault/*
\thandle @vault {
\t\treverse_proxy seed-vault:3000
\t}

\t# The vault UI uploads profile blobs to the daemon before any session exists.
\t@ipfs_upload {
\t\tmethod POST
\t\tpath /ipfs/*
\t}
\thandle @ipfs_upload {
\t\treverse_proxy seed-daemon:56001
\t}

\t# The sign-in callback stores delegation blobs and looks the account up;
\t# the deploy script creates the organization's space on the first deploy
\t# and republishes its address after a hostname change.
\t@open_api_post {
\t\tmethod POST
\t\tpath /api/PublishBlobs /hm/api/enterprise-bootstrap /hm/api/enterprise-site-url
\t}
\t@open_api_get {
\t\tmethod GET HEAD
\t\tpath /api/Account
\t}
\t@open path ${ENTERPRISE_OPEN_PATHS.join(' ')}
${notifyOpenBlock(config)}${agentsWebhookBlock(config)}\thandle @open_api_post {
\t\treverse_proxy seed-web:3000
\t}
\thandle @open_api_get {
\t\treverse_proxy seed-web:3000
\t}
\thandle @open {
\t\treverse_proxy seed-web:3000
\t}

\t# Everything below requires a session.
\t@ipfs path /ipfs/*
\thandle @ipfs {
\t\timport gate
\t\treverse_proxy seed-daemon:56001
\t}

\t@metrics path /.metrics*
\thandle @metrics {
\t\timport gate
\t\treverse_proxy grafana:3001
\t}
${agentsGatedBlock(config)}
\thandle {
\t\timport gate
\t\treverse_proxy seed-web:3000
\t}
}`)

  // Earlier hostnames (the managed address before a custom domain) keep a
  // certificate and send the browser to the current one.
  for (const host of redirectHostnames(config)) {
    blocks.push(`${host} {
\tredir https://${dns}{uri} permanent
}`)
  }

  return blocks.join('\n\n') + '\n'
}

export function generateCaddyfile(config: SeedConfig): string {
  if (isEnterprise(config)) return generateEnterpriseCaddyfile(config)
  // A public site: the agents service, when enabled, is open like the site.
  const agents = config.agents
    ? `\n@agentsroute {\n\tpath ${AGENTS_API_PATH} ${AGENTS_API_PATH}/*\n}\n\nreverse_proxy @agentsroute seed-agents:3050\n`
    : ''
  return `{$SEED_SITE_HOSTNAME}

encode zstd gzip

@ipfsroute {
\tpath /ipfs/*
}

reverse_proxy /.metrics* grafana:{$SEED_SITE_MONITORING_PORT:3001}

reverse_proxy @ipfsroute seed-daemon:{$SEED_SITE_BACKEND_GRPCWEB_PORT:56001}
${agents}
reverse_proxy * seed-web:{$SEED_SITE_LOCAL_PORT:3000}
`
}

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Containers that must be running for the stack to count as healthy. */
export function requiredContainers(config?: SeedConfig): string[] {
  const names = ['seed-proxy', 'seed-web', 'seed-daemon']
  if (config && isEnterprise(config)) {
    names.push('seed-vault')
    if (config.notify) names.push('seed-notify')
  }
  if (config?.agents) names.push('seed-agents')
  return names
}

export async function checkContainersHealthy(shell: ShellRunner, config?: SeedConfig): Promise<boolean> {
  const required = requiredContainers(config)
  for (const name of required) {
    const running = shell.runSafe(`docker inspect ${name} --format '{{.State.Running}}' 2>/dev/null`)
    if (running !== 'true') return false
  }
  return true
}

/**
 * True when the running seed containers match the configured image refs.
 *
 * The "no changes" fast-path trusts compose_env_sha as a proxy for what's
 * actually deployed, but that hash can desync from reality: a rollback, a
 * manual `docker` change, or an interrupted deploy can leave containers on a
 * different image while the stored hash still says the new config was applied.
 * Without this check the fast-path skips forever and never reconciles the
 * running images with the configured refs.
 */
export function containersMatchReleaseChannel(shell: ShellRunner, config: SeedConfig): boolean {
  for (const {container, expectedImage} of expectedServiceImages(config)) {
    const got = shell.runSafe(`docker inspect ${container} --format '{{.Config.Image}}' 2>/dev/null`)
    if (got !== expectedImage) return false
  }
  return true
}

/**
 * Detect whether the shared seed container names are owned by a *different*
 * compose project (another install dir on this host). Returns the foreign
 * project name, or null. Only a non-empty foreign project counts — legacy
 * non-compose orphans (empty label) are handled by freeConflictingPortBindings.
 */
export function detectForeignStack(shell: ShellRunner, paths: DeployPaths): string | null {
  const ours = composeProjectName(paths)
  for (const name of ['seed-proxy', 'seed-web', 'seed-daemon']) {
    const project = shell.runSafe(
      `docker inspect ${name} --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null`,
    )
    if (project && project !== ours) return project
  }
  return null
}

/**
 * Refuse to touch containers owned by another seed install. Two seed stacks
 * can't share one host — they use the same fixed container names and would
 * clobber each other. We abort rather than remove the other stack, because its
 * data volumes belong to it. Branch/test nodes belong on a separate host (or,
 * historically, in their own dir taking turns).
 */
export function assertNoForeignStack(shell: ShellRunner, paths: DeployPaths): void {
  const foreign = detectForeignStack(shell, paths)
  if (!foreign) return
  throw new Error(
    [
      `The seed containers on this host are managed by a different install (compose project '${foreign}').`,
      `This install is '${composeProjectName(paths)}' at ${paths.seedDir}.`,
      `Two seed stacks can't share one host — they use the same container names.`,
      `Stop the other one first ('stop' in its directory), or run this node on a separate host.`,
    ].join(' '),
  )
}

/**
 * Stop and remove the compose stack identified by its project label, whether
 * or not its install dir (and compose file) still exists — `compose -p down`
 * works from container labels alone. Any stragglers still carrying the label
 * (e.g. after a partial down) are force-removed by name as a fallback.
 */
export function stopStackByProject(shell: ShellRunner, project: string): void {
  shell.runSafe(`docker compose -p "${project}" down --remove-orphans`)
  for (const name of LEGACY_CONTAINER_NAMES) {
    const proj = shell.runSafe(
      `docker inspect ${name} --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null`,
    )
    if (proj === project) shell.runSafe(`docker rm -f ${name} 2>/dev/null`)
  }
}

/**
 * Stop another install's stack so this one can take over the host's shared
 * container names. The seed cron is disarmed FIRST: the old node's cron deploy
 * would otherwise fire mid-switch (e.g. while the user is in the wizard) and
 * resurrect the stack we just stopped. setActiveNode reinstalls the cron for
 * the new node once its deploy completes. The old install's data dir is never
 * touched.
 */
export function takeOverHost(shell: ShellRunner, foreignProject: string): void {
  clearSeedCron(shell)
  stopStackByProject(shell, foreignProject)
}

/**
 * The install directory the currently-running seed-daemon actually mounts, or
 * null if no daemon is running. Read from the /data bind-mount source, which is
 * always `<install-dir>/daemon`. This is the authoritative "what's live" signal,
 * independent of config files or the seed-deploy wrapper.
 */
export function getRunningInstallDir(shell: ShellRunner): string | null {
  const src = shell.runSafe(
    `docker inspect seed-daemon --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null`,
  )
  if (!src) return null
  return dirname(src) // strip the trailing "/daemon"
}

/**
 * Deploy-time handling of a stack owned by another install. Interactive runs
 * offer to take it over — or re-take silently when the user already approved a
 * takeover this run (the old node's cron may have raced us and resurrected its
 * stack). Headless runs keep the fatal guard, with one exception: when the
 * foreign stack's install dir no longer exists on disk (the folder was moved
 * or renamed), the stack is provably orphaned, so it is removed and the deploy
 * proceeds. The cron is left alone in that path — a headless run never
 * reinstalls it, and clearing it here would disarm auto-updates for good.
 */
export async function handleForeignStack(
  shell: ShellRunner,
  paths: DeployPaths,
  interactive: boolean,
  takeoverApproved: boolean,
): Promise<void> {
  const foreign = detectForeignStack(shell, paths)
  if (!foreign) return

  if (takeoverApproved) {
    takeOverHost(shell, foreign)
    return
  }

  const foreignDir = getRunningInstallDir(shell)

  if (interactive) {
    const ok = await p.confirm({
      message: `The seed containers on this host belong to ${
        foreignDir ? `the node at ${foreignDir}` : `compose project '${foreign}'`
      }. Stop it and take over? (its data is kept)`,
    })
    if (p.isCancel(ok) || !ok) assertNoForeignStack(shell, paths)
    takeOverHost(shell, foreign)
    return
  }

  if (
    foreignDir &&
    !(await access(foreignDir).then(
      () => true,
      () => false,
    ))
  ) {
    log(`Foreign stack '${foreign}' mounts ${foreignDir}, which no longer exists — removing the orphaned stack.`)
    stopStackByProject(shell, foreign)
    return
  }

  assertNoForeignStack(shell, paths)
}

export async function getContainerImages(shell: ShellRunner, config?: SeedConfig): Promise<Map<string, string>> {
  const images = new Map<string, string>()
  const containers = requiredContainers(config)
  for (const name of containers) {
    const image = shell.runSafe(`docker inspect ${name} --format '{{.Image}}' 2>/dev/null`)
    if (image) images.set(name, image)
  }
  return images
}

/** Return the expected Docker image refs for services managed by Seed compose. */
export function expectedServiceImages(config: SeedConfig): Array<{container: string; expectedImage: string}> {
  const tag = config.release_channel || DEFAULT_RELEASE_CHANNEL
  const images = [
    {container: 'seed-web', expectedImage: config.web_image || `seedhypermedia/web:${tag}`},
    {container: 'seed-daemon', expectedImage: config.site_image || `seedhypermedia/site:${tag}`},
  ]
  if (isEnterprise(config)) {
    images.push({container: 'seed-vault', expectedImage: `seedhypermedia/vault:${tag}`})
    if (config.notify) images.push({container: 'seed-notify', expectedImage: `seedhypermedia/notify:${tag}`})
  }
  if (config.agents) images.push({container: 'seed-agents', expectedImage: `seedhypermedia/agents:${tag}`})
  return images
}

function imageBase(ref: string): string {
  const lastSlash = ref.lastIndexOf('/')
  const lastColon = ref.lastIndexOf(':')
  if (lastColon > lastSlash) return ref.slice(0, lastColon)
  return ref
}

/** Return rollback tag sources and targets for the configured service image refs. */
export function rollbackImageTargets(config: SeedConfig): Array<{base: string; target: string}> {
  return expectedServiceImages(config).map(({expectedImage}) => ({
    base: imageBase(expectedImage),
    target: expectedImage,
  }))
}

/** Return rollback tag refs to apply to a running image before deploying a new config. */
export function rollbackTagRefs(container: string, runningImage: string, config: SeedConfig): string[] {
  const tags = new Set<string>([`${imageBase(runningImage)}:rollback`])
  const expected = expectedServiceImages(config).find((image) => image.container === container)
  if (expected) {
    tags.add(`${imageBase(expected.expectedImage)}:rollback`)
  }
  return [...tags]
}

/**
 * Pull latest images and check if any differ from what's currently running.
 * Returns true if new images were pulled that differ from running containers.
 * Returns false if all images match or if nothing could be pulled.
 *
 * `docker compose pull` pulls the whole stack, so a single un-pullable image
 * (e.g. a broken/absent custom tag, or a transient registry error) makes the
 * command exit non-zero even though other images pulled fine. We must NOT
 * treat that as "no updates": doing so silently pins the node to its current
 * images forever. Instead we log the reason and still run the per-image
 * comparison below, which correctly reports the images that did update.
 */
export async function checkForNewImages(config: SeedConfig, paths: DeployPaths, shell: ShellRunner): Promise<boolean> {
  const env = buildComposeEnv(config, paths)
  const beforeImages = await getContainerImages(shell, config)
  if (beforeImages.size === 0) return false

  try {
    const result = await shell.exec(`${env} docker compose -f ${paths.composePath} pull --quiet`, IMAGE_PULL_TIMEOUT_MS)
    if (result.stderr) log(`image pull: ${result.stderr}`)
  } catch (err) {
    // One image failed to pull, but others may have succeeded — keep going and
    // compare per image. Surface the reason so a stuck autoupdater is visible.
    log(`WARNING: image pull reported an error (continuing with per-image check): ${err}`)
    const pullMsg = describePullFailure(String(err), config.release_channel)
    if (pullMsg) log(`  ${pullMsg}`)
  }

  for (const [name, runningId] of beforeImages) {
    const imageName = shell.runSafe(`docker inspect ${name} --format '{{.Config.Image}}' 2>/dev/null`)
    if (!imageName) continue
    const pulledId = shell.runSafe(`docker image inspect ${imageName} --format '{{.Id}}' 2>/dev/null`)
    if (pulledId && runningId !== pulledId) return true
  }
  return false
}

/**
 * Extract environment variables from a running container as a key-value map.
 * Returns an empty object if the container doesn't exist or isn't running.
 */
export function getContainerEnvs(shell: ShellRunner, containerName: string): Record<string, string> {
  const raw = shell.runSafe(`docker inspect ${containerName} --format '{{json .Config.Env}}' 2>/dev/null`)
  if (!raw) return {}
  try {
    const envs = JSON.parse(raw) as string[]
    const result: Record<string, string> = {}
    for (const entry of envs) {
      const idx = entry.indexOf('=')
      if (idx > 0) {
        result[entry.slice(0, idx)] = entry.slice(idx + 1)
      }
    }
    return result
  } catch {
    return {}
  }
}

/** Result of checking GPU acceleration inside the daemon container. */
export type GpuStatus = {available: true} | {available: false; reason: 'not-running' | 'no-dev-dri' | 'no-vulkan-icd'}

/** Check whether the daemon container has GPU acceleration via Vulkan. */
export function checkGpuAcceleration(shell: ShellRunner): GpuStatus {
  const status = shell.runSafe(`docker inspect seed-daemon --format '{{.State.Status}}' 2>/dev/null`)
  if (status !== 'running') return {available: false, reason: 'not-running'}
  const renderNodes = shell.runSafe(`docker exec seed-daemon ls /dev/dri/renderD* 2>/dev/null`)
  if (!renderNodes) return {available: false, reason: 'no-dev-dri'}
  const vulkanIcd = shell.runSafe(`docker exec seed-daemon ls /usr/share/vulkan/icd.d/*.json 2>/dev/null`)
  if (!vulkanIcd) return {available: false, reason: 'no-vulkan-icd'}
  return {available: true}
}

/**
 * Quote one env value for the `K=V docker compose …` command prefix. Values
 * from the wizard are plain (hostnames, tags, paths) and keep the historical
 * double-quoted form, so existing nodes' compose_env_sha is unchanged. Anything
 * else (an SMTP password with `$` or `"`) is single-quoted for the shell.
 */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_\/:.@=,+ -]*$/.test(value)) return `"${value}"`
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildComposeEnv(config: SeedConfig, paths: DeployPaths): string {
  const dns = extractDns(config.domain)
  const enterprise = isEnterprise(config)
  const testnetName = enterprise ? enterpriseTestnetName(config.domain) : config.testnet ? 'dev' : ''
  const lightningUrl = config.testnet ? LIGHTNING_URL_TESTNET : LIGHTNING_URL_MAINNET

  const vars: Record<string, string> = {
    SEED_SITE_HOSTNAME: config.domain,
    SEED_SITE_DNS: dns,
    SEED_SITE_TAG: config.release_channel,
    SEED_SITE_WORKSPACE: paths.seedDir,
    SEED_UID: String(process.getuid!()),
    SEED_GID: String(process.getgid!()),
    SEED_LOG_LEVEL: config.compose_envs.LOG_LEVEL,
    SEED_IS_GATEWAY: String(config.gateway),
    SEED_ENABLE_STATISTICS: String(config.analytics),
    SEED_P2P_TESTNET_NAME: testnetName,
    SEED_LIGHTNING_URL: lightningUrl,
    NOTIFY_SERVICE_HOST: notifyHost(config),
    SEED_SITE_MONITORING_WORKDIR: join(paths.seedDir, 'monitoring'),
  }

  if (config.web_image) {
    vars.SEED_WEB_IMAGE = config.web_image
  }
  if (config.site_image) {
    vars.SEED_SITE_IMAGE = config.site_image
  }

  if (enterprise) {
    vars.SEED_SITE_NAME = config.site_name ?? dns
    vars.SEED_VAULT_ADMIN_SECRET = config.vault_admin_secret ?? ''
    vars.SEED_SESSION_SECRET = config.session_secret ?? ''
    vars.SEED_SERVICE_SECRET = config.service_secret ?? ''
    vars.SEED_UPSTREAM_API_URL = config.upstream_api_url ?? DEFAULT_UPSTREAM_API_URL
    vars.SEED_CONTACT_EMAIL = config.email ?? ''
    vars.SEED_NOTIFY_HOST = notifyHost(config)
    vars.SEED_AGENTS_HOST = agentsHost(config)
    vars.SEED_AGENTS_EXEC_BACKEND = config.agents_kvm ? 'microsandbox' : ''
    vars.SEED_SMTP_HOST = config.smtp?.host ?? ''
    vars.SEED_SMTP_PORT = config.smtp?.port ? String(config.smtp.port) : '587'
    vars.SEED_SMTP_USER = config.smtp?.user ?? ''
    vars.SEED_SMTP_PASSWORD = config.smtp?.password ?? ''
    vars.SEED_SMTP_SENDER = config.smtp?.sender ?? ''
    vars.SEED_EMAIL_RELAY_URL = config.email_relay_url ?? ''
    vars.SEED_EMAIL_RELAY_TOKEN = config.email_relay_token ?? ''
  } else if (config.agents) {
    // Unset otherwise, so the web app keeps the compose file's default (the
    // hosted agents service) and existing sites' env hash does not change.
    vars.SEED_AGENTS_HOST = agentsHost(config)
    vars.SEED_AGENTS_EXEC_BACKEND = config.agents_kvm ? 'microsandbox' : ''
  }

  const profiles = composeProfiles(config)
  if (profiles.length > 0) {
    vars.COMPOSE_PROFILES = profiles.join(',')
  }

  return Object.entries(vars)
    .map(([k, v]) => `${k}=${shellQuote(v)}`)
    .join(' ')
}

export function getWorkspaceDirs(paths: DeployPaths, config?: SeedConfig): string[] {
  // The daemon container always mounts monitoring volumes (for rsync of
  // built-in dashboards), so these directories must exist even when the
  // monitoring profile isn't active.
  const dirs = [
    join(paths.seedDir, 'proxy'),
    join(paths.seedDir, 'proxy', 'data'),
    join(paths.seedDir, 'proxy', 'config'),
    join(paths.seedDir, 'web'),
    join(paths.seedDir, 'daemon'),
    join(paths.seedDir, 'monitoring'),
    join(paths.seedDir, 'monitoring', 'grafana'),
    join(paths.seedDir, 'monitoring', 'prometheus'),
  ]
  if (config && isEnterprise(config)) {
    // Bind mounts are created by docker as root when missing; create them
    // here so the containers (running as the host user) can write to them.
    dirs.push(join(paths.seedDir, 'vault'), join(paths.seedDir, 'notify'), join(paths.seedDir, 'agents'))
  } else if (config?.agents) {
    dirs.push(join(paths.seedDir, 'agents'))
  }
  return dirs
}

/** Data directories that belong in a backup, in addition to web/daemon/proxy. */
export const ENTERPRISE_DATA_DIRS = ['vault', 'notify', 'agents'] as const

/**
 * Ensures the seed directory exists and is writable by the current user.
 * Uses sudo only when the parent directory isn't writable.
 */
export async function ensureSeedDir(paths: DeployPaths, shell: ShellRunner): Promise<void> {
  try {
    await access(paths.seedDir)
  } catch {
    // Directory doesn't exist — try creating it, escalate to sudo if needed
    try {
      await mkdir(paths.seedDir, {recursive: true})
    } catch {
      log(`Creating ${paths.seedDir} requires elevated permissions`)
      shell.run(`sudo mkdir -p "${paths.seedDir}"`)
      shell.run(`sudo chown "$(id -u):$(id -g)" "${paths.seedDir}"`)
    }
  }
}

async function rollback(
  previousImages: Map<string, string>,
  config: SeedConfig,
  paths: DeployPaths,
  shell: ShellRunner,
): Promise<void> {
  log('Deployment failed — rolling back to previous images...')

  // Re-tag rollback images back to the exact image refs compose uses.
  for (const {base, target} of rollbackImageTargets(config)) {
    const hasRollback = shell.runSafe(`docker image inspect ${base}:rollback >/dev/null 2>&1 && echo yes`)
    if (hasRollback === 'yes') {
      shell.runSafe(`docker tag ${base}:rollback ${target}`)
      log(`  Restored ${target} from rollback image`)
    }
  }

  for (const [name] of previousImages) {
    shell.runSafe(`docker stop ${name} 2>/dev/null`)
    shell.runSafe(`docker rm ${name} 2>/dev/null`)
  }
  log('  Running docker compose up with restored images...')
  const env = buildComposeEnv(config, paths)
  shell.runSafe(`${env} docker compose -f ${paths.composePath} up -d --quiet-pull 2>&1`)
  log('Rollback complete. Check container status with: docker ps')
}

// ---------------------------------------------------------------------------
// Self-update — fetches the latest deploy.js from the repo.
// Invoked by the explicit `upgrade` command (including cron-managed upgrades).
// The update takes effect on the *next* run; the current process continues
// with the code already loaded in memory.
// ---------------------------------------------------------------------------

export async function selfUpdate(scriptPath: string = process.argv[1] || '', deployUrl?: string): Promise<void> {
  const report = (msg: string) => {
    if (process.stdout.isTTY) {
      console.log(msg)
    } else {
      log(msg)
    }
  }

  // The script updates ITSELF in place, wherever it lives (the fixed tool path
  // for new installs; the data dir for legacy installs). This is independent of
  // the node's --dir data directory. The guard makes it impossible to overwrite
  // anything but a deploy.js (e.g. a test file when running under `bun test`).
  if (!scriptPath.endsWith('deploy.js')) {
    report(`Upgrade: skipped — script path is not a deploy.js (${scriptPath}).`)
    return
  }

  try {
    const url = getDeployScriptUrl(deployUrl)
    const response = await fetch(url)
    if (!response.ok) {
      report(`Upgrade: failed to fetch ${url}: ${response.status}`)
      return
    }
    const remote = await response.text()

    let local = ''
    try {
      local = await readFile(scriptPath, 'utf-8')
    } catch {
      // First run or path mismatch — treat as stale
    }

    if (sha256(remote) !== sha256(local)) {
      await writeFile(scriptPath, remote, 'utf-8')
      report(`Upgrade: deploy.js updated (takes effect on next run).`)
    } else {
      report('Upgrade: deploy.js is up to date.')
    }
  } catch (err) {
    report(`Upgrade: skipped (${err})`)
  }
}

/** Compose `devices:` / `group_add:` lines (4-space service indent) for a device injection. */
export function deviceDirectives(devices: string[], groupIds: string[]): string[] {
  const lines = ['    devices:', ...devices.map((d) => `      - ${d}:${d}`)]
  if (groupIds.length > 0) {
    // GIDs, not names — Docker resolves names from the container's /etc/group,
    // which may not define them. GIDs pass through without resolution.
    lines.push('    group_add:', ...groupIds.map((g) => `      - ${g}`))
  }
  return lines
}

/**
 * Insert directive lines before the `volumes:` line of the named service. The
 * compose templates ship without host-specific devices so they work on any
 * server; deploy adds them when the host has the hardware. Matches the first
 * 4-space `volumes:` after the service's `container_name:` line; a service
 * without one is left untouched.
 */
export function injectServiceDirectives(compose: string, containerName: string, lines: string[]): string {
  let inService = false
  const result: string[] = []
  for (const line of compose.split('\n')) {
    if (new RegExp(`^\\s+container_name:\\s*${containerName}\\s*$`).test(line)) inService = true
    if (inService && /^\s{4}volumes:/.test(line)) {
      result.push(...lines)
      inService = false // only inject once
    }
    result.push(line)
  }
  return result.join('\n')
}

export async function deploy(
  config: SeedConfig,
  paths: DeployPaths,
  shell: ShellRunner,
  takeoverApproved = false,
  bootstrap: BootstrapOptions = {},
  /** The hostname before this deploy, when it was reconfigured; a change republishes the space's address. */
  previousDomain?: string,
): Promise<void> {
  const isInteractive = process.stdout.isTTY
  const spinner = isInteractive ? p.spinner() : null

  const step = (msg: string) => {
    if (spinner) spinner.message(msg)
    log(msg)
  }

  if (isInteractive) {
    p.log.step('Starting deployment...')
  }

  // Never clobber another seed install silently: interactive runs offer a
  // takeover, headless runs only remove provably orphaned stacks.
  await handleForeignStack(shell, paths, isInteractive, takeoverApproved)

  // Surface risky/confusing config (unintended devnet, dev images on mainnet)
  // on every deploy so it is visible in the cron deploy log, not silent.
  for (const warning of configWarnings(config)) {
    if (isInteractive) p.log.warn(warning)
    else log(`WARNING: ${warning}`)
  }

  spinner?.start('Fetching docker-compose.yml...')
  step('Fetching docker-compose.yml...')

  // Use env-based URL override when present (testing / branch builds),
  // otherwise fall back to the compose_url stored in config.json.
  const hasEnvOverride = process.env.SEED_DEPLOY_URL || process.env.SEED_REPO_URL
  const composeFile = composeFileName(config.profile)
  const composeUrl = hasEnvOverride
    ? `${getOpsBaseUrl()}/${composeFile}`
    : config.deploy_url
      ? `${config.deploy_url.replace(/\/+$/, '')}/${composeFile}`
      : config.compose_url
  const composeResponse = await fetch(composeUrl)
  if (!composeResponse.ok) {
    spinner?.stop(`Failed to fetch ${composeFile}`)
    throw new Error(`Failed to fetch compose file from ${composeUrl}: ${composeResponse.status}`)
  }
  const composeContent = await composeResponse.text()
  const composeSha = sha256(composeContent)
  const envString = buildComposeEnv(config, paths)
  const envSha = sha256(envString)

  const containersHealthy = await checkContainersHealthy(shell, config)
  const containersOnConfiguredTag = containersMatchReleaseChannel(shell, config)
  // The Caddyfile is rendered from the config too (hostname, redirect
  // hostnames, the gate), but neither the compose nor the env SHA covers it,
  // so a config change that only touches the proxy must still redeploy.
  const caddyfilePath = join(paths.seedDir, 'proxy', 'CaddyFile')
  const caddyfileCurrent = await readFile(caddyfilePath, 'utf-8')
    .then((existing) => existing === generateCaddyfile(config))
    .catch(() => false)
  if (
    config.compose_sha === composeSha &&
    config.compose_env_sha === envSha &&
    containersHealthy &&
    containersOnConfiguredTag &&
    caddyfileCurrent
  ) {
    // Compose and config unchanged, containers running the configured image refs.
    // Check if remote images have been updated (e.g. CI pushed a new tag).
    step('Checking for new images...')
    const hasNewImages = await checkForNewImages(config, paths, shell)
    if (!hasNewImages) {
      spinner?.stop('No changes detected — all containers healthy. Skipping redeployment.')
      log('No changes detected — compose SHA and env SHA match, images current, containers healthy. Skipping.')
      if (isInteractive) {
        console.log(`\n  To change your node's configuration, run '${cmd('deploy --reconfigure')}'.\n`)
      }
      config.last_script_run = new Date().toISOString()
      await writeConfig(config, paths)
      return
    }
    step('New images available — proceeding with deployment.')
  }

  if (config.compose_sha && config.compose_sha !== composeSha) {
    step(`Compose file changed: ${config.compose_sha.slice(0, 8)} -> ${composeSha.slice(0, 8)}`)
  }
  if (config.compose_env_sha && config.compose_env_sha !== envSha) {
    step(`Configuration changed: ${config.compose_env_sha.slice(0, 8)} -> ${envSha.slice(0, 8)}`)
  }
  if (containersHealthy && !containersOnConfiguredTag) {
    step(
      `Running containers do not match the configured images (${expectedServiceImages(config)
        .map((i) => `${i.container}=${i.expectedImage}`)
        .join(', ')}) — redeploying to reconcile.`,
    )
  }

  await ensureSeedDir(paths, shell)
  // Inject GPU-related directives (devices, group_add) into the seed-daemon
  // service when the host has /dev/dri and the required groups. The compose
  // file ships without these so it works on any server out of the box.
  let finalCompose = composeContent
  const hasGpu = shell.runSafe('test -d /dev/dri && echo yes') === 'yes'
  if (hasGpu) {
    // Use GIDs instead of group names — Docker resolves names from the
    // container's /etc/group, which may not have these groups defined.
    // GIDs are passed through directly without any name resolution.
    const groups: string[] = []
    const videoGid = shell.runSafe('getent group video 2>/dev/null | cut -d: -f3')
    if (videoGid) groups.push(videoGid)
    const renderGid = shell.runSafe('getent group render 2>/dev/null | cut -d: -f3')
    if (renderGid) groups.push(renderGid)

    finalCompose = injectServiceDirectives(finalCompose, 'seed-daemon', deviceDirectives(['/dev/dri'], groups))
    log(`GPU detected — added devices${groups.length ? ` and group_add (${groups.join(', ')})` : ''} to compose file.`)
  }
  // Agents: /dev/kvm for sandboxed code execution, opt-in via config
  // (standard droplets have no KVM; the compose file ships without it).
  if (config.agents && config.agents_kvm) {
    const kvmGid = shell.runSafe('getent group kvm 2>/dev/null | cut -d: -f3')
    finalCompose = injectServiceDirectives(
      finalCompose,
      'seed-agents',
      deviceDirectives(['/dev/kvm'], kvmGid ? [kvmGid] : []),
    )
    log(`agents_kvm — added /dev/kvm${kvmGid ? ` and group_add (${kvmGid})` : ''} to seed-agents.`)
  }
  await writeFile(paths.composePath, finalCompose, 'utf-8')

  step('Setting up workspace directories...')
  const dirs = getWorkspaceDirs(paths, config)
  for (const dir of dirs) {
    await mkdir(dir, {recursive: true})
  }

  // If an old installation exists and our data dirs are empty, copy the data
  // over. This runs on every deploy but is a no-op once data exists.
  await migrateDataFromOldInstall(paths, shell)

  step('Generating Caddyfile...')
  const caddyfile = generateCaddyfile(config)
  const previousCaddyfile = await readFile(caddyfilePath, 'utf-8').catch(() => null)
  await writeFile(caddyfilePath, caddyfile, 'utf-8')

  // Write registration secret only on first deploy (web/config.json doesn't exist yet)
  const webConfigPath = join(paths.seedDir, 'web', 'config.json')
  let isFirstDeploy = false
  try {
    await access(webConfigPath)
  } catch {
    isFirstDeploy = true
    await writeFile(webConfigPath, JSON.stringify({availableRegistrationSecret: config.link_secret}) + '\n', 'utf-8')
    step('Created initial web/config.json with registration secret.')
  }

  const previousImages = await getContainerImages(shell, config)

  // Tag current images as :rollback before pulling so they survive prune and
  // can be restored if the new images fail health checks.
  for (const [name, imageId] of previousImages) {
    const imageName = shell.runSafe(`docker inspect ${name} --format '{{.Config.Image}}' 2>/dev/null`)
    if (imageName) {
      for (const tagRef of rollbackTagRefs(name, imageName, config)) {
        shell.runSafe(`docker tag ${imageId} ${tagRef} 2>/dev/null`)
      }
    }
  }

  const env = buildComposeEnv(config, paths)

  // Always evict watchtower-style autoupdaters before pulling images.
  // If left running, watchtower would react to the new image and recreate
  // the legacy daemon under its old non-compose name, re-binding port
  // 56000 outside compose's tracking. Idempotent: no-op when none exist.
  step('Removing legacy autoupdaters...')
  removeLegacyAutoupdaters(shell)

  // Remove non-compose containers that publish one of our ports or use
  // one of our well-known names. Healthy compose-managed containers carry
  // our project label and are skipped, so this is a true no-op on routine
  // re-runs / `--reconfigure` and a clean takeover for legacy installs.
  step('Clearing port and name conflicts from prior installs...')
  freeConflictingPortBindings(shell, composeProjectName(paths))

  // Pull new images while existing containers keep serving traffic.
  // This eliminates image download time from the downtime window.
  step('Pulling latest images...')
  try {
    await shell.exec(`${env} docker compose -f ${paths.composePath} pull --quiet`, IMAGE_PULL_TIMEOUT_MS)
  } catch (err: unknown) {
    log(`Image pull failed: ${err}`)
    // Non-fatal — compose up will attempt to pull as fallback
  }

  // Recreate containers from pre-pulled images. Only containers whose
  // image or configuration changed will be recreated; the rest stay up.
  step('Recreating containers...')
  try {
    const composeCmd = `${env} docker compose -f ${paths.composePath} up -d --quiet-pull`
    const result = await shell.exec(composeCmd)
    if (result.stderr) {
      log(`compose stderr: ${result.stderr}`)
    }
  } catch (err: unknown) {
    spinner?.stop('docker compose up failed')
    log(`docker compose up failed: ${err}`)
    if (previousImages.size > 0) {
      await rollback(previousImages, config, paths, shell)
    }
    const bindMsg = describeBindFailure(String(err))
    if (bindMsg) {
      throw new Error(bindMsg)
    }
    const pullMsg = describePullFailure(String(err), config.release_channel)
    if (pullMsg) {
      throw new Error(pullMsg)
    }
    throw new Error(`Deployment failed: ${err}`)
  }

  // The Caddyfile is a bind mount: compose does not recreate the proxy when
  // only that file changed, and Caddy does not watch it, so tell it.
  if (previousCaddyfile !== null && previousCaddyfile !== caddyfile) {
    step('Reloading the proxy configuration...')
    try {
      await shell.exec('docker exec seed-proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile')
    } catch (err) {
      log(`WARNING: caddy reload failed (${err}); restarting the proxy instead`)
      try {
        await shell.exec('docker restart seed-proxy')
      } catch (restartErr) {
        log(`WARNING: could not restart the proxy: ${restartErr}`)
      }
    }
  }

  let healthy = false
  for (let attempt = 0; attempt < 10; attempt++) {
    step(`Health check ${attempt + 1}/10...`)
    await new Promise((r) => setTimeout(r, 3000))
    healthy = await checkContainersHealthy(shell, config)
    if (healthy) break
  }

  if (!healthy) {
    spinner?.stop('Health checks failed')
    log('Health checks failed — containers not running after 30s')
    if (previousImages.size > 0) {
      await rollback(previousImages, config, paths, shell)
    }
    throw new Error('Deployment failed: containers did not become healthy within 30 seconds')
  }

  config.compose_sha = composeSha
  config.compose_env_sha = envSha
  config.last_script_run = new Date().toISOString()
  await writeConfig(config, paths)

  // New images are healthy — remove rollback tags so old images can be pruned.
  for (const {expectedImage} of expectedServiceImages(config)) {
    const base = imageBase(expectedImage)
    shell.runSafe(`docker rmi ${base}:rollback 2>/dev/null`)
  }

  // Prune old images immediately so disk doesn't fill up between cron runs.
  // Uses dangling-only prune (no -a) to preserve any tagged rollback images
  // that may exist from a failed deploy that was manually recovered.
  step('Cleaning up unused images...')
  shell.runSafe('docker image prune -f --filter "until=1m" 2>/dev/null')

  // An enterprise node's first deploy also creates the organization's space,
  // so the first member to sign in finds something. A failure here is not a
  // failed deploy: the stack is up, and 'bootstrap-space' retries it.
  let bootstrapLines: string[] = []
  if (isEnterprise(config) && isFirstDeploy) {
    step("Creating the organization's space...")
    bootstrapLines = await bootstrapAfterDeploy(config, paths, bootstrap, step)
    for (const line of bootstrapLines) log(line)
  }

  // A hostname change leaves the space's home document naming the old
  // address; the web app republishes it now that it answers on the new one.
  let siteUrlLines: string[] = []
  if (isEnterprise(config) && !isFirstDeploy && previousDomain && previousDomain !== config.domain) {
    step(`Updating the space's site URL to ${config.domain}...`)
    siteUrlLines = await syncSiteUrlAfterDeploy(config, step)
    for (const line of siteUrlLines) log(line)
  }

  spinner?.stop('Deployment complete!')
  log('Deployment complete.')

  if (isInteractive && siteUrlLines.length > 0) {
    p.note(siteUrlLines.join('\n'), 'Hostname changed')
  }

  if (isInteractive) {
    p.log.message(MANAGE_HINT)
  }

  if (isInteractive && isFirstDeploy) {
    // TODO: POST config.email, config.domain, and config.analytics to the
    // Seed vault so the team knows about new deployments and can activate
    // Plausible analytics for this domain. Coordinate endpoint with Eric.

    const registerUrl = `${config.domain}/hm/register?secret=${config.link_secret}`
    if (isEnterprise(config)) {
      p.note(
        [
          `Your private Seed is live at ${config.domain}`,
          '',
          ...bootstrapLines,
          '',
          `Invite the organization's people with '${cmd('invite you@example.org')}'`,
          `and have them open the invitation link in a browser.`,
          `Updates are manual: run '${cmd('deploy')}' when you want them.`,
        ].join('\n'),
        'Setup complete',
      )
      return
    }
    p.note(
      [
        `Your site is live at ${config.domain}`,
        '',
        `  Registration URL:`,
        `  ${registerUrl}`,
        '',
        'Copy this URL and paste it into the Seed desktop app',
        'to link your publisher account to this site.',
      ].join('\n'),
      'Setup complete',
    )
  }
}

// ---------------------------------------------------------------------------
// Cron Setup
// ---------------------------------------------------------------------------

/**
 * Build an updated crontab string by replacing any existing seed-managed lines
 * (identified by `# seed-deploy` / `# seed-cleanup` comment markers) with the
 * current versions. Non-seed lines are preserved untouched.
 */
export function buildCrontab(existing: string, paths: DeployPaths, bunPath: string = '/usr/local/bin/bun'): string {
  // Run the single fixed script, pointed at this node's data dir with --dir.
  const invoke = `${bunPath} "${DEPLOY_SCRIPT_PATH}" --dir "${paths.seedDir}"`
  const deployLine =
    `*/10 * * * * ${invoke} upgrade >> "${paths.deployLog}" 2>&1; ` +
    `${invoke} deploy >> "${paths.deployLog}" 2>&1 # seed-deploy`
  const cleanupLine = `0 * * * * docker image prune -f --filter "until=1h" # seed-cleanup`

  const filtered = removeSeedCronLines(existing).trim()

  return [filtered, deployLine, cleanupLine].filter(Boolean).join('\n') + '\n'
}

/**
 * Disarm the seed-managed cron jobs, leaving other cron lines untouched. Used
 * while taking over the host from another install: that node's cron deploy
 * would otherwise resurrect its stack between our `down` and `up`.
 */
export function clearSeedCron(shell: ShellRunner): void {
  const existing = shell.runSafe('crontab -l 2>/dev/null') ?? ''
  if (!existing.includes('# seed-deploy') && !existing.includes('# seed-cleanup')) return
  shell.runSafe(`echo '${removeSeedCronLines(existing)}' | crontab -`)
}

/** Absolute path to the bun binary for cron/wrapper lines: PATH lookup, else the bun running this script. */
export function resolveBunPath(shell: ShellRunner): string {
  return shell.runSafe('command -v bun') || process.execPath
}

/** Install or update this node's seed-managed deployment and cleanup cron jobs. */
export async function setupCron(paths: DeployPaths, shell: ShellRunner): Promise<void> {
  const bunPath = resolveBunPath(shell)
  const existing = shell.runSafe('crontab -l 2>/dev/null') ?? ''
  const newCrontab = buildCrontab(existing, paths, bunPath)

  try {
    shell.run(`echo '${newCrontab}' | crontab -`)
    if (existing.includes('# seed-deploy') || existing.includes('# seed-cleanup')) {
      log('Updated existing seed cron jobs.')
    } else {
      log('Installed automatic deployment cron job (runs every 10 minutes) and hourly image cleanup.')
    }
  } catch (err) {
    log(`Warning: Failed to install cron job: ${err}`)
  }
}

/**
 * Migrate legacy seed cron lines during a headless deploy. setupCron only runs
 * from the wizard or `seed-deploy cron`, so legacy installs otherwise keep
 * their old schedule and script path forever.
 */
export async function migrateLegacyCron(
  paths: DeployPaths,
  shell: ShellRunner,
  scriptPath: string = process.argv[1] || '',
): Promise<void> {
  const existing = shell.runSafe('crontab -l 2>/dev/null') ?? ''
  const deployLine = existing.split('\n').find((line) => line.includes('# seed-deploy'))
  if (!deployLine) return

  if (
    !deployLine.includes(`"${paths.seedDir}/deploy.js"`) &&
    !deployLine.includes(` ${paths.seedDir}/deploy.js `) &&
    !deployLine.includes(`--dir "${paths.seedDir}"`)
  ) {
    return
  }

  const bunPath = resolveBunPath(shell)
  const updated = buildCrontab(existing, paths, bunPath)
  if (JSON.stringify(extractSeedCronLines(existing)) === JSON.stringify(extractSeedCronLines(updated))) return

  let copyNeeded = false
  let copySucceeded = false
  if (scriptPath !== DEPLOY_SCRIPT_PATH) {
    let source: string | undefined
    if (scriptPath.endsWith('deploy.js')) {
      try {
        source = await readFile(scriptPath, 'utf-8')
      } catch {
        // A missing running script can still use an already-installed deploy.js.
      }
    }
    if (source !== undefined) {
      let targetMatches = false
      try {
        targetMatches = sha256(await readFile(DEPLOY_SCRIPT_PATH, 'utf-8')) === sha256(source)
      } catch {
        // Missing or unreadable target scripts are replaced from the running copy.
      }
      if (!targetMatches) {
        copyNeeded = true
        const dir = dirname(DEPLOY_SCRIPT_PATH)
        copySucceeded =
          shell.runSafe(`mkdir -p "${dir}" && cp "${scriptPath}" "${DEPLOY_SCRIPT_PATH}" && echo ok`) === 'ok'
        if (!copySucceeded) {
          copySucceeded =
            shell.runSafe(
              `sudo mkdir -p "${dir}" && sudo cp "${scriptPath}" "${DEPLOY_SCRIPT_PATH}" && sudo chown "$(id -u):$(id -g)" "${dir}" "${DEPLOY_SCRIPT_PATH}" && echo ok`,
            ) === 'ok'
        }
      }
    }
  }

  const scriptExists = shell.runSafe(`test -f "${DEPLOY_SCRIPT_PATH}" && echo ok`) === 'ok'
  if ((copyNeeded && !copySucceeded) || !scriptExists) {
    log(`WARNING: could not install deploy.js at ${DEPLOY_SCRIPT_PATH} — leaving the legacy cron untouched.`)
    return
  }

  const oldSchedule = deployLine.trim().split(/\s+/).slice(0, 5).join(' ')
  await setupCron(paths, shell)
  installWrapper(paths, shell)
  log(`Migrated legacy cron (${oldSchedule} → */10) to ${DEPLOY_SCRIPT_PATH}.`)
}

// ---------------------------------------------------------------------------
// CLI: Argument Parsing
// ---------------------------------------------------------------------------

const COMMANDS = [
  'deploy',
  'upgrade',
  'stop',
  'start',
  'restart',
  'doctor',
  'secret',
  'bootstrap-space',
  'config',
  'logs',
  'cron',
  'backup',
  'restore',
  'uninstall',
  'register',
  'invite',
  'set-hostname',
] as const

export type CliCommand = (typeof COMMANDS)[number]

export interface CliArgs {
  command: CliCommand | 'help' | 'version'
  args: string[]
  reconfigure?: boolean
  advanced?: boolean
  /** Node data directory to operate on (overrides DEFAULT_SEED_DIR). */
  dir?: string
  /** Deploy profile for a first run / reconfigure (`--profile enterprise`). */
  profile?: DeployProfile
  /** Unattended-install answers (`--hostname`, `--tag`, `--yes`, …). */
  headless: HeadlessOptions
}

function parseProfile(value: string | undefined): DeployProfile {
  if (value && (DEPLOY_PROFILES as readonly string[]).includes(value)) return value as DeployProfile
  console.error(`Unknown profile: ${value ?? '(none)'}. Expected one of: ${DEPLOY_PROFILES.join(', ')}\n`)
  process.exit(1)
}

export function parseArgs(argv: string[] = process.argv): CliArgs {
  const rawAll = argv.slice(2)
  // Global modifiers, stripped wherever they appear so they don't interfere
  // with command/subcommand parsing:
  //   --advanced        unlock advanced prompts
  //   --dir <path>      operate on that node's data directory
  //   --profile <name>  deploy profile (site | enterprise) for a first run
  //   --hostname, --tag, --email, --log-level, --agents, --notify, --yes
  //                     unattended enterprise install (no TTY)
  //   --site-name, --owner-password
  //                     the organization's space (first deploy / bootstrap-space)
  //   --email-relay-url, --email-relay-token
  //                     the hosting service's email relay instead of SMTP
  const advanced = rawAll.includes('--advanced')
  let dir: string | undefined
  let profile: DeployProfile | undefined
  const headless: HeadlessOptions = {}
  const valueFlags: Record<string, (v: string) => void> = {
    '--dir': (v) => (dir = v),
    '--profile': (v) => (profile = parseProfile(v)),
    '--hostname': (v) => (headless.hostname = v),
    '--tag': (v) => (headless.tag = v),
    '--email': (v) => (headless.email = v),
    '--log-level': (v) => (headless.logLevel = v),
    '--site-name': (v) => (headless.siteName = v),
    '--owner-password': (v) => (headless.ownerPassword = v),
    '--email-relay-url': (v) => (headless.emailRelayUrl = v),
    '--email-relay-token': (v) => (headless.emailRelayToken = v),
  }
  const boolFlags: Record<string, () => void> = {
    '--advanced': () => {},
    '--yes': () => (headless.yes = true),
    '--agents': () => (headless.agents = true),
    '--no-agents': () => (headless.agents = false),
    '--notify': () => (headless.notify = true),
    '--no-notify': () => (headless.notify = false),
  }
  const raw: string[] = []
  for (let i = 0; i < rawAll.length; i++) {
    const a = rawAll[i]
    if (boolFlags[a]) {
      boolFlags[a]()
      continue
    }
    if (valueFlags[a]) {
      valueFlags[a](rawAll[++i] ?? '')
      continue
    }
    const eq = a.indexOf('=')
    if (a.startsWith('--') && eq > 0 && valueFlags[a.slice(0, eq)]) {
      valueFlags[a.slice(0, eq)](a.slice(eq + 1))
      continue
    }
    raw.push(a)
  }
  const first = raw[0] ?? 'deploy'

  if (first === '--help' || first === '-h') return {command: 'help', args: [], advanced, dir, profile, headless}
  if (first === '--version' || first === '-v') return {command: 'version', args: [], advanced, dir, profile, headless}
  if (first === '--reconfigure')
    return {command: 'deploy', args: [], reconfigure: true, advanced, dir, profile, headless}

  if ((COMMANDS as readonly string[]).includes(first)) {
    const rest = raw.slice(1)
    const reconfigure = first === 'deploy' && rest.includes('--reconfigure')
    const args = reconfigure ? rest.filter((a) => a !== '--reconfigure') : rest
    return {command: first as CliCommand, args, reconfigure, advanced, dir, profile, headless}
  }

  console.error(`Unknown command: ${first}\n`)
  console.error('Your deploy script may be outdated; run seed-deploy upgrade\n')
  printHelp()
  process.exit(1)
}

export function printHelp(): void {
  const lines = [
    `Seed Node Deployment v${VERSION}`,
    ``,
    `Usage: seed-deploy [command] [options]`,
    ``,
    `Commands:`,
    `  deploy      Deploy or update the Seed node (default)`,
    `  upgrade     Update deploy script to latest version`,
    `  stop        Stop and remove all Seed containers`,
    `  start       Start containers without re-deploying`,
    `  restart     Restart all Seed containers`,
    `  doctor      Diagnose node health, versions, and connectivity`,
    `  secret      Print the site registration secret`,
    `  config      Print current configuration (secrets redacted)`,
    `  logs        Tail container logs [daemon|web|proxy|vault|notify|agents]`,
    `  cron        Install or remove automatic update cron jobs`,
    `  backup      Create a portable backup of all node data`,
    `  restore     Restore node data from a backup file`,
    `  uninstall   Remove all Seed containers, data, and configuration`,
    `  register    Register a space already on this daemon: register <accountUid>`,
    `  invite      Invite a person: invite <email> [--role reader|writer] [--no-email]  (enterprise)`,
    `  bootstrap-space  Create the organization's space if the first deploy could not  (enterprise)`,
    `  set-hostname  Move the node to a new hostname: set-hostname https://new.example.org  (enterprise)`,
    ``,
    `Options:`,
    `  --reconfigure  Re-run the setup wizard for the current node`,
    `  --advanced     Manage/create/switch nodes: pick the directory, custom tag, etc.`,
    `  --profile <p>  Deploy profile for a first run: site (default) or enterprise`,
    `  --hostname <url> --tag <tag> [--email <e>] [--log-level <l>] [--agents] [--notify] --yes`,
    `                 Unattended enterprise install (no wizard); SMTP from SEED_SMTP_HOST/USER/PASSWORD/SENDER`,
    `  --email-relay-url <url> --email-relay-token <token>`,
    `                 Send email through the Seed hosting relay instead of SMTP`,
    `                 (SEED_EMAIL_RELAY_URL / SEED_EMAIL_RELAY_TOKEN work too)`,
    `  --site-name <name> [--owner-password <pw>]`,
    `                 Name of the organization's space and a password for its exported owner key`,
    `                 (first enterprise deploy and bootstrap-space; SEED_OWNER_PASSWORD works too)`,
    `  -h, --help     Show this help message`,
    `  -v, --version  Show script version`,
    ``,
    `Examples:`,
    `  seed-deploy                            Deploy or update`,
    `  seed-deploy --profile enterprise       First-time setup of a private Enterprise node`,
    `  seed-deploy upgrade                    Update deploy script`,
    `  seed-deploy deploy --reconfigure       Change node configuration`,
    `  seed-deploy stop                       Teardown containers`,
    `  seed-deploy doctor                     Check node health`,
    `  seed-deploy secret                     Print registration secret`,
    `  seed-deploy logs daemon                Tail seed-daemon logs`,
    `  seed-deploy cron                       Install automatic update cron`,
    `  seed-deploy cron remove                Remove cron jobs`,
    `  seed-deploy backup                     Create backup`,
    `  seed-deploy backup /tmp/backup.tar.gz  Create backup at custom path`,
    `  seed-deploy restore backup.tar.gz      Restore from backup file`,
    ``,
  ]

  if (CLI_INSTALLED) {
    lines.push(
      `The 'seed-deploy' command is installed at /usr/local/bin/seed-deploy.`,
      `The deployment script lives at ${DEPLOY_SCRIPT_PATH}; node data defaults to ${DEFAULT_DATA_DIR} (override with --dir).`,
    )
  } else {
    lines.push(
      `The 'seed-deploy' CLI is not installed. You can run any command above with:`,
      `  ${CURL_INSTALL_CMD} -s -- <command>`,
      ``,
      `The deployment script lives at ${DEPLOY_SCRIPT_PATH}; node data defaults to ${DEFAULT_DATA_DIR} (override with --dir).`,
    )
  }

  console.log(lines.join('\n'))
}

// ---------------------------------------------------------------------------
// CLI: Commands
// ---------------------------------------------------------------------------

/**
 * Advanced step 1: choose which node's data directory to work on. Existing dir
 * (has config.json) → reconfigure it; new/empty dir → create a branch node
 * there. Defaults to the currently-running node. This is the single knob — the
 * `--dir` flag is just how the choice is carried, not something users type.
 */
async function promptNodeDir(current: DeployPaths, shell: ShellRunner): Promise<DeployPaths> {
  const running = getRunningInstallDir(shell)
  const chosen = await p.text({
    message: 'Node directory — existing dir reconfigures it; a new/empty dir creates a branch node',
    initialValue: running ?? current.seedDir,
    // Same value as the prefill: after clearing the field, the grey suggestion
    // (and Tab) must restore the current node dir, not the /opt/seed default.
    placeholder: running ?? current.seedDir,
    validate: (v) => {
      if (!v) return 'Required'
      if (!v.startsWith('/')) return 'Use an absolute path'
    },
  })
  if (p.isCancel(chosen)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }
  return makePaths(chosen as string)
}

/**
 * Only one node runs per host (shared container names). If another node's
 * stack is present — running or stopped, detected by compose project label or
 * by the daemon's data mount — confirm and take it over. Its data is
 * untouched. Returns true when the user approved a takeover, so later steps
 * can re-stop a raced resurrection without asking again.
 */
async function maybeStopOtherRunningNode(target: DeployPaths, shell: ShellRunner): Promise<boolean> {
  const foreign = detectForeignStack(shell, target)
  const running = getRunningInstallDir(shell)
  const otherDir = running && running !== target.seedDir ? running : null
  if (!foreign && !otherDir) return false
  const ok = await p.confirm({
    message: `Another node (${
      otherDir ?? `compose project '${foreign}'`
    }) owns the seed containers on this host. Stop it and switch to ${target.seedDir}? (its data is kept)`,
  })
  if (p.isCancel(ok) || !ok) {
    p.cancel('Cancelled — the running node was left in place.')
    process.exit(0)
  }
  takeOverHost(shell, foreign ?? composeProjectName(target))
  p.log.success(`Stopped the node${otherDir ? ` at ${otherDir}` : ''}. This one takes over when the deploy completes.`)
  return true
}

/**
 * Install/point the `seed-deploy` wrapper at this node's data dir. Written via
 * base64 to avoid shell-quoting pitfalls; falls back to sudo when /usr/local/bin
 * isn't writable.
 */
export function installWrapper(paths: DeployPaths, shell: ShellRunner): void {
  const bunPath = resolveBunPath(shell)
  const wrapper = '/usr/local/bin/seed-deploy'
  const content = `#!/bin/sh\nexec "${bunPath}" "${DEPLOY_SCRIPT_PATH}" --dir "${paths.seedDir}" "$@"\n`
  const b64 = Buffer.from(content).toString('base64')
  if (shell.runSafe(`echo ${b64} | base64 -d > ${wrapper} && chmod +x ${wrapper} && echo ok`) !== 'ok') {
    shell.runSafe(`echo ${b64} | base64 -d | sudo tee ${wrapper} >/dev/null && sudo chmod +x ${wrapper}`)
  }
}

/**
 * Make this dir the live node: point the cron and the wrapper at it.
 * Enterprise nodes get no auto-update cron (pinned updates are the policy;
 * `seed-deploy deploy` by hand still updates), and any seed cron left by a
 * previous site install on the host is disarmed so it cannot redeploy us.
 */
/**
 * Whether this node follows its image channel on its own (the ten-minute
 * `upgrade; deploy` cron). Sites always do. Enterprise nodes do on the two
 * preset channels: `latest`, so a release reaches them like everyone else, and
 * `dev`, which follows main (Seed's own test nodes). On any other channel (a
 * feature branch under test) updates stay a deliberate `seed-deploy deploy`,
 * so a pushed branch image cannot surprise the organization.
 */
export function autoUpdates(config: SeedConfig): boolean {
  return !isEnterprise(config) || isPresetReleaseChannel(config.release_channel)
}

async function setActiveNode(paths: DeployPaths, shell: ShellRunner, config?: SeedConfig): Promise<void> {
  if (config && !autoUpdates(config)) {
    clearSeedCron(shell)
    log(
      `Enterprise profile on the '${config.release_channel}' channel: automatic update cron not installed (updates are manual).`,
    )
  } else {
    await setupCron(paths, shell)
  }
  installWrapper(paths, shell)
}

function runWizardFor(
  profile: DeployProfile | undefined,
  paths: DeployPaths,
  existing: SeedConfig | undefined,
  advanced: boolean,
  bootstrap?: BootstrapOptions,
): Promise<SeedConfig> {
  const effective = profile ?? existing?.profile ?? 'site'
  return effective === 'enterprise'
    ? runEnterpriseWizard(paths, existing, advanced, bootstrap)
    : runFreshWizard(paths, existing, advanced)
}

async function cmdDeploy(
  paths: DeployPaths,
  shell: ShellRunner,
  reconfigure = false,
  advanced = false,
  profile?: DeployProfile,
  headless: HeadlessOptions = {},
): Promise<void> {
  checkDockerAccess(shell)
  const interactive = process.stdout.isTTY
  // Unattended enterprise install/reconfigure: `--yes` (or no TTY) with the
  // answers on the command line / in the environment instead of the wizard.
  const unattended = profile === 'enterprise' && (headless.yes || !interactive) && !!headless.hostname
  // What the first enterprise deploy needs to create the organization's space;
  // the wizard fills in the password when it is not given on the command line.
  const bootstrap = bootstrapOptionsFrom(headless)

  // Advanced + interactive: the data directory is the first choice, and it
  // drives everything — create a branch node in a new dir, or reconfigure /
  // switch to an existing one. Then, if a different node is live, offer to stop
  // it so this one can take over.
  let takeoverApproved = false
  if (advanced && interactive) {
    paths = await promptNodeDir(paths, shell)
    takeoverApproved = await maybeStopOtherRunningNode(paths, shell)
  }

  await ensureSeedDir(paths, shell)

  if (await configExists(paths)) {
    const existing = await readConfig(paths)
    if (profile && (existing.profile ?? 'site') !== profile) {
      throw new Error(
        `This node is configured with the '${existing.profile ?? 'site'}' profile; ` +
          `a profile cannot be switched in place. Use a fresh directory (--dir) for a '${profile}' node.`,
      )
    }
    if (unattended) {
      const config = headlessEnterpriseConfig(headless, existing)
      await writeConfig(config, paths)
      log(`Config updated from flags at ${paths.configPath}.`)
      await deploy(config, paths, shell, false, bootstrap, existing.domain)
      await setActiveNode(paths, shell, config)
      return
    }
    if ((reconfigure || advanced) && interactive) {
      const config = await runWizardFor(profile, paths, existing, advanced, bootstrap)
      await deploy(config, paths, shell, takeoverApproved, bootstrap, existing.domain)
      await setActiveNode(paths, shell, config)
      p.outro(`Reconfiguration complete! Your Seed node is running.\n${MANAGE_HINT}`)
      return
    }

    log(`Seed deploy v${VERSION} — config found at ${paths.configPath}, running headless.`)
    if (autoUpdates(existing)) {
      try {
        await migrateLegacyCron(paths, shell)
      } catch (err) {
        log(`WARNING: cron migration failed: ${err}`)
      }
    }
    await deploy(existing, paths, shell, false, bootstrap)
    return
  }

  if (unattended) {
    const config = headlessEnterpriseConfig(headless)
    await writeConfig(config, paths)
    log(`Seed deploy v${VERSION} — enterprise config written to ${paths.configPath} from flags.`)
    await deploy(config, paths, shell, takeoverApproved, bootstrap)
    await setActiveNode(paths, shell, config)
    log(`Setup complete. Next: '${cmd('invite you@example.org')}' for each person of the organization.`)
    return
  }
  if (!interactive) {
    throw new Error(
      `No config at ${paths.configPath} and no TTY for the wizard. ` +
        `For an unattended enterprise install pass --profile enterprise --hostname https://… --tag <tag> --yes.`,
    )
  }

  // The migration wizard only knows site installs; an enterprise first run is
  // always a fresh config.
  const oldInstall = profile === 'enterprise' ? null : await detectOldInstall(shell)
  const config = oldInstall
    ? await runMigrationWizard(oldInstall, paths, shell, advanced)
    : await runWizardFor(profile, paths, undefined, advanced, bootstrap)

  await deploy(config, paths, shell, takeoverApproved, bootstrap)
  await setActiveNode(paths, shell, config)
  p.outro(`Setup complete! Your Seed node is running.\n${MANAGE_HINT}`)
}

async function cmdUpgrade(paths: DeployPaths): Promise<void> {
  let deployUrl: string | undefined
  try {
    if (await configExists(paths)) {
      deployUrl = (await readConfig(paths)).deploy_url
    }
  } catch {
    // If config can't be read, use the upstream updater.
  }
  await selfUpdate(undefined, deployUrl)
}

/**
 * Env prefix for compose commands that act on an existing stack (stop, backup,
 * …). Compose only touches profiled services (notify, agents, metrics) when
 * their profiles are active, so COMPOSE_PROFILES must be set for those
 * commands too. Empty when there is no readable config.
 */
async function composeEnvPrefix(paths: DeployPaths): Promise<string> {
  try {
    if (!(await configExists(paths))) return ''
    return buildComposeEnv(await readConfig(paths), paths)
  } catch {
    return ''
  }
}

async function cmdStop(paths: DeployPaths, shell: ShellRunner): Promise<void> {
  checkDockerAccess(shell)
  console.log('Stopping and removing Seed containers...')
  const env = await composeEnvPrefix(paths)
  shell.runSafe(`${env} docker compose -f "${paths.composePath}" down`)
  console.log('All Seed containers stopped and removed.')
}

async function cmdStart(paths: DeployPaths, shell: ShellRunner): Promise<void> {
  checkDockerAccess(shell)
  if (!(await configExists(paths))) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first to set up.`)
    process.exit(1)
  }

  assertNoForeignStack(shell, paths)

  const config = await readConfig(paths)
  const envContent = buildComposeEnv(config, paths)

  console.log('Starting Seed containers...')
  shell.run(`${envContent} docker compose -f "${paths.composePath}" up -d --quiet-pull`)
  console.log('Seed containers started.')
}

async function cmdRestart(paths: DeployPaths, shell: ShellRunner): Promise<void> {
  await cmdStop(paths, shell)
  await cmdStart(paths, shell)
}

async function cmdDoctor(paths: DeployPaths, shell: ShellRunner): Promise<void> {
  checkDockerAccess(shell)
  console.log(`\nSeed Node Doctor v${VERSION}`)
  console.log('━'.repeat(40))

  // Configuration
  let config: SeedConfig | null = null
  if (await configExists(paths)) {
    config = await readConfig(paths)
    const enterprise = isEnterprise(config)
    console.log(`\nConfiguration:`)
    console.log(`  Profile:     ${enterprise ? 'Enterprise (private, web-only)' : 'Site'}`)
    console.log(`  Domain:      ${config.domain}`)
    console.log(`  Network:     ${enterprise ? 'Isolated (no P2P)' : config.testnet ? 'Testnet (devnet)' : 'Mainnet'}`)
    console.log(`  Channel:     ${config.release_channel}`)
    if (config.deploy_url) console.log(`  Deploy URL:  ${config.deploy_url}`)
    if (config.web_image) console.log(`  Web image:   ${config.web_image}`)
    if (config.site_image) console.log(`  Site image:  ${config.site_image}`)
    if (enterprise) {
      console.log(`  Notify:      ${config.notify ? notifyHost(config) : 'No'}`)
    } else {
      console.log(`  Gateway:     ${config.gateway ? 'Yes' : 'No'}`)
    }
    console.log(`  Agents:      ${config.agents ? `${agentsHost(config)}${config.agents_kvm ? ' (kvm)' : ''}` : 'No'}`)
    console.log(`  Config:      ${paths.configPath}`)
    for (const warning of configWarnings(config)) {
      console.log(`  ⚠ ${warning}`)
    }
  } else {
    console.log(`\nNo config found at ${paths.configPath}. Node is not set up.`)
  }

  // The live node may be managed from a *different* install directory than the
  // one we're inspecting (the recurring "two dirs on one host" trap). Compare
  // the running daemon's actual install dir against this one and warn loudly.
  const runningDir = getRunningInstallDir(shell)
  if (runningDir && runningDir !== paths.seedDir) {
    console.log(`\n  ⚠ The RUNNING node is managed from a different install: ${runningDir}`)
    console.log(`      You are inspecting ${paths.seedDir}, but the live containers belong to ${runningDir}.`)
    console.log(`      Manage the live node with: seed-deploy --dir ${runningDir} <command>.`)
  }

  // Containers
  console.log(`\nContainers:`)
  const containers = requiredContainers(config ?? undefined)
  let hasUnhealthy = false
  for (const name of containers) {
    const status = shell.runSafe(`docker inspect ${name} --format '{{.State.Status}}' 2>/dev/null`)
    const image = shell.runSafe(`docker inspect ${name} --format '{{.Config.Image}}' 2>/dev/null`)
    const started = shell.runSafe(`docker inspect ${name} --format '{{.State.StartedAt}}' 2>/dev/null`)
    if (status) {
      const symbol = status === 'running' ? '\u2714' : '\u26A0'
      console.log(
        `  ${symbol} ${name.padEnd(14)} ${(status ?? '').padEnd(10)} ${image ?? ''}${
          started ? `  (since ${started})` : ''
        }`,
      )
      if (status !== 'running') {
        hasUnhealthy = true
        const lastLog = shell.runSafe(`docker logs --tail 1 ${name} 2>&1`)
        if (lastLog) {
          console.log(`      └ ${lastLog.slice(0, 120)}`)
        }
      }
    } else {
      console.log(`  \u2718 ${name.padEnd(14)} not found`)
    }
  }

  if (hasUnhealthy) {
    console.log(`\n  Tip: Check logs with '${cmd('logs daemon|web|proxy')}'`)
  }

  // Configuration sync — compare running container state against config
  if (config) {
    const expectedLightning = config.testnet ? LIGHTNING_URL_TESTNET : LIGHTNING_URL_MAINNET
    const expectedTestnetName = config.testnet ? 'dev' : ''

    // Enterprise nodes have no lightning and a fixed private network name;
    // the public-network checks do not apply.
    const checks: Array<{container: string; envVar: string; expected: string; label?: string}> = isEnterprise(config)
      ? [
          {container: 'seed-daemon', envVar: 'SEED_P2P_TESTNET_NAME', expected: enterpriseTestnetName(config.domain)},
          {container: 'seed-daemon', envVar: 'SEED_LOG_LEVEL', expected: config.compose_envs.LOG_LEVEL},
          {container: 'seed-web', envVar: 'SEED_BASE_URL', expected: config.domain},
          {container: 'seed-web', envVar: 'SEED_IS_GATEWAY', expected: 'false'},
          {container: 'seed-web', envVar: 'SEED_ENABLE_STATISTICS', expected: 'false'},
          {container: 'seed-web', envVar: 'SEED_REQUIRE_SIGN_IN', expected: '1'},
          {
            container: 'seed-web',
            envVar: 'NOTIFY_SERVICE_HOST',
            expected: notifyHost(config),
            label: notifyHost(config) || '(empty, notify off)',
          },
        ]
      : [
          {
            container: 'seed-daemon',
            envVar: 'SEED_P2P_TESTNET_NAME',
            expected: expectedTestnetName,
            label: expectedTestnetName || '(empty, mainnet)',
          },
          {container: 'seed-daemon', envVar: 'LIGHTNING_API_URL', expected: expectedLightning},
          {container: 'seed-daemon', envVar: 'SEED_LOG_LEVEL', expected: config.compose_envs.LOG_LEVEL},
          {container: 'seed-web', envVar: 'SEED_BASE_URL', expected: config.domain},
          {container: 'seed-web', envVar: 'SEED_IS_GATEWAY', expected: String(config.gateway)},
          {container: 'seed-web', envVar: 'SEED_ENABLE_STATISTICS', expected: String(config.analytics)},
        ]

    // Gather env vars from running containers
    const daemonEnvs = getContainerEnvs(shell, 'seed-daemon')
    const webEnvs = getContainerEnvs(shell, 'seed-web')
    const envMaps: Record<string, Record<string, string>> = {
      'seed-daemon': daemonEnvs,
      'seed-web': webEnvs,
    }

    // Check image tags
    const imageChecks = expectedServiceImages(config)

    let hasMismatch = false
    const mismatches: string[] = []

    for (const {container, envVar, expected, label} of checks) {
      const actual = envMaps[container]?.[envVar]
      if (actual !== undefined && actual !== expected) {
        hasMismatch = true
        mismatches.push(
          `  \u26A0 ${container.padEnd(14)} ${envVar}: expected ${JSON.stringify(
            label ?? expected,
          )}, got ${JSON.stringify(actual)}`,
        )
      }
    }

    for (const {container, expectedImage} of imageChecks) {
      const actualImage = shell.runSafe(`docker inspect ${container} --format '{{.Config.Image}}' 2>/dev/null`)
      if (actualImage && actualImage !== expectedImage) {
        hasMismatch = true
        mismatches.push(`  \u26A0 ${container.padEnd(14)} image: expected ${expectedImage}, got ${actualImage}`)
      }
    }

    if (hasMismatch) {
      console.log(`\nConfiguration Sync:`)
      for (const m of mismatches) console.log(m)
      console.log(`\n  Tip: Run '${cmd('deploy')}' to reconcile running containers with config.`)
    }
  }

  // GPU acceleration check (only when daemon is running)
  const gpu = checkGpuAcceleration(shell)
  if (gpu.available) {
    console.log(`  \u2714 GPU            available via Vulkan`)
  } else if (gpu.reason !== 'not-running') {
    console.log(`  \u26A0 GPU            not available, embeddings will use CPU (slower)`)
    if (gpu.reason === 'no-dev-dri') {
      console.log(`      \u2514 /dev/dri not found in container; host may lack a GPU`)
    } else {
      console.log(`      \u2514 /dev/dri present but no Vulkan ICD found; install GPU vendor drivers on host`)
    }
  }

  // Monitoring export check (only shown when metrics profile is active)
  const prometheusRunning = shell.runSafe(`docker inspect prometheus --format '{{.State.Status}}' 2>/dev/null`)
  const grafanaRunning = shell.runSafe(`docker inspect grafana --format '{{.State.Status}}' 2>/dev/null`)
  if (prometheusRunning || grafanaRunning) {
    const prometheusConfig = join(paths.seedDir, 'monitoring', 'prometheus', 'prometheus.yaml')
    const grafanaProvDir = join(paths.seedDir, 'monitoring', 'grafana', 'provisioning')
    let monitoringOk = true

    console.log(`\nMonitoring:`)
    try {
      await access(prometheusConfig)
      console.log(`  \u2714 Prometheus config exported`)
    } catch {
      monitoringOk = false
      console.log(`  \u26A0 Prometheus config not exported`)
    }
    try {
      await access(grafanaProvDir)
      console.log(`  \u2714 Grafana provisioning exported`)
    } catch {
      monitoringOk = false
      console.log(`  \u26A0 Grafana provisioning not exported`)
    }
    if (!monitoringOk) {
      console.log(`\n  Tip: This may indicate a permissions issue with the monitoring/ directory.`)
      console.log(`        Run '${cmd('deploy')}' to attempt an automatic fix.`)
    }
  }

  // Health checks (only if config exists and domain is set)
  if (config) {
    console.log(`\nHealth Checks:`)
    const dns = extractDns(config.domain)

    // HTTPS check
    const httpResult = shell.runSafe(
      `curl -sS -o /dev/null -w '%{http_code} %{time_total}' --max-time 30 "${config.domain}" 2>/dev/null`,
    )
    if (httpResult) {
      const [code, timeStr] = httpResult.split(' ')
      const latency = parseFloat(timeStr)
      console.log(`  \u2714 HTTPS          OK (${code})`)
      if (!isNaN(latency)) {
        const latencyMs = Math.round(latency * 1000)
        const symbol = latency > 2 ? '\u26A0' : '\u2714'
        const suffix = latency > 2 ? ' — high latency, check server resources' : ''
        console.log(`  ${symbol} Latency        ${latencyMs}ms${suffix}`)
      }
    } else {
      console.log(`  \u26A0 HTTPS          unreachable`)
    }

    // DNS check
    const publicIp = shell.runSafe('curl -4 -s --max-time 5 ifconfig.me 2>/dev/null')
    const dnsResult = shell.runSafe(`dig +short ${dns} A 2>/dev/null | head -1`)
    if (publicIp && dnsResult) {
      if (dnsResult.trim() === publicIp.trim()) {
        console.log(`  \u2714 DNS            ${dns} -> ${dnsResult} (matches public IP)`)
      } else {
        console.log(`  \u26A0 DNS            ${dns} -> ${dnsResult} (public IP is ${publicIp})`)
      }
    } else if (!dnsResult) {
      console.log(`  \u26A0 DNS            ${dns} does not resolve`)
    } else {
      console.log(`  ? DNS            could not determine public IP`)
    }

    // TLS certificate check
    const certExpiry = shell.runSafe(
      `echo | openssl s_client -servername "${dns}" -connect "${dns}:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null`,
    )
    if (certExpiry) {
      const expiryDate = certExpiry.replace('notAfter=', '')
      const expiry = new Date(expiryDate)
      const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86_400_000)
      const symbol = daysLeft > 14 ? '\u2714' : '\u26A0'
      console.log(`  ${symbol} Certificate    valid, expires ${expiry.toISOString().slice(0, 10)} (${daysLeft}d)`)
    } else {
      console.log(`  \u26A0 Certificate    could not check`)
    }

    const webEnvJson = shell.runSafe("docker inspect seed-web --format '{{json .Config.Env}}' 2>/dev/null")
    let webPort = '3000'
    if (webEnvJson) {
      try {
        const envs = JSON.parse(webEnvJson) as string[]
        const portEnv = envs.find((entry) => entry.startsWith('PORT='))
        const port = portEnv?.split('=')[1]?.trim()
        if (port && /^\d+$/.test(port)) {
          webPort = port
        }
      } catch {
        // ignore invalid env JSON and keep default port
      }
    }

    // Enterprise nodes publish no web port; /hm/api/config is open through the proxy.
    const siteConfigUrl = isEnterprise(config)
      ? `${config.domain}/hm/api/config`
      : `http://127.0.0.1:${webPort}/hm/api/config`
    const siteConfigRaw = shell.runSafe(`curl -sS --max-time 10 "${siteConfigUrl}" 2>/dev/null`)
    if (!siteConfigRaw) {
      console.log(`  \u26A0 Site           could not check`)
    } else {
      try {
        const siteConfig = JSON.parse(siteConfigRaw) as {
          registeredAccountUid?: string
        }
        const accountUid = siteConfig.registeredAccountUid?.trim()
        if (accountUid) {
          const shortUid = accountUid.length > 16 ? `${accountUid.slice(0, 8)}...${accountUid.slice(-6)}` : accountUid
          console.log(`  \u2714 Site           registered (${shortUid})`)
        } else {
          console.log(`  \u26A0 Site           not registered`)
          if (isEnterprise(config)) {
            console.log(`      Tip: Run '${cmd('bootstrap-space')}' to create the organization's space.`)
          } else {
            console.log(`      Tip: Run '${cmd('secret')}' to get the registration URL,`)
            console.log('      then paste it into the Seed desktop app to register.')
          }
        }
      } catch {
        console.log(`  \u26A0 Site           could not check`)
      }
    }

    if (isEnterprise(config)) {
      console.log(`\nIsolation:`)
      for (const line of enterpriseIsolationChecks(shell, config)) console.log(line)
    }
  }

  // Disk usage
  const du = shell.runSafe(`du -sh "${paths.seedDir}" 2>/dev/null`)
  if (du) {
    console.log(`\nDisk:`)
    console.log(`  ${paths.seedDir}  ${du.split('\t')[0]}`)
  }

  // Cron
  const crontab = shell.runSafe('crontab -l 2>/dev/null') ?? ''
  const deployCron = crontab.split('\n').find((l) => l.includes('# seed-deploy'))
  const cleanupCron = crontab.split('\n').find((l) => l.includes('# seed-cleanup'))
  console.log(`\nCron:`)
  console.log(`  Auto-update: ${deployCron ? deployCron.split(' ').slice(0, 5).join(' ') : 'not installed'}`)
  console.log(`  Cleanup:     ${cleanupCron ? cleanupCron.split(' ').slice(0, 5).join(' ') : 'not installed'}`)
  if (config && isEnterprise(config)) {
    if (deployCron) {
      console.log(
        `\n  ⚠ Enterprise nodes update manually; this cron will redeploy on every new image. '${cmd(
          'cron remove',
        )}' removes it.`,
      )
    } else {
      console.log(`  (Enterprise profile: updates are manual — run '${cmd('deploy')}' to update.)`)
    }
  } else if (!deployCron || !cleanupCron) {
    console.log(`\n  Tip: Run '${cmd('cron')}' to set up automatic updates.`)
  }

  console.log('')
}

/**
 * Doctor lines for the enterprise isolation guarantees: the daemon publishes
 * no host ports, every page requires sign-in, and the vault answers under the
 * site origin. Pure over the shell so tests can drive it with a mock.
 */
export function enterpriseIsolationChecks(shell: ShellRunner, config: SeedConfig): string[] {
  const lines: string[] = []

  // 1. No published ports on the daemon: nothing can reach it from outside.
  const ports = shell.runSafe('docker port seed-daemon 2>/dev/null')
  if (ports === null) {
    lines.push(`  ⚠ Daemon ports   could not check (is seed-daemon running?)`)
  } else if (ports.trim() === '') {
    lines.push(`  ✔ Daemon ports   none published (P2P unreachable from outside)`)
  } else {
    lines.push(`  ✘ Daemon ports   PUBLISHED: ${ports.replace(/\n/g, '; ')}`)
    lines.push(`      └ the enterprise compose template has no ports on seed-daemon; redeploy with '${cmd('deploy')}'`)
  }

  // 2. The web app enforces sign-in (what the Caddy gate assumes).
  const siteConfigRaw = shell.runSafe(`curl -sS --max-time 10 "${config.domain}/hm/api/config" 2>/dev/null`)
  if (!siteConfigRaw) {
    lines.push(`  ⚠ Sign-in gate   could not fetch ${config.domain}/hm/api/config`)
  } else {
    try {
      const siteConfig = JSON.parse(siteConfigRaw) as {requireSignIn?: boolean}
      if (siteConfig.requireSignIn === true) {
        lines.push(`  ✔ Sign-in gate   /hm/api/config reports requireSignIn: true`)
      } else {
        lines.push(
          `  ✘ Sign-in gate   /hm/api/config reports requireSignIn: ${JSON.stringify(siteConfig.requireSignIn)}`,
        )
        lines.push(`      └ seed-web should run with SEED_REQUIRE_SIGN_IN=1; redeploy with '${cmd('deploy')}'`)
      }
    } catch {
      lines.push(`  ⚠ Sign-in gate   /hm/api/config is not JSON`)
    }
  }

  // 2b. The space's home document still names this hostname.
  const siteUrlRaw = shell.runSafe(`curl -sS --max-time 10 "${config.domain}/hm/api/site-url" 2>/dev/null`)
  if (siteUrlRaw) {
    try {
      lines.push(...siteUrlCheck(JSON.parse(siteUrlRaw) as {hostname?: string; siteUrl?: unknown}))
    } catch {
      lines.push(`  ⚠ Site URL       /hm/api/site-url is not JSON`)
    }
  }

  // 3. The proxy gate: a cookie-less GET / must bounce to the sign-in page.
  const gate = shell.runSafe(
    `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 "${config.domain}/" 2>/dev/null`,
  )
  if (!gate) {
    lines.push(`  ⚠ Proxy gate     could not fetch ${config.domain}/`)
  } else {
    const [code, redirect = ''] = gate.trim().split(' ')
    if (code === '302' && redirect.includes('/hm/sign-in')) {
      lines.push(`  ✔ Proxy gate     GET / without a session → 302 ${redirect}`)
    } else if (code === '401') {
      lines.push(`  ✔ Proxy gate     GET / without a session → 401`)
    } else {
      lines.push(`  ✘ Proxy gate     GET / without a session answered ${code}${redirect ? ` → ${redirect}` : ''}`)
      lines.push(`      └ the Caddyfile's forward_auth gate is not in effect; redeploy with '${cmd('deploy')}'`)
    }
  }

  // 4. The session route itself refuses a cookie-less caller (proves the
  // web app's gate is live, independent of the proxy).
  const session = shell.runSafe(
    `curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${config.domain}${SESSION_CHECK_URI}" 2>/dev/null`,
  )
  if (!session) {
    lines.push(`  \u26A0 Session check  could not fetch ${config.domain}${SESSION_CHECK_URI}`)
  } else if (session.trim() === '401') {
    lines.push(`  \u2714 Session check  ${SESSION_CHECK_URI} without a session → 401`)
  } else {
    lines.push(`  \u2718 Session check  ${SESSION_CHECK_URI} without a session answered ${session.trim()}`)
    lines.push(`      \u2514 seed-web should run with SEED_REQUIRE_SIGN_IN=1 and SEED_SESSION_SECRET set`)
  }

  // 5. The vault is reachable through the proxy at /vault/.
  const vaultStatus = shell.runSafe(
    `curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${config.domain}/vault/" 2>/dev/null`,
  )
  if (vaultStatus && /^2\d\d$/.test(vaultStatus.trim())) {
    lines.push(`  ✔ Vault          ${config.domain}/vault/ (${vaultStatus.trim()})`)
  } else {
    lines.push(`  ✘ Vault          ${config.domain}/vault/ answered ${vaultStatus?.trim() || 'nothing'}`)
    lines.push(`      └ check '${cmd('logs vault')}'`)
  }

  return lines
}

/**
 * Doctor lines comparing the hostname the web app serves with the `siteUrl`
 * the space's home document carries (both from /hm/api/site-url). They drift
 * apart when config.json's domain was changed without `set-hostname`.
 */
export function siteUrlCheck(siteConfig: {hostname?: string; siteUrl?: unknown}): string[] {
  if (typeof siteConfig.siteUrl !== 'string' || !siteConfig.hostname) return []
  if (siteConfig.siteUrl === siteConfig.hostname) {
    return [`  ✔ Site URL       the space's home document points at ${siteConfig.hostname}`]
  }
  return [
    `  ⚠ Site URL       the space's home document points at ${siteConfig.siteUrl}, the site is ${siteConfig.hostname}`,
    `      └ republish it with '${cmd(`set-hostname ${siteConfig.hostname}`)}'`,
  ]
}

async function cmdConfig(paths: DeployPaths): Promise<void> {
  if (!(await configExists(paths))) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first.`)
    process.exit(1)
  }

  const config = await readConfig(paths)
  console.log(JSON.stringify(redactConfig(config), null, 2))
}

/** The config as `seed-deploy config` prints it: every secret masked. */
export function redactConfig(config: SeedConfig): SeedConfig {
  const redacted: SeedConfig = {...config, link_secret: '****'}
  if (config.vault_admin_secret) redacted.vault_admin_secret = '****'
  if (config.session_secret) redacted.session_secret = '****'
  if (config.service_secret) redacted.service_secret = '****'
  if (config.smtp?.password) redacted.smtp = {...config.smtp, password: '****'}
  if (config.email_relay_token) redacted.email_relay_token = '****'
  return redacted
}

// ---------------------------------------------------------------------------
// Enterprise commands: register, invite
// ---------------------------------------------------------------------------

/** Minimal fetch wrapper: JSON in, JSON out, with the HTTP status on failure. */
async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    // not JSON — keep the raw text for the error message
  }
  if (!response.ok) {
    const detail = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
    throw new Error(`${url} → HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`)
  }
  return parsed
}

// ---------------------------------------------------------------------------
// Enterprise: the organization's space
// ---------------------------------------------------------------------------

/** Where the first deploy leaves the exported root key of the space. */
export const OWNER_KEY_DIR = 'owner-key'

export function ownerKeyPath(paths: DeployPaths, accountUid: string): string {
  return join(paths.seedDir, OWNER_KEY_DIR, `${accountUid}.hmkey.json`)
}

/** The web app answers a moment after its container does; ~30s covers it. */
export const BOOTSTRAP_ATTEMPTS = 6
export const BOOTSTRAP_RETRY_MS = 5000

export type BootstrapResult =
  | {status: 'created'; accountUid: string; name: string; keyPath: string}
  | {status: 'exists'; accountUid: string}

type BootstrapIo = {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  log?: (line: string) => void
}

/**
 * Ask the web app to create the organization's space and register the site
 * to it (`POST /hm/api/enterprise-bootstrap`, authorized by the vault admin
 * secret), then keep the key file it returns under `owner-key/` with owner-
 * only permissions and record the account in config.json. Idempotent: a site
 * that is already registered answers 409 with its account, which is returned
 * as `exists`. Retries while the web app is still coming up.
 */
export async function bootstrapSpace(
  config: SeedConfig,
  paths: DeployPaths,
  opts: BootstrapOptions = {},
  io: BootstrapIo = {},
): Promise<BootstrapResult> {
  if (!isEnterprise(config) || !config.vault_admin_secret) {
    throw new Error("Creating the organization's space needs an enterprise node (no vault_admin_secret in config).")
  }
  const name = opts.siteName?.trim() || config.site_name || extractDns(config.domain)
  const url = `${config.domain}/hm/api/enterprise-bootstrap`
  const body: {name: string; ownerPassword?: string} = {name}
  if (opts.ownerPassword) body.ownerPassword = opts.ownerPassword

  const answer = await postAdminRoute(url, config.vault_admin_secret, body, io, {
    waiting: 'Space not created yet',
    failure: "Could not create the organization's space",
  })
  const result = answer.result
  if (answer.ok) {
    const accountUid = typeof result.accountUid === 'string' ? result.accountUid : ''
    if (!accountUid || !result.keyFile) throw new Error(`${url} answered without an account or key file`)
    const keyPath = ownerKeyPath(paths, accountUid)
    await mkdir(dirname(keyPath), {recursive: true, mode: 0o700})
    await chmod(dirname(keyPath), 0o700)
    await writeFile(keyPath, `${JSON.stringify(result.keyFile, null, 2)}\n`, {encoding: 'utf-8', mode: 0o600})
    await chmod(keyPath, 0o600)
    config.owner_account_uid = accountUid
    config.site_name = typeof result.name === 'string' && result.name ? result.name : name
    await writeConfig(config, paths)
    return {status: 'created', accountUid, name: config.site_name, keyPath}
  }
  if (answer.status === 409 && typeof result.accountUid === 'string') {
    return {status: 'exists', accountUid: result.accountUid}
  }
  if (answer.status === 404) {
    throw new Error(
      `${url} → HTTP 404: the web app has no bootstrap route. ` +
        `Its image predates it, or SEED_VAULT_ADMIN_SECRET is not set on seed-web; ` +
        `after '${cmd('deploy')}' with current images run '${cmd('bootstrap-space')}'.`,
    )
  }
  throw new Error(`${url} → HTTP ${answer.status}${answer.detail ? `: ${answer.detail.slice(0, 500)}` : ''}`)
}

type AdminAnswer = {
  status: number
  ok: boolean
  /** The JSON body as an object; empty when the body was not one. */
  result: Record<string, unknown>
  /** The body as text for error messages. */
  detail: string
}

/**
 * POST to one of the web app's admin routes with the vault admin secret,
 * retrying connection errors and 5xx while the web app is still coming up.
 * Any answer below 500 is returned for the caller to interpret.
 */
async function postAdminRoute(
  url: string,
  secret: string,
  body: unknown,
  io: BootstrapIo,
  messages: {waiting: string; failure: string},
): Promise<AdminAnswer> {
  const doFetch = io.fetch ?? fetch
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let lastError = ''
  for (let attempt = 1; attempt <= BOOTSTRAP_ATTEMPTS; attempt++) {
    let response: Response | null = null
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {'content-type': 'application/json', authorization: `Bearer ${secret}`},
        body: JSON.stringify(body),
      })
    } catch (err) {
      lastError = `${url}: ${err instanceof Error ? err.message : String(err)}`
    }
    if (response) {
      const text = await response.text()
      let parsed: unknown = text
      try {
        parsed = JSON.parse(text)
      } catch {
        // not JSON — keep the raw text for the error message
      }
      const detail = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
      if (response.status < 500) {
        const result = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
        return {status: response.status, ok: response.ok, result, detail}
      }
      lastError = `${url} → HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`
    }
    if (attempt < BOOTSTRAP_ATTEMPTS) {
      io.log?.(`${messages.waiting} (${lastError}); retrying in ${BOOTSTRAP_RETRY_MS / 1000}s...`)
      await sleep(BOOTSTRAP_RETRY_MS)
    }
  }
  throw new Error(`${messages.failure} after ${BOOTSTRAP_ATTEMPTS} attempts: ${lastError}`)
}

/** What the operator reads after the space exists: its account, the key file, how to take root. */
export function describeBootstrap(config: SeedConfig, result: BootstrapResult): string[] {
  if (result.status === 'exists') {
    return [`The site is already registered to the space ${result.accountUid}; nothing to create.`]
  }
  return [
    `Created the organization's space "${result.name}": ${result.accountUid}`,
    `Owner key file (the root of the space): ${result.keyPath}`,
    `To take root, import it in the vault at ${config.domain}/vault/settings (Import identity),`,
    `with the desktop app's key import, or 'seed-cli key import ${result.keyPath}'.`,
    'The mnemonic was never stored; this file is the only copy of the key outside the daemon.',
  ]
}

async function bootstrapAfterDeploy(
  config: SeedConfig,
  paths: DeployPaths,
  opts: BootstrapOptions,
  progress: (msg: string) => void,
): Promise<string[]> {
  try {
    const result = await bootstrapSpace(config, paths, opts, {log: progress})
    return describeBootstrap(config, result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return [
      `The organization's space could not be created: ${message}`,
      `The node is up; retry with '${cmd('bootstrap-space')}'.`,
    ]
  }
}

export type SiteUrlResult = {
  accountUid: string
  siteUrl: string
  /** False when the home document already pointed at this hostname. */
  changed: boolean
  previousSiteUrl: string | null
}

/**
 * Ask the web app to republish the organization's home document with
 * `siteUrl` = the site's current hostname (`POST /hm/api/enterprise-site-url`,
 * authorized by the vault admin secret). The deploy rewrites the Caddyfile and
 * the containers' env on a hostname change, but the space's own record of its
 * address lives in that document. Idempotent: an up-to-date document answers
 * `changed: false`.
 */
export async function setSiteUrl(config: SeedConfig, io: BootstrapIo = {}): Promise<SiteUrlResult> {
  if (!isEnterprise(config) || !config.vault_admin_secret) {
    throw new Error("Updating the space's site URL needs an enterprise node (no vault_admin_secret in config).")
  }
  const url = `${config.domain}/hm/api/enterprise-site-url`
  const answer = await postAdminRoute(url, config.vault_admin_secret, {}, io, {
    waiting: 'Site URL not updated yet',
    failure: "Could not update the space's site URL",
  })
  const result = answer.result
  if (answer.ok) {
    const accountUid = typeof result.accountUid === 'string' ? result.accountUid : ''
    const siteUrl = typeof result.siteUrl === 'string' ? result.siteUrl : ''
    if (!accountUid || !siteUrl) throw new Error(`${url} answered without an account or site URL`)
    return {
      accountUid,
      siteUrl,
      changed: result.changed === true,
      previousSiteUrl: typeof result.previousSiteUrl === 'string' ? result.previousSiteUrl : null,
    }
  }
  if (answer.status === 404) {
    throw new Error(
      `${url} → HTTP 404: the web app has no site-url route. ` +
        `Its image predates it, or SEED_VAULT_ADMIN_SECRET is not set on seed-web; ` +
        `after '${cmd('deploy')}' with current images run '${cmd(`set-hostname ${config.domain}`)}'.`,
    )
  }
  if (answer.status === 409) {
    throw new Error(`${url} → HTTP 409: the site has no registered space yet; run '${cmd('bootstrap-space')}' first.`)
  }
  throw new Error(`${url} → HTTP ${answer.status}${answer.detail ? `: ${answer.detail.slice(0, 500)}` : ''}`)
}

/** What the operator reads after the site URL was checked. */
export function describeSiteUrl(result: SiteUrlResult): string[] {
  if (!result.changed) {
    return [`The space ${result.accountUid} already points at ${result.siteUrl}; nothing to republish.`]
  }
  return [
    `Republished the home document of ${result.accountUid}: siteUrl is now ${result.siteUrl}` +
      (result.previousSiteUrl ? ` (was ${result.previousSiteUrl}).` : '.'),
    'Passkeys are bound to the hostname: people who registered one on the old address',
    'sign in with their password and add a new passkey in the vault.',
  ]
}

async function syncSiteUrlAfterDeploy(config: SeedConfig, progress: (msg: string) => void): Promise<string[]> {
  try {
    return describeSiteUrl(await setSiteUrl(config, {log: progress}))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return [
      `The space's site URL could not be updated: ${message}`,
      `The node is up on ${config.domain}; retry with '${cmd(`set-hostname ${config.domain}`)}'.`,
    ]
  }
}

/**
 * `set-hostname https://new.example.org` — move an enterprise node to a new
 * public hostname: rewrite the config, redeploy (Caddyfile, certificates,
 * every container's env), then republish the space's home document so its
 * `siteUrl` follows. The DNS record must point at this server before this
 * runs, or the proxy cannot get a certificate for the new name.
 */
async function cmdSetHostname(paths: DeployPaths, shell: ShellRunner, args: string[]): Promise<void> {
  const hostname = (args[0] ?? '').trim().replace(/\/+$/, '')
  const urlError = hostname ? validateUrl(hostname) : 'Required'
  if (urlError) {
    console.error(`Usage: ${cmd('set-hostname https://new.example.org')} (${urlError})`)
    process.exit(1)
  }
  if (!(await configExists(paths))) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first.`)
    process.exit(1)
  }
  const config = await readConfig(paths)
  if (!isEnterprise(config) || !config.vault_admin_secret) {
    console.error(
      `'${cmd('set-hostname')}' needs an enterprise node; on a site run '${cmd('deploy --reconfigure')}' instead.`,
    )
    process.exit(1)
  }
  const previous = config.domain
  if (previous !== hostname) {
    config.domain = hostname
    // The old address keeps working: Caddy keeps its certificate and
    // redirects to the new hostname.
    config.redirect_hostnames = redirectHostnames({
      domain: hostname,
      redirect_hostnames: [...(config.redirect_hostnames ?? []), extractDns(previous)],
    })
    await writeConfig(config, paths)
    log(`Hostname changed from ${previous} to ${hostname}; ${extractDns(previous)} will redirect there. Redeploying.`)
    await deploy(config, paths, shell, false, {}, previous)
    return
  }
  // Same hostname: the deploy has nothing to change, but the document may
  // still name an older address (a hand edit of config.json, a failed sync).
  log(`The hostname is already ${hostname}; checking the space's site URL.`)
  for (const line of describeSiteUrl(await setSiteUrl(config, {log: (line) => console.log(line)}))) console.log(line)
}

/**
 * `bootstrap-space [--site-name …] [--owner-password …]` — create the
 * organization's space by hand, for when the first deploy's attempt failed.
 */
async function cmdBootstrapSpace(paths: DeployPaths, headless: HeadlessOptions): Promise<void> {
  if (!(await configExists(paths))) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first.`)
    process.exit(1)
  }
  const config = await readConfig(paths)
  if (!isEnterprise(config) || !config.vault_admin_secret) {
    console.error(`'${cmd('bootstrap-space')}' needs an enterprise node (no vault_admin_secret in config).`)
    process.exit(1)
  }
  const result = await bootstrapSpace(config, paths, bootstrapOptionsFrom(headless), {
    log: (line) => console.log(line),
  })
  for (const line of describeBootstrap(config, result)) console.log(line)
}

/**
 * `register <accountUid>` — register a space that already lives on this
 * daemon with the web app, the same call the Seed desktop app makes from
 * /hm/register, minus the P2P push (there is no P2P on an enterprise node and
 * the content is already local). Consumes the registration secret.
 */
async function cmdRegister(paths: DeployPaths, args: string[]): Promise<void> {
  const accountUid = args[0]
  if (!accountUid) {
    console.error(`Usage: ${cmd('register <accountUid>')}`)
    process.exit(1)
  }
  if (!(await configExists(paths))) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first.`)
    process.exit(1)
  }
  const config = await readConfig(paths)
  if (!config.link_secret) {
    console.error('No registration secret found in config.')
    process.exit(1)
  }

  const configUrl = `${config.domain}/hm/api/config`
  const siteResponse = await fetch(configUrl)
  if (!siteResponse.ok) throw new Error(`${configUrl} → HTTP ${siteResponse.status}`)
  const siteConfig = (await siteResponse.json()) as {peerId?: string; registeredAccountUid?: string}
  if (siteConfig.registeredAccountUid) {
    console.error(`This site is already registered to ${siteConfig.registeredAccountUid}.`)
    console.error(`To re-register, reset web/config.json as described in the self-hosting guide and restart.`)
    process.exit(1)
  }
  if (!siteConfig.peerId) throw new Error(`${configUrl} did not report a peerId; is the daemon running?`)

  const result = await postJson(`${config.domain}/hm/api/register`, {
    registrationSecret: config.link_secret,
    accountUid,
    peerId: siteConfig.peerId,
    addrs: [],
  })
  console.log(JSON.stringify(result, null, 2))
  console.log(`\nRegistered ${accountUid} at ${config.domain}.`)
}

/** Pull invitation links out of whatever shape the vault's admin API returns. */
export function extractInvitationLinks(result: unknown, vaultBase: string): string[] {
  if (!result || typeof result !== 'object') return []
  const r = result as Record<string, unknown>
  const toLink = (item: unknown): string | null => {
    if (typeof item === 'string') return item.startsWith('http') ? item : `${vaultBase}?invite=${item}`
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      if (typeof o.link === 'string') return o.link
      if (typeof o.url === 'string') return o.url
      if (typeof o.code === 'string') {
        const email = typeof o.email === 'string' && o.email ? `&email=${encodeURIComponent(o.email)}` : ''
        return `${vaultBase}?invite=${o.code}${email}`
      }
    }
    return null
  }
  const lists = [r.invitations, r.links, r.codes].filter(Array.isArray) as unknown[][]
  if (lists.length > 0) return lists[0].map(toLink).filter((l): l is string => !!l)
  const single = toLink(r)
  return single ? [single] : []
}

/** Parsed `invite` arguments: the email, the role and whether the vault should email the link. */
export function parseInviteArgs(args: string[]): {
  email?: string
  role: 'reader' | 'writer'
  send: boolean
  count?: number
  error?: string
} {
  let email: string | undefined
  let role: 'reader' | 'writer' = 'reader'
  let send = true
  let count: number | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--role' || a.startsWith('--role=')) {
      const value = a.includes('=') ? a.slice('--role='.length) : args[++i]
      if (value !== 'reader' && value !== 'writer')
        return {role, send, error: `--role must be reader or writer, not '${value ?? ''}'`}
      role = value
    } else if (a === '--writer') role = 'writer'
    else if (a === '--reader') role = 'reader'
    else if (a === '--no-email') send = false
    else if (/^\d+$/.test(a)) count = Number(a)
    else if (a.includes('@')) email = a
    else return {role, send, error: `unexpected argument '${a}'`}
  }
  return {email, role, send, count}
}

/**
 * `invite <email> [--role reader|writer] [--no-email]` — ask the vault's admin
 * API for an invitation. The vault is invite-only on an enterprise node, so
 * this is how the organization's people get an account. The vault emails the
 * one-time link to the person (through the hosting relay) unless --no-email;
 * a writer invitation also grants them a WRITER capability on the space once
 * their account exists.
 */
async function cmdInvite(paths: DeployPaths, args: string[]): Promise<void> {
  if (!(await configExists(paths))) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first.`)
    process.exit(1)
  }
  const config = await readConfig(paths)
  if (!isEnterprise(config) || !config.vault_admin_secret) {
    console.error(`'${cmd('invite')}' needs an enterprise node (no vault_admin_secret in config).`)
    process.exit(1)
  }

  const parsed = parseInviteArgs(args)
  if (parsed.error) {
    console.error(`${parsed.error}. Usage: ${cmd('invite <email> [--role reader|writer] [--no-email]')}`)
    process.exit(1)
  }
  const {email, role, send, count} = parsed
  if (!email) {
    console.error(
      `'${cmd(
        'invite <email>',
      )}' needs the invitee's email: invitations are scoped to one address and the link carries it.`,
    )
    process.exit(1)
  }
  const body: {email?: string; count?: number; role: string; send: boolean} = {email, role, send}
  if (count) body.count = count

  const vaultBase = `${config.domain}/vault`
  const result = await postJson(`${vaultBase}/api/admin/invitations`, body, {
    authorization: `Bearer ${config.vault_admin_secret}`,
  })
  const links = extractInvitationLinks(result, vaultBase)
  if (links.length === 0) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(`Invitation for ${email} (${role}):`)
  for (const link of links) console.log(`  ${link}`)
  const r = (result ?? {}) as {emailed?: boolean; emailError?: string}
  if (r.emailed) console.log(`Emailed to ${email}.`)
  else if (send) console.log(`Not emailed: ${r.emailError ?? 'the vault did not send it'}. Share the link by hand.`)
  else console.log('Not emailed (--no-email). Share the link by hand.')
  if (role === 'writer') console.log('They become a writer of the space as soon as their account exists.')
}

async function cmdSecret(paths: DeployPaths): Promise<void> {
  if (!(await configExists(paths))) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first.`)
    process.exit(1)
  }

  const config = await readConfig(paths)
  if (!config.link_secret) {
    console.error('No registration secret found in config.')
    process.exit(1)
  }

  console.log(`${config.domain}/hm/register?secret=${config.link_secret}`)
  if (config.owner_account_uid) {
    console.log(`Owner key of the space ${config.owner_account_uid}: ${ownerKeyPath(paths, config.owner_account_uid)}`)
  }
}

async function cmdLogs(paths: DeployPaths, args: string[]): Promise<void> {
  const service = args[0]
  const serviceName = service ? `seed-${service}` : ''
  try {
    execSync(`docker compose -f "${paths.composePath}" logs -f --tail 100 ${serviceName}`, {stdio: 'inherit'})
  } catch {
    // User pressed Ctrl+C — normal exit
  }
}

async function cmdCron(paths: DeployPaths, shell: ShellRunner, args: string[]): Promise<void> {
  const subcommand = args[0] ?? 'install'

  if (subcommand === 'remove') {
    const existing = shell.runSafe('crontab -l 2>/dev/null') ?? ''
    if (!existing.includes('# seed-deploy') && !existing.includes('# seed-cleanup')) {
      console.log('No seed cron jobs found. Nothing to remove.')
      return
    }
    const cleaned = removeSeedCronLines(existing)
    try {
      shell.run(`echo '${cleaned}' | crontab -`)
      console.log('Seed cron jobs removed.')
    } catch (err) {
      console.error(`Failed to remove cron jobs: ${err}`)
      process.exit(1)
    }
    return
  }

  if (subcommand === 'install') {
    await setupCron(paths, shell)
    const crontab = shell.runSafe('crontab -l 2>/dev/null') ?? ''
    const deployCron = crontab.split('\n').find((l) => l.includes('# seed-deploy'))
    const cleanupCron = crontab.split('\n').find((l) => l.includes('# seed-cleanup'))
    console.log('Cron jobs installed:')
    console.log(`  Auto-update: ${deployCron ?? '(missing)'}`)
    console.log(`  Cleanup:     ${cleanupCron ?? '(missing)'}`)
    return
  }

  console.error(`Unknown cron subcommand: ${subcommand}`)
  console.error(`Usage: ${cmd('cron [install|remove]')}`)
  process.exit(1)
}

/** Extract seed-managed cron lines from a full crontab string. */
export function extractSeedCronLines(crontab: string): string[] {
  return crontab.split('\n').filter((line) => line.includes('# seed-deploy') || line.includes('# seed-cleanup'))
}

/** Remove all seed-managed cron lines from the active crontab. */
export function removeSeedCronLines(existing: string): string {
  const cleaned = existing
    .split('\n')
    .filter((line) => !line.includes('# seed-deploy') && !line.includes('# seed-cleanup'))
    .join('\n')
    .trim()
  return cleaned ? cleaned + '\n' : ''
}

/** Metadata stored inside backup archives for provenance tracking. */
export interface BackupMeta {
  version: string
  timestamp: string
  hostname: string
  seedDir: string
  cron: string[]
}

/**
 * Paths (relative to the seed dir) that go into a backup archive. Enterprise
 * nodes add the vault, notify and agents data, site nodes the agents data; a
 * directory that does not exist yet (profile never enabled) is skipped so tar
 * does not fail on it.
 */
export async function backupMembers(paths: DeployPaths, config: SeedConfig): Promise<string[]> {
  const members = ['config.json', 'backup-meta.json', 'docker-compose.yml', 'web', 'daemon', 'proxy']
  const extra: readonly string[] = isEnterprise(config) ? ENTERPRISE_DATA_DIRS : config.agents ? ['agents'] : []
  for (const dir of extra) {
    try {
      await access(join(paths.seedDir, dir))
      members.push(dir)
    } catch {
      // never created — nothing to back up
    }
  }
  return members
}

async function cmdBackup(paths: DeployPaths, shell: ShellRunner, args: string[]): Promise<void> {
  checkDockerAccess(shell)
  if (!(await configExists(paths))) {
    console.error(`No config found at ${paths.configPath}. Nothing to back up.`)
    process.exit(1)
  }

  const config = await readConfig(paths)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const defaultPath = join(paths.seedDir, 'backups', `seed-backup-${timestamp}.tar.gz`)
  const backupFile = args[0] || defaultPath
  const backupDir = dirname(backupFile)

  await mkdir(backupDir, {recursive: true})

  // Write backup metadata
  const crontab = shell.runSafe('crontab -l 2>/dev/null') ?? ''
  const meta: BackupMeta = {
    version: VERSION,
    timestamp: new Date().toISOString(),
    hostname: config.domain,
    seedDir: paths.seedDir,
    cron: extractSeedCronLines(crontab),
  }
  await writeFile(join(paths.seedDir, 'backup-meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf-8')

  // Stop containers for data consistency
  console.log('Stopping containers for consistent backup...')
  const env = buildComposeEnv(config, paths)
  shell.runSafe(`${env} docker compose -f "${paths.composePath}" stop`)

  // Create tarball — include config, data, compose, metadata. Exclude backups dir and .env
  const seedBase = basename(paths.seedDir)
  const seedParent = dirname(paths.seedDir)
  const members = await backupMembers(paths, config)
  try {
    shell.run(
      `tar -czf "${backupFile}" -C "${seedParent}" --exclude="${seedBase}/backups" --exclude="${seedBase}/.env" --exclude="${seedBase}/deploy.js" --exclude="${seedBase}/deploy.log" ${members
        .map((m) => `"${seedBase}/${m}"`)
        .join(' ')}`,
    )
  } catch (err) {
    console.error(`Backup failed: ${err}`)
    // Restart containers even on failure
    shell.runSafe(`${env} docker compose -f "${paths.composePath}" start`)
    process.exit(1)
  }

  // Clean up metadata file
  shell.runSafe(`rm -f "${join(paths.seedDir, 'backup-meta.json')}"`)

  // Restart containers
  console.log('Restarting containers...')
  shell.runSafe(`${env} docker compose -f "${paths.composePath}" start`)

  const size = shell.runSafe(`du -h "${backupFile}"`)?.split('\t')[0] ?? 'unknown'
  console.log(`\nBackup created: ${backupFile} (${size})`)
}

async function cmdRestore(paths: DeployPaths, shell: ShellRunner, args: string[]): Promise<void> {
  checkDockerAccess(shell)
  const backupFile = args[0]
  if (!backupFile) {
    console.error(`Usage: ${cmd('restore <backup-file.tar.gz>')}`)
    process.exit(1)
  }

  try {
    await access(backupFile)
  } catch {
    console.error(`File not found: ${backupFile}`)
    process.exit(1)
  }

  // Read metadata from tarball without full extraction
  let meta: BackupMeta | null = null
  const seedBase = basename(paths.seedDir)
  const metaJson = shell.runSafe(`tar -xzf "${backupFile}" -O "${seedBase}/backup-meta.json" 2>/dev/null`)
  if (metaJson) {
    try {
      meta = JSON.parse(metaJson) as BackupMeta
    } catch {
      // malformed metadata — proceed without it
    }
  }

  // Show what we're restoring
  p.intro(`Seed Node Restore v${VERSION}`)
  if (meta) {
    p.note(
      [`Created:  ${meta.timestamp}`, `Source:   ${meta.hostname}`, `Version:  ${meta.version}`].join('\n'),
      'Restoring from backup',
    )
  }

  const confirmed = await p.confirm({
    message: `This will overwrite all data in ${paths.seedDir}. Continue?`,
  })
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Restore cancelled.')
    console.log(`\nRun '${cmd('restore <file>')}' to try again.\n`)
    process.exit(0)
  }

  // Stop existing containers
  console.log('Stopping existing containers...')
  shell.runSafe(`${await composeEnvPrefix(paths)} docker compose -f "${paths.composePath}" down`)

  // Extract backup
  console.log('Extracting backup...')
  await ensureSeedDir(paths, shell)
  const seedParent = dirname(paths.seedDir)
  shell.run(`tar -xzf "${backupFile}" -C "${seedParent}"`)

  // Clean up metadata file from extracted data
  shell.runSafe(`rm -f "${join(paths.seedDir, 'backup-meta.json')}"`)

  // Restore cron lines from backup metadata
  if (meta?.cron && meta.cron.length > 0) {
    const existingCron = shell.runSafe('crontab -l 2>/dev/null') ?? ''
    const newCrontab = buildCrontab(existingCron, paths)
    try {
      shell.run(`echo '${newCrontab}' | crontab -`)
      console.log('Cron jobs restored.')
    } catch {
      console.log('Warning: Could not restore cron jobs.')
    }
  }

  // Ask if user wants to review configuration
  const wantsReview = await p.confirm({
    message: 'Would you like to review the configuration before deploying?',
    initialValue: false,
  })

  let config: SeedConfig
  if (!p.isCancel(wantsReview) && wantsReview) {
    // Load the restored config and run the migration wizard with it pre-filled
    const restored = await readConfig(paths)
    if (isEnterprise(restored)) {
      config = await runEnterpriseWizard(paths, restored)
      await deploy(config, paths, shell)
      p.outro(`Restore complete! Your Seed node is running.\n${MANAGE_HINT}`)
      return
    }
    const asOldInstall: OldInstallInfo = {
      workspace: paths.seedDir,
      secret: restored.link_secret,
      secretConsumed: false,
      hostname: restored.domain,
      logLevel: restored.compose_envs.LOG_LEVEL,
      imageTag: restored.release_channel,
      testnet: restored.testnet,
      gateway: restored.gateway,
      trafficStats: restored.analytics,
    }
    config = await runMigrationWizard(asOldInstall, paths, shell)
  } else {
    config = await readConfig(paths)
  }

  // Deploy with the restored (or modified) config
  await deploy(config, paths, shell)

  p.outro(`Restore complete! Your Seed node is running.\n${MANAGE_HINT}`)
}

async function cmdUninstall(paths: DeployPaths, shell: ShellRunner): Promise<void> {
  checkDockerAccess(shell)
  p.intro(`Seed Node Uninstall v${VERSION}`)

  p.note(
    [
      'This will permanently delete:',
      `  - All Seed containers`,
      `  - All node data at ${paths.seedDir}/ (daemon identity, web data, config)`,
      `  - Cron jobs for seed-deploy and seed-cleanup`,
      '',
      'This action is IRREVERSIBLE.',
    ].join('\n'),
    'Warning',
  )

  // Offer backup first
  const wantsBackup = await p.confirm({
    message: 'Would you like to create a backup before uninstalling?',
    initialValue: true,
  })
  if (!p.isCancel(wantsBackup) && wantsBackup) {
    await cmdBackup(paths, shell, [])
  }

  const confirmation = await p.text({
    message: 'Type "yes" to confirm uninstallation:',
    validate: (v) => {
      if (v !== 'yes') return 'Please type "yes" to confirm, or press Ctrl+C to cancel.'
    },
  })

  if (p.isCancel(confirmation)) {
    p.cancel('Uninstall cancelled.')
    process.exit(0)
  }

  // Stop and remove containers
  console.log('Stopping and removing containers...')
  shell.runSafe(`${await composeEnvPrefix(paths)} docker compose -f "${paths.composePath}" down`)

  // Remove seed cron lines
  const existingCron = shell.runSafe('crontab -l 2>/dev/null') ?? ''
  if (existingCron.includes('# seed-deploy') || existingCron.includes('# seed-cleanup')) {
    const cleaned = removeSeedCronLines(existingCron)
    try {
      shell.run(`echo '${cleaned}' | crontab -`)
      console.log('Cron jobs removed.')
    } catch {
      console.log('Warning: Could not remove cron jobs.')
    }
  }

  // Remove seed directory
  console.log(`Removing ${paths.seedDir}...`)
  try {
    shell.run(`rm -rf "${paths.seedDir}"`)
  } catch {
    console.log(`Could not remove ${paths.seedDir}. Trying with sudo...`)
    shell.run(`sudo rm -rf "${paths.seedDir}"`)
  }

  p.outro('Seed node uninstalled.')
}

// ---------------------------------------------------------------------------
// Main: CLI Dispatch
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const {command, args, reconfigure, advanced, dir, profile, headless} = parseArgs()
  const paths = makePaths(dir ?? DEFAULT_SEED_DIR)
  const shell = makeShellRunner()

  switch (command) {
    case 'help':
      printHelp()
      return
    case 'version':
      console.log(VERSION)
      return
    case 'deploy':
      return cmdDeploy(paths, shell, reconfigure, advanced, profile, headless)
    case 'upgrade':
      return cmdUpgrade(paths)
    case 'stop':
      return cmdStop(paths, shell)
    case 'start':
      return cmdStart(paths, shell)
    case 'restart':
      return cmdRestart(paths, shell)
    case 'doctor':
      return cmdDoctor(paths, shell)
    case 'secret':
      return cmdSecret(paths)
    case 'config':
      return cmdConfig(paths)
    case 'logs':
      return cmdLogs(paths, args)
    case 'cron':
      return cmdCron(paths, shell, args)
    case 'backup':
      return cmdBackup(paths, shell, args)
    case 'restore':
      return cmdRestore(paths, shell, args)
    case 'uninstall':
      return cmdUninstall(paths, shell)
    case 'register':
      return cmdRegister(paths, args)
    case 'invite':
      return cmdInvite(paths, args)
    case 'bootstrap-space':
      return cmdBootstrapSpace(paths, headless)
    case 'set-hostname':
      return cmdSetHostname(paths, shell, args)
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
}
