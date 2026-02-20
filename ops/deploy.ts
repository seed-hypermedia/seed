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
 * The seed directory is derived from the script's own location
 * (dirname of process.argv[1]) so that cron jobs and the seed-deploy
 * wrapper always resolve to the correct path. This can be overridden
 * via the SEED_DIR environment variable.
 */

import * as p from "@clack/prompts";
import { readFile, writeFile, mkdir, access, stat } from "node:fs/promises";
import { execSync, exec as execCb } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, basename, dirname } from "node:path";

export const VERSION = "0.1.0";
export const DEFAULT_SEED_DIR =
  process.env.SEED_DIR || dirname(process.argv[1]);
export const DEFAULT_REPO_URL =
  "https://raw.githubusercontent.com/seed-hypermedia/seed/main";

// SEED_DEPLOY_URL points at the ops/ directory (matches deploy.sh convention).
// SEED_REPO_URL points at the repo root (legacy, kept for compatibility).
// Both resolve to the same ops/ base for fetching compose + deploy.js.
export const OPS_BASE_URL =
  process.env.SEED_DEPLOY_URL ||
  (process.env.SEED_REPO_URL
    ? `${process.env.SEED_REPO_URL}/ops`
    : `${DEFAULT_REPO_URL}/ops`);

export const DEFAULT_COMPOSE_URL = `${OPS_BASE_URL}/docker-compose.yml`;
export const NOTIFY_SERVICE_HOST = "https://notify.seed.hyper.media";
export const LIGHTNING_URL_MAINNET = "https://ln.seed.hyper.media";
export const LIGHTNING_URL_TESTNET = "https://ln.testnet.seed.hyper.media";

// ---------------------------------------------------------------------------
// Configurable paths — allows tests to inject a temp directory
// ---------------------------------------------------------------------------

export interface DeployPaths {
  seedDir: string;
  configPath: string;
  composePath: string;
  deployLog: string;
}

export function makePaths(seedDir: string = DEFAULT_SEED_DIR): DeployPaths {
  return {
    seedDir,
    configPath: join(seedDir, "config.json"),
    composePath: join(seedDir, "docker-compose.yml"),
    deployLog: join(seedDir, "deploy.log"),
  };
}

// ---------------------------------------------------------------------------
// Shell command abstraction — allows tests to inject mocks
// ---------------------------------------------------------------------------

export interface ShellRunner {
  run(cmd: string): string;
  runSafe(cmd: string): string | null;
  exec(cmd: string): Promise<{ stdout: string; stderr: string }>;
}

export function makeShellRunner(): ShellRunner {
  return {
    run(cmd: string): string {
      return execSync(cmd, { encoding: "utf-8", timeout: 30_000 }).trim();
    },
    runSafe(cmd: string): string | null {
      try {
        return this.run(cmd);
      } catch {
        return null;
      }
    },
    exec(cmd: string): Promise<{ stdout: string; stderr: string }> {
      return new Promise((resolve, reject) => {
        execCb(cmd, { timeout: 120_000 }, (err, stdout, stderr) => {
          if (err) reject(err);
          else
            resolve({
              stdout: stdout.toString().trim(),
              stderr: stderr.toString().trim(),
            });
        });
      });
    },
  };
}

export interface SeedConfig {
  /** Public hostname for this node, e.g. "https://node1.seed.run" */
  domain: string;
  /** Contact email — used to reach the operator about security updates */
  email: string;
  /** URL to fetch the docker-compose.yml from */
  compose_url: string;
  /** SHA-256 of the last deployed docker-compose.yml — used to detect changes */
  compose_sha: string;
  /** Environment variables passed through to compose services */
  compose_envs: {
    LOG_LEVEL: "debug" | "info" | "warn" | "error";
  };
  /** Deployment environment label */
  environment: "dev" | "staging" | "prod";
  /** Docker image tag to pull: "latest" for stable, "dev" for main branch */
  release_channel: "latest" | "dev" | string;
  /** Whether to connect to the testnet P2P network instead of mainnet */
  testnet: boolean;
  /** Random secret used for the initial site registration URL */
  link_secret: string;
  /** Whether to enable Plausible.io web analytics for this site */
  analytics: boolean;
  /** Whether this node acts as a public gateway serving all known content */
  gateway: boolean;
  /** ISO 8601 timestamp of the last successful deployment */
  last_script_run: string;
}

/**
 * Derives testnet and release_channel from the environment label.
 * Keeps the wizard to a single "Environment" question instead of three.
 */
export function environmentPresets(env: SeedConfig["environment"]): {
  testnet: boolean;
  release_channel: string;
} {
  switch (env) {
    case "dev":
      return { testnet: true, release_channel: "dev" };
    case "staging":
      return { testnet: false, release_channel: "dev" };
    case "prod":
    default:
      return { testnet: false, release_channel: "latest" };
  }
}

export async function configExists(paths: DeployPaths): Promise<boolean> {
  try {
    await access(paths.configPath);
    return true;
  } catch {
    return false;
  }
}

export async function readConfig(paths: DeployPaths): Promise<SeedConfig> {
  const raw = await readFile(paths.configPath, "utf-8");
  return JSON.parse(raw) as SeedConfig;
}

export async function writeConfig(
  config: SeedConfig,
  paths: DeployPaths,
): Promise<void> {
  await mkdir(paths.seedDir, { recursive: true });
  await writeFile(
    paths.configPath,
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );
}

export function generateSecret(length = 10): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

export function log(msg: string): void {
  const ts = new Date().toISOString();
  if (!process.stdout.isTTY) {
    console.log(`[${ts}] ${msg}`);
  }
}

const RESUME_HINT = "\nRun 'seed-deploy' to resume installation at any time.\n";
const MANAGE_HINT =
  "Manage your node anytime with the 'seed-deploy' command. Run 'seed-deploy --help' for options.";

// ---------------------------------------------------------------------------
// Old installation detection
// ---------------------------------------------------------------------------

export interface OldInstallInfo {
  workspace: string;
  secret: string | null;
  /** True when the old config.json exists but the secret field was already consumed (node registered). */
  secretConsumed: boolean;
  hostname: string | null;
  logLevel: string | null;
  imageTag: string | null;
  testnet: boolean;
  gateway: boolean;
  trafficStats: boolean;
}

/** Infer the environment preset from the old installation's state. */
export function inferEnvironment(
  old: OldInstallInfo,
): "prod" | "staging" | "dev" {
  if (old.testnet) return "dev";
  if (old.imageTag === "dev") return "staging";
  return "prod";
}

export function parseDaemonEnv(envJson: string): {
  logLevel: string | null;
  testnet: boolean;
} {
  let logLevel: string | null = null;
  let testnet = false;
  try {
    const envs: string[] = JSON.parse(envJson);
    for (const e of envs) {
      if (e.startsWith("SEED_LOG_LEVEL=")) logLevel = e.split("=")[1];
      if (e.startsWith("SEED_P2P_TESTNET_NAME=") && e.split("=")[1])
        testnet = true;
    }
  } catch {
    // invalid JSON from docker inspect — skip
  }
  return { logLevel, testnet };
}

