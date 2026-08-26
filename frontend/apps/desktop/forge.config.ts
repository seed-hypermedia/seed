import {MakerDeb, MakerDebConfig} from '@electron-forge/maker-deb'
import {MakerRpm, MakerRpmConfig} from '@electron-forge/maker-rpm'
// Temporarily disabled - focusing on flatpak first
// import {MakerSnap, MakerSnapConfig} from '@electron-forge/maker-snap'
import {MakerSquirrel} from '@electron-forge/maker-squirrel'
import {MakerZIP} from '@electron-forge/maker-zip'
import {PublisherS3} from '@electron-forge/publisher-s3'
import type {ForgeConfig} from '@electron-forge/shared-types'
import type {HookFunction} from '@electron/packager'
// import {MakerRpm} from '@electron-forge/maker-rpm'
import {VitePlugin} from '@electron-forge/plugin-vite'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import packageJson from './package.json'
// import setLanguages from 'electron-packager-languages'
import fs from 'node:fs'
import {signWindowsMakeResults, signWindowsPackagePaths} from './scripts/windows-signing'

const {version} = packageJson
const IS_PROD_DEV = version.includes('dev')
const packageExecutableName = IS_PROD_DEV ? 'SeedDev.exe' : 'Seed.exe'
const macAppName = IS_PROD_DEV ? 'SeedDev' : 'Seed'
const macSigningIdentity = 'Developer ID Application: Mintter Technologies S.L. (XSKC6RJDD8)'

const devProjectRoot = path.join(process.cwd(), '../../..')
const LLVM_TRIPLES = {
  'darwin/x64': 'x86_64-apple-darwin',
  'darwin/arm64': 'aarch64-apple-darwin',
  'win32/x64': 'x86_64-pc-windows-gnu.exe',
  'linux/x64': 'x86_64-unknown-linux-gnu',
  'linux/arm64': 'aarch64-unknown-linux-gnu',
}

function getPlatformTriple() {
  return (
    process.env.DAEMON_NAME ||
    // @ts-ignore
    LLVM_TRIPLES[`${process.platform}/${process.arch}`]
  )
}

const daemonBinaryPath = path.join(
  devProjectRoot,
  // TODO: parametrize this for each platform
  `plz-out/bin/backend/seed-daemon-${getPlatformTriple()}`,
)

// The local agents server: a `bun build --compile` binary staged by
// `agents/scripts/build-binary.ts` together with the package.json it needs at startup. The whole
// directory ships so it lands as `<resources>/agents/`, which is where
// `src/agents-server-path.ts` looks for it in a packaged app.
const agentsServerName = process.env.AGENTS_SERVER_NAME || getPlatformTriple()
const agentsDistPath = path.join(devProjectRoot, 'plz-out/bin/agents')
const agentsBinaryPath = path.join(agentsDistPath, `seed-agents-${agentsServerName}`)
const hasAgentsBinary = fs.existsSync(agentsBinaryPath) && fs.existsSync(path.join(agentsDistPath, 'package.json'))
if (!hasAgentsBinary) {
  if (process.env.CI) {
    // Fail loudly rather than notarize and ship an app whose assistant cannot start.
    throw new Error(
      `Missing agents server binary at ${agentsBinaryPath} (build it with \`cd agents && bun run build:binary\`)`,
    )
  }
  console.warn(
    `[FORGE CONFIG]: ⚠️ No agents server binary at ${agentsBinaryPath} — packaging WITHOUT a local agents server. Build it with \`cd agents && bun run build:binary\`.`,
  )
}

const extraResources = [daemonBinaryPath]
if (hasAgentsBinary) {
  extraResources.push(agentsDistPath)
}

/**
 * Mach-O files inside the staged microsandbox platform package (see agents/scripts/build-binary.ts).
 * They ship under `<resources>/agents/node_modules/` and must be signed for notarization.
 */
function agentsNestedBinaries(): string[] {
  const platformPkgDir = path.join(agentsDistPath, 'node_modules', '@superradcompany', 'microsandbox-darwin-arm64')
  return ['bin/msb', 'lib/libkrunfw.5.dylib', 'microsandbox.darwin-arm64.node']
    .map((rel) => path.join(platformPkgDir, rel))
    .filter((candidate) => fs.existsSync(candidate))
}

