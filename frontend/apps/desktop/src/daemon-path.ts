import path from 'path'

export function getDaemonBinaryPath() {
  // In development, we're running from the source directory and should use the plz-out path
  // In production, we're running from a packaged app and should use the resources path
  const isPackaged =
    process.resourcesPath &&
    !process.resourcesPath.includes('node_modules/electron')

  if (isPackaged) {
    // In production, the daemon binary is in the app's resources directory
    const resourcesPath =
      process.resourcesPath || path.join(__dirname, '..', 'Resources')
    return path.join(resourcesPath, `seed-daemon-${getPlatformTriple()}`)
  } else {
    // In development, use the plz-out build path
    return path.join(
      process.cwd(),
      '../../..',
      `plz-out/bin/backend/seed-daemon-${getPlatformTriple()}`,
    )
  }
}

function getPlatformTriple() {
  if (process.env.DAEMON_NAME) {
    return process.env.DAEMON_NAME
  } else {
    switch (`${process.platform}/${process.arch}`) {
      case 'darwin/x64':
        return 'x86_64-apple-darwin'
      case 'darwin/arm64':
        return 'aarch64-apple-darwin'
      case 'win32/x64':
        return 'x86_64-pc-windows-msvc'
      case 'linux/x64':
        return 'x86_64-unknown-linux-gnu'
      case 'linux/arm64':
        return 'aarch64-unknown-linux-gnu'
      default:
        return 'NO_DAEMON_NAME'
    }
  }
}
