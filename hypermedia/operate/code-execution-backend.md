---
name: Code execution backend
summary: This page says what a host needs so that agents can run code in small virtual machines, how the server reports that it cannot, and how to check that code execution still works.
---
[Agents](../agent.md) run code with the `execute` tool. Each call starts a sandbox, a small virtual machine, on the host of the [app environment](../software/app-environment.md). This page is the operator's side: what the host must provide, which settings shape the sandboxes, and how to tell that execution works.

The first thing to check: `curl <server>/api/health` and read `codeExec`. If it is `false`, the server does not offer `execute` to any agent, and `codeExecReason` says why.

The tool's contract is in [tools](../agent/tools.md), and the threat model is in [security](../agent/security.md).

# Requirements <!-- id:VLdUUR8z -->

The `execute` tool uses the `microsandbox` npm package. It runs each sandbox as a microVM, a virtual machine isolated by the hardware, and it needs no separate server process. <!-- id:pQ4E3B90 -->

- **The host** must be Apple Silicon on macOS, have KVM on Linux, or have WHP (Windows Hypervisor Platform) on Windows.
- **The runtime** and its native binaries install with the package.
- **The first execution** downloads the sandbox image, which takes tens of seconds. The default image is `python`. After that, a sandbox starts in well under a second.
- **TypeScript** runs in a second image, `SEED_APPS_EXEC_TS_IMAGE`, `oven/bun` by default. Set it empty and TypeScript is not offered; `codeExecRuntimes` in health reports that.

When the app environment runs inside a container, the container needs the host's virtualization device. On Linux that is `--device /dev/kvm`. Without it the server still runs, and agents are not offered `execute` (see below). <!-- id:1nsXcwQ3 -->

The runtime keeps its sandbox images under `~/.microsandbox/`, which is `/root/.microsandbox` in the image. Keep that directory on a volume. Then the first execution after a redeploy does not download the images again.

Every copy of the runtime on one machine shares that directory. When a newer copy upgrades the database in it, every older copy stops working with `database schema is newer than this msb binary`. So pin the `microsandbox` dependency to one exact version.

# When the host cannot run sandboxes

The server asks the backend whether it can run a sandbox. When the answer is no, the server removes `execute` from every agent's tools (`enabledCallableTools`). The model never sees a tool that can only fail. `SEED_APPS_EXEC_BACKEND=off` turns the backend off in the same way. <!-- id:EmHP7rkO -->

Health reports the answer as `codeExec`. When it is `false`, `codeExecReason` and `codeExecReasonCode` say why; the code is `kvm-missing` on a Linux host without the device. `codeExecRuntimes` lists the runtimes on offer. See [endpoints and health](./endpoints-and-health.md).

This is different from web search. Without its backend, `web_search` is still offered and a call fails; see [web research backends](./web-research-backends.md).

# Networking

A sandbox can use the network **by default**, so agents can install packages and fetch data. <!-- id:OYeHVeib -->

- The runtime gives each sandbox a DNS resolver: `SEED_APPS_EXEC_DNS`, `1.1.1.1,8.8.8.8` by default. A sandbox has no resolver otherwise.
- A sandbox reaches the public internet. It does not reach the host's private network or cloud metadata addresses such as `169.254.169.254`.
- `SEED_APPS_EXEC_ALLOW_NETWORK=false` cuts the sandbox off completely.

# Sandbox size, concurrency and reuse

These settings shape a sandbox. [Configuration](./configuration.md) has the defaults.

- `SEED_APPS_EXEC_CPUS` and `SEED_APPS_EXEC_MEMORY_MIB`: the virtual CPUs and the memory of each sandbox.
- `SEED_APPS_EXEC_TIMEOUT_SECS`: how long a call runs, unless the tool asks for more.
- `SEED_APPS_EXEC_MAX_CONCURRENT`: how many sandboxes the whole host uses at once. A call past this number waits up to `SEED_APPS_EXEC_ACQUIRE_WAIT_SECS` for a free place.
- Only one sandbox holds an agent's memory at a time. A second call waits up to `SEED_APPS_EXEC_MEMORY_ROOT_WAIT_SECS` for it.