function stagedMacExtraResourceBinaries(buildPath: string): string[] {
  const resourcesDir = path.join(buildPath, `${macAppName}.app`, 'Contents', 'Resources')
  const binaries = [path.join(resourcesDir, path.basename(daemonBinaryPath))]

  if (hasAgentsBinary) {
    binaries.push(
      path.join(resourcesDir, 'agents', path.basename(agentsBinaryPath)),
      ...agentsNestedBinaries().map((binary) =>
        path.join(resourcesDir, 'agents', path.relative(agentsDistPath, binary)),
      ),
    )
  }

  return binaries.filter((binary) => fs.existsSync(binary))
}

const signMacExtraResourceBinaries: HookFunction = (buildPath, _electronVersion, platform, _arch, callback) => {
  if ((platform !== 'darwin' && platform !== 'mas') || !process.env.CI) {
    callback()
    return
  }

  try {
    for (const binary of stagedMacExtraResourceBinaries(buildPath)) {
      execFileSync(
        'codesign',
        [
          '--force',
          '--sign',
          macSigningIdentity,
          '--options',
          'runtime',
          '--entitlements',
          path.join(__dirname, 'entitlements.plist'),
          binary,
        ],
        {stdio: 'inherit'},
      )
    }
    callback()
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)))
  }
}

if (process.platform === 'win32') {
  const winpthreadRuntimePath = path.join(devProjectRoot, 'plz-out/bin/backend/libwinpthread-1.dll')

  if (fs.existsSync(winpthreadRuntimePath)) {
    extraResources.push(winpthreadRuntimePath)
  } else if (process.env.CI) {
    throw new Error(`Missing Windows runtime dependency at ${winpthreadRuntimePath}`)
  }
}

let iconsPath = IS_PROD_DEV
  ? path.resolve(__dirname, 'assets', 'icons', 'icon')
  : path.resolve(__dirname, 'assets', 'icons-prod', 'icon')

const commonLinuxConfig = {
  options: {
    name: IS_PROD_DEV ? 'seed-dev' : 'seed',
    categories: ['Development', 'Utility'],
    icon: `${iconsPath}.png`,
    maintainer: 'Mintter Inc.',
    genericName: IS_PROD_DEV ? 'SeedDev' : 'Seed',
    description: 'Seed: a hyper.media protocol client',
    productName: IS_PROD_DEV ? 'SeedDev' : 'Seed',
    mimeType: ['x-scheme-handler/hm'],
    version,
    bin: IS_PROD_DEV ? 'SeedDev' : 'Seed',
    homepage: 'https://seed.hyper.media',
  },
}

// const flatpakConfig = {
//   options: {
//     ...commonLinuxConfig.options,
//     id: IS_PROD_DEV ? 'media.hyper.seed' : 'media.hyper.seed.dev',
//     runtime: 'org.freedesktop.Platform',
//     runtimeVersion: '24.08', // Updated to match working Nextcloud config
//     sdk: 'org.freedesktop.Sdk',
//     base: 'org.electronjs.Electron2.BaseApp',
//     baseVersion: '24.08', // Updated to match working Nextcloud config
//     branch: 'stable',
//     modules: [
//       {
//         name: 'zypak',
//         sources: [
//           {
//             type: 'git',
//             url: 'https://github.com/refi64/zypak',
//             tag: 'v2024.01.17', // Updated to match working Nextcloud config
//           },
//         ],
//       },
//     ],
//     files: [], // No additional files needed - main app is handled by @electron/packager automatically
//     finishArgs: [
//       '--share=ipc',
//       '--socket=x11',
//       '--socket=wayland',
//       '--socket=pulseaudio',
//       '--share=network',
//       '--device=dri',
//       '--filesystem=home',
//       '--talk-name=org.freedesktop.Notifications',
//       '--talk-name=org.kde.StatusNotifierWatcher',
//       '--own-name=media.hyper.seed.*',
//     ],
//   },
// }

