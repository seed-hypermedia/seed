---
name: Code Execution
summary: The execute callable runs TypeScript, Python, or shell code in an isolated microVM with the agent's memory mounted as its working directory.
---
The `execute` [callable](./callables.md) runs code for an agent. This page covers its input, the runtimes, the sandbox each call gets, queueing, networking, and its output. Operators set it up as described in [operations](../operate/code-execution-backend.md), and the threat model is in [security](./security.md).

Runs TypeScript, Python, or shell code in a hardware-isolated microVM with the agent's memory bind-mounted at `/workspace`, which is also the working directory (`apps/src/code-exec.ts`). <!-- id:nU6Y8gV3 -->

# Input <!-- id:5dic_Cn3 -->

```ts <!-- id:sz2X8H0e -->
type ExecuteInput = {
  description: string // required: one short line saying what the run is for, 3–120 chars
  runtime: 'ts' | 'python' | 'shell'
  code: string
  timeout_secs?: number // clamped to [1, 300]
}
```

# Behavior

<!-- id:EM9I864U -->
- **`description` is required**, and it is what the user reads. Agents use `execute` constantly, and a row that says "Ran python code (exit 0, 812ms)" tells the user nothing. The contract demands the intent in one line ("Count words across the notes folder"). A call without one gets the contract back, like any other miss. The desktop row shows the description live while the sandbox runs, and afterwards as the summary. The summary leads with it and appends only what matters: a non-zero exit, or memory files touched. Runtime and duration stay in the expanded details. <!-- id:WtamqiDC -->
- `ts` runs `bun -e`, `python` runs `python -c`, `shell` runs `/bin/sh -c`. Nothing goes through a shell unless the runtime _is_ the shell. The sandbox takes an argv array, so code with quotes, newlines, or `$` needs no escaping (`code-exec.ts`). <!-- id:fSq8wN3B -->
- **Two images.** The main rootfs is a Python image with no JavaScript runtime, so `ts` runs in its own image (`SEED_APPS_EXEC_TS_IMAGE`, default `oven/bun`). An operator can set it explicitly empty to withhold TypeScript. The runtime is then not offered at all, so it is never advertised and then fails (`code-exec.ts`, `executeToolForRuntimes`). <!-- id:ICMlkC26 -->
- Each call gets a sandbox (`security: restricted`) with capped CPUs, memory, and lifetime (`timeout + 30s`). By default it is fresh and discarded afterwards, so the contract tells the model to save results as files and to `pip install --target /workspace/pylibs <pkg>`. With the **warm pool** on (`SEED_APPS_EXEC_WARM_POOL=1`), a VM is kept per principal (account, agent, session, image) and reused for that principal's next call: `SEED_APPS_EXEC_MAX_VMS` (3) bounds the pool, `SEED_APPS_EXEC_POOL_IDLE_TTL_SECS` (180) and `SEED_APPS_EXEC_POOL_MAX_AGE_SECS` (1800) retire a VM. A warm VM is never shared across principals. Only one sandbox may have an agent's memory mounted at a time: a call that arrives while another sandbox for the same agent is running (another session, a delegated child, a trigger firing) waits for it, first-in first-out, and answers 503 only after `SEED_APPS_EXEC_MEMORY_ROOT_WAIT_SECS` (300, the longest one execution can run), so such calls normally queue rather than fail. A host-wide cap, `SEED_APPS_EXEC_MAX_CONCURRENT` (default `CPUs - 2`, at least 1), queues calls the same way and answers 503 after `SEED_APPS_EXEC_ACQUIRE_WAIT_SECS` (30). <!-- id:iYhNTgqU -->
- Networking is **on by default**, with explicit DNS resolvers and a non-local egress policy (`NetworkPolicy.fromProfiles(['public'])`, falling back to `nonLocal()` for older staged SDKs, `code-exec.ts`). <!-- id:V5Dky7AY -->
- Output: `{summary, exitCode, success, stdout, stderr, truncated, durationMs, changedFiles}`. stdout and stderr are bounded at 64 KiB each. `changedFiles` is a before/after listing diff of memory. Live progress streams a \~2000-char output tail at most every 250 ms. <!-- id:Zr_CQ4Uz -->
- The SDK loads lazily and `availability()` is memoized. Hosts without virtualization run normally, and the tool is absent there instead of failing (`code-exec.ts`, with codes `config-disabled`, `unsupported-platform`, `whp-disabled`, `kvm-missing`, `kvm-forbidden`, `runtime-error`). <!-- id:nzXZhUiw -->

# Files in /workspace

`/workspace` is the agent's [memory](./memory.md). The `private/` part of memory is not mounted. Other runs of the same agent and the host side verbs reach the same files, so some kinds of file are unsafe there. Read [what not to keep in /workspace](./memory.md#what-not-to-keep-in-workspace).

# See also

- [Callable tools](./callables.md)
- [Memory](./memory.md)
- [Security](./security.md)
- [Operations: code execution backend](../operate/code-execution-backend.md)
- [Troubleshooting](../operate/troubleshooting.md)
