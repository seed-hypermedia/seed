import {FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire, type FuseV1Config} from '@electron/fuses'

/** Security policy for every packaged Seed executable, including test builds. */
export const electronFuses = {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
} satisfies FuseV1Config

/** Reads the packaged binary (the same API as `electron-fuses read`) and rejects drift. */
export async function checkElectronFuses(appPath: string): Promise<void> {
  const actual = await getCurrentFuseWire(appPath)
  if (actual.version !== FuseVersion.V1) throw new Error(`Unexpected fuse version: ${actual.version}`)
  for (const [key, enabled] of Object.entries(electronFuses)) {
    if (key === 'version') continue
    const fuse = Number(key) as FuseV1Options
    if (actual[fuse] !== (enabled ? FuseState.ENABLE : FuseState.DISABLE)) {
      throw new Error(`Incorrect Electron fuse: ${FuseV1Options[fuse]} in ${appPath}`)
    }
  }
}

if (require.main === module) {
  const appPath = process.argv[2]
  if (!appPath) throw new Error('Usage: pnpm exec ts-node scripts/electron-fuses.ts <app-or-executable>')
  checkElectronFuses(appPath).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
