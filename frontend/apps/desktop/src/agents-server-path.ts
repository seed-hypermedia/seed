import path from 'path'

/**
 * Resolves the bundled agents-server binary, mirroring {@link ./daemon-path.ts} for the Go daemon.
 *
 * The binary is produced by `agents/scripts/build-binary.ts` (`bun build --compile`) into
 * `plz-out/bin/agents/` alongside its `package.json` and staged `node_modules/`, and that whole directory
 * ships as an `extraResource` — so in a packaged app it sits in `<resources>/agents/`. In
 * development the desktop attaches to an externally run server instead of spawning one (see
 * `agents-server-process.ts`), so the dev path here is only a fallback for locally produced builds.
 */
export function getAgentsServerBinaryPath(): string {
  const isPackaged = Boolean(process.resourcesPath) && !process.resourcesPath.includes('node_modules/electron')
  const fileName = `seed-agents-${getPlatformTriple()}${process.platform === 'win32' ? '.exe' : ''}`

  if (isPackaged) {
    const resourcesPath = process.resourcesPath || path.join(__dirname, '..', 'Resources')
    return path.join(resourcesPath, 'agents', fileName)
  }
  return path.join(process.cwd(), '../../..', 'plz-out/bin/agents', fileName)
}

/**
 * Directory the agents server must run from.
 *
 * The binary runs from its own directory, beside the files it ships with — the same arrangement
 * `agents/Dockerfile` uses. (The agent runtime no longer reads `package.json` at startup; that
 * requirement went away with `pi-coding-agent`.)
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