export function parseWebEnv(envJson: string): {
  hostname: string | null;
  gateway: boolean;
  trafficStats: boolean;
} {
  let hostname: string | null = null;
  let gateway = false;
  let trafficStats = false;
  try {
    const envs: string[] = JSON.parse(envJson);
    for (const e of envs) {
      if (e.startsWith("SEED_BASE_URL=")) hostname = e.split("=")[1];
      if (e.startsWith("SEED_IS_GATEWAY=true")) gateway = true;
      if (e.startsWith("SEED_ENABLE_STATISTICS=true")) trafficStats = true;
    }
  } catch {
    // invalid JSON from docker inspect — skip
  }
  return { hostname, gateway, trafficStats };
}

/** Extract image tag from a Docker image string, e.g. "seedhypermedia/web:latest" -> "latest" */
export function parseImageTag(imageStr: string): string {
  const parts = imageStr.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : "latest";
}

export async function detectOldInstall(
  shell: ShellRunner,
): Promise<OldInstallInfo | null> {
  const home = homedir();
  const candidates = [join(home, ".seed-site"), "/shm/gateway", "/shm"];

  let workspace: string | null = null;
  for (const dir of candidates) {
    try {
      await access(dir);
      workspace = dir;
      break;
    } catch {
      // not found, try next
    }
  }

  const hasContainers = shell.runSafe(
    "docker ps --format '{{.Names}}' 2>/dev/null | grep -q seed",
  );
  if (!workspace && hasContainers === null) {
    return null;
  }

  if (!workspace) {
    workspace = join(home, ".seed-site");
  }

  let secret: string | null = null;
  let secretConsumed = false;
  const secretPaths = [
    join(workspace, "web", "config.json"),
    "/shm/gateway/web/config.json",
    join(home, ".seed-site", "web", "config.json"),
  ];
  for (const sp of secretPaths) {
    try {
      const raw = await readFile(sp, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.availableRegistrationSecret) {
        secret = parsed.availableRegistrationSecret;
        break;
      }
      // Config exists but secret is missing — it was consumed during registration.
      if (parsed.registeredAccountUid || parsed.sourcePeerId) {
        secretConsumed = true;
      }
    } catch {
      // try next
    }
  }

  let hostname: string | null = null;
  let logLevel: string | null = null;
  let imageTag: string | null = null;
  let testnet = false;
  let gateway = false;
  let trafficStats = false;

  const daemonEnv = shell.runSafe(
    "docker inspect seed-daemon --format '{{json .Config.Env}}' 2>/dev/null",
  );
  if (daemonEnv) {
    const parsed = parseDaemonEnv(daemonEnv);
    logLevel = parsed.logLevel;
    testnet = parsed.testnet;
  }

  const webEnv = shell.runSafe(
    "docker inspect seed-web --format '{{json .Config.Env}}' 2>/dev/null",
  );
  if (webEnv) {
    const parsed = parseWebEnv(webEnv);
    hostname = parsed.hostname;
    gateway = parsed.gateway;
    trafficStats = parsed.trafficStats;
  }

  const webImage = shell.runSafe(
    "docker inspect seed-web --format '{{.Config.Image}}' 2>/dev/null",
  );
  if (webImage) {
    imageTag = parseImageTag(webImage);
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
  };
}

// ---------------------------------------------------------------------------
// Migration Wizard
// ---------------------------------------------------------------------------

