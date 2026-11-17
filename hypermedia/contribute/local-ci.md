---
name: Local CI with agent-ci
summary: How to run the GitHub Actions workflows on your own machine with agent-ci before pushing, so a failing check is found in seconds and fixed in the same loop.
---
The repository's GitHub Actions workflows can run on your own machine before you push. This finds failures in seconds instead of waiting for remote CI, and keeps the loop short: edit, run, fail, fix in place, retry the failed step, push. The root `AGENTS.md` asks coding agents to validate changes this way before they report work as done. <!-- id:In5OkeGr -->

The tool is [agent-ci](https://agent-ci.dev) by RedwoodJS. It uses the unmodified, official GitHub Actions runner binary, so what passes locally passes on GitHub. It replaces the cloud cache with local bind-mounts, so `node_modules`, the pnpm store, and the llama.cpp build artifacts persist across runs at near-zero overhead. <!-- id:Et3cpKfc -->

# What the repository provides <!-- id:jXaxKNbu -->

- **`.github/agent-ci.Dockerfile`** extends the official runner image to pre-create `/home/runner/.cache` with `runner` ownership. Without this, `golangci-lint-action` fails with `permission denied` because Docker creates that directory as root when bind-mounting `/home/runner/.cache/ms-playwright` on top of it. <!-- id:AKlKdU_W -->
- **The `Local CI` section of the root `AGENTS.md`** holds the same instructions for coding agents. <!-- id:ouU1g1YT -->

`.env.agent-ci` is gitignored. It is optional and only needed if you want to pass secrets into local runs. Most workflows do not need it. <!-- id:xZwPXBzc -->

# One-time setup <!-- id:Au6foafG -->

1. **Docker Desktop.** Install and start it. Verify with `docker info`. <!-- id:BTLNOrIo -->
2. **Tell agent-ci where Docker's socket is.** Docker Desktop on macOS doesn't expose `/var/run/docker.sock` by default; agent-ci checks the standard `DOCKER_HOST` env var. Add this to `~/.zshrc` (or `~/.bashrc`): <!-- id:bXM7U21n -->

   ```sh <!-- id:FS7Kck05 -->
   export DOCKER_HOST="unix://$HOME/.docker/run/docker.sock"
   ```

   Then `source ~/.zshrc` or open a new terminal. Verify with `echo $DOCKER_HOST`. <!-- id:VnJ28PNP -->

   Alternative: in Docker Desktop → Settings → Advanced, enable "Allow the default Docker socket to be used". That creates the `/var/run/docker.sock` symlink and the export becomes optional. <!-- id:OB38j2MS -->
3. **Pull the runner image** (about 1.5 GB): <!-- id:QzzTOJCq -->

   ```sh <!-- id:GA2Ysimu -->
   docker pull ghcr.io/actions/actions-runner:latest
   ```
4. **Optional, macOS jobs.** To run the macOS desktop-build workflows locally (Apple Silicon only): <!-- id:d5NzqIzW -->

   ```sh <!-- id:ZO0M2jHN -->
   brew install cirruslabs/cli/tart hudochenkov/sshpass/sshpass
   ```

   Without these, agent-ci silently skips macOS jobs. Windows jobs aren't supported and are always skipped. <!-- id:9vmvH8Jg -->

# Commands by area <!-- id:YdqhB76- -->

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

Skip `--all` and skip `dev-docker-images.yml` for everyday work. They include heavy llama.cpp Vulkan builds and Docker image assembly that take more than 15 minutes and add nothing beyond what `test-go.yml` already tells you. <!-- id:TpewADIy -->

Workflows you cannot validate locally regardless: <!-- id:s8l0kHsn -->
  - **Windows desktop builds.** agent-ci does not support Windows runners. <!-- id:E8Z6Okrg -->
  - **macOS codesigning and notarization.** Those steps need Apple secrets that are not on disk on purpose. The build succeeds and the sign step fails. Run with `--no-matrix` if you want to test the build logic itself. <!-- id:M9OyaVDk -->
  - **Anything reading deploy secrets** (S3, Sentry, Docker Hub). Those steps fail locally, as expected. <!-- id:Vb__R_5E -->

# Troubleshooting <!-- id:ntmtQk_m -->

**`Docker does not appear to be running`**: your shell is not exporting `DOCKER_HOST`. See setup step 2 above. Verify with `echo $DOCKER_HOST`. <!-- id:7MdiJ9h8 -->

**`No such image: ghcr.io/actions/actions-runner:latest`**: the runner image is not pulled, or `docker system prune` removed it. Re-run setup step 3. <!-- id:gzxPCc6L -->

**`permission denied` writing under `/home/runner/.cache/...`**: `.github/agent-ci.Dockerfile` handles this. If a new tool needs another sibling directory under `.cache`, add it to the `install -d ...` line in that Dockerfile. <!-- id:Ep3mVA8D -->

**llama.cpp build hangs or fails on Vulkan**: skip `dev-docker-images.yml` locally. Use `test-go.yml` instead; it does a CPU-only llama build that's reliable across machines and gets cached after the first run. <!-- id:ooeINROW -->

**Step `actions/setup-go@v5` is slow on first run**: it downloads Go when the cache is cold. Later runs reuse it. <!-- id:eU-kANVK -->

# How it works <!-- id:CtNSZ5i6 -->

agent-ci runs the official GitHub Actions runner binary inside a Docker container. It emulates the GitHub server-side API surface (Twirp endpoints, the Azure Block Blob artifact protocol, the cache REST API) on localhost so the runner thinks it's talking to GitHub.com. Caches and `node_modules` are bind-mounted from your host into `/home/runner/...` paths, so installs that take minutes in remote CI take seconds locally on repeat runs. Because it's the real runner, not a re-implementation, drift between local and remote is essentially zero. <!-- id:s4n4J3GV -->

# See also

- [Contributing](./contributing.md), for the checks each area expects and how to run them without agent-ci.
- [Releasing](./releasing.md), for the workflows a release tag starts.
- [Working on Seed](../contribute.md), the list of contributor guides.
