import {IS_PROD_DESKTOP} from '@shm/shared'
import * as legacyLogger from 'electron-log'
import {existsSync, rmSync} from 'fs'
import {join} from 'path'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import {userDataPath} from './app-paths'
import {MESSAGE} from 'triple-beam'

export const legacyLogsFilePath = legacyLogger.transports.file.getFile().path

if (existsSync(legacyLogsFilePath)) {
  // throw away legacy logs for security reasons
  rmSync(legacyLogsFilePath)
}

export const loggingDir = join(userDataPath, 'logs')

const customJSONFormatter = winston.format((info: any) => {
  if (info.rawMessage) {
    info[MESSAGE] = info.rawMessage
    return info
  }

  let ts = new Date().toISOString()
  info[MESSAGE] = JSON.stringify({
    lvl: info.level,
    ts: ts,
    log: info.loggerName,
    msg: info.message,
    ...info.meta,
  })
  return info
})

const winstonLogger = winston.createLogger({
  transports: [
    new DailyRotateFile({
      level: 'debug',
      format: customJSONFormatter(),
      dirname: loggingDir,
      filename: '%DATE%.log',
      datePattern: 'YYYY-MM-DD-HH',
      zippedArchive: true,
      maxSize: '100m',
      maxFiles: '7d',
      createSymlink: true,
    }),
  ],
})

if (!IS_PROD_DESKTOP) {
  winstonLogger.add(
    new winston.transports.Console({
      level: 'debug',
      format: customJSONFormatter(),
    }),
  )
}

console.log('== Logs will be written in: ', loggingDir)

interface LogArgs {
  [key: string]: any
}

const mainLoggerName = 'seed/desktop'

export function info(message: string, meta: LogArgs = {}) {
  winstonLogger.log({
    level: 'info',
    message: message,
    loggerName: mainLoggerName,
    meta: meta,
  })
}

export function debug(message: string, meta: LogArgs = {}) {
  winstonLogger.log({
    level: 'debug',
    message: message,
    loggerName: mainLoggerName,
    meta: meta,
  })
}

export function warn(message: string, meta: LogArgs = {}) {
  winstonLogger.log({
    level: 'warn',
    message: message,
    loggerName: mainLoggerName,
    meta: meta,
  })
}

export function error(message: string, meta: LogArgs = {}) {
  winstonLogger.log({
    level: 'error',
    message: message,
    loggerName: mainLoggerName,
    meta: meta,
  })
}

export function verbose(message: string, meta: LogArgs = {}) {
  winstonLogger.log({
    level: 'debug',
    message: message,
    loggerName: mainLoggerName,
    meta: meta,
  })
}

export function rawMessage(message: string) {
  winstonLogger.log({
    // Using placeholder fields here to fulfill the interface.
    // The actual raw message will be used by the custom formatter.
    level: 'warn',
    message: 'raw message',
    rawMessage: message,
  })
}

export function childLogger(loggerName: string) {
  return {
    info(message: string, meta: LogArgs = {}) {
      winstonLogger.log({
        level: 'info',
        message: message,
        loggerName: loggerName,
        meta: meta,
      })
    },
    debug(message: string, meta: LogArgs = {}) {
      winstonLogger.log({
        level: 'debug',
        message: message,
        loggerName: loggerName,
        meta: meta,
      })
    },
    warn(message: string, meta: LogArgs = {}) {
      winstonLogger.log({
        level: 'warn',
        message: message,
        loggerName: loggerName,
        meta: meta,
      })
    },
    error(message: string, meta: LogArgs = {}) {
      winstonLogger.log({
        level: 'error',
        message: message,
        loggerName: loggerName,
        meta: meta,
      })
    },
    verbose(message: string, meta: LogArgs = {}) {
      winstonLogger.log({
        level: 'debug',
        message: message,
        loggerName: loggerName,
        meta: meta,
      })
    },
  }
}
