/**
 * Utility functions for Claude process management
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { logger } from '../../ui/logger'

const __filename = fileURLToPath(import.meta.url)
const __dirname = join(__filename, '..')

/**
 * Create a clean environment without local node_modules/.bin in PATH
 */
export function getCleanEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    const cwd = process.cwd()
    const pathSep = process.platform === 'win32' ? ';' : ':'
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
    const actualPathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || pathKey

    if (env[actualPathKey]) {
        const cleanPath = env[actualPathKey]!
            .split(pathSep)
            .filter(p => {
                const normalizedP = p.replace(/\\/g, '/').toLowerCase()
                const normalizedCwd = cwd.replace(/\\/g, '/').toLowerCase()
                return !normalizedP.startsWith(normalizedCwd)
            })
            .join(pathSep)
        env[actualPathKey] = cleanPath
    }

    return env
}

/**
 * Try to find globally installed Claude CLI
 */
function findGlobalClaudePath(): string | null {
    const homeDir = homedir()
    const cleanEnv = getCleanEnv()

    try {
        execSync('claude --version', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: homeDir,
            env: cleanEnv
        })
        return 'claude'
    } catch {
        // claude command not available globally
    }

    if (process.platform !== 'win32') {
        try {
            const result = execSync('which claude', {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: homeDir,
                env: cleanEnv
            }).trim()
            if (result && existsSync(result)) return result
        } catch {
            // which didn't find it
        }
    }

    return null
}

/**
 * Get default path to Claude Code executable
 */
export function getDefaultClaudeCodePath(): string {
    const nodeModulesPath = join(__dirname, '..', '..', '..', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')

    if (process.env.CONSORTIUM_CLAUDE_PATH) {
        return process.env.CONSORTIUM_CLAUDE_PATH
    }

    if (process.env.CONSORTIUM_USE_BUNDLED_CLAUDE === '1') {
        return nodeModulesPath
    }

    const globalPath = findGlobalClaudePath()
    if (!globalPath) {
        return nodeModulesPath
    }

    return globalPath
}

/**
 * Log debug message
 */
export function logDebug(message: string): void {
    if (process.env.DEBUG) {
        logger.debug(message)
        console.log(message)
    }
}

/**
 * Stream async messages to stdin
 */
export async function streamToStdin(
    stream: AsyncIterable<unknown>,
    stdin: NodeJS.WritableStream,
    abort?: AbortSignal
): Promise<void> {
    for await (const message of stream) {
        if (abort?.aborted) break
        stdin.write(JSON.stringify(message) + '\n')
    }
    stdin.end()
}
