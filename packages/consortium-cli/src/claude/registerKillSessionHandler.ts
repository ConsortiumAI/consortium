/**
 * RPC handler for remote session termination
 */

import { RpcHandlerManager } from "../api/rpc/RpcHandlerManager";
import { logger } from "../ui/logger";

export function registerKillSessionHandler(
    rpcHandlerManager: RpcHandlerManager,
    killThisConsortium: () => Promise<void>
) {
    rpcHandlerManager.registerHandler('killSession', async () => {
        logger.debug('Kill session request received');
        void killThisConsortium();
        return {
            success: true,
            message: 'Killing consortium-cli process'
        };
    });
}
