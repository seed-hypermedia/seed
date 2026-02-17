import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  getContainerImages,
  ensureSeedDir,
  environmentPresets,
  buildCrontab,
  parseArgs,
  extractSeedCronLines,
  removeSeedCronLines,
  DEFAULT_SEED_DIR,
  selfUpdate,
} from "./deploy";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTestConfig(overrides: Partial<SeedConfig> = {}): SeedConfig {
  return {
    domain: "https://node1.seed.run",
    email: "ops@seed.hypermedia",
    compose_url: DEFAULT_COMPOSE_URL,
    compose_sha: "",
    compose_envs: { LOG_LEVEL: "info" },
    environment: "prod",
    release_channel: "latest",
    testnet: false,
    link_secret: "testSecret1",
    analytics: false,
    gateway: false,
    last_script_run: "",
    ...overrides,
  };
}

function makeNoopShell(): ShellRunner {
  return {
    run(_cmd: string): string {
      throw new Error("command not found");
    },
    runSafe(_cmd: string): string | null {
      return null;
    },
    exec(_cmd: string): Promise<{ stdout: string; stderr: string }> {
      return Promise.reject(new Error("command not found"));
    },
  };
}

function makeMockShell(responses: Record<string, string>): ShellRunner {
  return {
    run(cmd: string): string {
      for (const [pattern, response] of Object.entries(responses)) {
        if (cmd.includes(pattern)) return response;
      }
      throw new Error(`command not mocked: ${cmd}`);
    },
    runSafe(cmd: string): string | null {
      try {
        return this.run(cmd);
      } catch {
        return null;
      }
    },
    exec(cmd: string): Promise<{ stdout: string; stderr: string }> {
      try {
        return Promise.resolve({ stdout: this.run(cmd), stderr: "" });
      } catch (e) {
        return Promise.reject(e);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// makePaths
// ---------------------------------------------------------------------------

describe("makePaths", () => {
  test("creates paths from default seed dir", () => {
    const paths = makePaths("/opt/seed");
    expect(paths.seedDir).toBe("/opt/seed");
    expect(paths.configPath).toBe("/opt/seed/config.json");
    expect(paths.composePath).toBe("/opt/seed/docker-compose.yml");
    expect(paths.deployLog).toBe("/opt/seed/deploy.log");
  });

  test("creates paths from custom seed dir", () => {
    const paths = makePaths("/tmp/test-seed");
    expect(paths.seedDir).toBe("/tmp/test-seed");
    expect(paths.configPath).toBe("/tmp/test-seed/config.json");
    expect(paths.composePath).toBe("/tmp/test-seed/docker-compose.yml");
    expect(paths.deployLog).toBe("/tmp/test-seed/deploy.log");
  });
});

// ---------------------------------------------------------------------------
// extractDns
// ---------------------------------------------------------------------------

describe("extractDns", () => {
  test("strips https:// prefix", () => {
    expect(extractDns("https://node1.seed.run")).toBe("node1.seed.run");
  });

  test("strips http:// prefix", () => {
    expect(extractDns("http://node1.seed.run")).toBe("node1.seed.run");
  });

  test("strips trailing slashes", () => {
    expect(extractDns("https://node1.seed.run/")).toBe("node1.seed.run");
    expect(extractDns("https://node1.seed.run///")).toBe("node1.seed.run");
  });

  test("handles bare domain (no protocol)", () => {
    expect(extractDns("node1.seed.run")).toBe("node1.seed.run");
  });

  test("preserves port numbers", () => {
    expect(extractDns("https://localhost:3000")).toBe("localhost:3000");
  });

  test("preserves subdomains", () => {
    expect(extractDns("https://deep.sub.domain.example.com")).toBe(
      "deep.sub.domain.example.com",
    );
  });

  test("handles empty string", () => {
    expect(extractDns("")).toBe("");
  });

  test("handles just protocol", () => {
    expect(extractDns("https://")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// sha256
// ---------------------------------------------------------------------------

describe("sha256", () => {
  test("produces a 64-char hex string", () => {
    const hash = sha256("hello world");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("known hash for 'hello world'", () => {
    expect(sha256("hello world")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  test("different inputs produce different hashes", () => {
    expect(sha256("input A")).not.toBe(sha256("input B"));
  });

  test("same input produces same hash", () => {
    expect(sha256("deterministic")).toBe(sha256("deterministic"));
  });

  test("handles empty string", () => {
    expect(sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("handles unicode content", () => {
    const hash = sha256("hello 世界 🌍");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// generateSecret
// ---------------------------------------------------------------------------

describe("generateSecret", () => {
  test("default length is 10", () => {
    expect(generateSecret()).toHaveLength(10);
  });

  test("custom lengths", () => {
    expect(generateSecret(5)).toHaveLength(5);
    expect(generateSecret(20)).toHaveLength(20);
    expect(generateSecret(1)).toHaveLength(1);
    expect(generateSecret(0)).toBe("");
  });

  test("only alphanumeric characters", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateSecret(50)).toMatch(/^[A-Za-z0-9]*$/);
    }
  });

  test("successive calls produce different values", () => {
    const secrets = new Set(Array.from({ length: 20 }, () => generateSecret()));
    expect(secrets.size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// environmentPresets
// ---------------------------------------------------------------------------

describe("environmentPresets", () => {
  test("prod uses mainnet and stable releases", () => {
    const p = environmentPresets("prod");
    expect(p.testnet).toBe(false);
    expect(p.release_channel).toBe("latest");
  });

  test("staging uses mainnet with dev builds", () => {
    const p = environmentPresets("staging");
    expect(p.testnet).toBe(false);
    expect(p.release_channel).toBe("dev");
  });

  test("dev uses testnet with dev builds", () => {
    const p = environmentPresets("dev");
    expect(p.testnet).toBe(true);
    expect(p.release_channel).toBe("dev");
  });
});

// ---------------------------------------------------------------------------
// generateCaddyfile
// ---------------------------------------------------------------------------

describe("generateCaddyfile", () => {
  test("contains expected Caddy directives", () => {
    const caddy = generateCaddyfile(makeTestConfig());
    expect(caddy).toContain("{$SEED_SITE_HOSTNAME}");
    expect(caddy).toContain("encode zstd gzip");
    expect(caddy).toContain("reverse_proxy /.metrics* grafana:");
    expect(caddy).toContain("reverse_proxy @ipfsget seed-daemon:");
    expect(caddy).toContain("reverse_proxy * seed-web:");
  });

  test("contains IPFS get matcher", () => {
    const caddy = generateCaddyfile(makeTestConfig());
    expect(caddy).toContain("@ipfsget");
    expect(caddy).toContain("method GET HEAD OPTIONS");
    expect(caddy).toContain("path /ipfs/*");
  });

  test("uses env var placeholders for ports", () => {
    const caddy = generateCaddyfile(makeTestConfig());
    expect(caddy).toContain("{$SEED_SITE_MONITORING_PORT:3001}");
    expect(caddy).toContain("{$HM_SITE_BACKEND_GRPCWEB_PORT:56001}");
    expect(caddy).toContain("{$SEED_SITE_LOCAL_PORT:3000}");
  });

  test("output is consistent regardless of config values", () => {
    const caddy1 = generateCaddyfile(
      makeTestConfig({ domain: "https://a.com" }),
    );
    const caddy2 = generateCaddyfile(
      makeTestConfig({ domain: "https://b.com" }),
    );
    expect(caddy1).toBe(caddy2);
  });
});

// ---------------------------------------------------------------------------
// parseDaemonEnv
// ---------------------------------------------------------------------------

describe("parseDaemonEnv", () => {
  test("extracts log level", () => {
    const json = JSON.stringify(["SEED_LOG_LEVEL=debug", "OTHER=value"]);
    const result = parseDaemonEnv(json);
    expect(result.logLevel).toBe("debug");
    expect(result.testnet).toBe(false);
  });

  test("detects testnet when SEED_P2P_TESTNET_NAME has a value", () => {
    const json = JSON.stringify([
      "SEED_LOG_LEVEL=info",
      "SEED_P2P_TESTNET_NAME=dev",
    ]);
    expect(parseDaemonEnv(json).testnet).toBe(true);
  });

  test("no testnet when SEED_P2P_TESTNET_NAME is empty", () => {
    const json = JSON.stringify(["SEED_P2P_TESTNET_NAME="]);
    expect(parseDaemonEnv(json).testnet).toBe(false);
  });

  test("null logLevel when not present", () => {
    expect(
      parseDaemonEnv(JSON.stringify(["UNRELATED=foo"])).logLevel,
    ).toBeNull();
  });

  test("handles invalid JSON", () => {
    const result = parseDaemonEnv("not valid json");
    expect(result.logLevel).toBeNull();
    expect(result.testnet).toBe(false);
  });

  test("handles empty array", () => {
    const result = parseDaemonEnv("[]");
    expect(result.logLevel).toBeNull();
    expect(result.testnet).toBe(false);
  });

  test("handles empty string", () => {
    const result = parseDaemonEnv("");
    expect(result.logLevel).toBeNull();
    expect(result.testnet).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseWebEnv
// ---------------------------------------------------------------------------

describe("parseWebEnv", () => {
  test("extracts hostname", () => {
    const json = JSON.stringify(["SEED_BASE_URL=https://node1.seed.run"]);
    expect(parseWebEnv(json).hostname).toBe("https://node1.seed.run");
  });

  test("detects gateway mode", () => {
    expect(parseWebEnv(JSON.stringify(["SEED_IS_GATEWAY=true"])).gateway).toBe(
      true,
    );
  });

  test("gateway false when value is 'false'", () => {
    expect(parseWebEnv(JSON.stringify(["SEED_IS_GATEWAY=false"])).gateway).toBe(
      false,
    );
  });

  test("detects traffic stats", () => {
    expect(
      parseWebEnv(JSON.stringify(["SEED_ENABLE_STATISTICS=true"])).trafficStats,
    ).toBe(true);
  });

  test("extracts all fields together", () => {
    const json = JSON.stringify([
      "SEED_BASE_URL=https://gateway.hyper.media",
      "SEED_IS_GATEWAY=true",
      "SEED_ENABLE_STATISTICS=true",
      "OTHER=ignored",
    ]);
    const result = parseWebEnv(json);
    expect(result.hostname).toBe("https://gateway.hyper.media");
    expect(result.gateway).toBe(true);
    expect(result.trafficStats).toBe(true);
  });

  test("handles invalid JSON", () => {
    const result = parseWebEnv("garbage");
    expect(result.hostname).toBeNull();
    expect(result.gateway).toBe(false);
    expect(result.trafficStats).toBe(false);
  });

  test("handles empty string", () => {
    const result = parseWebEnv("");
    expect(result.hostname).toBeNull();
    expect(result.gateway).toBe(false);
    expect(result.trafficStats).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseImageTag
// ---------------------------------------------------------------------------

describe("parseImageTag", () => {
  test("extracts tag from full image string", () => {
    expect(parseImageTag("seedhypermedia/web:latest")).toBe("latest");
    expect(parseImageTag("seedhypermedia/web:dev")).toBe("dev");
    expect(parseImageTag("seedhypermedia/site:v1.2.3")).toBe("v1.2.3");
  });

  test("returns 'latest' when no tag specified", () => {
    expect(parseImageTag("seedhypermedia/web")).toBe("latest");
  });

  test("handles registry prefix", () => {
    expect(parseImageTag("docker.io/seedhypermedia/web:main")).toBe("main");
  });

  test("handles multiple colons (registry:port/image:tag)", () => {
    expect(parseImageTag("registry:5000/seedhypermedia/web:dev")).toBe("dev");
  });

  test("handles empty string", () => {
    expect(parseImageTag("")).toBe("latest");
  });
});

// ---------------------------------------------------------------------------
// inferEnvironment
// ---------------------------------------------------------------------------

function makeOldInstall(
  overrides: Partial<OldInstallInfo> = {},
): OldInstallInfo {
  return {
    workspace: "/home/user/.seed-site",
    secret: null,
    secretConsumed: false,
    hostname: "https://example.com",
    logLevel: "info",
    imageTag: "latest",
    testnet: false,
    gateway: false,
    trafficStats: false,
    ...overrides,
  };
}

describe("inferEnvironment", () => {
  test("returns 'dev' when testnet is true", () => {
    expect(inferEnvironment(makeOldInstall({ testnet: true }))).toBe("dev");
  });

  test("returns 'dev' when testnet is true even with dev image tag", () => {
    expect(
      inferEnvironment(makeOldInstall({ testnet: true, imageTag: "dev" })),
    ).toBe("dev");
  });

  test("returns 'staging' when not testnet and image tag is 'dev'", () => {
    expect(
      inferEnvironment(makeOldInstall({ testnet: false, imageTag: "dev" })),
    ).toBe("staging");
  });

  test("returns 'prod' when not testnet and image tag is 'latest'", () => {
    expect(
      inferEnvironment(makeOldInstall({ testnet: false, imageTag: "latest" })),
    ).toBe("prod");
  });

  test("returns 'prod' when not testnet and image tag is a semver", () => {
    expect(
      inferEnvironment(makeOldInstall({ testnet: false, imageTag: "v1.2.3" })),
    ).toBe("prod");
  });

  test("returns 'prod' when not testnet and image tag is null", () => {
    expect(
      inferEnvironment(makeOldInstall({ testnet: false, imageTag: null })),
    ).toBe("prod");
  });
});

// ---------------------------------------------------------------------------
// buildComposeEnv
// ---------------------------------------------------------------------------

describe("buildComposeEnv", () => {
  test("includes all required environment variables", () => {
    const env = buildComposeEnv(makeTestConfig(), makePaths("/opt/seed"));
    expect(env).toContain('SEED_SITE_HOSTNAME="https://node1.seed.run"');
    expect(env).toContain('SEED_SITE_DNS="node1.seed.run"');
    expect(env).toContain('SEED_SITE_TAG="latest"');
    expect(env).toContain('SEED_SITE_WORKSPACE="/opt/seed"');
    expect(env).toContain(`SEED_UID="${process.getuid!()}"`);
    expect(env).toContain(`SEED_GID="${process.getgid!()}"`);
    expect(env).toContain('SEED_LOG_LEVEL="info"');
    expect(env).toContain('SEED_IS_GATEWAY="false"');
    expect(env).toContain('SEED_ENABLE_STATISTICS="false"');
    expect(env).toContain('SEED_P2P_TESTNET_NAME=""');
    expect(env).toContain(`SEED_LIGHTNING_URL="${LIGHTNING_URL_MAINNET}"`);
    expect(env).toContain(`NOTIFY_SERVICE_HOST="${NOTIFY_SERVICE_HOST}"`);
    expect(env).toContain(
      'SEED_SITE_MONITORING_WORKDIR="/opt/seed/monitoring"',
    );
  });

  test("testnet flips lightning URL and testnet name", () => {
    const env = buildComposeEnv(makeTestConfig({ testnet: true }), makePaths());
    expect(env).toContain(`SEED_LIGHTNING_URL="${LIGHTNING_URL_TESTNET}"`);
    expect(env).toContain('SEED_P2P_TESTNET_NAME="dev"');
  });

  test("mainnet uses mainnet lightning URL", () => {
    const env = buildComposeEnv(
      makeTestConfig({ testnet: false }),
      makePaths(),
    );
    expect(env).toContain(`SEED_LIGHTNING_URL="${LIGHTNING_URL_MAINNET}"`);
    expect(env).toContain('SEED_P2P_TESTNET_NAME=""');
  });

  test("reflects gateway flag", () => {
    expect(
      buildComposeEnv(makeTestConfig({ gateway: true }), makePaths()),
    ).toContain('SEED_IS_GATEWAY="true"');
    expect(
      buildComposeEnv(makeTestConfig({ gateway: false }), makePaths()),
    ).toContain('SEED_IS_GATEWAY="false"');
  });

  test("reflects analytics flag", () => {
    expect(
      buildComposeEnv(makeTestConfig({ analytics: true }), makePaths()),
    ).toContain('SEED_ENABLE_STATISTICS="true"');
    expect(
      buildComposeEnv(makeTestConfig({ analytics: false }), makePaths()),
    ).toContain('SEED_ENABLE_STATISTICS="false"');
  });

  test("reflects release channel", () => {
    expect(
      buildComposeEnv(makeTestConfig({ release_channel: "dev" }), makePaths()),
    ).toContain('SEED_SITE_TAG="dev"');
    expect(
      buildComposeEnv(
        makeTestConfig({ release_channel: "latest" }),
        makePaths(),
      ),
    ).toContain('SEED_SITE_TAG="latest"');
  });

  test("reflects log level", () => {
    expect(
      buildComposeEnv(
        makeTestConfig({
          compose_envs: { LOG_LEVEL: "debug" },
        }),
        makePaths(),
      ),
    ).toContain('SEED_LOG_LEVEL="debug"');
  });

  test("uses custom paths for workspace and monitoring", () => {
    const env = buildComposeEnv(makeTestConfig(), makePaths("/custom/path"));
    expect(env).toContain('SEED_SITE_WORKSPACE="/custom/path"');
    expect(env).toContain(
      'SEED_SITE_MONITORING_WORKDIR="/custom/path/monitoring"',
    );
  });

  test("handles domain with special characters", () => {
    const env = buildComposeEnv(
      makeTestConfig({ domain: "https://my-node.example.com" }),
      makePaths(),
    );
    expect(env).toContain('SEED_SITE_DNS="my-node.example.com"');
  });
});

// ---------------------------------------------------------------------------
// getWorkspaceDirs
// ---------------------------------------------------------------------------

describe("getWorkspaceDirs", () => {
  test("includes base and monitoring directories", () => {
    const dirs = getWorkspaceDirs(makePaths("/opt/seed"));
    expect(dirs).toContain("/opt/seed/proxy");
    expect(dirs).toContain("/opt/seed/proxy/data");
    expect(dirs).toContain("/opt/seed/proxy/config");
    expect(dirs).toContain("/opt/seed/web");
    expect(dirs).toContain("/opt/seed/daemon");
    expect(dirs).toContain("/opt/seed/monitoring");
    expect(dirs).toContain("/opt/seed/monitoring/grafana");
    expect(dirs).toContain("/opt/seed/monitoring/prometheus");
    expect(dirs).toHaveLength(8);
  });

  test("respects custom paths", () => {
    const dirs = getWorkspaceDirs(makePaths("/tmp/test-seed"));
    expect(dirs.every((d) => d.startsWith("/tmp/test-seed"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Config read/write/exists (integration with temp dirs)
// ---------------------------------------------------------------------------

describe("config read/write/exists", () => {
  let tmpDir: string;
  let paths: DeployPaths;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "seed-test-"));
    paths = makePaths(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("configExists returns false when no config", async () => {
    expect(await configExists(paths)).toBe(false);
  });

  test("writeConfig creates directory and file", async () => {
    await writeConfig(makeTestConfig(), paths);
    expect(await configExists(paths)).toBe(true);
  });

  test("readConfig roundtrips correctly", async () => {
    const original = makeTestConfig({
      domain: "https://roundtrip.example.com",
      email: "test@example.com",
      compose_sha: "abc123",
      compose_envs: { LOG_LEVEL: "debug" },
      environment: "dev",
      release_channel: "dev",
      testnet: true,
      link_secret: "mysecret",
      analytics: true,
      gateway: true,
      last_script_run: "2026-01-15T10:30:00Z",
    });
    await writeConfig(original, paths);
    expect(await readConfig(paths)).toEqual(original);
  });

  test("writeConfig overwrites existing config", async () => {
    await writeConfig(makeTestConfig({ domain: "https://first.com" }), paths);
    await writeConfig(makeTestConfig({ domain: "https://second.com" }), paths);
    expect((await readConfig(paths)).domain).toBe("https://second.com");
  });

  test("config file is pretty-printed JSON ending with newline", async () => {
    await writeConfig(makeTestConfig(), paths);
    const raw = await readFile(paths.configPath, "utf-8");
    expect(raw).toContain("\n");
    expect(raw).toContain("  ");
    expect(raw.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test("readConfig throws on missing file", async () => {
    await expect(readConfig(paths)).rejects.toThrow();
  });

  test("readConfig throws on invalid JSON", async () => {
    await mkdir(paths.seedDir, { recursive: true });
    await writeFile(paths.configPath, "not json", "utf-8");
    await expect(readConfig(paths)).rejects.toThrow();
  });

  test("config preserves all SeedConfig fields", async () => {
    await writeConfig(makeTestConfig(), paths);
    const loaded = await readConfig(paths);
    const expectedKeys: (keyof SeedConfig)[] = [
      "domain",
      "email",
      "compose_url",
      "compose_sha",
      "compose_envs",
      "environment",
      "release_channel",
      "testnet",
      "link_secret",
      "analytics",
      "gateway",
      "last_script_run",
    ];
    for (const key of expectedKeys) {
      expect(loaded).toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// ensureSeedDir
// ---------------------------------------------------------------------------

describe("ensureSeedDir", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "seed-dir-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("creates directory if it doesn't exist", async () => {
    const seedDir = join(tmpDir, "newseed");
    const paths = makePaths(seedDir);
    const shell = makeNoopShell();

    await ensureSeedDir(paths, shell);
    await access(seedDir); // should not throw
  });

  test("succeeds if directory already exists", async () => {
    const paths = makePaths(tmpDir);
    const shell = makeNoopShell();

    await ensureSeedDir(paths, shell);
    await access(tmpDir); // should not throw
  });

  test("creates nested directory structure", async () => {
    const seedDir = join(tmpDir, "deep", "nested", "seed");
    const paths = makePaths(seedDir);
    const shell = makeNoopShell();

    await ensureSeedDir(paths, shell);
    await access(seedDir);
  });
});

// ---------------------------------------------------------------------------
// checkContainersHealthy / getContainerImages (mock shell)
// ---------------------------------------------------------------------------

describe("checkContainersHealthy", () => {
  test("false when no Docker available", async () => {
    expect(await checkContainersHealthy(makeNoopShell())).toBe(false);
  });

  test("false when some containers missing", async () => {
    const shell = makeMockShell({
      "seed-proxy": "true",
      "seed-web": "true",
    });
    expect(await checkContainersHealthy(shell)).toBe(false);
  });

  test("true when all containers running", async () => {
    const shell = makeMockShell({
      "seed-proxy": "true",
      "seed-web": "true",
      "seed-daemon": "true",
    });
    expect(await checkContainersHealthy(shell)).toBe(true);
  });

  test("false when a container reports not running", async () => {
    const shell = makeMockShell({
      "seed-proxy": "true",
      "seed-web": "false",
      "seed-daemon": "true",
    });
    expect(await checkContainersHealthy(shell)).toBe(false);
  });
});

describe("getContainerImages", () => {
  test("empty map when no Docker available", async () => {
    expect((await getContainerImages(makeNoopShell())).size).toBe(0);
  });

  test("returns images for running containers", async () => {
    const shell = makeMockShell({
      "seed-proxy": "sha256:abc123",
      "seed-web": "sha256:def456",
      "seed-daemon": "sha256:ghi789",
    });
    const images = await getContainerImages(shell);
    expect(images.size).toBe(3);
    expect(images.get("seed-proxy")).toBe("sha256:abc123");
    expect(images.get("seed-web")).toBe("sha256:def456");
    expect(images.get("seed-daemon")).toBe("sha256:ghi789");
  });
});

// ---------------------------------------------------------------------------
// makeShellRunner (real shell smoke tests)
// ---------------------------------------------------------------------------

describe("makeShellRunner", () => {
  test("run executes a basic command", () => {
    expect(makeShellRunner().run("echo hello")).toBe("hello");
  });

  test("runSafe returns null on failure", () => {
    expect(makeShellRunner().runSafe("false")).toBeNull();
  });

  test("exec resolves with stdout", async () => {
    expect((await makeShellRunner().exec("echo async")).stdout).toBe("async");
  });

  test("exec rejects on failure", async () => {
    await expect(makeShellRunner().exec("false")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Full scenario: config -> compose env
// ---------------------------------------------------------------------------

describe("full config scenarios", () => {
  let tmpDir: string;
  let paths: DeployPaths;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "seed-scenario-"));
    paths = makePaths(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("testnet config roundtrips and produces correct env", async () => {
    const config = makeTestConfig({
      domain: "https://dev.hyper.media",
      testnet: true,
      release_channel: "dev",
      gateway: true,
      analytics: true,
      compose_envs: { LOG_LEVEL: "debug" },
    });

    await writeConfig(config, paths);
    const loaded = await readConfig(paths);
    const env = buildComposeEnv(loaded, paths);

    expect(env).toContain('SEED_SITE_HOSTNAME="https://dev.hyper.media"');
    expect(env).toContain('SEED_SITE_DNS="dev.hyper.media"');
    expect(env).toContain('SEED_SITE_TAG="dev"');
    expect(env).toContain('SEED_P2P_TESTNET_NAME="dev"');
    expect(env).toContain(`SEED_LIGHTNING_URL="${LIGHTNING_URL_TESTNET}"`);
    expect(env).toContain('SEED_IS_GATEWAY="true"');
    expect(env).toContain('SEED_ENABLE_STATISTICS="true"');
    expect(env).toContain('SEED_LOG_LEVEL="debug"');
  });

  test("production config roundtrips and produces correct env", async () => {
    const config = makeTestConfig({
      domain: "https://node.example.com",
      testnet: false,
      release_channel: "latest",
      gateway: false,
    });

    await writeConfig(config, paths);
    const loaded = await readConfig(paths);
    const env = buildComposeEnv(loaded, paths);

    expect(env).toContain('SEED_SITE_TAG="latest"');
    expect(env).toContain('SEED_P2P_TESTNET_NAME=""');
    expect(env).toContain(`SEED_LIGHTNING_URL="${LIGHTNING_URL_MAINNET}"`);
    expect(env).toContain('SEED_IS_GATEWAY="false"');
  });

  test("workspace dirs always include monitoring subdirs for daemon volumes", () => {
    const dirs = getWorkspaceDirs(paths);
    expect(dirs.some((d) => d.includes("monitoring"))).toBe(true);
    expect(dirs.some((d) => d.includes("monitoring/grafana"))).toBe(true);
    expect(dirs.some((d) => d.includes("monitoring/prometheus"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildCrontab
// ---------------------------------------------------------------------------

describe("buildCrontab", () => {
  const paths = makePaths("/opt/seed");

  test("adds seed lines to an empty crontab", () => {
    const result = buildCrontab("", paths);
    expect(result).toContain("# seed-deploy");
    expect(result).toContain("# seed-cleanup");
    expect(result).toContain("/opt/seed/deploy.js");
    expect(result.endsWith("\n")).toBe(true);
  });

  test("preserves existing non-seed cron lines", () => {
    const existing = "0 * * * * /usr/bin/some-other-job # my-job";
    const result = buildCrontab(existing, paths);
    expect(result).toContain("some-other-job");
    expect(result).toContain("# seed-deploy");
    expect(result).toContain("# seed-cleanup");
  });

  test("replaces existing seed-deploy line without duplicating", () => {
    const existing = [
      "0 * * * * /usr/bin/some-other-job # my-job",
      "0 3 * * * /usr/bin/bun /old/path/deploy.js >> /old/path/log 2>&1 # seed-deploy",
    ].join("\n");
    const result = buildCrontab(existing, paths);

    // Should contain exactly one seed-deploy line (the new one)
    const deployLines = result
      .split("\n")
      .filter((l) => l.includes("# seed-deploy"));
    expect(deployLines).toHaveLength(1);
    expect(deployLines[0]).toContain("/opt/seed/deploy.js");
    expect(deployLines[0]).not.toContain("/old/path");

    // Other job preserved
    expect(result).toContain("some-other-job");
  });

  test("replaces existing seed-cleanup line without duplicating", () => {
    const existing = "30 0 * * * docker image prune -f # seed-cleanup";
    const result = buildCrontab(existing, paths);

    const cleanupLines = result
      .split("\n")
      .filter((l) => l.includes("# seed-cleanup"));
    expect(cleanupLines).toHaveLength(1);
    // New version uses -a flag and multiple times
    expect(cleanupLines[0]).toContain("0 0,4,8,12,16,20");
  });

  test("replaces both seed lines at once (idempotent)", () => {
    // First run
    const first = buildCrontab("0 * * * * /usr/bin/other # my-job", paths);
    // Second run with first output
    const second = buildCrontab(first, paths);

    expect(first).toBe(second);
  });

  test("does not leave blank lines when replacing", () => {
    const existing = [
      "0 * * * * /usr/bin/job-a # job-a",
      "0 2 * * * /usr/bin/bun /opt/seed/deploy.js >> /opt/seed/deploy.log 2>&1 # seed-deploy",
      "0 0,4,8,12,16,20 * * * docker image prune -a -f # seed-cleanup",
    ].join("\n");
    const result = buildCrontab(existing, paths);

    // No double newlines (blank lines)
    expect(result).not.toContain("\n\n");
  });

  test("uses custom bun path in deploy cron line", () => {
    const result = buildCrontab("", paths, "/home/user/.bun/bin/bun");
    const deployLine = result
      .split("\n")
      .find((l) => l.includes("# seed-deploy"))!;
    expect(deployLine).toContain("/home/user/.bun/bin/bun");
    expect(deployLine).not.toContain("/usr/local/bin/bun");
  });

  test("defaults bun path to /usr/local/bin/bun", () => {
    const result = buildCrontab("", paths);
    const deployLine = result
      .split("\n")
      .find((l) => l.includes("# seed-deploy"))!;
    expect(deployLine).toContain("/usr/local/bin/bun");
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  test("defaults to 'deploy' when no args given", () => {
    const result = parseArgs(["node", "deploy.js"]);
    expect(result.command).toBe("deploy");
    expect(result.args).toEqual([]);
  });

  test("parses known commands", () => {
    const commands = [
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
    for (const cmd of commands) {
      const result = parseArgs(["node", "deploy.js", cmd]);
      expect(result.command).toBe(cmd);
    }
  });

  test("passes remaining args through", () => {
    const result = parseArgs(["node", "deploy.js", "logs", "daemon"]);
    expect(result.command).toBe("logs");
    expect(result.args).toEqual(["daemon"]);
  });

  test("parses --help flag", () => {
    expect(parseArgs(["node", "deploy.js", "--help"]).command).toBe("help");
    expect(parseArgs(["node", "deploy.js", "-h"]).command).toBe("help");
  });

  test("parses --version flag", () => {
    expect(parseArgs(["node", "deploy.js", "--version"]).command).toBe(
      "version",
    );
    expect(parseArgs(["node", "deploy.js", "-v"]).command).toBe("version");
  });

  test("passes backup path as arg", () => {
    const result = parseArgs([
      "node",
      "deploy.js",
      "backup",
      "/tmp/backup.tar.gz",
    ]);
    expect(result.command).toBe("backup");
    expect(result.args).toEqual(["/tmp/backup.tar.gz"]);
  });

  test("passes restore path as arg", () => {
    const result = parseArgs([
      "node",
      "deploy.js",
      "restore",
      "/tmp/backup.tar.gz",
    ]);
    expect(result.command).toBe("restore");
    expect(result.args).toEqual(["/tmp/backup.tar.gz"]);
  });

  test("passes cron subcommand as arg", () => {
    const result = parseArgs(["node", "deploy.js", "cron", "remove"]);
    expect(result.command).toBe("cron");
    expect(result.args).toEqual(["remove"]);
  });

  test("--reconfigure flag on deploy command", () => {
    const result = parseArgs(["node", "deploy.js", "deploy", "--reconfigure"]);
    expect(result.command).toBe("deploy");
    expect(result.reconfigure).toBe(true);
    expect(result.args).toEqual([]);
  });

  test("--reconfigure without explicit deploy command", () => {
    const result = parseArgs(["node", "deploy.js", "--reconfigure"]);
    expect(result.command).toBe("deploy");
    expect(result.reconfigure).toBe(true);
    expect(result.args).toEqual([]);
  });

  test("--reconfigure is not set on other commands", () => {
    const result = parseArgs(["node", "deploy.js", "status"]);
    expect(result.reconfigure).toBeFalsy();
  });

  test("--reconfigure is not set on plain deploy", () => {
    const result = parseArgs(["node", "deploy.js"]);
    expect(result.reconfigure).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// extractSeedCronLines / removeSeedCronLines
// ---------------------------------------------------------------------------

describe("extractSeedCronLines", () => {
  test("extracts seed-deploy and seed-cleanup lines", () => {
    const crontab = [
      "0 * * * * /usr/bin/other # my-job",
      "0 2 * * * /usr/bin/bun /opt/seed/deploy.js >> /opt/seed/deploy.log 2>&1 # seed-deploy",
      "0 0,4,8,12,16,20 * * * docker image prune -a -f # seed-cleanup",
    ].join("\n");
    const lines = extractSeedCronLines(crontab);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("# seed-deploy");
    expect(lines[1]).toContain("# seed-cleanup");
  });

  test("returns empty array when no seed lines present", () => {
    const crontab = "0 * * * * /usr/bin/other # my-job";
    expect(extractSeedCronLines(crontab)).toHaveLength(0);
  });
});

describe("removeSeedCronLines", () => {
  test("removes seed lines and preserves others", () => {
    const crontab = [
      "0 * * * * /usr/bin/other # my-job",
      "0 2 * * * /usr/bin/bun /opt/seed/deploy.js # seed-deploy",
      "30 * * * * /usr/bin/another # another-job",
      "0 0 * * * docker image prune -a -f # seed-cleanup",
    ].join("\n");
    const result = removeSeedCronLines(crontab);
    expect(result).toContain("my-job");
    expect(result).toContain("another-job");
    expect(result).not.toContain("seed-deploy");
    expect(result).not.toContain("seed-cleanup");
  });

  test("returns empty crontab when only seed lines present", () => {
    const crontab = [
      "0 2 * * * /usr/bin/bun /opt/seed/deploy.js # seed-deploy",
      "0 0 * * * docker image prune -a -f # seed-cleanup",
    ].join("\n");
    const result = removeSeedCronLines(crontab);
    expect(result.trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_SEED_DIR derivation
// ---------------------------------------------------------------------------

describe("DEFAULT_SEED_DIR", () => {
  test("derives from dirname of process.argv[1] when SEED_DIR is unset", () => {
    // When SEED_DIR is not set in the test environment, the default should
    // be derived from process.argv[1] (the test runner's script path).
    // We can't fully test the env-var branch here since it would require
    // modifying process.env before the module loads, but we verify the
    // derivation logic is not hardcoded to "/opt/seed".
    if (!process.env.SEED_DIR) {
      const { dirname } = require("node:path");
      expect(DEFAULT_SEED_DIR).toBe(dirname(process.argv[1]));
    } else {
      expect(DEFAULT_SEED_DIR).toBe(process.env.SEED_DIR);
    }
  });
});

// ---------------------------------------------------------------------------
// buildCrontab: pruning safety margin
// ---------------------------------------------------------------------------

describe("buildCrontab pruning safety", () => {
  const paths = makePaths("/opt/seed");

  test("cleanup line includes --filter until=1h for safety margin", () => {
    const result = buildCrontab("", paths);
    const cleanupLine = result
      .split("\n")
      .find((l) => l.includes("# seed-cleanup"))!;
    expect(cleanupLine).toContain('--filter "until=1h"');
    expect(cleanupLine).toContain("docker image prune -a -f");
  });
});

// ---------------------------------------------------------------------------
// selfUpdate
// ---------------------------------------------------------------------------

describe("selfUpdate", () => {
  let tmpDir: string;
  let paths: DeployPaths;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "seed-selfupdate-"));
    paths = makePaths(tmpDir);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("is exported and callable", () => {
    expect(typeof selfUpdate).toBe("function");
  });

  test("handles fetch failure gracefully (no throw)", async () => {
    // selfUpdate uses process.argv[1] and fetches from DEFAULT_REPO_URL.
    // In a test environment, the fetch will fail (no internet or wrong URL).
    // It should not throw — just log and return.
    const origUrl = process.env.SEED_REPO_URL;
    process.env.SEED_REPO_URL = "http://localhost:1/nonexistent";
    try {
      await selfUpdate(paths); // should not throw
    } finally {
      if (origUrl !== undefined) {
        process.env.SEED_REPO_URL = origUrl;
      } else {
        delete process.env.SEED_REPO_URL;
      }
    }
  });
});
