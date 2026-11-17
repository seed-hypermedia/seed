---
name: Local CI with agent-ci
summary: This page shows how to run the GitHub Actions workflows on your own machine with agent-ci before you push, so you find a failing check quickly and fix it in the same loop.
---
You can run the repository's GitHub Actions workflows on your own machine before you push. CI means the checks that GitHub runs on every pull request. Running them locally finds a failure quickly, without a wait for GitHub. The loop is short: edit, run, see the failure, fix it, retry the failed step, push. The root `AGENTS.md` asks coding [agents](../agent.md) to check their changes this way before they report work as done. <!-- id:In5OkeGr -->

The tool is [agent-ci](https://agent-ci.dev) by RedwoodJS. It uses the official GitHub Actions runner binary, unchanged. So what passes on your machine passes on GitHub. It replaces the cloud cache with folders mounted from your machine. So `node_modules`, the pnpm store and the llama.cpp build results stay between runs at almost no cost. <!-- id:Et3cpKfc -->

# What the repository provides <!-- id:jXaxKNbu -->

- **`.github/agent-ci.Dockerfile`** extends the official runner image. It creates `/home/runner/.cache` in advance, owned by the user `runner`. Without this, `golangci-lint-action` fails with `permission denied`, because Docker creates that directory as root when it mounts `/home/runner/.cache/ms-playwright` on top of it. <!-- id:AKlKdU_W -->
- **The `Local CI` section of the root `AGENTS.md`** holds the same instructions for coding agents. <!-- id:ouU1g1YT -->

`.env.agent-ci` is ignored by git. It is optional. You need it only to pass secrets into local runs, and most workflows do not need it. <!-- id:xZwPXBzc -->

# One-time setup <!-- id:Au6foafG -->

1. **Docker Desktop.** Install and start it. Verify with `docker info`. <!-- id:BTLNOrIo -->
2. **Tell agent-ci where Docker's socket is.** Docker Desktop on macOS does not provide `/var/run/docker.sock` by default. agent-ci reads the standard `DOCKER_HOST` environment variable. Add this to `~/.zshrc` (or `~/.bashrc`): <!-- id:bXM7U21n -->

   ```sh <!-- id:FS7Kck05 -->
   export DOCKER_HOST="unix://$HOME/.docker/run/docker.sock"
   ```

   Then `source ~/.zshrc` or open a new terminal. Verify with `echo $DOCKER_HOST`. <!-- id:VnJ28PNP -->

   Another way: in Docker Desktop → Settings → Advanced, turn on "Allow the default Docker socket to be used". That creates the `/var/run/docker.sock` link, and then you do not need the export. <!-- id:OB38j2MS -->
3. **Pull the runner image** (about 1.5 GB): <!-- id:QzzTOJCq -->

   ```sh <!-- id:GA2Ysimu -->
   docker pull ghcr.io/actions/actions-runner:latest
   ```
4. **Optional, macOS jobs.** To run the macOS desktop-build workflows locally (Apple Silicon only): <!-- id:d5NzqIzW -->

   ```sh <!-- id:ZO0M2jHN -->
   brew install cirruslabs/cli/tart hudochenkov/sshpass/sshpass
   ```

   Without these, agent-ci skips macOS jobs and prints no warning. agent-ci does not support Windows jobs and always skips them. <!-- id:9vmvH8Jg -->

# Commands by area <!-- id:YdqhB76- -->

Pick the command for the area you changed. `-p` is `--pause-on-failure`: it keeps the container running after a failure, so you can fix the problem and retry the same step. `--github-token` with no value gets the token from the `gh` [CLI](../build/cli.md). <!-- id:yS6jBnuP -->

<!-- id:uRrqdkVb -->
| Changed area <!-- col:RnMPmqe2 --> | Command <!-- col:zFKlxiKl --> <!-- id:XQD3lc3s --> |
| --- | --- |
| Frontend (web/desktop/shared/ui/editor) | `npx @redwoodjs/agent-ci run -w .github/workflows/test-frontend-parallel.yml -p --github-token` <!-- id:ioOOI0l2 --> |
| Backend Go lint | `npx @redwoodjs/agent-ci run -w .github/workflows/lint-go.yml -p` <!-- id:g4vKFaEm --> |
| Backend Go tests | `npx @redwoodjs/agent-ci run -w .github/workflows/test-go.yml -p` <!-- id:YMQ2Xrtc --> |
| `apps/**`, the [app environment](../software/app-environment.md) | `npx @redwoodjs/agent-ci run -w .github/workflows/test-agents.yml -p` |
| `hypermedia/**`, these docs | `npx @redwoodjs/agent-ci run -w .github/workflows/check-hypermedia.yml -p` |
| `vault/**` | `npx @redwoodjs/agent-ci run -w .github/workflows/dev-vault-image.yml -p --github-token` <!-- id:cPaTPvvR --> |
| `ops/**` deploy script | `npx @redwoodjs/agent-ci run -w .github/workflows/check-deploy-script.yml -p --github-token` <!-- id:akOqVqnT --> |
| Dependency change | `npx @redwoodjs/agent-ci run -w .github/workflows/security-audit.yml -p` <!-- id:ATdWooCI --> |

# The fix-and-retry loop <!-- id:fYMdhnpI -->

When a step fails with `-p`, agent-ci pauses and prints a runner name such as `agent-ci-3`. The container keeps running, with all its caches. <!-- id:B0PLcaTa -->

```sh <!-- id:GuTu3pfV -->
# Edit the broken file in your editor
npx @redwoodjs/agent-ci retry --name agent-ci-3
```

`retry` runs only the failed step again, in the same container. To run the whole job again from step 1, add `--from-start`. To stop, run `npx @redwoodjs/agent-ci abort --name agent-ci-3`. <!-- id:JEl59XaE -->

# What not to run locally <!-- id:pZulyp1a -->

For everyday work, do not use `--all` and do not run `dev-docker-images.yml`. They include heavy llama.cpp Vulkan builds and the building of Docker images. These take more than 15 minutes and tell you nothing that `test-go.yml` does not. <!-- id:TpewADIy -->

You cannot check these workflows locally at all: <!-- id:s8l0kHsn -->
  - **Windows desktop builds.** agent-ci does not support Windows runners. <!-- id:E8Z6Okrg -->
  - **macOS code signing and notarization.** Those steps need Apple secrets, which are kept off your disk on purpose. The build passes and the signing step fails. Run with `--no-matrix` if you want to test the build itself. <!-- id:M9OyaVDk -->
  - **Anything reading deploy secrets** (S3, Sentry, Docker Hub). Those steps fail locally, as expected. <!-- id:Vb__R_5E -->

# Troubleshooting <!-- id:ntmtQk_m -->

**`Docker does not appear to be running`**: your shell is not exporting `DOCKER_HOST`. See setup step 2 above. Verify with `echo $DOCKER_HOST`. <!-- id:7MdiJ9h8 -->

**`No such image: ghcr.io/actions/actions-runner:latest`**: the runner image is not pulled, or `docker system prune` removed it. Do setup step 3 again. <!-- id:gzxPCc6L -->

**`permission denied` writing under `/home/runner/.cache/...`**: `.github/agent-ci.Dockerfile` handles this. If a new tool needs another directory under `.cache`, add it to the `install -d ...` line in that Dockerfile. <!-- id:Ep3mVA8D -->

**The llama.cpp build hangs or fails on Vulkan**: do not run `dev-docker-images.yml` locally. Use `test-go.yml`. It builds llama for the CPU only, which works on every machine, and the build is cached after the first run. <!-- id:ooeINROW -->

**Step `actions/setup-go@v5` is slow on first run**: it downloads Go when the cache is cold. Later runs reuse it. <!-- id:eU-kANVK -->

# How it works <!-- id:CtNSZ5i6 -->

agent-ci runs the official GitHub Actions runner binary inside a Docker container. On your machine it imitates the parts of GitHub that the runner talks to: the Twirp endpoints, the Azure [Block](../protocol/blocks.md) [Blob](../protocol/blobs.md) protocol for artifacts, and the cache REST API. So the runner behaves as if it talks to GitHub.com. agent-ci mounts the caches and `node_modules` from your machine into `/home/runner/...` paths. So an install that takes minutes in remote CI takes seconds on a second local run. It is the real runner and not a copy of it, so a local run and a remote run behave almost exactly the same. <!-- id:s4n4J3GV -->

# See also

- [Contributing](./contributing.md), for the checks each area expects and how to run them without agent-ci.
- [Releasing](./releasing.md), for the workflows a release tag starts.
- [Working on Seed](../contribute.md), the list of contributor guides.
