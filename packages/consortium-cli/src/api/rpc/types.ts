/**
 * Common RPC types and interfaces
 */

export type RpcHandler<TRequest = any, TResponse = any> = (
    data: TRequest
) => TResponse | Promise<TResponse>;

export type RpcHandlerMap = Map<string, RpcHandler>;

export interface RpcRequest {
    method: string;
    params: string; // Base64 encoded encrypted params
}

export type RpcResponseCallback = (response: string) => void;

export interface RpcHandlerConfig {
    scopePrefix: string;
    encryptionKey: Uint8Array;
    encryptionVariant: 'legacy' | 'dataKey';
    logger?: (message: string, data?: any) => void;
}