async function runMigrationWizard(
  old: OldInstallInfo,
  paths: DeployPaths,
  shell: ShellRunner,
): Promise<SeedConfig> {
  p.intro(`Seed Node Migration v${VERSION}`);

  p.note(
    [
      `Detected an existing Seed installation at: ${old.workspace}`,
      "",
      "We'll import your current settings and migrate to the new deployment system.",
      `After migration, your node will be managed from ${paths.seedDir}/ and updated via cron.`,
      "",
      "Please review and confirm the detected values below.",
    ].join("\n"),
    "Existing installation found",
  );

  const answers = await p.group(
    {
      domain: () =>
        p.text({
          message: "Public hostname (including https://)",
          placeholder: old.hostname || "https://node1.seed.run",
          validate: (v) => {
            if (!v) return "Required";
            if (!v.startsWith("https://") && !v.startsWith("http://"))
              return "Must start with https:// or http://";
          },
        }),
      environment: () =>
        p.select({
          message: "Environment",
          initialValue: inferEnvironment(old),
          options: [
            {
              value: "prod",
              label: "Production",
              hint: "stable releases, mainnet network — recommended",
            },
            {
              value: "staging",
              label: "Staging",
              hint: "development builds, mainnet network — for testing",
            },
            {
              value: "dev",
              label: "Development",
              hint: "development builds, testnet network",
            },
          ],
        }),
      log_level: () =>
        p.select({
          message: "Log level",
          initialValue: old.logLevel ?? "info",
          options: [
            {
              value: "debug",
              label: "Debug",
              hint: "verbose, useful for troubleshooting",
            },
            {
              value: "info",
              label: "Info",
              hint: "standard operational logging",
            },
            { value: "warn", label: "Warn", hint: "only warnings and errors" },
            { value: "error", label: "Error", hint: "only errors" },
          ],
        }),
      gateway: () =>
        p.confirm({
          message: "Run as public gateway?",
          initialValue: old.gateway,
        }),
      analytics: () =>
        p.confirm({
          message:
            "Enable web analytics? Adds a Plausible.io dashboard to track your site's traffic.",
          initialValue: old.trafficStats,
        }),
      email: () =>
        p.text({
          message:
            "Contact email (optional) — lets us notify you about security updates. Not shared publicly.",
          placeholder: "you@example.com",
          validate: (v) => {
            if (v && !v.includes("@")) return "Must be a valid email";
          },
        }),
    },
    {
      onCancel: () => {
        p.cancel("Migration cancelled.");
        console.log(RESUME_HINT);
        process.exit(0);
      },
    },
  );

  const secret = old.secret ?? generateSecret();
  if (old.secret) {
    p.log.success(`Registration secret imported from existing installation.`);
  } else if (old.secretConsumed) {
    p.log.info(
      `Node is already registered (secret was consumed). Generated a new secret for future registrations.`,
    );
  } else {
    p.log.warn(`No existing registration secret found. Generated a new one.`);
  }

  const env = answers.environment as SeedConfig["environment"];
  const presets = environmentPresets(env);

  const config: SeedConfig = {
    domain: answers.domain as string,
    email: (answers.email as string) || "",
    compose_url: DEFAULT_COMPOSE_URL,
    compose_sha: "",
    compose_envs: {
      LOG_LEVEL: answers.log_level as SeedConfig["compose_envs"]["LOG_LEVEL"],
    },
    environment: env,
    release_channel: presets.release_channel,
    testnet: presets.testnet,
    link_secret: secret,
    analytics: answers.analytics as boolean,
    gateway: answers.gateway as boolean,
    last_script_run: "",
  };

  const summary = Object.entries(config)
    .map(([k, v]) => `  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join("\n");
  p.note(summary, "Configuration summary");

  const confirmed = await p.confirm({
    message: "Write config and proceed with deployment?",
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Migration cancelled.");
    console.log(RESUME_HINT);
    process.exit(0);
  }

  await writeConfig(config, paths);
  p.log.success(`Config written to ${paths.configPath}`);

  // Migrate file ownership from the old UID 1001 (hardcoded in the previous
  // web Dockerfile) to the current user. The new docker-compose.yml runs the
  // web container as the host user, so the data directory must be owned by them.
  const webDir = join(old.workspace, "web");
  const currentUid = String(process.getuid!());
  const currentGid = String(process.getgid!());
  const owner = shell.runSafe(`stat -c '%u:%g' "${webDir}" 2>/dev/null`);
  if (owner && owner !== `${currentUid}:${currentGid}`) {
    p.log.warn(
      `The web data directory (${webDir}) is owned by a different user (${owner}).` +
        ` Updating ownership so the web container can write to it.`,
    );
    if (
      !shell.runSafe(
        `chown -R ${currentUid}:${currentGid} "${webDir}" 2>/dev/null`,
      )
    ) {
      shell.runSafe(`sudo chown -R ${currentUid}:${currentGid} "${webDir}"`);
    }
    p.log.success("File ownership updated.");
  }

  return config;
}

// ---------------------------------------------------------------------------
// Fresh Install Wizard
// ---------------------------------------------------------------------------

async function runFreshWizard(
  paths: DeployPaths,
  existing?: SeedConfig,
): Promise<SeedConfig> {
  const isReconfig = !!existing;
  p.intro(
    isReconfig
      ? `Seed Node Reconfiguration v${VERSION}`
      : `Seed Node Setup v${VERSION}`,
  );

  if (!isReconfig) {
    p.note(
      [
        "Welcome! This wizard will configure your new Seed node.",
        "",
        "Seed is a peer-to-peer hypermedia publishing system. This script sets up",
        "the Docker containers, reverse proxy, and networking so your node is",
        "reachable on the public internet.",
        "",
        `Configuration will be saved to ${paths.configPath}.`,
        "Subsequent runs of this script will deploy automatically (headless mode).",
      ].join("\n"),
      "First-time setup",
    );
  } else {
    p.note(
      [
        "Editing your current configuration. Press Tab to keep existing values, or type to change them.",
        "",
        `Configuration: ${paths.configPath}`,
      ].join("\n"),
      "Reconfiguration",
    );
  }

  const answers = await p.group(
    {
      domain: () =>
        p.text({
          message: "Public hostname (including https://)",
          placeholder: existing?.domain || "https://node1.seed.run",
          validate: (v) => {
            if (!v) return "Required";
            if (!v.startsWith("https://") && !v.startsWith("http://"))
              return "Must start with https:// or http://";
          },
        }),
      environment: () =>
        p.select({
          message: "Environment",
          initialValue: existing?.environment ?? "prod",
          options: [
            {
              value: "prod",
              label: "Production",
              hint: "stable releases, mainnet network — recommended",
            },
            {
              value: "staging",
              label: "Staging",
              hint: "development builds, mainnet network — for testing",
            },
            {
              value: "dev",
              label: "Development",
              hint: "development builds, testnet network",
            },
          ],
        }),
      log_level: () =>
        p.select({
          message: "Log level for Seed services",
          initialValue: existing?.compose_envs?.LOG_LEVEL ?? "info",
          options: [
            {
              value: "debug",
              label: "Debug",
              hint: "very verbose, useful for troubleshooting",
            },
            {
              value: "info",
              label: "Info",
              hint: "standard operational logging — recommended",
            },
            { value: "warn", label: "Warn", hint: "only warnings and errors" },
            { value: "error", label: "Error", hint: "only critical errors" },
          ],
        }),
      gateway: () =>
        p.confirm({
          message: "Run as a public gateway? (serves all known public content)",
          initialValue: existing?.gateway ?? false,
        }),
      analytics: () =>
        p.confirm({
          message:
            "Enable web analytics? Adds a Plausible.io dashboard to track your site's traffic.",
          initialValue: existing?.analytics ?? false,
        }),
      email: () =>
        p.text({
          message:
            "Contact email (optional) — lets us notify you about security updates. Not shared publicly.",
          placeholder: existing?.email || "you@example.com",
          validate: (v) => {
            if (v && !v.includes("@")) return "Must be a valid email";
          },
        }),
    },
    {
      onCancel: () => {
        p.cancel(
          isReconfig ? "Reconfiguration cancelled." : "Setup cancelled.",
        );
        console.log(RESUME_HINT);
        process.exit(0);
      },
    },
  );

  const secret = existing?.link_secret ?? generateSecret();

  const env = answers.environment as SeedConfig["environment"];
  const presets = environmentPresets(env);

  const config: SeedConfig = {
    domain: answers.domain as string,
    email: (answers.email as string) || "",
    compose_url: DEFAULT_COMPOSE_URL,
    compose_sha: existing?.compose_sha ?? "",
    compose_envs: {
      LOG_LEVEL: answers.log_level as SeedConfig["compose_envs"]["LOG_LEVEL"],
    },
    environment: env,
    release_channel: presets.release_channel,
    testnet: presets.testnet,
    link_secret: secret,
    analytics: answers.analytics as boolean,
    gateway: answers.gateway as boolean,
    last_script_run: existing?.last_script_run ?? "",
  };

  const userFields: [string, string][] = [
    ["domain", config.domain],
    ["email", config.email],
    ["environment", config.environment],
    ["log_level", config.compose_envs.LOG_LEVEL],
    ["gateway", String(config.gateway)],
    ["analytics", String(config.analytics)],
  ];
  const oldFields: Record<string, string> | undefined = existing
    ? {
        domain: existing.domain,
        email: existing.email,
        environment: existing.environment,
        log_level: existing.compose_envs?.LOG_LEVEL ?? "info",
        gateway: String(existing.gateway),
        analytics: String(existing.analytics),
      }
    : undefined;
  const summary = userFields
    .map(([k, v]) => {
      if (oldFields && String(v) !== String(oldFields[k] ?? "")) {
        return `  \u270E ${k}: ${v}`;
      }
      return `    ${k}: ${v}`;
    })
    .join("\n");
  p.note(summary, "Configuration summary");

  const confirmed = await p.confirm({
    message: isReconfig
      ? "Save changes and redeploy?"
      : "Write config and proceed with deployment?",
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel(isReconfig ? "Reconfiguration cancelled." : "Setup cancelled.");
    console.log(RESUME_HINT);
    process.exit(0);
  }

  await writeConfig(config, paths);
  p.log.success(`Config written to ${paths.configPath}`);

  return config;
}

// ---------------------------------------------------------------------------
// Deployment Engine
// ---------------------------------------------------------------------------

/** Extract the bare DNS name from a URL, e.g. "https://node.seed.run" -> "node.seed.run" */
export function extractDns(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function generateCaddyfile(_config: SeedConfig): string {
  return `{$SEED_SITE_HOSTNAME}

encode zstd gzip

@ipfsget {
\tmethod GET HEAD OPTIONS
\tpath /ipfs/*
}

reverse_proxy /.metrics* grafana:{$SEED_SITE_MONITORING_PORT:3001}

reverse_proxy @ipfsget seed-daemon:{$HM_SITE_BACKEND_GRPCWEB_PORT:56001}

reverse_proxy * seed-web:{$SEED_SITE_LOCAL_PORT:3000}
`;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function checkContainersHealthy(
  shell: ShellRunner,
): Promise<boolean> {
  const required = ["seed-proxy", "seed-web", "seed-daemon"];
  for (const name of required) {
    const running = shell.runSafe(
      `docker inspect ${name} --format '{{.State.Running}}' 2>/dev/null`,
    );
    if (running !== "true") return false;
  }
  return true;
}

export async function getContainerImages(
  shell: ShellRunner,
): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  const containers = ["seed-proxy", "seed-web", "seed-daemon"];
  for (const name of containers) {
    const image = shell.runSafe(
      `docker inspect ${name} --format '{{.Image}}' 2>/dev/null`,
    );
    if (image) images.set(name, image);
  }
  return images;
}

export function buildComposeEnv(
  config: SeedConfig,
  paths: DeployPaths,
): string {
  const dns = extractDns(config.domain);
  const testnetName = config.testnet ? "dev" : "";
  const lightningUrl = config.testnet
    ? LIGHTNING_URL_TESTNET
    : LIGHTNING_URL_MAINNET;

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
    NOTIFY_SERVICE_HOST: NOTIFY_SERVICE_HOST,
    SEED_SITE_MONITORING_WORKDIR: join(paths.seedDir, "monitoring"),
  };

  return Object.entries(vars)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
}

export function getWorkspaceDirs(paths: DeployPaths): string[] {
  // The daemon container always mounts monitoring volumes (for rsync of
  // built-in dashboards), so these directories must exist even when the
  // monitoring profile isn't active.
  return [
    join(paths.seedDir, "proxy"),
    join(paths.seedDir, "proxy", "data"),
    join(paths.seedDir, "proxy", "config"),
    join(paths.seedDir, "web"),
    join(paths.seedDir, "daemon"),
    join(paths.seedDir, "monitoring"),
    join(paths.seedDir, "monitoring", "grafana"),
    join(paths.seedDir, "monitoring", "prometheus"),
  ];
}

/**
 * Ensures the seed directory exists and is writable by the current user.
 * Uses sudo only when the parent directory isn't writable.
 */
export async function ensureSeedDir(
  paths: DeployPaths,
  shell: ShellRunner,
): Promise<void> {
  try {
    await access(paths.seedDir);
  } catch {
    // Directory doesn't exist — try creating it, escalate to sudo if needed
    try {
      await mkdir(paths.seedDir, { recursive: true });
    } catch {
      log(`Creating ${paths.seedDir} requires elevated permissions`);
      shell.run(`sudo mkdir -p "${paths.seedDir}"`);
      shell.run(`sudo chown "$(id -u):$(id -g)" "${paths.seedDir}"`);
    }
  }
}

async function rollback(
  previousImages: Map<string, string>,
  config: SeedConfig,
  paths: DeployPaths,
  shell: ShellRunner,
): Promise<void> {
  log("Deployment failed — rolling back to previous images...");
  for (const [name, imageId] of previousImages) {
    log(`  Restoring ${name} to image ${imageId.slice(0, 16)}...`);
    shell.runSafe(`docker stop ${name} 2>/dev/null`);
    shell.runSafe(`docker rm ${name} 2>/dev/null`);
  }
  log("  Running docker compose up with cached images...");
  const env = buildComposeEnv(config, paths);
  shell.runSafe(
    `${env} docker compose -f ${paths.composePath} up -d --quiet-pull 2>&1`,
  );
  log("Rollback complete. Check container status with: docker ps");
}

// ---------------------------------------------------------------------------
// Self-update — fetches the latest deploy.js from the repo during headless
// runs so that cron-triggered deployments always use the newest script.
// The update takes effect on the *next* run; the current process continues
// with the code already loaded in memory.
// ---------------------------------------------------------------------------

export async function selfUpdate(paths: DeployPaths): Promise<void> {
  const scriptPath = process.argv[1];
  const url = `${OPS_BASE_URL}/dist/deploy.js`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      log(`Self-update: failed to fetch ${url}: ${response.status}`);
      return;
    }
    const remote = await response.text();

    let local = "";
    try {
      local = await readFile(scriptPath, "utf-8");
    } catch {
      // First run or path mismatch — treat as stale
    }

    if (sha256(remote) !== sha256(local)) {
      await writeFile(scriptPath, remote, "utf-8");
      log(`Self-update: deploy.js updated (takes effect on next run).`);
    } else {
      log("Self-update: deploy.js is up to date.");
    }
  } catch (err) {
    log(`Self-update: skipped (${err})`);
  }
}

export async function deploy(
  config: SeedConfig,
  paths: DeployPaths,
  shell: ShellRunner,
): Promise<void> {
  const isInteractive = process.stdout.isTTY;
  const spinner = isInteractive ? p.spinner() : null;

  const step = (msg: string) => {
    if (spinner) spinner.message(msg);
    log(msg);
  };

  if (isInteractive) {
    p.log.step("Starting deployment...");
  }

  spinner?.start("Fetching docker-compose.yml...");
  step("Fetching docker-compose.yml...");

  // Use env-based URL override when present (testing / branch builds),
  // otherwise fall back to the compose_url stored in config.json.
  const hasEnvOverride =
    process.env.SEED_DEPLOY_URL || process.env.SEED_REPO_URL;
  const composeUrl = hasEnvOverride
    ? `${OPS_BASE_URL}/docker-compose.yml`
    : config.compose_url;
  const composeResponse = await fetch(composeUrl);
  if (!composeResponse.ok) {
    spinner?.stop("Failed to fetch docker-compose.yml");
    throw new Error(
      `Failed to fetch compose file from ${composeUrl}: ${composeResponse.status}`,
    );
  }
  const composeContent = await composeResponse.text();
  const composeSha = sha256(composeContent);

  const containersHealthy = await checkContainersHealthy(shell);
  if (config.compose_sha === composeSha && containersHealthy) {
    spinner?.stop(
      "No changes detected — all containers healthy. Skipping redeployment.",
    );
    log(
      "No changes detected — compose SHA matches and containers are healthy. Skipping.",
    );
    if (isInteractive) {
      console.log(
        "\n  To change your node's configuration, run 'seed-deploy deploy --reconfigure'.\n",
      );
    }
    config.last_script_run = new Date().toISOString();
    await writeConfig(config, paths);
    return;
  }

  if (config.compose_sha && config.compose_sha !== composeSha) {
    step(
      `Compose file changed: ${config.compose_sha.slice(0, 8)} -> ${composeSha.slice(0, 8)}`,
    );
  }

  await ensureSeedDir(paths, shell);
  await writeFile(paths.composePath, composeContent, "utf-8");

  step("Setting up workspace directories...");
  const dirs = getWorkspaceDirs(paths);
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  step("Generating Caddyfile...");
  const caddyfile = generateCaddyfile(config);
  await writeFile(
    join(paths.seedDir, "proxy", "CaddyFile"),
    caddyfile,
    "utf-8",
  );

  // Write registration secret only on first deploy (web/config.json doesn't exist yet)
  const webConfigPath = join(paths.seedDir, "web", "config.json");
  let isFirstDeploy = false;
  try {
    await access(webConfigPath);
  } catch {
    isFirstDeploy = true;
    await writeFile(
      webConfigPath,
      JSON.stringify({ availableRegistrationSecret: config.link_secret }) +
        "\n",
      "utf-8",
    );
    step("Created initial web/config.json with registration secret.");
  }

  const previousImages = await getContainerImages(shell);
  const env = buildComposeEnv(config, paths);

  // On first compose-managed deploy, remove legacy containers that were
  // created by the old website_deployment.sh via `docker run`. They aren't
  // compose-managed, so `docker compose up` can't recreate them and will
  // fail with a "name already in use" conflict.
  if (!config.compose_sha) {
    step("Removing legacy containers...");
    shell.runSafe(
      "docker stop seed-site seed-daemon seed-web seed-proxy autoupdater grafana prometheus 2>/dev/null",
    );
    shell.runSafe(
      "docker rm seed-site seed-daemon seed-web seed-proxy autoupdater grafana prometheus 2>/dev/null",
    );
  }

  // Pull new images while existing containers keep serving traffic.
  // This eliminates image download time from the downtime window.
  step("Pulling latest images...");
  try {
    await shell.exec(
      `${env} docker compose -f ${paths.composePath} pull --quiet`,
    );
  } catch (err: unknown) {
    log(`Image pull failed: ${err}`);
    // Non-fatal — compose up will attempt to pull as fallback
  }

  // Recreate containers from pre-pulled images. Only containers whose
  // image or configuration changed will be recreated; the rest stay up.
  step("Recreating containers...");
  try {
    const composeCmd = `${env} docker compose -f ${paths.composePath} up -d --quiet-pull`;
    const result = await shell.exec(composeCmd);
    if (result.stderr) {
      log(`compose stderr: ${result.stderr}`);
    }
  } catch (err: unknown) {
    spinner?.stop("docker compose up failed");
    log(`docker compose up failed: ${err}`);
    if (previousImages.size > 0) {
      await rollback(previousImages, config, paths, shell);
    }
    throw new Error(`Deployment failed: ${err}`);
  }

  let healthy = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    step(`Health check ${attempt + 1}/10...`);
    await new Promise((r) => setTimeout(r, 3000));
    healthy = await checkContainersHealthy(shell);
    if (healthy) break;
  }

  if (!healthy) {
    spinner?.stop("Health checks failed");
    log("Health checks failed — containers not running after 30s");
    if (previousImages.size > 0) {
      await rollback(previousImages, config, paths, shell);
    }
    throw new Error(
      "Deployment failed: containers did not become healthy within 30 seconds",
    );
  }

  config.compose_sha = composeSha;
  config.last_script_run = new Date().toISOString();
  await writeConfig(config, paths);

  // Prune old images immediately so disk doesn't fill up between cron runs.
  step("Cleaning up unused images...");
  shell.runSafe('docker image prune -a -f --filter "until=1m" 2>/dev/null');

  spinner?.stop("Deployment complete!");
  log("Deployment complete.");

  if (isInteractive) {
    p.log.message(MANAGE_HINT);
  }

  if (isInteractive && isFirstDeploy) {
    // TODO: POST config.email, config.domain, and config.analytics to the
    // Seed vault so the team knows about new deployments and can activate
    // Plausible analytics for this domain. Coordinate endpoint with Eric.

    p.note(
      [
        `Your site is live at ${config.domain}`,
        "",
        `  Secret:  ${config.link_secret}`,
        "",
        "Open the Seed desktop app and enter this secret to link",
        "your publisher account to this site.",
      ].join("\n"),
      "Setup complete",
    );
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
export function buildCrontab(
  existing: string,
  paths: DeployPaths,
  bunPath: string = "/usr/local/bin/bun",
): string {
  const deployLine = `0 2 * * * ${bunPath} ${join(paths.seedDir, "deploy.js")} >> ${paths.deployLog} 2>&1 # seed-deploy`;
  const cleanupLine = `0 0,4,8,12,16,20 * * * docker image prune -a -f --filter "until=1h" # seed-cleanup`;

  const filtered = existing
    .split("\n")
    .filter(
      (line) =>
        !line.includes("# seed-deploy") && !line.includes("# seed-cleanup"),
    )
    .join("\n")
    .trim();

  return [filtered, deployLine, cleanupLine].filter(Boolean).join("\n") + "\n";
}

export async function setupCron(
  paths: DeployPaths,
  shell: ShellRunner,
): Promise<void> {
  const bunPath = shell.runSafe("which bun") ?? "/usr/local/bin/bun";
  const existing = shell.runSafe("crontab -l 2>/dev/null") ?? "";
  const newCrontab = buildCrontab(existing, paths, bunPath);

  try {
    shell.run(`echo '${newCrontab}' | crontab -`);
    if (
      existing.includes("# seed-deploy") ||
      existing.includes("# seed-cleanup")
    ) {
      log("Updated existing seed cron jobs.");
    } else {
      log(
        "Installed nightly deployment cron job (02:00) and image cleanup cron.",
      );
    }
  } catch (err) {
    log(`Warning: Failed to install cron job: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// CLI: Argument Parsing
// ---------------------------------------------------------------------------

const COMMANDS = [
  "deploy",
  "stop",
  "start",
  "restart",
  "status",
  "config",
  "logs",
  "cron",
  "backup",
  "restore",
  "uninstall",
] as const;

export type CliCommand = (typeof COMMANDS)[number];

export interface CliArgs {
  command: CliCommand | "help" | "version";
  args: string[];
  reconfigure?: boolean;
}

export function parseArgs(argv: string[] = process.argv): CliArgs {
  const raw = argv.slice(2);
  const first = raw[0] ?? "deploy";

  if (first === "--help" || first === "-h")
    return { command: "help", args: [] };
  if (first === "--version" || first === "-v")
    return { command: "version", args: [] };
  if (first === "--reconfigure")
    return { command: "deploy", args: [], reconfigure: true };

  if ((COMMANDS as readonly string[]).includes(first)) {
    const rest = raw.slice(1);
    const reconfigure = first === "deploy" && rest.includes("--reconfigure");
    const args = reconfigure ? rest.filter((a) => a !== "--reconfigure") : rest;
    return { command: first as CliCommand, args, reconfigure };
  }

  console.error(`Unknown command: ${first}\n`);
  printHelp();
  process.exit(1);
}

export function printHelp(): void {
  const text = `
Seed Node Deployment v${VERSION}

Usage: seed-deploy [command] [options]

Commands:
  deploy      Deploy or update the Seed node (default)
  stop        Stop and remove all Seed containers
  start       Start containers without re-deploying
  restart     Restart all Seed containers
  status      Show node health, versions, and connectivity
  config      Print current configuration (secrets redacted)
  logs        Tail container logs [daemon|web|proxy]
  cron        Install or remove automatic update cron jobs
  backup      Create a portable backup of all node data
  restore     Restore node data from a backup file
  uninstall   Remove all Seed containers, data, and configuration

Options:
  --reconfigure  Re-run the setup wizard to change configuration
  -h, --help     Show this help message
  -v, --version  Show script version

Examples:
  seed-deploy                            Deploy or update
  seed-deploy deploy --reconfigure       Change node configuration
  seed-deploy stop                       Teardown containers
  seed-deploy status                     Check node health
  seed-deploy logs daemon                Tail seed-daemon logs
  seed-deploy cron                       Install automatic update cron
  seed-deploy cron remove                Remove cron jobs
  seed-deploy backup                     Create backup
  seed-deploy backup /tmp/backup.tar.gz  Create backup at custom path
  seed-deploy restore backup.tar.gz      Restore from backup file

The 'seed-deploy' command is installed at ~/.local/bin/seed-deploy
during initial setup. The deployment script lives at ${DEFAULT_SEED_DIR}/deploy.js.
`.trimStart();
  console.log(text);
}

// ---------------------------------------------------------------------------
// CLI: Commands
// ---------------------------------------------------------------------------

async function cmdDeploy(
  paths: DeployPaths,
  shell: ShellRunner,
  reconfigure = false,
): Promise<void> {
  await ensureSeedDir(paths, shell);

  // In headless mode (cron), self-update the script before deploying.
  // The update takes effect on the next run — the current process keeps
  // executing with the code already loaded in memory.
  if (!process.stdout.isTTY) {
    await selfUpdate(paths);
  }

  if (await configExists(paths)) {
    if (reconfigure && process.stdout.isTTY) {
      const existing = await readConfig(paths);
      const config = await runFreshWizard(paths, existing);
      await deploy(config, paths, shell);
      p.outro(
        `Reconfiguration complete! Your Seed node is running.\n${MANAGE_HINT}`,
      );
      return;
    }

    log(
      `Seed deploy v${VERSION} — config found at ${paths.configPath}, running headless.`,
    );
    const config = await readConfig(paths);
    await deploy(config, paths, shell);
    return;
  }

  const oldInstall = await detectOldInstall(shell);

  let config: SeedConfig;
  if (oldInstall) {
    config = await runMigrationWizard(oldInstall, paths, shell);
  } else {
    config = await runFreshWizard(paths);
  }

  const wantsCron = await p.confirm({
    message: "Install nightly cron job for automatic updates? (runs at 02:00)",
    initialValue: true,
  });
  if (!p.isCancel(wantsCron) && wantsCron) {
    await setupCron(paths, shell);
    p.log.success(
      "Cron job installed. Your node will auto-update nightly at 02:00.",
    );
  }

  await deploy(config, paths, shell);

  p.outro(`Setup complete! Your Seed node is running.\n${MANAGE_HINT}`);
}

async function cmdStop(paths: DeployPaths, shell: ShellRunner): Promise<void> {
  console.log("Stopping and removing Seed containers...");
  shell.runSafe(`docker compose -f "${paths.composePath}" down`);
  console.log("All Seed containers stopped and removed.");
}

async function cmdStart(paths: DeployPaths, shell: ShellRunner): Promise<void> {
  if (!(await configExists(paths))) {
    console.error(
      `No config found at ${paths.configPath}. Run 'seed-deploy' first to set up.`,
    );
    process.exit(1);
  }

  const config = await readConfig(paths);
  const envContent = buildComposeEnv(config, paths);

  console.log("Starting Seed containers...");
  shell.run(
    `${envContent} docker compose -f "${paths.composePath}" up -d --quiet-pull`,
  );
  console.log("Seed containers started.");
}

async function cmdRestart(
  paths: DeployPaths,
  shell: ShellRunner,
): Promise<void> {
  await cmdStop(paths, shell);
  await cmdStart(paths, shell);
}

async function cmdStatus(
  paths: DeployPaths,
  shell: ShellRunner,
): Promise<void> {
  console.log(`\nSeed Node Status v${VERSION}`);
  console.log("━".repeat(40));

  // Configuration
  let config: SeedConfig | null = null;
  if (await configExists(paths)) {
    config = await readConfig(paths);
    console.log(`\nConfiguration:`);
    console.log(`  Domain:      ${config.domain}`);
    console.log(
      `  Environment: ${{ prod: "Production", staging: "Staging", dev: "Development" }[config.environment]}`,
    );
    console.log(`  Channel:     ${config.release_channel}`);
    console.log(`  Gateway:     ${config.gateway ? "Yes" : "No"}`);
    console.log(`  Analytics:   ${config.analytics ? "Yes" : "No"}`);
    console.log(`  Config:      ${paths.configPath}`);
  } else {
    console.log(
      `\nNo config found at ${paths.configPath}. Node is not set up.`,
    );
  }

  // Containers
  console.log(`\nContainers:`);
  const containers = ["seed-daemon", "seed-web", "seed-proxy"];
  let hasUnhealthy = false;
  for (const name of containers) {
    const status = shell.runSafe(
      `docker inspect ${name} --format '{{.State.Status}}' 2>/dev/null`,
    );
    const image = shell.runSafe(
      `docker inspect ${name} --format '{{.Config.Image}}' 2>/dev/null`,
    );
    const started = shell.runSafe(
      `docker inspect ${name} --format '{{.State.StartedAt}}' 2>/dev/null`,
    );
    if (status) {
      const symbol = status === "running" ? "\u2714" : "\u26A0";
      console.log(
        `  ${symbol} ${name.padEnd(14)} ${(status ?? "").padEnd(10)} ${image ?? ""}${started ? `  (since ${started})` : ""}`,
      );
      if (status !== "running") {
        hasUnhealthy = true;
        const lastLog = shell.runSafe(`docker logs --tail 1 ${name} 2>&1`);
        if (lastLog) {
          console.log(`      └ ${lastLog.slice(0, 120)}`);
        }
      }
    } else {
      console.log(`  \u2718 ${name.padEnd(14)} not found`);
    }
  }

  if (hasUnhealthy) {
    console.log(`\n  Tip: Check logs with 'seed-deploy logs daemon|web|proxy'`);
  }

  // Monitoring export check (only shown when metrics profile is active)
  const prometheusRunning = shell.runSafe(
    `docker inspect prometheus --format '{{.State.Status}}' 2>/dev/null`,
  );
  const grafanaRunning = shell.runSafe(
    `docker inspect grafana --format '{{.State.Status}}' 2>/dev/null`,
  );
  if (prometheusRunning || grafanaRunning) {
    const prometheusConfig = join(
      paths.seedDir,
      "monitoring",
      "prometheus",
      "prometheus.yaml",
    );
    const grafanaProvDir = join(
      paths.seedDir,
      "monitoring",
      "grafana",
      "provisioning",
    );
    let monitoringOk = true;

    console.log(`\nMonitoring:`);
    try {
      await access(prometheusConfig);
      console.log(`  \u2714 Prometheus config exported`);
    } catch {
      monitoringOk = false;
      console.log(`  \u26A0 Prometheus config not exported`);
    }
    try {
      await access(grafanaProvDir);
      console.log(`  \u2714 Grafana provisioning exported`);
    } catch {
      monitoringOk = false;
      console.log(`  \u26A0 Grafana provisioning not exported`);
    }
    if (!monitoringOk) {
      console.log(
        `\n  Tip: This may indicate a permissions issue with the monitoring/ directory.`,
      );
      console.log(
        `        Run 'seed-deploy deploy' to attempt an automatic fix.`,
      );
    }
  }

  // Health checks (only if config exists and domain is set)
  if (config) {
    console.log(`\nHealth Checks:`);
    const dns = extractDns(config.domain);

    // HTTPS check
    const httpCode = shell.runSafe(
      `curl -sSf -o /dev/null -w '%{http_code}' --max-time 10 "${config.domain}" 2>/dev/null`,
    );
    if (httpCode && httpCode.startsWith("2")) {
      console.log(`  \u2714 HTTPS          ${httpCode} OK`);
    } else if (httpCode) {
      console.log(`  \u26A0 HTTPS          ${httpCode}`);
    } else {
      console.log(`  \u26A0 HTTPS          unreachable`);
    }

    // DNS check
    const publicIp = shell.runSafe(
      "curl -s --max-time 5 ifconfig.me 2>/dev/null",
    );
    const dnsResult = shell.runSafe(
      `dig +short ${dns} A 2>/dev/null | head -1`,
    );
    if (publicIp && dnsResult) {
      if (dnsResult.trim() === publicIp.trim()) {
        console.log(
          `  \u2714 DNS            ${dns} -> ${dnsResult} (matches public IP)`,
        );
      } else {
        console.log(
          `  \u26A0 DNS            ${dns} -> ${dnsResult} (public IP is ${publicIp})`,
        );
      }
    } else if (!dnsResult) {
      console.log(`  \u26A0 DNS            ${dns} does not resolve`);
    } else {
      console.log(`  ? DNS            could not determine public IP`);
    }

    // TLS certificate check
    const certExpiry = shell.runSafe(
      `echo | openssl s_client -servername "${dns}" -connect "${dns}:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null`,
    );
    if (certExpiry) {
      const expiryDate = certExpiry.replace("notAfter=", "");
      const expiry = new Date(expiryDate);
      const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
      const symbol = daysLeft > 14 ? "\u2714" : "\u26A0";
      console.log(
        `  ${symbol} Certificate    valid, expires ${expiry.toISOString().slice(0, 10)} (${daysLeft}d)`,
      );
    } else {
      console.log(`  \u26A0 Certificate    could not check`);
    }
  }

  // Disk usage
  const du = shell.runSafe(`du -sh "${paths.seedDir}" 2>/dev/null`);
  if (du) {
    console.log(`\nDisk:`);
    console.log(`  ${paths.seedDir}  ${du.split("\t")[0]}`);
  }

  // Cron
  const crontab = shell.runSafe("crontab -l 2>/dev/null") ?? "";
  const deployCron = crontab
    .split("\n")
    .find((l) => l.includes("# seed-deploy"));
  const cleanupCron = crontab
    .split("\n")
    .find((l) => l.includes("# seed-cleanup"));
  console.log(`\nCron:`);
  console.log(
    `  Auto-update: ${deployCron ? deployCron.split(" ").slice(0, 5).join(" ") : "not installed"}`,
  );
  console.log(
    `  Cleanup:     ${cleanupCron ? cleanupCron.split(" ").slice(0, 5).join(" ") : "not installed"}`,
  );
  if (!deployCron || !cleanupCron) {
    console.log(`\n  Tip: Run 'seed-deploy cron' to set up automatic updates.`);
  }

  console.log("");
}

async function cmdConfig(paths: DeployPaths): Promise<void> {
  if (!(await configExists(paths))) {
    console.error(
      `No config found at ${paths.configPath}. Run 'seed-deploy' first.`,
    );
    process.exit(1);
  }

  const config = await readConfig(paths);
  const redacted = { ...config, link_secret: "****" };
  console.log(JSON.stringify(redacted, null, 2));
}

async function cmdLogs(paths: DeployPaths, args: string[]): Promise<void> {
  const service = args[0];
  const serviceName = service ? `seed-${service}` : "";
  try {
    execSync(
      `docker compose -f "${paths.composePath}" logs -f --tail 100 ${serviceName}`,
      { stdio: "inherit" },
    );
  } catch {
    // User pressed Ctrl+C — normal exit
  }
}

async function cmdCron(
  paths: DeployPaths,
  shell: ShellRunner,
  args: string[],
): Promise<void> {
  const subcommand = args[0] ?? "install";

  if (subcommand === "remove") {
    const existing = shell.runSafe("crontab -l 2>/dev/null") ?? "";
    if (
      !existing.includes("# seed-deploy") &&
      !existing.includes("# seed-cleanup")
    ) {
      console.log("No seed cron jobs found. Nothing to remove.");
      return;
    }
    const cleaned = removeSeedCronLines(existing);
    try {
      shell.run(`echo '${cleaned}' | crontab -`);
      console.log("Seed cron jobs removed.");
    } catch (err) {
      console.error(`Failed to remove cron jobs: ${err}`);
      process.exit(1);
    }
    return;
  }

  if (subcommand === "install") {
    await setupCron(paths, shell);
    const crontab = shell.runSafe("crontab -l 2>/dev/null") ?? "";
    const deployCron = crontab
      .split("\n")
      .find((l) => l.includes("# seed-deploy"));
    const cleanupCron = crontab
      .split("\n")
      .find((l) => l.includes("# seed-cleanup"));
    console.log("Cron jobs installed:");
    console.log(`  Auto-update: ${deployCron ?? "(missing)"}`);
    console.log(`  Cleanup:     ${cleanupCron ?? "(missing)"}`);
    return;
  }

  console.error(`Unknown cron subcommand: ${subcommand}`);
  console.error("Usage: seed-deploy cron [install|remove]");
  process.exit(1);
}

/** Extract seed-managed cron lines from a full crontab string. */
export function extractSeedCronLines(crontab: string): string[] {
  return crontab
    .split("\n")
    .filter(
      (line) =>
        line.includes("# seed-deploy") || line.includes("# seed-cleanup"),
    );
}

/** Remove all seed-managed cron lines from the active crontab. */
export function removeSeedCronLines(existing: string): string {
  return (
    existing
      .split("\n")
      .filter(
        (line) =>
          !line.includes("# seed-deploy") && !line.includes("# seed-cleanup"),
      )
      .join("\n")
      .trim() + "\n"
  );
}

/** Metadata stored inside backup archives for provenance tracking. */
export interface BackupMeta {
  version: string;
  timestamp: string;
  hostname: string;
  seedDir: string;
  cron: string[];
}

async function cmdBackup(
  paths: DeployPaths,
  shell: ShellRunner,
  args: string[],
): Promise<void> {
  if (!(await configExists(paths))) {
    console.error(
      `No config found at ${paths.configPath}. Nothing to back up.`,
    );
    process.exit(1);
  }

  const config = await readConfig(paths);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultPath = join(
    paths.seedDir,
    "backups",
    `seed-backup-${timestamp}.tar.gz`,
  );
  const backupFile = args[0] || defaultPath;
  const backupDir = dirname(backupFile);

  await mkdir(backupDir, { recursive: true });

  // Write backup metadata
  const crontab = shell.runSafe("crontab -l 2>/dev/null") ?? "";
  const meta: BackupMeta = {
    version: VERSION,
    timestamp: new Date().toISOString(),
    hostname: config.domain,
    seedDir: paths.seedDir,
    cron: extractSeedCronLines(crontab),
  };
  await writeFile(
    join(paths.seedDir, "backup-meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
    "utf-8",
  );

  // Stop containers for data consistency
  console.log("Stopping containers for consistent backup...");
  shell.runSafe(`docker compose -f "${paths.composePath}" stop`);

  // Create tarball — include config, data, compose, metadata. Exclude backups dir and .env
  const seedBase = basename(paths.seedDir);
  const seedParent = dirname(paths.seedDir);
  try {
    shell.run(
      `tar -czf "${backupFile}" -C "${seedParent}" --exclude="${seedBase}/backups" --exclude="${seedBase}/.env" --exclude="${seedBase}/deploy.js" --exclude="${seedBase}/deploy.log" "${seedBase}/config.json" "${seedBase}/backup-meta.json" "${seedBase}/docker-compose.yml" "${seedBase}/web" "${seedBase}/daemon" "${seedBase}/proxy"`,
    );
  } catch (err) {
    console.error(`Backup failed: ${err}`);
    // Restart containers even on failure
    shell.runSafe(`docker compose -f "${paths.composePath}" start`);
    process.exit(1);
  }

  // Clean up metadata file
  shell.runSafe(`rm -f "${join(paths.seedDir, "backup-meta.json")}"`);

  // Restart containers
  console.log("Restarting containers...");
  shell.runSafe(`docker compose -f "${paths.composePath}" start`);

  const size =
    shell.runSafe(`du -h "${backupFile}"`)?.split("\t")[0] ?? "unknown";
  console.log(`\nBackup created: ${backupFile} (${size})`);
}

async function cmdRestore(
  paths: DeployPaths,
  shell: ShellRunner,
  args: string[],
): Promise<void> {
  const backupFile = args[0];
  if (!backupFile) {
    console.error("Usage: seed-deploy restore <backup-file.tar.gz>");
    process.exit(1);
  }

  try {
    await access(backupFile);
  } catch {
    console.error(`File not found: ${backupFile}`);
    process.exit(1);
  }

  // Read metadata from tarball without full extraction
  let meta: BackupMeta | null = null;
  const seedBase = basename(paths.seedDir);
  const metaJson = shell.runSafe(
    `tar -xzf "${backupFile}" -O "${seedBase}/backup-meta.json" 2>/dev/null`,
  );
  if (metaJson) {
    try {
      meta = JSON.parse(metaJson) as BackupMeta;
    } catch {
      // malformed metadata — proceed without it
    }
  }

  // Show what we're restoring
  p.intro(`Seed Node Restore v${VERSION}`);
  if (meta) {
    p.note(
      [
        `Created:  ${meta.timestamp}`,
        `Source:   ${meta.hostname}`,
        `Version:  ${meta.version}`,
      ].join("\n"),
      "Restoring from backup",
    );
  }

  const confirmed = await p.confirm({
    message: `This will overwrite all data in ${paths.seedDir}. Continue?`,
  });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Restore cancelled.");
    console.log("\nRun 'seed-deploy restore <file>' to try again.\n");
    process.exit(0);
  }

  // Stop existing containers
  console.log("Stopping existing containers...");
  shell.runSafe(`docker compose -f "${paths.composePath}" down`);

  // Extract backup
  console.log("Extracting backup...");
  await ensureSeedDir(paths, shell);
  const seedParent = dirname(paths.seedDir);
  shell.run(`tar -xzf "${backupFile}" -C "${seedParent}"`);

  // Clean up metadata file from extracted data
  shell.runSafe(`rm -f "${join(paths.seedDir, "backup-meta.json")}"`);

  // Restore cron lines from backup metadata
  if (meta?.cron && meta.cron.length > 0) {
    const existingCron = shell.runSafe("crontab -l 2>/dev/null") ?? "";
    const newCrontab = buildCrontab(existingCron, paths);
    try {
      shell.run(`echo '${newCrontab}' | crontab -`);
      console.log("Cron jobs restored.");
    } catch {
      console.log("Warning: Could not restore cron jobs.");
    }
  }

  // Ask if user wants to review configuration
  const wantsReview = await p.confirm({
    message: "Would you like to review the configuration before deploying?",
    initialValue: false,
  });

  let config: SeedConfig;
  if (!p.isCancel(wantsReview) && wantsReview) {
    // Load the restored config and run the migration wizard with it pre-filled
    const restored = await readConfig(paths);
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
    };
    config = await runMigrationWizard(asOldInstall, paths, shell);
  } else {
    config = await readConfig(paths);
  }

  // Deploy with the restored (or modified) config
  await deploy(config, paths, shell);

  p.outro(`Restore complete! Your Seed node is running.\n${MANAGE_HINT}`);
}

async function cmdUninstall(
  paths: DeployPaths,
  shell: ShellRunner,
): Promise<void> {
  p.intro(`Seed Node Uninstall v${VERSION}`);

  p.note(
    [
      "This will permanently delete:",
      `  - All Seed containers`,
      `  - All node data at ${paths.seedDir}/ (daemon identity, web data, config)`,
      `  - Cron jobs for seed-deploy and seed-cleanup`,
      "",
      "This action is IRREVERSIBLE.",
    ].join("\n"),
    "Warning",
  );

  // Offer backup first
  const wantsBackup = await p.confirm({
    message: "Would you like to create a backup before uninstalling?",
    initialValue: true,
  });
  if (!p.isCancel(wantsBackup) && wantsBackup) {
    await cmdBackup(paths, shell, []);
  }

  const confirmation = await p.text({
    message: 'Type "yes" to confirm uninstallation:',
    validate: (v) => {
      if (v !== "yes")
        return 'Please type "yes" to confirm, or press Ctrl+C to cancel.';
    },
  });

  if (p.isCancel(confirmation)) {
    p.cancel("Uninstall cancelled.");
    process.exit(0);
  }

  // Stop and remove containers
  console.log("Stopping and removing containers...");
  shell.runSafe(`docker compose -f "${paths.composePath}" down`);

  // Remove seed cron lines
  const existingCron = shell.runSafe("crontab -l 2>/dev/null") ?? "";
  if (
    existingCron.includes("# seed-deploy") ||
    existingCron.includes("# seed-cleanup")
  ) {
    const cleaned = removeSeedCronLines(existingCron);
    try {
      shell.run(`echo '${cleaned}' | crontab -`);
      console.log("Cron jobs removed.");
    } catch {
      console.log("Warning: Could not remove cron jobs.");
    }
  }

  // Remove seed directory
  console.log(`Removing ${paths.seedDir}...`);
  try {
    shell.run(`rm -rf "${paths.seedDir}"`);
  } catch {
    console.log(`Could not remove ${paths.seedDir}. Trying with sudo...`);
    shell.run(`sudo rm -rf "${paths.seedDir}"`);
  }

  p.outro("Seed node uninstalled.");
}

// ---------------------------------------------------------------------------
// Main: CLI Dispatch
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { command, args, reconfigure } = parseArgs();
  const paths = makePaths();
  const shell = makeShellRunner();

  switch (command) {
    case "help":
      printHelp();
      return;
    case "version":
      console.log(VERSION);
      return;
    case "deploy":
      return cmdDeploy(paths, shell, reconfigure);
    case "stop":
      return cmdStop(paths, shell);
    case "start":
      return cmdStart(paths, shell);
    case "restart":
      return cmdRestart(paths, shell);
    case "status":
      return cmdStatus(paths, shell);
    case "config":
      return cmdConfig(paths);
    case "logs":
      return cmdLogs(paths, args);
    case "cron":
      return cmdCron(paths, shell, args);
    case "backup":
      return cmdBackup(paths, shell, args);
    case "restore":
      return cmdRestore(paths, shell, args);
    case "uninstall":
      return cmdUninstall(paths, shell);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
