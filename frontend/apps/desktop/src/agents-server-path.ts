import path from 'path'

/**
 * Resolves the bundled agents-server binary, mirroring {@link ./daemon-path.ts} for the Go daemon.
 *
 * The binary is produced by `bun build --compile` from `agents/src/main.ts` and shipped as an
 * `extraResource`, so in a packaged app it sits directly in `process.resourcesPath`. In development
 * the desktop attaches to an externally run server instead of spawning one (see
 * `agents-server-process.ts`), so the dev path here is only a fallback for locally produced builds.
 */
export function getAgentsServerBinaryPath(): string {
  const isPackaged = Boolean(process.resourcesPath) && !process.resourcesPath.includes('node_modules/electron')
  const fileName = `seed-agents-${getPlatformTriple()}${process.platform === 'win32' ? '.exe' : ''}`

  if (isPackaged) {
    const resourcesPath = process.resourcesPath || path.join(__dirname, '..', 'Resources')
    return path.join(resourcesPath, fileName)
  }
  return path.join(process.cwd(), '../../..', 'plz-out/bin/agents', fileName)
}

/**
 * Directory the agents server must run from.
 *
 * `pi-coding-agent` reads its own `package.json` relative to `cwd` at import time, so the compiled
 * binary only starts when a `package.json` sits next to it — the same arrangement `agents/Dockerfile`
 * relies on. Spawning with this as `cwd` keeps that contract explicit rather than incidental.
 */
export function getAgentsServerWorkingDirectory(): string {
  return path.dirname(getAgentsServerBinaryPath())
}

function getPlatformTriple(): string {
  if (process.env.AGENTS_SERVER_NAME) return process.env.AGENTS_SERVER_NAME
  switch (`${process.platform}/${process.arch}`) {
    case 'darwin/x64':
      return 'x86_64-apple-darwin'
    case 'darwin/arm64':
      return 'aarch64-apple-darwin'
    case 'win32/x64':
      return 'x86_64-pc-windows-gnu'
    case 'linux/x64':
      return 'x86_64-unknown-linux-gnu'
    case 'linux/arm64':
      return 'aarch64-unknown-linux-gnu'
    default:
      return 'NO_AGENTS_SERVER_NAME'
  }
}
