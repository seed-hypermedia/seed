---
name: Code execution backend
summary: What a host needs so that agents can run code in microVM sandboxes, how the server reports and withholds the capability, and how to check that it still works.
---
Agents run code through the `execute` tool, which boots a sandbox on the host of the [app environment](../software/app-environment.md). This page is the operator's side: what the host must provide, which settings shape the sandboxes, and how to tell that execution works. The tool's contract is in [tools](../agent/tools.md), and the threat model is in [security](../agent/security.md).

# Requirements <!-- id:VLdUUR8z -->

The `execute` tool uses the embedded `microsandbox` npm runtime: hardware-isolated microVMs with no separate server process. Host requirements: Apple Silicon on macOS, KVM on Linux, WHP (Windows Hypervisor Platform) on Windows. The runtime and native binaries install with the package. The first execution pulls the configured OCI image (default `python`), which takes tens of seconds. After that, sandboxes boot in well under a second. The `ts` runtime comes from a second image (`SEED_APPS_EXEC_TS_IMAGE`, default `oven/bun`); Setting it empty leaves TypeScript unavailable, and `codeExecRuntimes` reports that. <!-- id:pQ4E3B90 -->

When the app environment runs inside a container, the container needs access to the host virtualization device (on Linux, `--device /dev/kvm`). Without it, executions fail with the backend-unavailable error, and the rest of the service keeps working. <!-- id:1nsXcwQ3 -->

The runtime keeps its sandbox images under `~/.microsandbox/` (`/root/.microsandbox` in the image). Persist that directory as a volume, so the first execution after each redeploy does not pull the images again. Every copy of the runtime on one machine shares that state directory, and a newer copy that migrates its database locks out every older copy (`database schema is newer than this msb binary`), so keep the `microsandbox` dependency pinned exactly.

# When the host cannot run sandboxes

On a host that cannot run sandboxes, the tool is withheld so it never fails at call time. `enabledCallableTools` drops `execute` from the agent's callable set when the availability probe says no, so the model never sees a tool that can only error. `SEED_APPS_EXEC_BACKEND=off` disables the backend outright. <!-- id:EmHP7rkO -->

The health endpoint reports the probe as `codeExec`, with `codeExecReason` and `codeExecReasonCode` when it is false (`kvm-missing` on a Linux host without the device) and `codeExecRuntimes` for the runtimes on offer. See [endpoints and health](./endpoints-and-health.md).

# Networking

Sandbox networking is **on by default** so agents can install packages and fetch data. The runtime gives each sandbox an explicit DNS resolver (`SEED_APPS_EXEC_DNS`, default `1.1.1.1,8.8.8.8`; a guest has no resolver otherwise) and a non-local egress policy. The sandbox reaches the public internet but not the host's private network or cloud-metadata endpoints (for example `169.254.169.254`). Set `SEED_APPS_EXEC_ALLOW_NETWORK=false` to cut the sandbox off entirely. <!-- id:OYeHVeib -->

# Sandbox size, concurrency and reuse

Each sandbox gets `SEED_APPS_EXEC_CPUS` virtual CPUs and `SEED_APPS_EXEC_MEMORY_MIB` of memory, and a call runs for `SEED_APPS_EXEC_TIMEOUT_SECS` unless the tool asks for more. `SEED_APPS_EXEC_MAX_CONCURRENT` caps the sandboxes in use at once across the host; a call past the cap waits up to `SEED_APPS_EXEC_ACQUIRE_WAIT_SECS` for a slot. Only one sandbox mounts an agent's memory at a time, and a second call waits up to `SEED_APPS_EXEC_MEMORY_ROOT_WAIT_SECS` for it.

By default each call runs in a fresh microVM that is discarded afterwards, so installed packages do not survive between calls. The tool prompt tells agents to `pip install --target /workspace/pylibs <pkg>` so packages persist in memory and can be re-imported later. With `SEED_APPS_EXEC_WARM_POOL=1` the server keeps microVMs alive between calls and reuses one for the same account, agent, session and image. `SEED_APPS_EXEC_MAX_VMS` bounds the pool, and `SEED_APPS_EXEC_POOL_IDLE_TTL_SECS` and `SEED_APPS_EXEC_POOL_MAX_AGE_SECS` retire a pooled VM. The hosted production and staging servers turn the pool on. [Configuration](./configuration.md) has the defaults, and [tools](../agent/tools.md) says what the agent may rely on.

# Is code execution working

Code execution can break while everything else stays green. The health endpoint does not boot a sandbox, and a warm pool keeps serving VMs that are already running, so health can answer `200` while every new sandbox fails at boot. Three things probe the subsystem directly:

  - **The exec canary** (`SEED_APPS_EXEC_CANARY_SECS`, `300` on the hosted servers) boots a brand-new sandbox on that interval, runs `echo` in it and tears it down. It never takes a warm VM and it skips the host-wide concurrency cap, so neither the pool nor a busy host can hide a broken runtime. Its scratch workspace is a fresh directory under `<data dir>/exec-probe`, never an agent's memory. The first failure and the recovery are logged as `[Exec Canary] Sandbox probe failed` and `recovered`.
  - **`/api/health`** carries `execCanary: {ok, lastRunAt, consecutiveFailures}` (null when the canary is off). It never turns health 503, since a restart does not fix a broken sandbox runtime.
  - **`GET /api/metrics`** exposes `seed_agents_exec_canary_up`, `seed_agents_exec_canary_consecutive_failures`, `seed_agents_exec_canary_last_run_timestamp_seconds` and `_last_success_timestamp_seconds`, next to `seed_agents_events_total{event}` (every `/api/perf` counter, including `exec.boot_failed` and the run outcomes `run.succeeded`, `run.failed`, `run.canceled`), `seed_agents_span_total{span}`, `seed_agents_span_p95_milliseconds{span}` and the loop-lag gauges.

On the hosted servers, Grafana Alloy on the agents host scrapes `/api/metrics` for stable, staging and dev every minute, and Grafana alert rules page the ops Discord channel. Both live in SeedInfra: the scrape in `seed_infra/agentic/config/monitoring/agents.alloy`, the rules in `seed_infra/monitoring` (sandbox canary failing, canary not running, metrics missing, sandbox boots failing, run failure rate, event loop stalled, and the agents host's own liveness, disk and memory).

When the canary fails, `docker logs agents-stable 2>&1 | grep -A3 'Exec Canary'` has the boot error, and `msb logs --source system <sandbox>` inside the container has the runtime's side.

# See also

- [Tools](../agent/tools.md), the `execute` contract and what not to keep in `/workspace`
- [Security](../agent/security.md), code execution safety
- [Configuration](./configuration.md), every `SEED_APPS_EXEC_*` setting
- [Environments](./environments.md), how each deployment gets its sandbox runtime
- [Deploying](./deploying.md), how the runtime is staged into the image
- [Troubleshooting](./troubleshooting.md), symptoms under `/workspace`
