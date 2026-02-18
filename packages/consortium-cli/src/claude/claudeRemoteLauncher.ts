/**
 * Remote mode launcher - stripped of Ink UI, uses simple console output
 */

import { Session } from "./session";
import { claudeRemote } from "./claudeRemote";
import { Future } from "../utils/future";
import { SDKMessage, SDKUserMessage } from "./sdk";
import { logger } from "../ui/logger";
import { PLAN_FAKE_REJECT } from "./sdk/prompts";
import { EnhancedMode } from "./loop";
import { RawJSONLines } from "./types";
import { PermissionResult } from "./sdk/types";

export async function claudeRemoteLauncher(session: Session): Promise<'switch' | 'exit'> {
    logger.debug('[claudeRemoteLauncher] Starting remote launcher');

    // Handle abort
    let exitReason: 'switch' | 'exit' | null = null;
    let abortController: AbortController | null = null;
    let abortFuture: Future<void> | null = null;

    async function abort() {
        if (abortController && !abortController.signal.aborted) {
            abortController.abort();
        }
        await abortFuture?.promise;
    }

    async function doAbort() {
        await abort();
    }

    async function doSwitch() {
        if (!exitReason) exitReason = 'switch';
        await abort();
    }

    // RPC handlers for remote abort/switch
    session.client.rpcHandlerManager.registerHandler('abort', doAbort);
    session.client.rpcHandlerManager.registerHandler('switch', doSwitch);

    // Simple permission handler - auto-approve all tools in relay mode
    const permissionResponses = new Map<string, { approved: boolean; mode?: string; allowTools?: string[]; receivedAt?: number }>();

    function handleToolCall(toolName: string, input: unknown, mode: EnhancedMode, options: { signal: AbortSignal }): Promise<PermissionResult> {
        // In relay mode, default to allowing all tools
        return Promise.resolve({
            behavior: 'allow' as const,
            updatedInput: input as Record<string, unknown>
        });
    }

    function isAborted(toolCallId: string): boolean {
        return false;
    }

    // Handle messages - convert SDK messages to relay format and send
    function onMessage(message: SDKMessage) {
        // Convert to RawJSONLines-like format and send
        try {
            const logMessage = convertSDKMessage(message);
            if (logMessage) {
                session.client.sendClaudeSessionMessage(logMessage);
            }
        } catch (error) {
            logger.debug('[remote] Error converting message:', error);
        }
    }

    try {
        let pending: { message: string; mode: EnhancedMode } | null = null;

        while (!exitReason) {
            logger.debug('[remote]: launch');
            console.log('Waiting for messages from remote client...');

            const controller = new AbortController();
            abortController = controller;
            abortFuture = new Future<void>();
            let modeHash: string | null = null;
            let mode: EnhancedMode | null = null;

            try {
                await claudeRemote({
                    sessionId: session.sessionId,
                    path: session.path,
                    allowedTools: session.allowedTools ?? [],
                    mcpServers: session.mcpServers,
                    canCallTool: handleToolCall,
                    isAborted,
                    nextMessage: async () => {
                        if (pending) {
                            let p = pending;
                            pending = null;
                            return p;
                        }

                        let msg = await session.queue.waitForMessagesAndGetAsString(controller.signal);
                        if (msg) {
                            if ((modeHash && msg.hash !== modeHash) || msg.isolate) {
                                pending = msg;
                                return null;
                            }
                            modeHash = msg.hash;
                            mode = msg.mode;
                            return { message: msg.message, mode: msg.mode };
                        }
                        return null;
                    },
                    onSessionFound: (sessionId) => {
                        session.onSessionFound(sessionId);
                    },
                    onThinkingChange: session.onThinkingChange,
                    claudeEnvVars: session.claudeEnvVars,
                    claudeArgs: session.claudeArgs,
                    onMessage,
                    onCompletionEvent: (message: string) => {
                        logger.debug(`[remote]: Completion event: ${message}`);
                        session.client.sendSessionEvent({ type: 'message', message });
                    },
                    onSessionReset: () => {
                        session.clearSessionId();
                    },
                    onReady: () => {
                        if (!pending && session.queue.size() === 0) {
                            session.client.sendSessionEvent({ type: 'ready' });
                        }
                    },
                    signal: abortController.signal,
                });

                session.consumeOneTimeFlags();

                if (!exitReason && abortController.signal.aborted) {
                    session.client.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
                }
            } catch (e) {
                logger.debug('[remote]: launch error', e);
                if (!exitReason) {
                    session.client.sendSessionEvent({ type: 'message', message: 'Process exited unexpectedly' });
                    continue;
                }
            } finally {
                abortController = null;
                abortFuture?.resolve(undefined);
                abortFuture = null;
                modeHash = null;
                mode = null;
            }
        }
    } finally {
        if (abortFuture) abortFuture.resolve(undefined);
    }

    return exitReason || 'exit';
}

/**
 * Convert SDK messages to RawJSONLines format for relay
 */
function convertSDKMessage(message: SDKMessage): RawJSONLines | null {
    if (message.type === 'assistant') {
        return {
            type: 'assistant',
            uuid: (message as any).uuid || crypto.randomUUID(),
            message: (message as any).message
        } as any;
    }
    if (message.type === 'user') {
        return {
            type: 'user',
            uuid: (message as any).uuid || crypto.randomUUID(),
            message: (message as any).message
        } as any;
    }
    if (message.type === 'system') {
        return {
            type: 'system',
            uuid: (message as any).uuid || crypto.randomUUID(),
            ...(message as any)
        } as any;
    }
    if (message.type === 'result') {
        // Result messages indicate completion, don't need to relay as session messages
        return null;
    }
    return null;
}
