// Helpers copied from https://github.com/kubeshop/monokle/blob/main/tests/electronHelpers.ts
import {Page, _electron as electron} from '@playwright/test'
import * as ASAR from 'asar'
import * as fs from 'fs'
import log from 'loglevel'
import os from 'os'
import * as path from 'path'
import {ElectronAppInfo} from './types'

/**
 * Find the latest build and start monokle app for testing
 */
export async function startApp() {
  // find the latest build in the out directory
  const latestBuild = findLatestBuild()
  // parse the directory and find paths and other info
  const appInfo = parseElectronApp(latestBuild)

  //   deleteApplicationConfig(appInfo.platform);
  const electronApp = await electron.launch({
    args: [appInfo.main],
    executablePath: appInfo.executable,
  })

  // // wait for splash-screen to pass
  // await electronApp.firstWindow();
  // while (electronApp.windows().length === 2) {

  //   await pause(100);
  // }

  const windows = electronApp.windows()

  // if (windows.length != 1) {
  //   console.log(`== ~ startApp ~ windows:`, windows)
  //   throw new Error('too many windows open')
  // }
  const appWindow: Page = windows[0]
  appWindow.on('console', log.info)

  // await appWindow.screenshot({
  //   path: getRecordingPath(appInfo.platform, 'before-modals.png'),
  //   timeout: 45000,
  // });

  //   await closeNotification(appWindow, 20000);

  //   for (const modalName of modalsToWait) {
  //     const modal = await waitForModalToShow(appWindow, modalName, 20000);
  //     if (modal) {
  //       await closeModal(modal);
  //       await pause(500);
  //       await waitForModalToHide(appWindow, modalName, 20000);
  //       await pause(500);
  //       await clickOnMonokleLogo(appWindow);
  //     }
  //     await appWindow.screenshot({
  //       path: getRecordingPath(appInfo.platform, `modal-gone-${modalName}.png`),
  //     });
  //   }

  // Capture a screenshot.
  // await appWindow.screenshot({
  //   path: getRecordingPath(appInfo.platform, 'initial-screen.png'),
  // });
  await electronApp.on('window', () => {
    console.log('-- helloooo')
  })
  return {
    getWindow: async () => await electronApp.firstWindow(),
    appInfo,
    app: electronApp,
    appWindow,
  }
}

/**
 * Parses the `out` directory to find the latest build.
 * Use `npm run package` (or similar) to build your app prior to testing.
 * @returns path to the most recently modified build directory
 */
export function findLatestBuild(): string {
  // root of your project
  const rootDir = path.resolve('./')
  // directory where the builds are stored
  const outDir = path.join(rootDir, 'out')
  // list of files in the out directory
  const builds = fs.readdirSync(outDir)

  const platforms = [
    'win32',
    'win',
    'windows',
    'darwin',
    'mac',
    'macos',
    'osx',
    'linux',
    'ubuntu',
  ]

  const latestBuild = builds
    .map((fileName) => {
      // make sure it's a directory with "-" delimited platform in its name
      const stats = fs.statSync(path.join(outDir, fileName))
      const isBuild = fileName
        .toLocaleLowerCase()
        .split('-')
        .some((part) => platforms.includes(part))
      if (stats.isDirectory() && isBuild) {
        return {
          name: fileName,
          time: fs.statSync(path.join(outDir, fileName)).mtimeMs,
        }
      }
    })
    // @ts-ignore
    .sort((a, b) => b.time - a.time)
    .map((file) => {
      if (file) {
        return file.name
      }
    })[0]
  if (!latestBuild) {
    throw new Error('No build found in out directory')
  }
  return path.join(outDir, latestBuild)
}

/**
 * Given a directory containing an Electron app build,
 * return the path to the app's executable and the path to the app's main file.
 */
