/**
 * Generic RPC handler manager for session clients
 * Manages method registration, encryption/decryption, and handler execution
 */

import { logger as defaultLogger } from '../../ui/logger';
import { decodeBase64, encodeBase64, encrypt, decrypt } from '../encryption';
import {
    RpcHandler,
    RpcHandlerMap,
    RpcRequest,
    RpcHandlerConfig,
} from './types';
import { Socket } from 'socket.io-client';

export class RpcHandlerManager {
    private handlers: RpcHandlerMap = new Map();
    private readonly scopePrefix: string;
    private readonly encryptionKey: Uint8Array;
    private readonly encryptionVariant: 'legacy' | 'dataKey';
    private readonly logger: (message: string, data?: any) => void;
    private socket: Socket | null = null;

    constructor(config: RpcHandlerConfig) {
        this.scopePrefix = config.scopePrefix;
        this.encryptionKey = config.encryptionKey;
        this.encryptionVariant = config.encryptionVariant;
        this.logger = config.logger || ((msg, data) => defaultLogger.debug(msg, data));
    }

    registerHandler<TRequest = any, TResponse = any>(
        method: string,
        handler: RpcHandler<TRequest, TResponse>
    ): void {
        const prefixedMethod = this.getPrefixedMethod(method);
        this.handlers.set(prefixedMethod, handler);
        if (this.socket) {
            this.socket.emit('rpc-register', { method: prefixedMethod });
        }
    }

    async handleRequest(request: RpcRequest): Promise<any> {
        try {
            const handler = this.handlers.get(request.method);
            if (!handler) {
                const errorResponse = { error: 'Method not found' };
                return encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, errorResponse));
            }

            const decryptedParams = decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(request.params));
            const result = await handler(decryptedParams);
            return encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, result));
        } catch (error) {
            const errorResponse = {
                error: error instanceof Error ? error.message : 'Unknown error'
            };
            return encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, errorResponse));
        }
    }

    onSocketConnect(socket: Socket): void {
        this.socket = socket;
        for (const [prefixedMethod] of this.handlers) {
            socket.emit('rpc-register', { method: prefixedMethod });
        }
    }

    onSocketDisconnect(): void {
        this.socket = null;
    }

    getHandlerCount(): number {
        return this.handlers.size;
    }

    hasHandler(method: string): boolean {
        return this.handlers.has(this.getPrefixedMethod(method));
    }

    clearHandlers(): void {
        this.handlers.clear();
    }

    private getPrefixedMethod(method: string): string {
        return `${this.scopePrefix}:${method}`;
    }
}