// Temporarily disabled - focusing on flatpak first
// const snapConfig = {
//   options: {
//     name: IS_PROD_DEV ? 'seed-dev' : 'seed',
//     summary: 'Seed: a hyper.media protocol client',
//     description: 'Seed: a hyper.media protocol client',
//     grade: 'stable',
//     confinement: 'strict',
//     base: 'core18', // Using core18 with snapcraft 7.x for compatibility
//     plugs: {
//       'browser-support': null,
//       network: null,
//       home: null,
//       opengl: null,
//       pulseaudio: null,
//       unity7: null,
//       x11: null,
//       wayland: null,
//       desktop: null,
//       'desktop-legacy': null,
//     },
//   },
// }

const config: ForgeConfig = {
  packagerConfig: {
    appVersion: process.env.VITE_VERSION,
    asar: true,
    darwinDarkModeSupport: true,
    icon: iconsPath,
    name: macAppName,
    appBundleId: IS_PROD_DEV ? 'media.hyper.seed.dev' : 'media.hyper.seed',
    executableName: macAppName,
    appCategoryType: 'public.app-category.productivity',
    // packageManager: 'yarn',
    extraResource: extraResources,
    afterCopyExtraResources: [signMacExtraResourceBinaries],
    // beforeCopy: [setLanguages(['en', 'en_US'])],
    win32metadata: {
      CompanyName: 'Mintter Inc.',
      OriginalFilename: 'Seed',
    },
    protocols: [{name: 'Seed Hypermedia', schemes: ['hm']}],
  },
  makers: [
    new MakerDeb(commonLinuxConfig as MakerDebConfig, ['linux']),
    new MakerZIP(
      IS_PROD_DEV
        ? (arch) => ({
            // Note that we must provide this S3 URL here
            // in order to support smooth version transitions
            // especially when using a CDN to front your updates
            macUpdateManifestBaseUrl: `https://seedappdev.s3.eu-west-2.amazonaws.com/dev/darwin/${arch}`,
          })
        : {},
      ['darwin'],
    ),
    new MakerSquirrel(
      (arch) => ({
        name: IS_PROD_DEV ? 'SeedDev' : 'Seed',
        authors: 'Mintter inc.',
        exe: IS_PROD_DEV ? 'SeedDev.exe' : 'seed.exe',
        description: `Seed: a hyper.media protocol client ${IS_PROD_DEV ? '(dev build)' : ''}`,
        // An URL to an ICO file to use as the application icon (displayed in Control Panel > Programs and Features).
        iconUrl: `${iconsPath}.ico`,
        noMsi: true,
        setupIcon: `${iconsPath}.ico`,
        setupExe: `seed${IS_PROD_DEV ? '-dev' : ''}-${version}-win32-${process.arch}-setup.exe`,
        // The ICO file to use as the icon for the generated Setup.exe
        loadingGif: path.resolve(__dirname, 'assets', 'loading.gif'),

        // Note that we must provide this S3 URL here
        // in order to generate delta updates
        // remoteReleases: `https://seedappdev.s3.eu-west-2.amazonaws.com/dev/win32/${arch}`,
        remoteReleases: IS_PROD_DEV ? `https://seedappdev.s3.eu-west-2.amazonaws.com/dev/win32/${arch}` : undefined,

        // certificateFile: process.env.WINDOWS_PFX_FILE,
        // certificatePassword: process.env.WINDOWS_PFX_PASSWORD,
      }),
      ['win32'],
    ),
    new MakerRpm(commonLinuxConfig as MakerRpmConfig, ['linux']),
    // new MakerFlatpak(flatpakConfig as MakerFlatpakConfig),
    // new MakerAppImage(commonLinuxConfig as MakerAppImageConfig),
    // Temporarily disabled - focusing on flatpak first
    // new MakerSnap(snapConfig as MakerSnapConfig),
  ],
  plugins: [
    // {
    //   name: '@electron-forge/plugin-electronegativity',
    //   config: {
    //     isSarif: true,
    //   },
    // },
    // {
    //   name: '@electron-forge/plugin-auto-unpack-natives',
    //   config: {},
    // },
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
        },
        {
          entry: 'src/preload-find-in-page.ts',
          config: 'vite.preload.config.mts',
        },
        {
          entry: 'src/preload-loading.ts',
          config: 'vite.preload.config.mts',
        },
        {
          entry: 'src/preload-profiler.ts',
          config: 'vite.preload.config.mts',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
        {
          name: 'find_in_page',
          config: 'vite.renderer.find-in-page.config.mts',
        },
        {
          name: 'loading_window',
          config: 'vite.renderer.loading.config.mts',
        },
      ],
    }),
  ],
  publishers: [],
  hooks: {
    postPackage: async (_config, options) => {
      console.info('PostPackage output paths:', options.outputPaths)
      await signWindowsPackagePaths(options.outputPaths, {
        packageExecutableName,
        packageResourceExecutableNames: [
          path.basename(daemonBinaryPath),
          // The agents binary ships inside the `agents/` resources subdirectory.
          ...(hasAgentsBinary ? [path.join('agents', path.basename(agentsBinaryPath))] : []),
        ],
      })

      for (const outputPath of options.outputPaths) {
        console.info(`\nListing contents of: ${outputPath}`)
        const files = fs.readdirSync(outputPath)
        files.forEach((file) => {
          const stats = fs.statSync(`${outputPath}/${file}`)
          console.info(`- ${file} (${stats.isDirectory() ? 'directory' : 'file'})`)
        })
      }
    },
    postMake: async (_config, results) => {
      console.info('PostMake results:', results)
      return signWindowsMakeResults(results)
    },
  },
}

