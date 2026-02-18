import { log } from "../../../utils/log";
import { Socket } from "socket.io";

export function rpcHandler(userId: string, socket: Socket, rpcListeners: Map<string, Socket>) {
    socket.on('rpc-register', async (data: any) => {
        try {
            const { method } = data;
            if (!method || typeof method !== 'string') {
                socket.emit('rpc-error', { type: 'register', error: 'Invalid method name' });
                return;
            }
            rpcListeners.set(method, socket);
            socket.emit('rpc-registered', { method });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in rpc-register: ${error}`);
            socket.emit('rpc-error', { type: 'register', error: 'Internal error' });
        }
    });

    socket.on('rpc-unregister', async (data: any) => {
        try {
            const { method } = data;
            if (!method || typeof method !== 'string') {
                socket.emit('rpc-error', { type: 'unregister', error: 'Invalid method name' });
                return;
            }
            if (rpcListeners.get(method) === socket) {
                rpcListeners.delete(method);
                if (rpcListeners.size === 0) {
                    rpcListeners.delete(userId);
                }
            }
            socket.emit('rpc-unregistered', { method });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in rpc-unregister: ${error}`);
            socket.emit('rpc-error', { type: 'unregister', error: 'Internal error' });
        }
    });

    socket.on('rpc-call', async (data: any, callback: (response: any) => void) => {
        try {
            const { method, params } = data;
            if (!method || typeof method !== 'string') {
                if (callback) callback({ ok: false, error: 'Invalid parameters: method is required' });
                return;
            }

            const targetSocket = rpcListeners.get(method);
            if (!targetSocket || !targetSocket.connected) {
                if (callback) callback({ ok: false, error: 'RPC method not available' });
                return;
            }

            if (targetSocket === socket) {
                if (callback) callback({ ok: false, error: 'Cannot call RPC on the same socket' });
                return;
            }

            try {
                const response = await targetSocket.timeout(30000).emitWithAck('rpc-request', { method, params });
                if (callback) callback({ ok: true, result: response });
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'RPC call failed';
                if (callback) callback({ ok: false, error: errorMsg });
            }
        } catch (error) {
            if (callback) callback({ ok: false, error: 'Internal error' });
        }
    });

    socket.on('disconnect', () => {
        const methodsToRemove: string[] = [];
        for (const [method, registeredSocket] of rpcListeners.entries()) {
            if (registeredSocket === socket) {
                methodsToRemove.push(method);
            }
        }
        methodsToRemove.forEach(method => rpcListeners.delete(method));
        if (rpcListeners.size === 0) {
            rpcListeners.delete(userId);
        }
    });
}
