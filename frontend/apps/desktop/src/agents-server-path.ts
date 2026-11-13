import path from 'path'

/**
 * Resolves the bundled agents-server binary, mirroring {@link ./daemon-path.ts} for the Go daemon.
 *
 * The binary is produced by `apps/scripts/build-binary.ts` (`bun build --compile`) into
 * `plz-out/bin/apps/` alongside its `package.json` and staged `node_modules/`, and that whole directory
 * ships as an `extraResource` — so in a packaged app it sits in `<resources>/apps/`. In
 * development the desktop attaches to an externally run server instead of spawning one (see
 * `agents-server-process.ts`), so the dev path here is only a fallback for locally produced builds.
 */
export function getAgentsServerBinaryPath(): string {
  const isPackaged = Boolean(process.resourcesPath) && !process.resourcesPath.includes('node_modules/electron')
  const fileName = `seed-apps-${getPlatformTriple()}${process.platform === 'win32' ? '.exe' : ''}`

  if (isPackaged) {
    const resourcesPath = process.resourcesPath || path.join(__dirname, '..', 'Resources')
    return path.join(resourcesPath, 'apps', fileName)
  }
  return path.join(process.cwd(), '../../..', 'plz-out/bin/apps', fileName)
}

/**
 * Directory the app environment must run from.
 *
 * The binary runs from its own directory, beside the files it ships with — the same arrangement
 * `apps/Dockerfile` uses. (The agent runtime no longer reads `package.json` at startup; that
 * requirement went away with `pi-coding-agent`.)
 */
export function getAgentsServerWorkingDirectory(): string {
  return path.dirname(getAgentsServerBinaryPath())
}

function getPlatformTriple(): string {
  if (process.env.APPS_SERVER_NAME) return process.env.APPS_SERVER_NAME
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
      return 'NO_APPS_SERVER_NAME'
  }
}
