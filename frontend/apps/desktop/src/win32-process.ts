import {ChildProcess, exec} from 'child_process'
import * as log from './logger'

export function killProcessTree(pid: number): Promise<void> {
  log.info(`[WIN32-PROCESS] Killing process tree for PID: ${pid}`)

  return new Promise<void>((resolve) => {
    const cmd = `taskkill /F /T /PID ${pid}`
    log.info(`[WIN32-PROCESS] Executing: ${cmd}`)

    exec(cmd, {timeout: 15_000}, (error, stdout, stderr) => {
      if (error) {
        if (error.killed || error.code === 128) {
          log.info(`[WIN32-PROCESS] Process ${pid} was not found (already dead)`)
        } else {
          log.warn(`[WIN32-PROCESS] taskkill warning for PID ${pid}: ${error.message}`)
          log.warn(`[WIN32-PROCESS] stderr: ${stderr}`)
        }
      }
      if (stdout.trim()) {
        log.info(`[WIN32-PROCESS] taskkill stdout: ${stdout.trim()}`)
      }
      if (stderr.trim() && !stderr.includes('not found')) {
        log.info(`[WIN32-PROCESS] taskkill stderr: ${stderr.trim()}`)
      }
      resolve()
    })
  })
}

export function killProcess(pid: number): Promise<void> {
  return killProcessTree(pid)
}

export async function killProcessAndWait(pid: number, waitMs: number = 2000): Promise<void> {
  await killProcessTree(pid)
  await new Promise((resolve) => setTimeout(resolve, waitMs))
}

export async function forceKillChildProcess(child: ChildProcess): Promise<void> {
  if (!child.pid) {
    log.warn('[WIN32-PROCESS] Child process has no PID, cannot force kill')
    return
  }

  log.info(`[WIN32-PROCESS] Force killing child process PID: ${child.pid}`)

  if (!child.killed) {
    child.kill()
  }

  await killProcessTree(child.pid)
}