By default each call runs in a new microVM, and the server throws the microVM away afterwards. So installed packages do not last between calls. The tool prompt tells agents to run `pip install --target /workspace/pylibs <pkg>`, which keeps packages in the agent's memory for later calls.

With `SEED_APPS_EXEC_WARM_POOL=1` the server keeps microVMs alive between calls. It uses one again for the same [account](../protocol/identity.md), agent, session and image. `SEED_APPS_EXEC_MAX_VMS` limits the pool, and `SEED_APPS_EXEC_POOL_IDLE_TTL_SECS` and `SEED_APPS_EXEC_POOL_MAX_AGE_SECS` retire a pooled VM. [Tools](../agent/tools.md) says what an agent may rely on.

# Is code execution working

Code execution can break while everything else looks fine. The health endpoint does not start a sandbox. A warm pool keeps handing out VMs that are already running. So health can answer `200` while every new sandbox fails to start. Three things test code execution directly:

  - **The exec canary** (`SEED_APPS_EXEC_CANARY_SECS`) starts a new sandbox on that interval, runs `echo` in it and removes it. It never takes a warm VM, and it does not count against the host-wide limit. So neither the pool nor a busy host can hide a broken runtime. Its work directory is a new directory under `<data dir>/exec-probe`, never an agent's memory. It logs the first failure and the recovery as `[Exec Canary] Sandbox probe failed` and `[Exec Canary] Sandbox probe recovered`.
  - **`/api/health`** carries `execCanary: {ok, lastRunAt, consecutiveFailures}`, or `null` when the canary is off. A failing canary never turns health `503`, because a restart does not fix a broken sandbox runtime.
  - **`GET /api/metrics`** has `seed_agents_exec_canary_up`, `seed_agents_exec_canary_consecutive_failures`, `seed_agents_exec_canary_last_run_timestamp_seconds` and `_last_success_timestamp_seconds`. Beside them are `seed_agents_events_total{event}` (every `/api/perf` counter, including `exec.boot_failed` and the run outcomes `run.succeeded`, `run.failed`, `run.canceled`), `seed_agents_span_total{span}`, `seed_agents_span_p95_milliseconds{span}` and the [loop-lag](./stalled-server.md) gauges.

When the canary fails:

1. Run `docker logs <container> 2>&1 | grep -A3 'Exec Canary'`. It shows the error from the start of the sandbox. On the hosted production server the container is `agents-stable`.
2. Run `msb logs --source system <sandbox>` inside the container. It shows the runtime's side.

# On the hosted Seed servers

This section describes the servers Seed hosts. It can change, and this repository cannot confirm it.

- Production and staging turn the warm pool on and run the canary every `300` seconds.
- Grafana Alloy on the agents host reads `/api/metrics` for stable, staging and dev every minute. Grafana alert rules send a message to the operations Discord channel.
- Both live in the infrastructure repository (SeedInfra): the scrape in `seed_infra/agentic/config/monitoring/agents.alloy`, the rules in `seed_infra/monitoring`.
- The rules cover: sandbox canary failing, canary not running, metrics missing, sandbox boots failing, run failure rate, event loop stalled, and the liveness, disk and memory of the agents host.

# See also

- [Tools](../agent/tools.md), the `execute` contract and what not to keep in `/workspace`
- [Security](../agent/security.md), code execution safety
- [Configuration](./configuration.md), every `SEED_APPS_EXEC_*` setting
- [Environments](./environments.md), how each setup gets its sandbox runtime
- [Deploying](./deploying.md), how the runtime is put into the image
- [Troubleshooting](./troubleshooting.md), symptoms under `/workspace`
