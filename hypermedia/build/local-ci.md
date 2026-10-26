---
name: Local CI with agent-ci
summary: How to run the GitHub Actions workflows on your own machine with agent-ci before pushing, so a failing check is found in seconds and fixed in the same loop.
---
We now run our GitHub Actions workflows on our own machines before pushing. This catches failures in seconds instead of waiting for remote CI, and keeps the dev loop tight: edit → run → fail → fix in place → retry the failed step → push. <!-- id:In5OkeGr -->

The tool is [agent-ci](https://agent-ci.dev) by RedwoodJS. It uses the unmodified, official GitHub Actions runner binary, so what passes locally passes on GitHub. It replaces the cloud cache with local bind-mounts, so `node_modules`, the pnpm store, and the llama.cpp build artifacts persist across runs at near-zero overhead. <!-- id:Et3cpKfc -->

# What's in the repo <!-- id:jXaxKNbu -->

Two new files were added: <!-- id:BPNy13Dc -->
  - **`.github/agent-ci.Dockerfile`**, extends the official runner image to pre-create `/home/runner/.cache` with `runner` ownership. Without this, `golangci-lint-action` fails with `permission denied` because Docker auto-creates that directory as root when bind-mounting `/home/runner/.cache/ms-playwright` on top of it. <!-- id:AKlKdU_W -->
  - **`AGENTS.md` → `## Local CI` section**, instructions for AI agents (Claude Code, Codex, Cursor) so they validate changes via agent-ci before reporting work done. <!-- id:ouU1g1YT -->

`.env.agent-ci` is gitignored. It's optional and only needed if you want to bake secrets into local runs (most workflows don't need it). <!-- id:xZwPXBzc -->

# One-time setup <!-- id:Au6foafG -->

1. **Docker Desktop**, install and start it. Verify with `docker info`. <!-- id:BTLNOrIo -->
2. **Tell agent-ci where Docker's socket is.** Docker Desktop on macOS doesn't expose `/var/run/docker.sock` by default; agent-ci checks the standard `DOCKER_HOST` env var. Add this to `~/.zshrc` (or `~/.bashrc`): <!-- id:bXM7U21n -->

   ```sh <!-- id:FS7Kck05 -->
   export DOCKER_HOST="unix://$HOME/.docker/run/docker.sock"
   ```

   Then `source ~/.zshrc` or open a new terminal. Verify with `echo $DOCKER_HOST`. <!-- id:VnJ28PNP -->

   Alternative: in Docker Desktop → Settings → Advanced, enable "Allow the default Docker socket to be used", that creates the `/var/run/docker.sock` symlink and the export becomes optional. <!-- id:OB38j2MS -->
3. **Pull the runner image** (one-time, \~1.5 GB): <!-- id:QzzTOJCq -->

   ```sh <!-- id:GA2Ysimu -->
   docker pull ghcr.io/actions/actions-runner:latest
   ```
4. **Optional, macOS jobs.** If you ever want to run the macOS desktop-build workflows locally (Apple Silicon only): <!-- id:d5NzqIzW -->

   ```sh <!-- id:ZO0M2jHN -->
   brew install cirruslabs/cli/tart hudochenkov/sshpass/sshpass
   ```

   Without these, agent-ci silently skips macOS jobs. Windows jobs aren't supported and are always skipped. <!-- id:9vmvH8Jg -->

# Daily-driver commands <!-- id:YdqhB76- -->

Pick the one that matches what you touched. `-p` is `--pause-on-failure` (keeps the container alive on failure so you can fix and retry the same step). `--github-token` (no value) auto-resolves via the `gh` CLI. <!-- id:yS6jBnuP -->

<!-- id:uRrqdkVb -->
| Changed area <!-- col:RnMPmqe2 --> | Command <!-- col:zFKlxiKl --> <!-- id:XQD3lc3s --> |
| --- | --- |
| Frontend (web/desktop/shared/ui/editor) | `npx @redwoodjs/agent-ci run -w .github/workflows/test-frontend-parallel.yml -p --github-token` <!-- id:ioOOI0l2 --> |
| Backend Go lint | `npx @redwoodjs/agent-ci run -w .github/workflows/lint-go.yml -p` <!-- id:g4vKFaEm --> |
| Backend Go tests | `npx @redwoodjs/agent-ci run -w .github/workflows/test-go.yml -p` <!-- id:YMQ2Xrtc --> |
| `vault/**` | `npx @redwoodjs/agent-ci run -w .github/workflows/dev-vault-image.yml -p --github-token` <!-- id:cPaTPvvR --> |
| `ops/**` deploy script | `npx @redwoodjs/agent-ci run -w .github/workflows/check-deploy-script.yml -p --github-token` <!-- id:akOqVqnT --> |
| Dependency change | `npx @redwoodjs/agent-ci run -w .github/workflows/security-audit.yml -p` <!-- id:ATdWooCI --> |

