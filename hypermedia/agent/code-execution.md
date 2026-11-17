---
name: Code Execution
summary: The execute callable runs TypeScript, Python, or shell code in an isolated microVM with the agent's memory mounted as its working directory.
---
`execute` is the [callable tool](./callables.md) that runs code for an [agent](../agent.md). For example, an agent can run a short Python program to count the words in its notes. The code runs in a sandbox: a small virtual machine that is kept apart from the server and from other agents.

`execute` runs TypeScript, Python or shell code. The agent's memory is mounted at `/workspace`, which is also the working directory (`apps/src/code-exec.ts`). <!-- id:nU6Y8gV3 -->

This page covers the input, the languages, the sandbox each call gets, waiting in line, networking, and the output. Operators set it up as described in [Code execution backend](../operate/code-execution-backend.md), and the threat model is in [security](./security.md).

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
- **`description` is required**, and it is what the user reads. A row that says "Ran python code (exit 0, 812ms)" tells the user nothing. So the contract asks for the purpose in one line ("Count words across the notes folder"). A call without one gets the contract back, like any other miss. The [Seed app](../software/desktop.md) shows the description while the sandbox runs, and afterwards as the summary. The summary adds only what matters: an exit code that is not zero, or memory files that changed. The language and the duration stay in the expanded details. <!-- id:WtamqiDC -->
- `ts` runs `bun -e`, `python` runs `python -c`, `shell` runs `/bin/sh -c`. Nothing goes through a shell unless the runtime _is_ the shell. The sandbox takes a list of arguments, so code with quotes, newlines, or `$` needs no escaping (`code-exec.ts`). <!-- id:fSq8wN3B -->
- **Two images.** The main image is a Python image with no JavaScript runtime. So `ts` runs in its own image (`SEED_APPS_EXEC_TS_IMAGE`, default `oven/bun`). An operator can set that variable to an empty value to turn TypeScript off. The server then does not offer `ts` at all, so the model is never offered a language that fails (`code-exec.ts`, `executeToolForRuntimes`). <!-- id:ICMlkC26 -->
- **A fresh sandbox.** Each call gets a sandbox (`security: restricted`) with limits on CPUs, memory, and lifetime (`timeout + 30s`). By default the sandbox is new and is thrown away afterwards. So the contract tells the model to save results as files, and to install Python packages with `pip install --target /workspace/pylibs <pkg>`. <!-- id:iYhNTgqU -->
- **The warm pool.** With `SEED_APPS_EXEC_WARM_POOL=1`, the server keeps a VM and uses it again for the next call with the same [account](../protocol/identity.md), agent, [session](./session.md) and image. A warm VM is never shared outside that combination. `SEED_APPS_EXEC_MAX_VMS` (3) limits the pool. `SEED_APPS_EXEC_POOL_IDLE_TTL_SECS` (180) and `SEED_APPS_EXEC_POOL_MAX_AGE_SECS` (1800) retire a VM.
- **One sandbox per agent memory.** Only one sandbox can have an agent's memory mounted at a time. A second call for the same agent waits in line, first in, first out. The second call can come from another session, a delegated child, or a [trigger](../trigger.md) firing. It fails with a 503 only after `SEED_APPS_EXEC_MEMORY_ROOT_WAIT_SECS` (300, the longest one execution can run). So such calls usually wait and do not fail.
- **A limit for the whole host.** `SEED_APPS_EXEC_MAX_CONCURRENT` (default `CPUs - 2`, at least 1) limits how many sandboxes run at once. Calls past the limit wait the same way, and fail with a 503 after `SEED_APPS_EXEC_ACQUIRE_WAIT_SECS` (30).
- Networking is **on by default**. The sandbox gets explicit DNS resolvers and can reach public addresses but not local ones (`NetworkPolicy.fromProfiles(['public'])`, or `nonLocal()` for older staged versions of the sandbox [SDK](../build/sdk.md), `code-exec.ts`). <!-- id:V5Dky7AY -->
- Output: `{summary, exitCode, success, stdout, stderr, truncated, durationMs, changedFiles}`. stdout and stderr are limited to 64 KiB each. `changedFiles` compares the list of memory files before and after. While the code runs, the server streams the last \~2000 characters of output, at most every 250 ms. <!-- id:Zr_CQ4Uz -->
- The sandbox SDK is loaded only when first needed, and the result of `availability()` is remembered. A host without virtualization runs normally. The tool is simply absent there and does not fail (`code-exec.ts`, with codes `config-disabled`, `unsupported-platform`, `whp-disabled`, `kvm-missing`, `kvm-forbidden`, `runtime-error`). <!-- id:nzXZhUiw -->

# Files in /workspace

`/workspace` is the agent's [memory](./memory.md). The `private/` part of memory is not mounted. Other [runs](./runs.md) of the same agent, and the [read](./read.md) and [write](./write.md) [verbs](./tools.md) on the host, reach the same files. So some kinds of file are unsafe there. Read [what not to keep in /workspace](./memory.md#what-not-to-keep-in-workspace).

# See also

- [Callable tools](./callables.md)
- [Memory](./memory.md)
- [Security](./security.md)
- [Code execution backend](../operate/code-execution-backend.md)
- [Troubleshooting](../operate/troubleshooting.md)
