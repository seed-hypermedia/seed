import {MakerDeb, MakerDebConfig} from '@electron-forge/maker-deb'
import {MakerRpm, MakerRpmConfig} from '@electron-forge/maker-rpm'
import {MakerSquirrel} from '@electron-forge/maker-squirrel'
import {MakerZIP} from '@electron-forge/maker-zip'
import {PublisherS3} from '@electron-forge/publisher-s3'
import type {ForgeConfig} from '@electron-forge/shared-types'
// import {MakerRpm} from '@electron-forge/maker-rpm'
import {VitePlugin} from '@electron-forge/plugin-vite'
import path from 'node:path'
import packageJson from './package.json'
// import setLanguages from 'electron-packager-languages'

const {version} = packageJson

const devProjectRoot = path.join(process.cwd(), '../../..')
const LLVM_TRIPLES = {
  'darwin/x64': 'x86_64-apple-darwin',
  'darwin/arm64': 'aarch64-apple-darwin',
  'win32/x64': 'x86_64-pc-windows-msvc.exe',
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

let iconsPath = process.env.CI
  ? path.resolve(__dirname, 'assets', 'icons-prod', 'icon')
  : path.resolve(__dirname, 'assets', 'icons', 'icon')

const commonLinuxConfig = {
  options: {
    categories: ['Development', 'Utility'],
    icon: `${iconsPath}.png`,
    maintainer: 'Mintter Inc.',
    description: 'Seed: a hyper.media protocol client',
    productName: 'Seed',
    mimeType: ['x-scheme-handler/hm'],
    version,
    bin: 'Seed',
    homepage: 'https://seedhypermedia.com',
  },
}

const config: ForgeConfig = {
  packagerConfig: {
    appVersion: process.env.VITE_VERSION,
    asar: true,
    darwinDarkModeSupport: true,
    icon: iconsPath,
    name: 'Seed',
    appBundleId: 'com.seed.app',
    executableName: 'Seed',
    appCategoryType: 'public.app-category.productivity',
    // packageManager: 'yarn',
    extraResource: [daemonBinaryPath],
    // beforeCopy: [setLanguages(['en', 'en_US'])],
    win32metadata: {
      CompanyName: 'Mintter Inc.',
      OriginalFilename: 'Seed',
    },
    protocols: [{name: 'Seed Hypermedia', schemes: ['hm']}],
  },
  makers: [
    new MakerDeb(commonLinuxConfig as MakerDebConfig),
    new MakerZIP(
      (arch) => ({
        // Note that we must provide this S3 URL here
        // in order to support smooth version transitions
        // especially when using a CDN to front your updates
        macUpdateManifestBaseUrl: `https://seed-demo.s3.eu-west-2.amazonaws.com/dev/darwin/${arch}`,
      }),
      ['darwin'],
    ),
    new MakerSquirrel((arch) => ({
      name: 'Seed',
      authors: 'Mintter inc.',
      exe: 'seed.exe',
      description: 'Seed: a hyper.media protocol client',
      // An URL to an ICO file to use as the application icon (displayed in Control Panel > Programs and Features).
      iconUrl: `${iconsPath}.ico`,
      noMsi: true,
      setupIcon: `${iconsPath}.ico`,
      setupExe: `seed-${version}-win32-${process.arch}-setup.exe`,
      // The ICO file to use as the icon for the generated Setup.exe
      loadingGif: path.resolve(__dirname, 'assets', 'loading.gif'),

      // Note that we must provide this S3 URL here
      // in order to generate delta updates
      remoteReleases: `https://seed-demo.s3.eu-west-2.amazonaws.com/dev/win32/${arch}`,

      // certificateFile: process.env.WINDOWS_PFX_FILE,
      // certificatePassword: process.env.WINDOWS_PFX_PASSWORD,
    })),
    new MakerRpm(commonLinuxConfig as MakerRpmConfig),
    // new MakerFlatpak(commonLinuxConfig as unknown as MakerFlatpakConfig),
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
      ],
    }),
  ],
  publishers: [],
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

  config.publishers?.push(
    new PublisherS3({
      bucket: 'seed-demo',
      accessKeyId: process.env.TEMP_S3_ACCESS_KEY,
      secretAccessKey: process.env.TEMP_S3_SECRET_KEY,
      folder: 'dev',
      omitAcl: true,
      public: true,
      region: 'eu-west-2',
      s3ForcePathStyle: true,
      // Function to determine the S3 key (path) for each uploaded file
      keyResolver: (filePath) => {
        // If the file is 'latest.yml', place it in the 'latest/' directory
        if (filePath.endsWith('latest.yml')) {
          return 'latest/latest.yml'
        }

        // Otherwise, upload to the 'latest/' directory with the file name
        return `latest/${filePath.split('/').pop()}`
      },
    }),
    new PublisherS3({
      bucket: 'seed-demo',
      accessKeyId: process.env.TEMP_S3_ACCESS_KEY,
      secretAccessKey: process.env.TEMP_S3_SECRET_KEY,
      folder: 'dev',
      omitAcl: true,
      public: true,
      region: 'eu-west-2',
      s3ForcePathStyle: true,

      keyResolver: (filePath) => {
        // Upload 'latest.yml' to the versioned folder
        if (filePath.endsWith('latest.yml')) {
          return `v${version}/latest.yml`
        }

        // Place other files in the versioned folder
        return `v${process.env.VITE_VERSION}/${filePath.split('/').pop()}`
      },
    }),
  )
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
    // @ts-expect-error
    entitlements: './entitlements.plist',
    executableName: 'Mintter',
    entitlementsInherit: './entitlements.plist',
    gatekeeperAssess: false,
    hardenedRuntime: true,
    identity:
      'Developer ID Application: Mintter Technologies S.L. (XSKC6RJDD8)',
    binaries: [daemonBinaryPath],
  }
}

notarizeMaybe()
buildDMGMaybe()

module.exports = config
