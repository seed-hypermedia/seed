# Local CI with agent-ci

We now run our GitHub Actions workflows on our own machines before pushing. This catches failures in seconds instead of waiting for remote CI, and keeps the dev loop tight: edit → run → fail → fix in place → retry the failed step → push.

The tool is [agent-ci](https://agent-ci.dev) by RedwoodJS. It uses the unmodified, official GitHub Actions runner binary, so what passes locally passes on GitHub. It replaces the cloud cache with local bind-mounts, so `node_modules`, the pnpm store, and the llama.cpp build artifacts persist across runs at near-zero overhead.

## What's in the repo

Two new files were added:

- **`.github/agent-ci.Dockerfile`** — extends the official runner image to pre-create `/home/runner/.cache` with `runner` ownership. Without this, `golangci-lint-action` fails with `permission denied` because Docker auto-creates that directory as root when bind-mounting `/home/runner/.cache/ms-playwright` on top of it.
- **`AGENTS.md` → `## Local CI` section** — instructions for AI agents (Claude Code, Codex, Cursor) so they validate changes via agent-ci before reporting work done.

`.env.agent-ci` is gitignored. It's optional and only needed if you want to bake secrets into local runs (most workflows don't need it).

## One-time setup

1. **Docker Desktop** — install and start it. Verify with `docker info`.

2. **Tell agent-ci where Docker's socket is.** Docker Desktop on macOS doesn't expose `/var/run/docker.sock` by default; agent-ci checks the standard `DOCKER_HOST` env var. Add this to `~/.zshrc` (or `~/.bashrc`):

   ```sh
   export DOCKER_HOST="unix://$HOME/.docker/run/docker.sock"
   ```

   Then `source ~/.zshrc` or open a new terminal. Verify with `echo $DOCKER_HOST`.

   Alternative: in Docker Desktop → Settings → Advanced, enable "Allow the default Docker socket to be used" — that creates the `/var/run/docker.sock` symlink and the export becomes optional.

3. **Pull the runner image** (one-time, ~1.5 GB):

   ```sh
   docker pull ghcr.io/actions/actions-runner:latest
   ```

4. **Optional — macOS jobs.** If you ever want to run the macOS desktop-build workflows locally (Apple Silicon only):

   ```sh
   brew install cirruslabs/cli/tart hudochenkov/sshpass/sshpass
   ```

   Without these, agent-ci silently skips macOS jobs. Windows jobs aren't supported and are always skipped.

## Daily-driver commands

Pick the one that matches what you touched. `-p` is `--pause-on-failure` (keeps the container alive on failure so you can fix and retry the same step). `--github-token` (no value) auto-resolves via the `gh` CLI.

| Changed area | Command |
|---|---|
| Frontend (web/desktop/shared/ui/editor) | `npx @redwoodjs/agent-ci run -w .github/workflows/test-frontend-parallel.yml -p --github-token` |
| Backend Go lint | `npx @redwoodjs/agent-ci run -w .github/workflows/lint-go.yml -p` |
| Backend Go tests | `npx @redwoodjs/agent-ci run -w .github/workflows/test-go.yml -p` |
| `vault/**` | `npx @redwoodjs/agent-ci run -w .github/workflows/dev-vault-image.yml -p --github-token` |
| `ops/**` deploy script | `npx @redwoodjs/agent-ci run -w .github/workflows/check-deploy-script.yml -p --github-token` |
| Dependency change | `npx @redwoodjs/agent-ci run -w .github/workflows/security-audit.yml -p` |

## The fix-and-retry loop

When a step fails with `-p`, agent-ci pauses and prints a runner name like `agent-ci-3`. The container stays alive with all caches warm.

```sh
# Edit the broken file in your editor
npx @redwoodjs/agent-ci retry --name agent-ci-3
```

Re-runs only the failed step in the same container. If you want the whole job again from step 1: `--from-start`. To give up: `npx @redwoodjs/agent-ci abort --name agent-ci-3`.

## What not to run locally

Skip `--all` and skip `dev-docker-images.yml` for everyday work — they include heavy llama.cpp Vulkan builds and Docker image assembly that take 15+ minutes and don't add signal beyond what `test-go.yml` already gives you.

Workflows you cannot validate locally regardless:

- **Windows desktop builds** — agent-ci doesn't support Windows runners.
- **macOS codesigning / notarization** — those steps need Apple secrets that intentionally aren't on disk; the build succeeds, the sign step fails. Run with `--no-matrix` if you want to test the build logic itself.
- **Anything reading deploy secrets** (S3, Sentry, Dockerhub) — those steps fail locally; that's expected.

## The AI agent integration

The agent-ci skill is installed globally in `~/.agents/skills/agent-ci` and symlinked into `~/.claude/skills/agent-ci`. In any future Claude Code session in this repo, just say *"validate this with agent-ci"* or *"run agent-ci before we ship"* and the skill will pick the right invocation based on your diff. Codex, Cursor, and several others are wired up the same way — see the skill's installation summary if you use one of those.

## Troubleshooting

**`Docker does not appear to be running`** — your shell isn't exporting `DOCKER_HOST`. See setup step 2 above. Verify with `echo $DOCKER_HOST`.

**`No such image: ghcr.io/actions/actions-runner:latest`** — you haven't pulled the runner image yet, or `docker system prune` wiped it. Re-run setup step 3.

**`permission denied` writing under `/home/runner/.cache/...`** — the `.github/agent-ci.Dockerfile` should handle this. If a new tool needs another sibling directory under `.cache`, add it to the `install -d ...` line in that Dockerfile.

**llama.cpp build hangs or fails on Vulkan** — skip `dev-docker-images.yml` locally. Use `test-go.yml` instead; it does a CPU-only llama build that's reliable across machines and gets cached after the first run.

**Step `actions/setup-go@v5` is slow on first run** — yes, it downloads Go each time the cache is cold. Subsequent runs reuse it.

## How it works (one paragraph)

agent-ci runs the official GitHub Actions runner binary inside a Docker container. It emulates the GitHub server-side API surface (Twirp endpoints, the Azure Block Blob artifact protocol, the cache REST API) on localhost so the runner thinks it's talking to GitHub.com. Caches and `node_modules` are bind-mounted from your host into `/home/runner/...` paths, so installs that take minutes in remote CI take seconds locally on repeat runs. Because it's the real runner — not a re-implementation — drift between local and remote is essentially zero.
