/**
 * HTTP API client for relay server
 *
 * Handles session CRUD with E2EE: metadata and messages are encrypted
 * client-side before transmission.
 */

import type { Credentials } from './auth';
import {
  decodeBase64,
  decrypt,
  decryptBox,
  encrypt,
  encodeBase64,
  getRandomBytes,
} from './encryption';
import sodium from 'libsodium-wrappers';

export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || window.location.origin;

// --- Types ---

export interface RawSession {
  id: string;
  seq: number;
  metadata: string; // base64 encrypted
  metadataVersion: number;
  agentState: string | null;
  agentStateVersion: number;
  dataEncryptionKey: string | null; // base64 encrypted DEK
  active: boolean;
  activeAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface SessionMetadata {
  path?: string;
  host?: string;
  os?: string;
  machineId?: string;
  firstMessage?: string;
  lifecycleState?: string;
  lifecycleStateSince?: number;
  flavor?: string;
  summary?: { text: string; updatedAt: number };
  [key: string]: unknown;
}

export interface DecryptedSession {
  id: string;
  seq: number;
  metadata: SessionMetadata | null;
  metadataVersion: number;
  agentState: Record<string, unknown> | null;
  agentStateVersion: number;
  encryptionKey: Uint8Array;
  encryptionVariant: 'legacy' | 'dataKey';
  active: boolean;
  activeAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface RawMessage {
  id: string;
  seq: number;
  content: { t: string; c?: string; [key: string]: unknown };
  localId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MessageContent {
  role: 'user' | 'agent';
  content:
    | { type: 'text'; text: string }
    | { type: 'output'; data: unknown }
    | { type: 'event'; id?: string; data: unknown };
  meta?: { sentFrom?: string; permissionMode?: string; [key: string]: unknown };
}

// --- Session encryption key resolution ---

function resolveSessionKey(
  rawDek: string | null,
  credentials: Credentials,
): { key: Uint8Array; variant: 'legacy' | 'dataKey' } {
  if (rawDek && credentials.encryption.type === 'dataKey') {
    const dekBundle = decodeBase64(rawDek);
    // First byte is version (0x00)
    const encryptedDek = dekBundle.slice(1);
    const key = decryptBox(encryptedDek, credentials.encryption.privateKey);
    if (key) {
      return { key, variant: 'dataKey' };
    }
  }
  if (credentials.encryption.type === 'legacy') {
    return { key: credentials.encryption.secret, variant: 'legacy' };
  }
  // Fallback: try treating secret as legacy key
  return { key: credentials.secret, variant: 'legacy' };
}

// --- API methods ---

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchSessions(
  credentials: Credentials,
): Promise<DecryptedSession[]> {
  const res = await fetch(`${SERVER_URL}/v1/sessions`, {
    headers: authHeaders(credentials.token),
  });
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);

  const data = await res.json();
  const sessions: DecryptedSession[] = [];

  for (const raw of data.sessions as RawSession[]) {
    try {
      const { key, variant } = resolveSessionKey(
        raw.dataEncryptionKey,
        credentials,
      );
      const metadata = raw.metadata
        ? ((await decrypt(key, variant, decodeBase64(raw.metadata))) as SessionMetadata | null)
        : null;
      const agentState = raw.agentState
        ? ((await decrypt(key, variant, decodeBase64(raw.agentState))) as Record<string, unknown> | null)
        : null;

      sessions.push({
        id: raw.id,
        seq: raw.seq,
        metadata,
        metadataVersion: raw.metadataVersion,
        agentState,
        agentStateVersion: raw.agentStateVersion,
        encryptionKey: key,
        encryptionVariant: variant,
        active: raw.active,
        activeAt: raw.activeAt,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      });
    } catch (err) {
      console.warn('Failed to decrypt session:', raw.id, err);
    }
  }

  return sessions;
}

export async function fetchMessages(
  credentials: Credentials,
  session: DecryptedSession,
): Promise<MessageContent[]> {
  const res = await fetch(
    `${SERVER_URL}/v1/sessions/${session.id}/messages`,
    { headers: authHeaders(credentials.token) },
  );
  if (!res.ok) throw new Error(`Failed to fetch messages: ${res.status}`);

  const data = await res.json();
  const messages: MessageContent[] = [];

  for (const raw of (data.messages as RawMessage[]).reverse()) {
    if (raw.content?.t === 'encrypted' && raw.content.c) {
      try {
        const decrypted = await decrypt(
          session.encryptionKey,
          session.encryptionVariant,
          decodeBase64(raw.content.c as string),
        );
        if (decrypted) {
          messages.push(decrypted as MessageContent);
        }
      } catch {
        // Skip undecryptable messages
      }
    }
  }

  return messages;
}

export async function deleteSession(
  credentials: Credentials,
  sessionId: string,
): Promise<void> {
  const res = await fetch(`${SERVER_URL}/v1/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: authHeaders(credentials.token),
  });
  if (!res.ok) throw new Error(`Failed to delete session: ${res.status}`);
}
