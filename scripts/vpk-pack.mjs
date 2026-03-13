#!/usr/bin/env node

/**
 * Orchestrates `vpk pack` after `electron-forge package`.
 *
 * Reads config from environment variables:
 *   VITE_VERSION  - App version (required)
 *   VPK_CHANNEL   - Release channel: "dev" or "stable" (default: "dev")
 *
 * The packaged app is expected at:
 *   frontend/apps/desktop/out/<AppName>-<platform>-<arch>/
 */

import {execSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const desktopDir = path.join(projectRoot, 'frontend', 'apps', 'desktop')

const version = process.env.VITE_VERSION
if (!version) {
  console.error('ERROR: VITE_VERSION environment variable is required')
  process.exit(1)
}

const channel = process.env.VPK_CHANNEL || 'dev'
const platform = process.platform
const arch = process.arch

// Determine app name based on whether this is a dev build
const isDev = version.includes('dev')
const appName = isDev ? 'SeedDev' : 'Seed'
const packId = isDev ? 'SeedDev' : 'Seed'

// Determine the packaged app directory from Forge output
function getPackDir() {
  const outDir = path.join(desktopDir, 'out')

  if (platform === 'darwin') {
    // macOS: out/<AppName>-darwin-<arch>/<AppName>.app
    const dirName = `${appName}-darwin-${arch}`
    const appPath = path.join(outDir, dirName, `${appName}.app`)
    if (fs.existsSync(appPath)) return appPath

    // Fallback: search for any matching directory
    const entries = fs.readdirSync(outDir).filter((e) => e.startsWith(appName) && e.includes('darwin'))
    if (entries.length > 0) {
      const fallback = path.join(outDir, entries[0], `${appName}.app`)
      if (fs.existsSync(fallback)) return fallback
    }

    console.error(`ERROR: Could not find packaged app at ${appPath}`)
    console.error(`Contents of ${outDir}:`, fs.readdirSync(outDir))
    process.exit(1)
  }

  if (platform === 'win32') {
    // Windows: out/<AppName>-win32-<arch>/
    const dirName = `${appName}-win32-${arch}`
    const dirPath = path.join(outDir, dirName)
    if (fs.existsSync(dirPath)) return dirPath

    const entries = fs.readdirSync(outDir).filter((e) => e.startsWith(appName) && e.includes('win32'))
    if (entries.length > 0) {
      return path.join(outDir, entries[0])
    }

    console.error(`ERROR: Could not find packaged app at ${dirPath}`)
    process.exit(1)
  }

  if (platform === 'linux') {
    // Linux: out/<AppName>-linux-<arch>/
    const dirName = `${appName}-linux-${arch}`
    const dirPath = path.join(outDir, dirName)
    if (fs.existsSync(dirPath)) return dirPath

    const entries = fs.readdirSync(outDir).filter((e) => e.startsWith(appName) && e.includes('linux'))
    if (entries.length > 0) {
      return path.join(outDir, entries[0])
    }

    console.error(`ERROR: Could not find packaged app at ${dirPath}`)
    process.exit(1)
  }

  console.error(`ERROR: Unsupported platform: ${platform}`)
  process.exit(1)
}

function getMainExe() {
  if (platform === 'win32') return `${appName}.exe`
  return appName
}

function getRuntimeId() {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'osx-arm64' : 'osx-x64'
  }
  if (platform === 'win32') {
    return arch === 'arm64' ? 'win-arm64' : 'win-x64'
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  }
  return `${platform}-${arch}`
}

const packDir = getPackDir()
const mainExe = getMainExe()
const runtimeId = getRuntimeId()
const outputDir = path.join(desktopDir, 'out', 'velopack')

// Ensure output directory exists
fs.mkdirSync(outputDir, {recursive: true})

const args = [
  'pack',
  '--packId',
  packId,
  '--packVersion',
  version,
  '--packDir',
  packDir,
  '--mainExe',
  mainExe,
  '--outputDir',
  outputDir,
  '--channel',
  channel,
]

// Add runtime for non-macOS (macOS .app bundles don't need --runtime)
if (platform !== 'darwin') {
  args.push('--runtime', runtimeId)
}

const cmd = `vpk ${args.join(' ')}`
console.log(`[vpk-pack] Running: ${cmd}`)
console.log(`[vpk-pack] Pack dir: ${packDir}`)
console.log(`[vpk-pack] Output dir: ${outputDir}`)
console.log(`[vpk-pack] Version: ${version}, Channel: ${channel}`)

try {
  execSync(cmd, {stdio: 'inherit', cwd: projectRoot})
  console.log('[vpk-pack] Done!')

  // List output files
  const files = fs.readdirSync(outputDir)
  console.log(`[vpk-pack] Output files:`)
  files.forEach((f) => {
    const stat = fs.statSync(path.join(outputDir, f))
    const sizeMB = (stat.size / 1024 / 1024).toFixed(2)
    console.log(`  ${f} (${sizeMB} MB)`)
  })
} catch (err) {
  console.error(`[vpk-pack] Failed:`, err.message)
  process.exit(1)
}
