import {ChildProcess, spawn} from 'child_process'
import {randomUUID} from 'crypto'
import * as fs from 'node:fs'
import * as readline from 'node:readline'
import path from 'path'
import {userDataPath} from './app-paths'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import * as log from './logger'
import {killProcessTree} from './win32-process'

/**
 * Service manager: runs arbitrary long-running shell commands ("services") under the desktop app,
 * keeps their definitions across restarts, captures their output, and reports their state to the
 * renderer (Services page), the tray menu, the tRPC router and the local HTTP API.
 *
 * Every service is one shell command spawned in its own process group, so stopping a service kills
 * the whole tree it started (a `pnpm dev` and the vite it forked, for example), not just the shell.
 */

const SERVICES_STORAGE_KEY = 'Services-v001'
/** Lines kept in memory per service; the full output also goes to a log file under userData. */
const MAX_LOG_LINES = 2_000
/** How long a service gets to exit after SIGTERM before it is killed. */
const STOP_GRACE_MS = 5_000

export type ServiceDefinition = {
  id: string
  name: string
  /** Shell command line, run through the platform shell. */
  command: string
  /** Working directory; defaults to the user's home directory. */
  cwd?: string
  /** Extra environment variables layered over the app's environment. */
  env?: Record<string, string>
  /** Start automatically when the desktop app launches. */
  autoStart: boolean
  createdAt: number
  updatedAt: number
}

export type ServiceStatus = 'stopped' | 'running' | 'stopping' | 'exited' | 'failed'

export type ServiceRuntime = {
  status: ServiceStatus
  pid: number | null
  startedAt: number | null
  exitedAt: number | null
  exitCode: number | null
  signal: string | null
  /** Spawn error or the reason for the last failed exit. */
  error: string | null
}

export type ServiceInfo = ServiceDefinition & {runtime: ServiceRuntime}

