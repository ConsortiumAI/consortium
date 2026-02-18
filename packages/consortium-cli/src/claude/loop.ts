/**
 * Main control loop - remote only (no local mode)
 */

import { ApiSessionClient } from "../api/apiSession"
import { MessageQueue2 } from "../utils/MessageQueue2"
import { logger } from "../ui/logger"
import { Session } from "./session"
import { claudeRemoteLauncher } from "./claudeRemoteLauncher"
import { ApiClient } from "../api/api"

// Re-export permission mode type from api/types
export type { PermissionMode } from "../api/types"
import type { PermissionMode } from "../api/types"

export interface EnhancedMode {
    permissionMode: PermissionMode;
    model?: string;
    fallbackModel?: string;
    customSystemPrompt?: string;
    appendSystemPrompt?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
}

interface LoopOptions {
    path: string
    model?: string
    permissionMode?: PermissionMode
    onModeChange: (mode: 'local' | 'remote') => void
    mcpServers: Record<string, any>
    session: ApiSessionClient
    api: ApiClient,
    claudeEnvVars?: Record<string, string>
    claudeArgs?: string[]
    messageQueue: MessageQueue2<EnhancedMode>
    allowedTools?: string[]
    onSessionReady?: (session: Session) => void
}

export async function loop(opts: LoopOptions): Promise<number> {
    const logPath = logger.logFilePath;
    let session = new Session({
        api: opts.api,
        client: opts.session,
        path: opts.path,
        sessionId: null,
        claudeEnvVars: opts.claudeEnvVars,
        claudeArgs: opts.claudeArgs,
        mcpServers: opts.mcpServers,
        logPath: logPath,
        messageQueue: opts.messageQueue,
        allowedTools: opts.allowedTools,
        onModeChange: opts.onModeChange,
    });

    opts.onSessionReady?.(session)

    // Remote only - no local mode switching
    while (true) {
        logger.debug(`[loop] Iteration in remote mode`);
        const reason = await claudeRemoteLauncher(session);
        if (reason === 'exit') {
            return 0;
        }
        // 'switch' just continues the loop in remote mode
    }
}