export function parseElectronApp(buildDir: string): ElectronAppInfo {
  log.info(`Parsing Electron app in ${buildDir}`)
  let platform: string | undefined
  if (buildDir.endsWith('.app')) {
    buildDir = path.dirname(buildDir)
    platform = 'darwin'
  }
  if (buildDir.endsWith('.exe')) {
    buildDir = path.dirname(buildDir)
    platform = 'win32'
  }

  const baseName = path.basename(buildDir).toLowerCase()
  if (!platform) {
    // parse the directory name to figure out the platform
    if (baseName.includes('win')) {
      platform = 'win32'
    }
    if (
      baseName.includes('linux') ||
      baseName.includes('ubuntu') ||
      baseName.includes('debian')
    ) {
      platform = 'linux'
    }
    if (
      baseName.includes('darwin') ||
      baseName.includes('mac') ||
      baseName.includes('osx')
    ) {
      platform = 'darwin'
    }
  }

  if (!platform) {
    throw new Error(`Platform not found in directory name: ${baseName}`)
  }

  let arch: ReturnType<typeof os.arch>
  if (baseName.includes('x32') || baseName.includes('i386')) {
    arch = 'x32'
  }
  if (baseName.includes('x64')) {
    arch = 'x64'
  }
  if (baseName.includes('arm64')) {
    arch = 'arm64'
  }

  let executable: string
  let main: string
  let name: string
  let asar: boolean
  let resourcesDir: string

  if (platform === 'darwin') {
    // MacOS Structure
    // <buildDir>/
    //   <appName>.app/
    //     Contents/
    //       MacOS/
    //        <appName> (executable)
    //       Info.plist
    //       PkgInfo
    //       Resources/
    //         electron.icns
    //         file.icns
    //         app.asar (asar bundle) - or -
    //         app
    //           package.json
    //           (your app structure)

    const list = fs.readdirSync(buildDir)
    const appBundle = list.find((fileName) => {
      return fileName.endsWith('.app')
    })
    // @ts-ignore
    const appDir = path.join(buildDir, appBundle, 'Contents', 'MacOS')
    const appName = fs.readdirSync(appDir)[0]
    executable = path.join(appDir, appName)

    // @ts-ignore
    resourcesDir = path.join(buildDir, appBundle, 'Contents', 'Resources')
    const resourcesList = fs.readdirSync(resourcesDir)
    asar = resourcesList.includes('app.asar')

    let packageJson: {main: string; name: string}
    if (asar) {
      const asarPath = path.join(resourcesDir, 'app.asar')
      packageJson = JSON.parse(
        ASAR.extractFile(asarPath, 'package.json').toString('utf8'),
      )
      main = path.join(asarPath, packageJson.main)
    } else {
      packageJson = JSON.parse(
        fs.readFileSync(path.join(resourcesDir, 'app', 'package.json'), 'utf8'),
      )
      main = path.join(resourcesDir, 'app', packageJson.main)
    }
    name = packageJson.name
  } else if (platform === 'win32') {
    // Windows Structure
    // <buildDir>/
    //   <appName>.exe (executable)
    //   resources/
    //     app.asar (asar bundle) - or -
    //     app
    //       package.json
    //       (your app structure)

    const list = fs.readdirSync(buildDir)
    const exe = list.find((fileName) => {
      return fileName.endsWith('.exe')
    })
    // @ts-ignore
    executable = path.join(buildDir, exe)

    resourcesDir = path.join(buildDir, 'resources')
    const resourcesList = fs.readdirSync(resourcesDir)
    asar = resourcesList.includes('app.asar')

    let packageJson: {main: string; name: string}

    if (asar) {
      const asarPath = path.join(resourcesDir, 'app.asar')
      packageJson = JSON.parse(
        ASAR.extractFile(asarPath, 'package.json').toString('utf8'),
      )
      main = path.join(asarPath, packageJson.main)
    } else {
      packageJson = JSON.parse(
        fs.readFileSync(path.join(resourcesDir, 'app', 'package.json'), 'utf8'),
      )
      main = path.join(resourcesDir, 'app', packageJson.main)
    }
    name = packageJson.name
  } else if (platform == 'linux') {
    const buildFolderName = buildDir.split('/').reverse()[0]
    const appName = buildFolderName.split('-')[0]
    executable = path.join(buildDir, appName)
    resourcesDir = path.join(buildDir, 'resources')
    const resourcesList = fs.readdirSync(resourcesDir)
    asar = resourcesList.includes('app.asar')
    let packageJson: {main: string; name: string}
    if (asar) {
      const asarPath = path.join(resourcesDir, 'app.asar')
      packageJson = JSON.parse(
        ASAR.extractFile(asarPath, 'package.json').toString('utf8'),
      )
      main = path.join(asarPath, packageJson.main)
    } else {
      packageJson = JSON.parse(
        fs.readFileSync(path.join(resourcesDir, 'app', 'package.json'), 'utf8'),
      )
      main = path.join(resourcesDir, 'app', packageJson.main)
    }
    name = packageJson.name
  } else {
    /**  @todo add support for linux */
    throw new Error(`Platform not supported: ${platform}`)
  }
  return {
    executable,
    main,
    asar,
    name,
    platform,
    resourcesDir,
    // @ts-ignore
    arch,
  }
}

const MAC_CONFIG_PATH = ['Library', 'Application Support', 'Seed']
const WIN_CONFIG_PATH = ['AppData', 'Roaming', 'Seed']

export const deleteApplicationConfig = (platform: string) => {
  let tempPath

  if (platform === 'darwin') {
    tempPath = MAC_CONFIG_PATH.join(path.sep)
  }
  if (platform === 'win32') {
    tempPath = WIN_CONFIG_PATH.join(path.sep)
  }

  try {
    if (tempPath) {
      fs.unlinkSync(path.join(os.homedir(), tempPath, 'config.json'))
    }
  } catch (error) {
    log.error(error.message)
  }
}
