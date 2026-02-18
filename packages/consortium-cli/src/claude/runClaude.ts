/**
 * Main Claude orchestration - stripped version
 * Removed: local mode, daemon, MCP server, hook server, caffeinate, SDK metadata extraction
 */

import os from 'node:os';
import { randomUUID } from 'node:crypto';

import { ApiClient } from '../api/api';
import { logger } from '../ui/logger';
import { loop } from './loop';
import { AgentState, Metadata } from '../api/types';
import { Credentials } from '../persistence';
import { EnhancedMode, PermissionMode } from './loop';
import { MessageQueue2 } from '../utils/MessageQueue2';
import { hashObject } from '../utils/deterministicJson';
import { configuration } from '../configuration';
import { registerKillSessionHandler } from './registerKillSessionHandler';
import { Session } from './session';

export interface StartOptions {
    model?: string
    permissionMode?: PermissionMode
    claudeEnvVars?: Record<string, string>
    claudeArgs?: string[]
}

export async function runClaude(credentials: Credentials, machineId: string, options: StartOptions = {}): Promise<void> {
    logger.debug(`[CLAUDE] ===== RELAY MODE STARTING =====`);

    const workingDirectory = process.cwd();
    const sessionTag = randomUUID();

    // Create session service
    const api = await ApiClient.create(credentials);

    // Create a new session
    let state: AgentState = {};

    let metadata: Metadata = {
        path: workingDirectory,
        host: os.hostname(),
        os: os.platform(),
        machineId: machineId,
        homeDir: os.homedir(),
        consortiumHomeDir: configuration.consortiumHomeDir,
        consortiumLibDir: process.cwd(),
        consortiumToolsDir: process.cwd(),
        startedBy: 'terminal',
        lifecycleState: 'running',
        lifecycleStateSince: Date.now(),
        flavor: 'claude'
    };

    const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });

    if (!response) {
        console.error('Failed to create session. Is the server running?');
        process.exit(1);
    }

    logger.debug(`Session created: ${response.id}`);

    // Create realtime session
    const session = api.sessionSyncClient(response);

    // Variable to track current session instance
    let currentSession: Session | null = null;

    // Print log file path
    const logPath = logger.logFilePath;
    logger.infoDeveloper(`Session: ${response.id}`);
    logger.infoDeveloper(`Logs: ${logPath}`);
    console.log(`Session: ${response.id}`);
    console.log(`Logs: ${logPath}`);

    // Set initial agent state
    session.updateAgentState((currentState) => ({
        ...currentState,
        controlledByUser: false // remote mode
    }));

    // Create message queue
    const messageQueue = new MessageQueue2<EnhancedMode>(mode => hashObject({
        isPlan: mode.permissionMode === 'plan',
        model: mode.model,
        fallbackModel: mode.fallbackModel,
        customSystemPrompt: mode.customSystemPrompt,
        appendSystemPrompt: mode.appendSystemPrompt,
        allowedTools: mode.allowedTools,
        disallowedTools: mode.disallowedTools
    }));

    // Forward messages to the queue
    let currentPermissionMode: PermissionMode | undefined = options.permissionMode;
    let currentModel = options.model;
    let currentFallbackModel: string | undefined = undefined;
    let currentCustomSystemPrompt: string | undefined = undefined;
    let currentAppendSystemPrompt: string | undefined = undefined;
    let currentAllowedTools: string[] | undefined = undefined;
    let currentDisallowedTools: string[] | undefined = undefined;
    let hasStoredFirstMessage = false;

    session.onUserMessage((message) => {
        // Store first user message in metadata
        if (!hasStoredFirstMessage && message.content.text) {
            hasStoredFirstMessage = true;
            session.updateMetadata((m) => ({
                ...m,
                firstMessage: message.content.text.substring(0, 100)
            }));
        }

        // Resolve permission mode from meta
        let messagePermissionMode: PermissionMode | undefined = currentPermissionMode;
        if (message.meta?.permissionMode) {
            messagePermissionMode = message.meta.permissionMode;
            currentPermissionMode = messagePermissionMode;
        }

        // Resolve model
        let messageModel = currentModel;
        if (message.meta?.hasOwnProperty('model')) {
            messageModel = message.meta.model || undefined;
            currentModel = messageModel;
        }

        // Resolve custom system prompt
        let messageCustomSystemPrompt = currentCustomSystemPrompt;
        if (message.meta?.hasOwnProperty('customSystemPrompt')) {
            messageCustomSystemPrompt = message.meta.customSystemPrompt || undefined;
            currentCustomSystemPrompt = messageCustomSystemPrompt;
        }

        // Resolve fallback model
        let messageFallbackModel = currentFallbackModel;
        if (message.meta?.hasOwnProperty('fallbackModel')) {
            messageFallbackModel = message.meta.fallbackModel || undefined;
            currentFallbackModel = messageFallbackModel;
        }

        // Resolve append system prompt
        let messageAppendSystemPrompt = currentAppendSystemPrompt;
        if (message.meta?.hasOwnProperty('appendSystemPrompt')) {
            messageAppendSystemPrompt = message.meta.appendSystemPrompt || undefined;
            currentAppendSystemPrompt = messageAppendSystemPrompt;
        }

        // Resolve allowed tools
        let messageAllowedTools = currentAllowedTools;
        if (message.meta?.hasOwnProperty('allowedTools')) {
            messageAllowedTools = message.meta.allowedTools || undefined;
            currentAllowedTools = messageAllowedTools;
        }

        // Resolve disallowed tools
        let messageDisallowedTools = currentDisallowedTools;
        if (message.meta?.hasOwnProperty('disallowedTools')) {
            messageDisallowedTools = message.meta.disallowedTools || undefined;
            currentDisallowedTools = messageDisallowedTools;
        }

        // Handle /compact and /clear as isolated messages
        const trimmed = message.content.text.trim();
        if (trimmed === '/clear' || trimmed.startsWith('/compact')) {
            const enhancedMode: EnhancedMode = {
                permissionMode: messagePermissionMode || 'default',
                model: messageModel,
                fallbackModel: messageFallbackModel,
                customSystemPrompt: messageCustomSystemPrompt,
                appendSystemPrompt: messageAppendSystemPrompt,
                allowedTools: messageAllowedTools,
                disallowedTools: messageDisallowedTools
            };
            messageQueue.pushIsolateAndClear(message.content.text, enhancedMode);
            return;
        }

        // Push normal message
        const enhancedMode: EnhancedMode = {
            permissionMode: messagePermissionMode || 'default',
            model: messageModel,
            fallbackModel: messageFallbackModel,
            customSystemPrompt: messageCustomSystemPrompt,
            appendSystemPrompt: messageAppendSystemPrompt,
            allowedTools: messageAllowedTools,
            disallowedTools: messageDisallowedTools
        };
        messageQueue.push(message.content.text, enhancedMode);
        logger.debug('User message pushed to queue');
    });

    // Setup signal handlers for graceful shutdown
    const cleanup = async () => {
        logger.debug('[START] Received termination signal, cleaning up...');
        try {
            if (session) {
                session.updateMetadata((currentMetadata) => ({
                    ...currentMetadata,
                    lifecycleState: 'archived',
                    lifecycleStateSince: Date.now(),
                    archivedBy: 'cli',
                    archiveReason: 'User terminated'
                }));
                currentSession?.cleanup();
                session.sendSessionDeath();
                await session.flush();
                await session.close();
            }
            logger.debug('[START] Cleanup complete, exiting');
            process.exit(0);
        } catch (error) {
            logger.debug('[START] Error during cleanup:', error);
            process.exit(1);
        }
    };

    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('uncaughtException', (error) => {
        logger.debug('[START] Uncaught exception:', error);
        cleanup();
    });
    process.on('unhandledRejection', (reason) => {
        logger.debug('[START] Unhandled rejection:', reason);
        cleanup();
    });

    registerKillSessionHandler(session.rpcHandlerManager, cleanup);

    // Create claude loop
    const exitCode = await loop({
        path: workingDirectory,
        model: options.model,
        permissionMode: options.permissionMode,
        messageQueue,
        api,
        allowedTools: [],
        onModeChange: (newMode) => {
            session.sendSessionEvent({ type: 'switch', mode: newMode });
            session.updateAgentState((currentState) => ({
                ...currentState,
                controlledByUser: newMode === 'local'
            }));
        },
        onSessionReady: (sessionInstance) => {
            currentSession = sessionInstance;
        },
        mcpServers: {},
        session,
        claudeEnvVars: options.claudeEnvVars,
        claudeArgs: options.claudeArgs,
    });

    // Cleanup
    (currentSession as Session | null)?.cleanup();
    session.sendSessionDeath();
    await session.flush();
    await session.close();

    process.exit(exitCode);
}
