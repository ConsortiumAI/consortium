/**
 * Main query implementation for Claude process management
 * Handles spawning Claude process and managing message streams
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { Stream } from './stream'
import {
    type QueryOptions,
    type QueryPrompt,
    type SDKMessage,
    type ControlResponseHandler,
    type SDKControlRequest,
    type ControlRequest,
    type SDKControlResponse,
    type CanCallToolCallback,
    type CanUseToolControlRequest,
    type CanUseToolControlResponse,
    type ControlCancelRequest,
    type PermissionResult,
    AbortError
} from './types'
import { getDefaultClaudeCodePath, getCleanEnv, logDebug, streamToStdin } from './utils'
import type { Writable } from 'node:stream'
import { logger } from '../../ui/logger'

export class Query implements AsyncIterableIterator<SDKMessage> {
    private pendingControlResponses = new Map<string, ControlResponseHandler>()
    private cancelControllers = new Map<string, AbortController>()
    private sdkMessages: AsyncIterableIterator<SDKMessage>
    private inputStream = new Stream<SDKMessage>()
    private canCallTool?: CanCallToolCallback

    constructor(
        private childStdin: Writable | null,
        private childStdout: NodeJS.ReadableStream,
        private processExitPromise: Promise<void>,
        canCallTool?: CanCallToolCallback
    ) {
        this.canCallTool = canCallTool
        this.readMessages()
        this.sdkMessages = this.readSdkMessages()
    }

    setError(error: Error): void {
        this.inputStream.error(error)
    }

    next(...args: [] | [undefined]): Promise<IteratorResult<SDKMessage>> {
        return this.sdkMessages.next(...args)
    }

    return(value?: any): Promise<IteratorResult<SDKMessage>> {
        if (this.sdkMessages.return) return this.sdkMessages.return(value)
        return Promise.resolve({ done: true, value: undefined })
    }

    throw(e: any): Promise<IteratorResult<SDKMessage>> {
        if (this.sdkMessages.throw) return this.sdkMessages.throw(e)
        return Promise.reject(e)
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<SDKMessage> {
        return this.sdkMessages
    }

    private async readMessages(): Promise<void> {
        const rl = createInterface({ input: this.childStdout })
        try {
            for await (const line of rl) {
                if (line.trim()) {
                    try {
                        const message = JSON.parse(line) as SDKMessage | SDKControlResponse
                        if (message.type === 'control_response') {
                            const controlResponse = message as SDKControlResponse
                            const handler = this.pendingControlResponses.get(controlResponse.response.request_id)
                            if (handler) handler(controlResponse.response)
                            continue
                        } else if (message.type === 'control_request') {
                            await this.handleControlRequest(message as unknown as CanUseToolControlRequest)
                            continue
                        } else if (message.type === 'control_cancel_request') {
                            this.handleControlCancelRequest(message as unknown as ControlCancelRequest)
                            continue
                        }
                        this.inputStream.enqueue(message)
                    } catch (e) {
                        logger.debug(line)
                    }
                }
            }
            await this.processExitPromise
        } catch (error) {
            this.inputStream.error(error as Error)
        } finally {
            this.inputStream.done()
            this.cleanupControllers()
            rl.close()
        }
    }

    private async *readSdkMessages(): AsyncIterableIterator<SDKMessage> {
        for await (const message of this.inputStream) {
            yield message
        }
    }

    async interrupt(): Promise<void> {
        if (!this.childStdin) throw new Error('Interrupt requires --input-format stream-json')
        await this.request({ subtype: 'interrupt' }, this.childStdin)
    }

    private request(request: ControlRequest, childStdin: Writable): Promise<SDKControlResponse['response']> {
        const requestId = Math.random().toString(36).substring(2, 15)
        const sdkRequest: SDKControlRequest = {
            request_id: requestId,
            type: 'control_request',
            request
        }
        return new Promise((resolve, reject) => {
            this.pendingControlResponses.set(requestId, (response) => {
                if (response.subtype === 'success') resolve(response)
                else reject(new Error(response.error))
            })
            childStdin.write(JSON.stringify(sdkRequest) + '\n')
        })
    }

    private async handleControlRequest(request: CanUseToolControlRequest): Promise<void> {
        if (!this.childStdin) return
        const controller = new AbortController()
        this.cancelControllers.set(request.request_id, controller)

        try {
            const response = await this.processControlRequest(request, controller.signal)
            const controlResponse: CanUseToolControlResponse = {
                type: 'control_response',
                response: {
                    subtype: 'success',
                    request_id: request.request_id,
                    response
                }
            }
            this.childStdin.write(JSON.stringify(controlResponse) + '\n')
        } catch (error) {
            const controlErrorResponse: CanUseToolControlResponse = {
                type: 'control_response',
                response: {
                    subtype: 'error',
                    request_id: request.request_id,
                    error: error instanceof Error ? error.message : String(error)
                }
            }
            this.childStdin.write(JSON.stringify(controlErrorResponse) + '\n')
        } finally {
            this.cancelControllers.delete(request.request_id)
        }
    }

    private handleControlCancelRequest(request: ControlCancelRequest): void {
        const controller = this.cancelControllers.get(request.request_id)
        if (controller) {
            controller.abort()
            this.cancelControllers.delete(request.request_id)
        }
    }

    private async processControlRequest(request: CanUseToolControlRequest, signal: AbortSignal): Promise<PermissionResult> {
        if (request.request.subtype === 'can_use_tool') {
            if (!this.canCallTool) throw new Error('canCallTool callback is not provided.')
            return this.canCallTool(request.request.tool_name, request.request.input, { signal })
        }
        throw new Error('Unsupported control request subtype: ' + request.request.subtype)
    }

    private cleanupControllers(): void {
        for (const [requestId, controller] of this.cancelControllers.entries()) {
            controller.abort()
            this.cancelControllers.delete(requestId)
        }
    }
}

export function query(config: {
    prompt: QueryPrompt
    options?: QueryOptions
}): Query {
    const {
        prompt,
        options: {
            allowedTools = [],
            appendSystemPrompt,
            customSystemPrompt,
            cwd,
            disallowedTools = [],
            executable = 'node',
            executableArgs = [],
            maxTurns,
            mcpServers,
            pathToClaudeCodeExecutable = getDefaultClaudeCodePath(),
            permissionMode = 'default',
            continue: continueConversation,
            resume,
            model,
            fallbackModel,
            strictMcpConfig,
            canCallTool,
            settingsPath
        } = {}
    } = config

    if (!process.env.CLAUDE_CODE_ENTRYPOINT) {
        process.env.CLAUDE_CODE_ENTRYPOINT = 'consortium-relay'
    }

    const args = ['--output-format', 'stream-json', '--verbose']

    if (customSystemPrompt) args.push('--system-prompt', customSystemPrompt)
    if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt)
    if (maxTurns) args.push('--max-turns', maxTurns.toString())
    if (model) args.push('--model', model)
    if (canCallTool) {
        if (typeof prompt === 'string') {
            throw new Error('canCallTool callback requires --input-format stream-json')
        }
        args.push('--permission-prompt-tool', 'stdio')
    }
    if (continueConversation) args.push('--continue')
    if (resume) args.push('--resume', resume)
    if (allowedTools.length > 0) args.push('--allowedTools', allowedTools.join(','))
    if (disallowedTools.length > 0) args.push('--disallowedTools', disallowedTools.join(','))
    if (mcpServers && Object.keys(mcpServers).length > 0) {
        args.push('--mcp-config', JSON.stringify({ mcpServers }))
    }
    if (strictMcpConfig) args.push('--strict-mcp-config')
    if (permissionMode) args.push('--permission-mode', permissionMode)
    if (settingsPath) args.push('--settings', settingsPath)
    if (fallbackModel) {
        if (model && fallbackModel === model) {
            throw new Error('Fallback model cannot be the same as the main model.')
        }
        args.push('--fallback-model', fallbackModel)
    }

    if (typeof prompt === 'string') {
        args.push('--print', prompt.trim())
    } else {
        args.push('--input-format', 'stream-json')
    }

    const isJsFile = pathToClaudeCodeExecutable.endsWith('.js') || pathToClaudeCodeExecutable.endsWith('.cjs')
    const isCommandOnly = pathToClaudeCodeExecutable === 'claude'

    if (!isCommandOnly && !existsSync(pathToClaudeCodeExecutable)) {
        throw new ReferenceError(`Claude Code executable not found at ${pathToClaudeCodeExecutable}`)
    }

    const spawnCommand = isJsFile ? executable : pathToClaudeCodeExecutable
    const spawnArgs = isJsFile
        ? [...executableArgs, pathToClaudeCodeExecutable, ...args]
        : args

    const spawnEnv = isCommandOnly ? getCleanEnv() : process.env
    logDebug(`Spawning Claude Code: ${spawnCommand} ${spawnArgs.join(' ')}`)

    const child = spawn(spawnCommand, spawnArgs, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        signal: config.options?.abort,
        env: spawnEnv,
        shell: !isJsFile && process.platform === 'win32'
    }) as ChildProcessWithoutNullStreams

    let childStdin: Writable | null = null
    if (typeof prompt === 'string') {
        child.stdin.end()
    } else {
        streamToStdin(prompt, child.stdin, config.options?.abort)
        childStdin = child.stdin
    }

    if (process.env.DEBUG) {
        child.stderr.on('data', (data) => {
            console.error('Claude Code stderr:', data.toString())
        })
    }

    const cleanup = () => {
        if (!child.killed) child.kill('SIGTERM')
    }

    config.options?.abort?.addEventListener('abort', cleanup)
    process.on('exit', cleanup)

    const processExitPromise = new Promise<void>((resolve) => {
        child.on('close', (code) => {
            if (config.options?.abort?.aborted) {
                queryInstance.setError(new AbortError('Claude Code process aborted by user'))
            }
            if (code !== 0) {
                queryInstance.setError(new Error(`Claude Code process exited with code ${code}`))
            } else {
                resolve()
            }
        })
    })

    const queryInstance = new Query(childStdin, child.stdout, processExitPromise, canCallTool)

    child.on('error', (error) => {
        if (config.options?.abort?.aborted) {
            queryInstance.setError(new AbortError('Claude Code process aborted by user'))
        } else {
            queryInstance.setError(new Error(`Failed to spawn Claude Code: ${error.message}`))
        }
    })

    processExitPromise.finally(() => {
        cleanup()
        config.options?.abort?.removeEventListener('abort', cleanup)
    })

    return queryInstance
}
