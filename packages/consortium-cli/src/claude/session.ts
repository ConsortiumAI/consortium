/**
 * Session tracking, message queue, heartbeat
 */

import { ApiClient } from "../api/api";
import { ApiSessionClient } from "../api/apiSession";
import { MessageQueue2 } from "../utils/MessageQueue2";
import { EnhancedMode } from "./loop";
import { logger } from "../ui/logger";

export class Session {
    readonly path: string;
    readonly logPath: string;
    readonly api: ApiClient;
    readonly client: ApiSessionClient;
    readonly queue: MessageQueue2<EnhancedMode>;
    readonly claudeEnvVars?: Record<string, string>;
    claudeArgs?: string[];
    readonly mcpServers: Record<string, any>;
    readonly allowedTools?: string[];
    readonly _onModeChange: (mode: 'local' | 'remote') => void;

    sessionId: string | null;
    mode: 'local' | 'remote' = 'remote';
    thinking: boolean = false;

    private sessionFoundCallbacks: ((sessionId: string) => void)[] = [];
    private keepAliveInterval: NodeJS.Timeout;

    constructor(opts: {
        api: ApiClient,
        client: ApiSessionClient,
        path: string,
        logPath: string,
        sessionId: string | null,
        claudeEnvVars?: Record<string, string>,
        claudeArgs?: string[],
        mcpServers: Record<string, any>,
        messageQueue: MessageQueue2<EnhancedMode>,
        onModeChange: (mode: 'local' | 'remote') => void,
        allowedTools?: string[],
    }) {
        this.path = opts.path;
        this.api = opts.api;
        this.client = opts.client;
        this.logPath = opts.logPath;
        this.sessionId = opts.sessionId;
        this.queue = opts.messageQueue;
        this.claudeEnvVars = opts.claudeEnvVars;
        this.claudeArgs = opts.claudeArgs;
        this.mcpServers = opts.mcpServers;
        this.allowedTools = opts.allowedTools;
        this._onModeChange = opts.onModeChange;

        // Start keep alive
        this.client.keepAlive(this.thinking, this.mode);
        this.keepAliveInterval = setInterval(() => {
            this.client.keepAlive(this.thinking, this.mode);
        }, 2000);
    }

    cleanup = (): void => {
        clearInterval(this.keepAliveInterval);
        this.sessionFoundCallbacks = [];
        logger.debug('[Session] Cleaned up resources');
    }

    onThinkingChange = (thinking: boolean) => {
        this.thinking = thinking;
        this.client.keepAlive(thinking, this.mode);
    }

    onModeChange = (mode: 'local' | 'remote') => {
        this.mode = mode;
        this.client.keepAlive(this.thinking, mode);
        this._onModeChange(mode);
    }

    onSessionFound = (sessionId: string) => {
        this.sessionId = sessionId;
        this.client.updateMetadata((metadata) => ({
            ...metadata,
            claudeSessionId: sessionId
        }));
        logger.debug(`[Session] Claude Code session ID ${sessionId} added to metadata`);
        for (const callback of this.sessionFoundCallbacks) {
            callback(sessionId);
        }
    }

    addSessionFoundCallback = (callback: (sessionId: string) => void): void => {
        this.sessionFoundCallbacks.push(callback);
    }

    clearSessionId = (): void => {
        this.sessionId = null;
        logger.debug('[Session] Session ID cleared');
    }

    consumeOneTimeFlags = (): void => {
        if (!this.claudeArgs) return;

        const filteredArgs: string[] = [];
        for (let i = 0; i < this.claudeArgs.length; i++) {
            const arg = this.claudeArgs[i];

            if (arg === '--continue') {
                logger.debug('[Session] Consumed --continue flag');
                continue;
            }

            if (arg === '--resume') {
                if (i + 1 < this.claudeArgs.length) {
                    const nextArg = this.claudeArgs[i + 1];
                    if (!nextArg.startsWith('-') && nextArg.includes('-')) {
                        i++;
                        logger.debug(`[Session] Consumed --resume flag with session ID: ${nextArg}`);
                    } else {
                        logger.debug('[Session] Consumed --resume flag (no session ID)');
                    }
                } else {
                    logger.debug('[Session] Consumed --resume flag (no session ID)');
                }
                continue;
            }

            filteredArgs.push(arg);
        }

        this.claudeArgs = filteredArgs.length > 0 ? filteredArgs : undefined;
    }
}
