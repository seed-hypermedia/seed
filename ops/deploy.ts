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
 * The seed directory defaults to /opt/seed but can be overridden via
 * the SEED_DIR environment variable.
 */

import * as p from "@clack/prompts";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { execSync, exec as execCb } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const VERSION = "0.1.0";
export const DEFAULT_SEED_DIR = process.env.SEED_DIR || "/opt/seed";
export const DEFAULT_REPO_URL =
  "https://raw.githubusercontent.com/seed-hypermedia/seed/main";
export const DEFAULT_COMPOSE_URL = `${
  process.env.SEED_REPO_URL || DEFAULT_REPO_URL
}/ops/docker-compose.yml`;
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

// ---------------------------------------------------------------------------
// Old installation detection
// ---------------------------------------------------------------------------

export interface OldInstallInfo {
  workspace: string;
  secret: string | null;
  hostname: string | null;
  logLevel: string | null;
  imageTag: string | null;
  testnet: boolean;
  gateway: boolean;
  trafficStats: boolean;
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
          placeholder: "https://node1.seed.run",
          initialValue: old.hostname ?? "",
          validate: (v) => {
            if (!v) return "Required";
            if (!v.startsWith("https://") && !v.startsWith("http://"))
              return "Must start with https:// or http://";
          },
        }),
      email: () =>
        p.text({
          message:
            "Contact email — lets us notify you about security updates and node issues. Not shared publicly.",
          placeholder: "you@example.com",
          validate: (v) => {
            if (!v) return "Required";
            if (!v.includes("@")) return "Must be a valid email";
          },
        }),
      environment: () =>
        p.select({
          message: "Environment",
          initialValue: old.testnet ? "dev" : "prod",
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
    },
    {
      onCancel: () => {
        p.cancel("Migration cancelled");
        process.exit(0);
      },
    },
  );

  const secret = old.secret ?? generateSecret();
  if (old.secret) {
    p.log.success(`Registration secret imported from existing installation.`);
  } else {
    p.log.warn(`No existing registration secret found. Generated a new one.`);
  }

  const env = answers.environment as SeedConfig["environment"];
  const presets = environmentPresets(env);

  const config: SeedConfig = {
    domain: answers.domain as string,
    email: answers.email as string,
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
    p.cancel("Migration cancelled");
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

async function runFreshWizard(paths: DeployPaths): Promise<SeedConfig> {
  p.intro(`Seed Node Setup v${VERSION}`);

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

  const answers = await p.group(
    {
      domain: () =>
        p.text({
          message: "Public hostname (including https://)",
          placeholder: "https://node1.seed.run",
          validate: (v) => {
            if (!v) return "Required";
            if (!v.startsWith("https://") && !v.startsWith("http://"))
              return "Must start with https:// or http://";
          },
        }),
      email: () =>
        p.text({
          message:
            "Contact email — lets us notify you about security updates and node issues. Not shared publicly.",
          placeholder: "you@example.com",
          validate: (v) => {
            if (!v) return "Required";
            if (!v.includes("@")) return "Must be a valid email";
          },
        }),
      environment: () =>
        p.select({
          message: "Environment",
          initialValue: "prod",
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
          initialValue: "info",
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
          initialValue: false,
        }),
      analytics: () =>
        p.confirm({
          message:
            "Enable web analytics? Adds a Plausible.io dashboard to track your site's traffic.",
          initialValue: false,
        }),
    },
    {
      onCancel: () => {
        p.cancel("Setup cancelled");
        process.exit(0);
      },
    },
  );

  const secret = generateSecret();

  const env = answers.environment as SeedConfig["environment"];
  const presets = environmentPresets(env);

  const config: SeedConfig = {
    domain: answers.domain as string,
    email: answers.email as string,
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
    .filter(([k]) => k !== "compose_sha" && k !== "last_script_run")
    .map(([k, v]) => `  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join("\n");
  p.note(summary, "Configuration summary");

  const confirmed = await p.confirm({
    message: "Write config and proceed with deployment?",
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Setup cancelled");
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

  const repoOverride = process.env.SEED_REPO_URL;
  const composeUrl = repoOverride
    ? `${repoOverride}/ops/docker-compose.yml`
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

  step("Stopping any existing containers...");
  shell.runSafe(
    "docker stop seed-site seed-daemon seed-proxy grafana prometheus 2>/dev/null",
  );
  shell.runSafe(
    "docker rm seed-site seed-daemon seed-proxy grafana prometheus 2>/dev/null",
  );

  const previousImages = await getContainerImages(shell);

  step("Running docker compose up...");
  const env = buildComposeEnv(config, paths);

  try {
    const composeCmd = `${env} docker compose -f ${paths.composePath} up -d --pull always --quiet-pull`;
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

  step("Running post-deploy health checks...");
  let healthy = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    healthy = await checkContainersHealthy(shell);
    if (healthy) break;
    step(`Health check attempt ${attempt + 1}/10...`);
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

  spinner?.stop("Deployment complete!");
  log("Deployment complete.");

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

export async function setupCron(
  paths: DeployPaths,
  shell: ShellRunner,
): Promise<void> {
  const cronLine = `0 2 * * * /usr/bin/bun ${join(paths.seedDir, "deploy.js")} >> ${paths.deployLog} 2>&1 # seed-deploy`;

  const existing = shell.runSafe("crontab -l 2>/dev/null") ?? "";
  if (existing.includes("seed-deploy")) {
    log("Cron job already installed. Skipping.");
    return;
  }

  const cleanupCron = `0 0,4,8,12,16,20 * * * docker image prune -a -f # seed-cleanup`;
  const newCrontab =
    [existing, cronLine, cleanupCron].filter(Boolean).join("\n") + "\n";
  try {
    execSync(`echo '${newCrontab}' | crontab -`, { encoding: "utf-8" });
    log(
      "Installed nightly deployment cron job (02:00) and image cleanup cron.",
    );
  } catch (err) {
    log(`Warning: Failed to install cron job: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const paths = makePaths();
  const shell = makeShellRunner();

  await ensureSeedDir(paths, shell);

  const hasConfig = await configExists(paths);

  if (hasConfig) {
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

  p.outro("Setup complete! Your Seed node is running.");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