export type ServiceLogLine = {
  ts: number
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

export type ServiceInput = {
  name: string
  command: string
  cwd?: string
  env?: Record<string, string>
  autoStart?: boolean
}

export type ServicesEvent = {type: 'services'} | {type: 'logs'; serviceId: string}

type ServiceRecord = {
  definition: ServiceDefinition
  runtime: ServiceRuntime
  child: ChildProcess | null
  logs: ServiceLogLine[]
  logFile: fs.WriteStream | null
  stopTimer: ReturnType<typeof setTimeout> | null
  /** Resolves when the current process has fully closed. */
  closed: Promise<void> | null
}

const records = new Map<string, ServiceRecord>()
const listeners = new Set<(event: ServicesEvent) => void>()
let loaded = false

function idleRuntime(): ServiceRuntime {
  return {status: 'stopped', pid: null, startedAt: null, exitedAt: null, exitCode: null, signal: null, error: null}
}

function emit(event: ServicesEvent) {
  for (const listener of Array.from(listeners)) {
    try {
      listener(event)
    } catch (error) {
      log.error('[SERVICES] listener failed', {error: (error as Error).message})
    }
  }
}

/** Subscribes to service list/state changes and log output. Returns the unsubscribe function. */
export function subscribeServices(listener: (event: ServicesEvent) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function persist() {
  const services = Array.from(records.values()).map((record) => record.definition)
  appStore.set(SERVICES_STORAGE_KEY, {services})
}

function newRecord(definition: ServiceDefinition): ServiceRecord {
  return {definition, runtime: idleRuntime(), child: null, logs: [], logFile: null, stopTimer: null, closed: null}
}

function ensureLoaded() {
  if (loaded) return
  loaded = true
  const stored = appStore.get(SERVICES_STORAGE_KEY) as {services?: ServiceDefinition[]} | undefined
  for (const definition of stored?.services ?? []) {
    if (!definition?.id || typeof definition.command !== 'string') continue
    records.set(definition.id, newRecord({...definition, autoStart: Boolean(definition.autoStart)}))
  }
}

function logsDir(): string {
  return path.join(userDataPath, 'service-logs')
}

/** Path of the on-disk log file for a service. */
export function getServiceLogPath(id: string): string {
  return path.join(logsDir(), `${id}.log`)
}

function toInfo(record: ServiceRecord): ServiceInfo {
  return {...record.definition, runtime: {...record.runtime}}
}

function requireRecord(id: string): ServiceRecord {
  ensureLoaded()
  const record = records.get(id)
  if (!record) throw new Error(`Unknown service: ${id}`)
  return record
}

function isActive(record: ServiceRecord): boolean {
  return record.runtime.status === 'running' || record.runtime.status === 'stopping'
}

function appendLog(record: ServiceRecord, stream: ServiceLogLine['stream'], text: string) {
  const line: ServiceLogLine = {ts: Date.now(), stream, text}
  record.logs.push(line)
  if (record.logs.length > MAX_LOG_LINES) {
    record.logs.splice(0, record.logs.length - MAX_LOG_LINES)
  }
  record.logFile?.write(`${new Date(line.ts).toISOString()} [${stream}] ${text}\n`)
  emit({type: 'logs', serviceId: record.definition.id})
}

function validateInput(input: Partial<ServiceInput>, requireAll: boolean) {
  if (requireAll || input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('Service name is required')
  }
  if (requireAll || input.command !== undefined) {
    if (typeof input.command !== 'string' || !input.command.trim()) throw new Error('Service command is required')
  }
  if (input.cwd !== undefined && typeof input.cwd !== 'string') {
    throw new Error('Service cwd must be a string')
  }
  if (input.env !== undefined) {
    if (typeof input.env !== 'object' || input.env === null || Array.isArray(input.env)) {
      throw new Error('Service env must be an object of strings')
    }
    for (const value of Object.values(input.env)) {
      if (typeof value !== 'string') throw new Error('Service env must be an object of strings')
    }
  }
}

/** All services with their current runtime state. */
export function listServices(): ServiceInfo[] {
  ensureLoaded()
  return Array.from(records.values()).map(toInfo)
}

/** One service by id. */
export function getService(id: string): ServiceInfo {
  return toInfo(requireRecord(id))
}

/** Creates a service definition; does not start it. */
export function createService(input: ServiceInput): ServiceInfo {
  ensureLoaded()
  validateInput(input, true)
  const now = Date.now()
  const definition: ServiceDefinition = {
    id: randomUUID(),
    name: input.name.trim(),
    command: input.command.trim(),
    cwd: input.cwd?.trim() || undefined,
    env: input.env && Object.keys(input.env).length ? {...input.env} : undefined,
    autoStart: Boolean(input.autoStart),
    createdAt: now,
    updatedAt: now,
  }
  const record = newRecord(definition)
  records.set(definition.id, record)
  persist()
  log.info('[SERVICES] created', {id: definition.id, name: definition.name})
  emit({type: 'services'})
  return toInfo(record)
}

/** Updates a service definition. A running service keeps running with its old command until restarted. */
export function updateService(id: string, input: Partial<ServiceInput>): ServiceInfo {
  const record = requireRecord(id)
  validateInput(input, false)
  const definition = record.definition
  if (input.name !== undefined) definition.name = input.name.trim()
  if (input.command !== undefined) definition.command = input.command.trim()
  if (input.cwd !== undefined) definition.cwd = input.cwd.trim() || undefined
  if (input.env !== undefined) definition.env = Object.keys(input.env).length ? {...input.env} : undefined
  if (input.autoStart !== undefined) definition.autoStart = Boolean(input.autoStart)
  definition.updatedAt = Date.now()
  persist()
  emit({type: 'services'})
  return toInfo(record)
}

/** Stops (if needed) and forgets a service. */
export async function removeService(id: string): Promise<void> {
  const record = requireRecord(id)
  if (isActive(record)) {
    await stopService(id)
  }
  record.logFile?.end()
  records.delete(id)
  persist()
  log.info('[SERVICES] removed', {id})
  emit({type: 'services'})
}

/** Recent output of a service, oldest first. */
export function getServiceLogs(id: string, limit = 500): ServiceLogLine[] {
  const record = requireRecord(id)
  const count = Math.max(0, Math.min(limit, record.logs.length))
  return record.logs.slice(record.logs.length - count)
}

/** Discards the in-memory log buffer of a service. */
export function clearServiceLogs(id: string): void {
  const record = requireRecord(id)
  record.logs = []
  emit({type: 'logs', serviceId: id})
}

function openLogFile(record: ServiceRecord) {
  try {
    fs.mkdirSync(logsDir(), {recursive: true})
    record.logFile?.end()
    record.logFile = fs.createWriteStream(getServiceLogPath(record.definition.id), {flags: 'a'})
    record.logFile.on('error', (error) => {
      log.warn('[SERVICES] log file write failed', {id: record.definition.id, error: error.message})
    })
  } catch (error) {
    log.warn('[SERVICES] could not open log file', {id: record.definition.id, error: (error as Error).message})
    record.logFile = null
  }
}

function resolveCwd(definition: ServiceDefinition): string {
  const cwd = definition.cwd || process.env.HOME || process.env.USERPROFILE || process.cwd()
  if (!fs.existsSync(cwd)) throw new Error(`Working directory does not exist: ${cwd}`)
  return cwd
}

/** Spawns the service's command. Returns once the process exists; exits are reported through events. */
export function startService(id: string): ServiceInfo {
  const record = requireRecord(id)
  if (isActive(record)) return toInfo(record)

  const {definition} = record
  const cwd = resolveCwd(definition)
  openLogFile(record)
  appendLog(record, 'system', `Starting: ${definition.command}`)

  const child = spawn(definition.command, {
    shell: true,
    cwd,
    env: {...process.env, ...definition.env},
    stdio: ['ignore', 'pipe', 'pipe'],
    // A separate process group on POSIX so stop() can signal the whole tree.
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  record.child = child
  record.runtime = {
    status: 'running',
    pid: child.pid ?? null,
    startedAt: Date.now(),
    exitedAt: null,
    exitCode: null,
    signal: null,
    error: null,
  }

  if (child.stdout) {
    readline.createInterface({input: child.stdout}).on('line', (line) => appendLog(record, 'stdout', line))
  }
  if (child.stderr) {
    readline.createInterface({input: child.stderr}).on('line', (line) => appendLog(record, 'stderr', line))
  }

  record.closed = new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    child.on('error', (error) => {
      if (record.child !== child) return
      record.runtime = {...record.runtime, status: 'failed', pid: null, exitedAt: Date.now(), error: error.message}
      record.child = null
      appendLog(record, 'system', `Failed to start: ${error.message}`)
      log.error('[SERVICES] spawn error', {id, error: error.message})
      emit({type: 'services'})
      finish()
    })
    child.on('close', (code, signal) => {
      if (record.child !== child) return
      const wasStopping = record.runtime.status === 'stopping'
      if (record.stopTimer) {
        clearTimeout(record.stopTimer)
        record.stopTimer = null
      }
      const clean = wasStopping || code === 0
      record.runtime = {
        ...record.runtime,
        status: clean ? (wasStopping ? 'stopped' : 'exited') : 'failed',
        pid: null,
        exitedAt: Date.now(),
        exitCode: code,
        signal: signal ?? null,
        error: clean ? null : `Exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
      }
      record.child = null
      appendLog(record, 'system', `Process ended (${signal ? `signal ${signal}` : `code ${code}`})`)
      log.info('[SERVICES] closed', {id, code, signal})
      emit({type: 'services'})
      finish()
    })
  })

  log.info('[SERVICES] started', {id, pid: child.pid, command: definition.command, cwd})
  emit({type: 'services'})
  return toInfo(record)
}

function signalTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    void killProcessTree(child.pid)
    return
  }
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // Already gone.
    }
  }
}

/** Asks a service to stop, escalating to SIGKILL after a grace period. Resolves once it has exited. */
export async function stopService(id: string): Promise<ServiceInfo> {
  const record = requireRecord(id)
  const child = record.child
  if (!child || !isActive(record)) return toInfo(record)

  if (record.runtime.status !== 'stopping') {
    record.runtime = {...record.runtime, status: 'stopping'}
    appendLog(record, 'system', 'Stopping…')
    emit({type: 'services'})
    signalTree(child, 'SIGTERM')
    record.stopTimer = setTimeout(() => {
      record.stopTimer = null
      if (record.child === child) {
        appendLog(record, 'system', 'Did not exit in time, killing')
        signalTree(child, 'SIGKILL')
      }
    }, STOP_GRACE_MS)
    record.stopTimer.unref?.()
  }
  await record.closed
  return toInfo(record)
}

/** Stops then starts a service. */
export async function restartService(id: string): Promise<ServiceInfo> {
  await stopService(id)
  return startService(id)
}

/** Starts every service flagged autoStart. Called once at app startup. */
export function startAutoStartServices(): void {
  ensureLoaded()
  for (const record of Array.from(records.values())) {
    if (!record.definition.autoStart || isActive(record)) continue
    try {
      startService(record.definition.id)
    } catch (error) {
      log.error('[SERVICES] autostart failed', {id: record.definition.id, error: (error as Error).message})
    }
  }
}

/** Stops every running service. Used on app quit. */
export async function stopAllServices(): Promise<void> {
  ensureLoaded()
  await Promise.all(
    Array.from(records.values())
      .filter(isActive)
      .map((record) => stopService(record.definition.id).catch(() => undefined)),
  )
}

/** Number of services currently running or stopping. */
export function countActiveServices(): number {
  ensureLoaded()
  return Array.from(records.values()).filter(isActive).length
}

/** Test-only: forget everything without touching processes. */
export function _resetServicesForTests(): void {
  records.clear()
  listeners.clear()
  loaded = false
}
