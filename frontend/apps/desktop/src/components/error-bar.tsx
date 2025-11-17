import {AppPlatform, useAppContext} from '@/app-context'
import ErrorBarMacos from './error-bar-macos'
import ErrorBarWindowsLinux from './error-bar-windows-linux'

export function ErrorBar() {
  const {platform} = useAppContext()
  let Component = getErrorBar(platform)
  return <Component />
}

function getErrorBar(platform: AppPlatform) {
  // return ErrorBarWindowsLinux // to test from macOS
  switch (platform) {
    case 'win32':
    case 'linux':
      return ErrorBarWindowsLinux
    case 'darwin':
      return ErrorBarMacos
    default:
      console.warn(`ErrorBar: unsupported platform: ${platform}`)
      return ErrorBarMacos
  }
}
