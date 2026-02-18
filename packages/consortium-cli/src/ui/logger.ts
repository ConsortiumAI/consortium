/**
 * File-based logging for relay CLI
 *
 * Prevents interference with Claude's terminal UI by logging to files only.
 */

import chalk from 'chalk'
import { appendFileSync } from 'fs'
import { configuration } from '../configuration'
import { join } from 'node:path'

function createTimestampForFilename(date: Date = new Date()): string {
  return date.toLocaleString('sv-SE', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).replace(/[: ]/g, '-').replace(/,/g, '') + '-pid-' + process.pid
}

function createTimestampForLogEntry(date: Date = new Date()): string {
  return date.toLocaleTimeString('en-US', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  })
}

function getSessionLogPath(): string {
  const timestamp = createTimestampForFilename()
  return join(configuration.logsDir, `${timestamp}.log`)
}

class Logger {
  constructor(
    public readonly logFilePath = getSessionLogPath()
  ) {}

  localTimezoneTimestamp(): string {
    return createTimestampForLogEntry()
  }

  debug(message: string, ...args: unknown[]): void {
    this.logToFile(`[${this.localTimezoneTimestamp()}]`, message, ...args)
  }

  debugLargeJson(
    message: string,
    object: unknown,
    maxStringLength: number = 100,
    maxArrayLength: number = 10,
  ): void {
    if (!process.env.DEBUG) {
      this.debug(`In production, skipping message inspection`)
      return
    }

    const truncateStrings = (obj: unknown): unknown => {
      if (typeof obj === 'string') {
        return obj.length > maxStringLength
          ? obj.substring(0, maxStringLength) + '... [truncated]'
          : obj
      }
      if (Array.isArray(obj)) {
        const truncatedArray = obj.map(item => truncateStrings(item)).slice(0, maxArrayLength)
        if (obj.length > maxArrayLength) {
          truncatedArray.push(`... [truncated array up to ${maxArrayLength} items]` as unknown)
        }
        return truncatedArray
      }
      if (obj && typeof obj === 'object') {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(obj)) {
          if (key === 'usage') continue
          result[key] = truncateStrings(value)
        }
        return result
      }
      return obj
    }

    const truncatedObject = truncateStrings(object)
    const json = JSON.stringify(truncatedObject, null, 2)
    this.logToFile(`[${this.localTimezoneTimestamp()}]`, message, '\n', json)
  }

  info(message: string, ...args: unknown[]): void {
    this.logToConsole('info', '', message, ...args)
    this.debug(message, args)
  }

  infoDeveloper(message: string, ...args: unknown[]): void {
    this.debug(message, ...args)
    if (process.env.DEBUG) {
      this.logToConsole('info', '[DEV]', message, ...args)
    }
  }

  warn(message: string, ...args: unknown[]): void {
    this.logToConsole('warn', '', message, ...args)
    this.debug(`[WARN] ${message}`, ...args)
  }

  getLogPath(): string {
    return this.logFilePath
  }

  private logToConsole(level: 'debug' | 'error' | 'info' | 'warn', prefix: string, message: string, ...args: unknown[]): void {
    switch (level) {
      case 'debug':
        console.log(chalk.gray(prefix), message, ...args)
        break
      case 'error':
        console.error(chalk.red(prefix), message, ...args)
        break
      case 'info':
        console.log(chalk.blue(prefix), message, ...args)
        break
      case 'warn':
        console.log(chalk.yellow(prefix), message, ...args)
        break
    }
  }

  private logToFile(prefix: string, message: string, ...args: unknown[]): void {
    const logLine = `${prefix} ${message} ${args.map(arg =>
      typeof arg === 'string' ? arg : JSON.stringify(arg)
    ).join(' ')}\n`

    try {
      appendFileSync(this.logFilePath, logLine)
    } catch (appendError) {
      if (process.env.DEBUG) {
        console.error('[DEV MODE ONLY] Failed to append to log file:', appendError)
        throw appendError
      }
    }
  }
}

export const logger = new Logger()
