/**
 * Socket.io real-time connection for session updates and messaging
 *
 * Connects as a 'user-scoped' client to receive all session updates,
 * or as 'session-scoped' for a specific session view.
 */

import { io, Socket } from 'socket.io-client';
import { SERVER_URL, type DecryptedSession, type MessageContent } from './api';
import { decodeBase64, decrypt, encrypt, encodeBase64 } from './encryption';

export type UpdateEvent =
  | {
      type: 'new-session';
      id: string;
      metadata: string;
      metadataVersion: number;
      agentState: string | null;
      agentStateVersion: number;
      dataEncryptionKey: string | null;
      active: boolean;
      activeAt: number;
      createdAt: number;
      updatedAt: number;
    }
  | {
      type: 'update-session';
      id: string;
      metadata?: { value: string; version: number };
      agentState?: { value: string | null; version: number };
    }
  | {
      type: 'delete-session';
      sid: string;
    }
  | {
      type: 'new-message';
      sid: string;
      message: {
        id: string;
        seq: number;
        content: { t: string; c?: string };
        localId: string | null;
        createdAt: number;
        updatedAt: number;
      };
    };

export type EphemeralEvent =
  | {
      type: 'activity';
      id: string;
      active: boolean;
      activeAt: number;
      thinking: boolean;
    }
  | {
      type: 'machine-activity';
      id: string;
      active: boolean;
      activeAt: number;
    };

export interface SocketCallbacks {
  onUpdate?: (event: UpdateEvent) => void;
  onEphemeral?: (event: EphemeralEvent) => void;
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
}

export function createSocket(
  token: string,
  callbacks: SocketCallbacks,
  scope:
    | { type: 'user-scoped' }
    | { type: 'session-scoped'; sessionId: string } = { type: 'user-scoped' },
): Socket {
  const socket = io(SERVER_URL, {
    auth: {
      token,
      clientType: scope.type,
      ...(scope.type === 'session-scoped' ? { sessionId: scope.sessionId } : {}),
    },
    path: '/v1/updates',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    callbacks.onConnect?.();
  });

  socket.on('disconnect', (reason) => {
    callbacks.onDisconnect?.(reason);
  });

  socket.on('update', (data: { body?: Record<string, unknown> }) => {
    if (data.body && typeof data.body.t === 'string') {
      callbacks.onUpdate?.({ ...data.body, type: data.body.t } as unknown as UpdateEvent);
    }
  });

  socket.on('ephemeral', (data: EphemeralEvent) => {
    callbacks.onEphemeral?.(data);
  });

  return socket;
}

/**
 * Send an encrypted message to a session via socket
 */
export async function sendMessage(
  socket: Socket,
  session: DecryptedSession,
  text: string,
): Promise<void> {
  const content: MessageContent = {
    role: 'user',
    content: { type: 'text', text },
    meta: {
      sentFrom: 'web',
      permissionMode: 'default',
    },
  };

  const encrypted = encodeBase64(
    await encrypt(session.encryptionKey, session.encryptionVariant, content),
  );

  socket.emit('message', {
    sid: session.id,
    message: encrypted,
    localId: crypto.randomUUID(),
    sentFrom: 'web',
  });
}

/**
 * Send an RPC call to a session's CLI agent
 */
export async function rpcCall(
  socket: Socket,
  session: DecryptedSession,
  method: string,
  params?: unknown,
): Promise<unknown> {
  const scopedMethod = `${session.id}:${method}`;

  let encryptedParams: string | undefined;
  if (params !== undefined) {
    encryptedParams = encodeBase64(
      await encrypt(session.encryptionKey, session.encryptionVariant, params),
    );
  }

  return new Promise((resolve, reject) => {
    socket.emit(
      'rpc-call',
      { method: scopedMethod, params: encryptedParams },
      (response: { ok: boolean; result?: unknown; error?: string }) => {
        if (response.ok) {
          resolve(response.result);
        } else {
          reject(new Error(response.error || 'RPC call failed'));
        }
      },
    );
  });
}

/**
 * Decrypt an incoming new-message update event
 */
export async function decryptMessageUpdate(
  event: Extract<UpdateEvent, { type: 'new-message' }>,
  session: DecryptedSession,
): Promise<MessageContent | null> {
  if (event.message.content?.t === 'encrypted' && event.message.content.c) {
    try {
      const decrypted = await decrypt(
        session.encryptionKey,
        session.encryptionVariant,
        decodeBase64(event.message.content.c),
      );
      return decrypted as MessageContent | null;
    } catch {
      return null;
    }
  }
  return null;
}