# The fix-and-retry loop <!-- id:fYMdhnpI -->

When a step fails with `-p`, agent-ci pauses and prints a runner name like `agent-ci-3`. The container stays alive with all caches warm. <!-- id:B0PLcaTa -->

```sh <!-- id:GuTu3pfV -->
# Edit the broken file in your editor
npx @redwoodjs/agent-ci retry --name agent-ci-3
```

Re-runs only the failed step in the same container. If you want the whole job again from step 1: `--from-start`. To give up: `npx @redwoodjs/agent-ci abort --name agent-ci-3`. <!-- id:JEl59XaE -->

# What not to run locally <!-- id:pZulyp1a -->

Skip `--all` and skip `dev-docker-images.yml` for everyday work, they include heavy llama.cpp Vulkan builds and Docker image assembly that take 15+ minutes and don't add signal beyond what `test-go.yml` already gives you. <!-- id:TpewADIy -->

Workflows you cannot validate locally regardless: <!-- id:s8l0kHsn -->
  - **Windows desktop builds**, agent-ci doesn't support Windows runners. <!-- id:E8Z6Okrg -->
  - **macOS codesigning / notarization**, those steps need Apple secrets that intentionally aren't on disk; the build succeeds, the sign step fails. Run with `--no-matrix` if you want to test the build logic itself. <!-- id:M9OyaVDk -->
  - **Anything reading deploy secrets** (S3, Sentry, Dockerhub), those steps fail locally; that's expected. <!-- id:Vb__R_5E -->

# The AI agent integration <!-- id:o94ExnlV -->

The agent-ci skill is installed globally in `~/.agents/skills/agent-ci` and symlinked into `~/.claude/skills/agent-ci`. In any future Claude Code session in this repo, just say _"validate this with agent-ci"_ or _"run agent-ci before we ship"_ and the skill will pick the right invocation based on your diff. Codex, Cursor, and several others are wired up the same way, see the skill's installation summary if you use one of those. <!-- id:goPw4ZIa -->

# Troubleshooting <!-- id:ntmtQk_m -->

**`Docker does not appear to be running`**, your shell isn't exporting `DOCKER_HOST`. See setup step 2 above. Verify with `echo $DOCKER_HOST`. <!-- id:7MdiJ9h8 -->

**`No such image: ghcr.io/actions/actions-runner:latest`**, you haven't pulled the runner image yet, or `docker system prune` wiped it. Re-run setup step 3. <!-- id:gzxPCc6L -->

**`permission denied` writing under `/home/runner/.cache/...`**, the `.github/agent-ci.Dockerfile` should handle this. If a new tool needs another sibling directory under `.cache`, add it to the `install -d ...` line in that Dockerfile. <!-- id:Ep3mVA8D -->

**llama.cpp build hangs or fails on Vulkan**, skip `dev-docker-images.yml` locally. Use `test-go.yml` instead; it does a CPU-only llama build that's reliable across machines and gets cached after the first run. <!-- id:ooeINROW -->

**Step `actions/setup-go@v5` is slow on first run**, yes, it downloads Go each time the cache is cold. Subsequent runs reuse it. <!-- id:eU-kANVK -->

# How it works (one paragraph) <!-- id:CtNSZ5i6 -->

agent-ci runs the official GitHub Actions runner binary inside a Docker container. It emulates the GitHub server-side API surface (Twirp endpoints, the Azure Block Blob artifact protocol, the cache REST API) on localhost so the runner thinks it's talking to GitHub.com. Caches and `node_modules` are bind-mounted from your host into `/home/runner/...` paths, so installs that take minutes in remote CI take seconds locally on repeat runs. Because it's the real runner, not a re-implementation, drift between local and remote is essentially zero. <!-- id:s4n4J3GV -->
