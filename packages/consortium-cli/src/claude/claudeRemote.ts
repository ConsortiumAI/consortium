/**
 * Core relay: SDK integration + message streaming via query()
 * Stripped: removed parseSpecialCommand, claudeCheckSession, awaitFileExist
 */

import { EnhancedMode } from "./loop";
import { query, type QueryOptions, type SDKMessage, type SDKSystemMessage, AbortError, SDKUserMessage } from './sdk'
import { logger } from "../ui/logger";
import { PushableAsyncIterable } from "../utils/PushableAsyncIterable";
import { getDefaultClaudeCodePath } from "./sdk/utils";
import { PermissionResult } from "./sdk/types";

/**
 * Map permission modes to Claude-compatible modes
 */
function mapToClaudeMode(mode: string): 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' {
    switch (mode) {
        case 'yolo':
        case 'bypassPermissions':
            return 'bypassPermissions';
        case 'plan':
            return 'plan';
        case 'acceptEdits':
            return 'acceptEdits';
        default:
            return 'default';
    }
}

export async function claudeRemote(opts: {
    sessionId: string | null,
    path: string,
    mcpServers?: Record<string, any>,
    claudeEnvVars?: Record<string, string>,
    claudeArgs?: string[],
    allowedTools: string[],
    signal?: AbortSignal,
    canCallTool: (toolName: string, input: unknown, mode: EnhancedMode, options: { signal: AbortSignal }) => Promise<PermissionResult>,

    nextMessage: () => Promise<{ message: string, mode: EnhancedMode } | null>,
    onReady: () => void,
    isAborted: (toolCallId: string) => boolean,

    onSessionFound: (id: string) => void,
    onThinkingChange?: (thinking: boolean) => void,
    onMessage: (message: SDKMessage) => void,
    onCompletionEvent?: (message: string) => void,
    onSessionReset?: () => void
}) {
    let startFrom = opts.sessionId;

    // Extract --resume from claudeArgs if present
    if (!startFrom && opts.claudeArgs) {
        for (let i = 0; i < opts.claudeArgs.length; i++) {
            if (opts.claudeArgs[i] === '--resume') {
                if (i + 1 < opts.claudeArgs.length) {
                    const nextArg = opts.claudeArgs[i + 1];
                    if (!nextArg.startsWith('-') && nextArg.includes('-')) {
                        startFrom = nextArg;
                        logger.debug(`[claudeRemote] Found --resume with session ID: ${startFrom}`);
                        break;
                    }
                }
                break;
            }
        }
    }

    // Set environment variables for Claude Code SDK
    if (opts.claudeEnvVars) {
        Object.entries(opts.claudeEnvVars).forEach(([key, value]) => {
            process.env[key] = value;
        });
    }

    // Get initial message
    const initial = await opts.nextMessage();
    if (!initial) return;

    // Handle /clear command
    if (initial.message.trim() === '/clear') {
        if (opts.onCompletionEvent) opts.onCompletionEvent('Context was reset');
        if (opts.onSessionReset) opts.onSessionReset();
        return;
    }

    // Handle /compact command
    let isCompactCommand = initial.message.trim().startsWith('/compact');
    if (isCompactCommand && opts.onCompletionEvent) {
        opts.onCompletionEvent('Compaction started');
    }

    // Prepare SDK options
    let mode = initial.mode;
    const sdkOptions: QueryOptions = {
        cwd: opts.path,
        resume: startFrom ?? undefined,
        mcpServers: opts.mcpServers,
        permissionMode: mapToClaudeMode(initial.mode.permissionMode),
        model: initial.mode.model,
        fallbackModel: initial.mode.fallbackModel,
        customSystemPrompt: initial.mode.customSystemPrompt,
        appendSystemPrompt: initial.mode.appendSystemPrompt,
        allowedTools: initial.mode.allowedTools ? initial.mode.allowedTools.concat(opts.allowedTools) : opts.allowedTools,
        disallowedTools: initial.mode.disallowedTools,
        canCallTool: (toolName: string, input: unknown, options: { signal: AbortSignal }) => opts.canCallTool(toolName, input, mode, options),
        executable: 'node',
        abort: opts.signal,
        pathToClaudeCodeExecutable: getDefaultClaudeCodePath(),
    }

    // Track thinking state
    let thinking = false;
    const updateThinking = (newThinking: boolean) => {
        if (thinking !== newThinking) {
            thinking = newThinking;
            if (opts.onThinkingChange) opts.onThinkingChange(thinking);
        }
    };

    // Push initial message
    let messages = new PushableAsyncIterable<SDKUserMessage>();
    messages.push({
        type: 'user',
        message: { role: 'user', content: initial.message },
    });

    // Start the loop
    const response = query({
        prompt: messages,
        options: sdkOptions,
    });

    updateThinking(true);
    try {
        for await (const message of response) {
            opts.onMessage(message);

            if (message.type === 'system' && message.subtype === 'init') {
                updateThinking(true);
                const systemInit = message as SDKSystemMessage;
                if (systemInit.session_id) {
                    opts.onSessionFound(systemInit.session_id);
                }
            }

            if (message.type === 'result') {
                updateThinking(false);

                if (isCompactCommand) {
                    if (opts.onCompletionEvent) opts.onCompletionEvent('Compaction completed');
                    isCompactCommand = false;
                }

                opts.onReady();

                const next = await opts.nextMessage();
                if (!next) {
                    messages.end();
                    return;
                }
                mode = next.mode;
                messages.push({ type: 'user', message: { role: 'user', content: next.message } });
            }

            if (message.type === 'user') {
                const msg = message as SDKUserMessage;
                if (msg.message.role === 'user' && Array.isArray(msg.message.content)) {
                    for (let c of msg.message.content) {
                        if (c.type === 'tool_result' && c.tool_use_id && opts.isAborted(c.tool_use_id)) {
                            return;
                        }
                    }
                }
            }
        }
    } catch (e) {
        if (e instanceof AbortError) {
            logger.debug(`[claudeRemote] Aborted`);
        } else {
            throw e;
        }
    } finally {
        updateThinking(false);
    }
}