function addPublishers() {
  if (!process.env.CI) {
    return
  }

  config.publishers?.push(
    new PublisherS3({
      bucket: 'seedappdev',
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
      folder: 'dev',
      omitAcl: true,
      public: true,
      region: 'eu-west-2',
      s3ForcePathStyle: true,
    }),
    // this updates the latest folder
    new PublisherS3({
      bucket: 'seedappdev',
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
      folder: 'dev',
      omitAcl: true,
      public: true,
      region: 'eu-west-2',
      s3ForcePathStyle: true,
      keyResolver(fileName, platform, arch) {
        if (fileName.endsWith('latest.yml')) {
          return 'dev/latest/latest.yml'
        }
        return `dev/latest/${fileName}`
      },
    }),
  )
}

function buildDMGMaybe() {
  if (process.platform !== 'darwin') {
    console.log(
      `[FORGE CONFIG]: 🍎 The platform we are building is not 'darwin'. skipping (platform: ${process.platform})`,
    )
    return
  }

  if (!process.env.CI) {
    console.log(`[FORGE CONFIG]: 🤖 Not in CI, skipping sign and notarization`)
    return
  }

  console.log(`[FORGE CONFIG]: 🎉 adding DMG maker to the config.`)

  config.makers?.push({
    name: '@electron-forge/maker-dmg',
    config: {
      background: './assets/dmg-background.png',
      format: 'ULFO',
    },
  })
}

function notarizeMaybe() {
  if (process.platform !== 'darwin') {
    console.log(
      `[FORGE CONFIG]: 🍎 The platform we are building is not 'darwin'. skipping (platform: ${process.platform})`,
    )
    return
  }

  if (!process.env.CI) {
    console.log(`[FORGE CONFIG]: 🤖 Not in CI, skipping sign and notarization`)
    return
  }

  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD) {
    console.warn(
      `[FORGE CONFIG]: ❌ Should be notarizing, but environment variables APPLE_ID or APPLE_ID_PASSWORD are missing!`,
    )
    return
  }

  console.log(
    `[FORGE CONFIG]: 🎉 adding 'osxNotarize' and 'osxSign' values to the config. Proceed to Sign and Notarize`,
  )

  // @ts-expect-error
  config.packagerConfig.osxNotarize = {
    // tool: 'notarytool',
    appleId: process.env.APPLE_ID || '',
    appleIdPassword: process.env.APPLE_ID_PASSWORD || '',
    teamId: process.env.APPLE_TEAM_ID || '',
  }

  // @ts-expect-error
  config.packagerConfig.osxSign = {
    identity: macSigningIdentity,
    // @electron/osx-sign v1 only honors entitlements via optionsForFile; the old flat
    // `entitlements`/`entitlementsInherit` options are silently ignored, which signed every
    // binary with the library's default entitlements and stripped com.apple.security.hypervisor
    // from msb — breaking execute_code microVMs in shipped builds while dev (npm-signed msb)
    // kept working.
    optionsForFile: () => ({
      entitlements: './entitlements.plist',
      hardenedRuntime: true,
    }),
  }
}

notarizeMaybe()
buildDMGMaybe()
addPublishers()

module.exports = config
