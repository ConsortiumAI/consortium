/**
 * Global configuration for relay CLI
 *
 * Centralizes all configuration including environment variables and paths
 */

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

class Configuration {
  public readonly serverUrl: string

  // Directories and paths
  public readonly consortiumHomeDir: string
  public readonly logsDir: string
  public readonly settingsFile: string
  public readonly privateKeyFile: string

  constructor() {
    // Server configuration
    this.serverUrl = process.env.CONSORTIUM_SERVER_URL || 'https://api.consortium.dev'

    // Directory configuration
    if (process.env.CONSORTIUM_HOME_DIR) {
      const expandedPath = process.env.CONSORTIUM_HOME_DIR.replace(/^~/, homedir())
      this.consortiumHomeDir = expandedPath
    } else {
      this.consortiumHomeDir = join(homedir(), '.consortium')
    }

    this.logsDir = join(this.consortiumHomeDir, 'logs')
    this.settingsFile = join(this.consortiumHomeDir, 'settings.json')
    this.privateKeyFile = join(this.consortiumHomeDir, 'access.key')

    if (!existsSync(this.consortiumHomeDir)) {
      mkdirSync(this.consortiumHomeDir, { recursive: true })
    }
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true })
    }
  }
}

export const configuration: Configuration = new Configuration()
