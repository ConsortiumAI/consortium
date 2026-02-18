/**
 * Authentication state management
 *
 * Stores credentials in localStorage. Supports two encryption modes:
 * - legacy: master secret used directly as NaCl secretbox key
 * - dataKey: per-session AES-256-GCM keys, unwrapped with box keypair
 */

import sodium from 'libsodium-wrappers';
import {
  initEncryption,
  authChallenge,
  encodeBase64,
  getRandomBytes,
  encodeBase64Url,
} from './encryption';

const STORAGE_KEY = 'consortium-relay-credentials';

export interface StoredCredentials {
  token: string;
  /** base64-encoded 32-byte master secret */
  secret: string;
}

export interface Credentials {
  token: string;
  secret: Uint8Array;
  encryption:
    | { type: 'legacy'; secret: Uint8Array }
    | { type: 'dataKey'; publicKey: Uint8Array; privateKey: Uint8Array };
}

export function getStoredCredentials(): StoredCredentials | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function storeCredentials(creds: StoredCredentials): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

export function clearStoredCredentials(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Resolve full credentials from stored credentials.
 * For the web client, we always use the legacy secret mode
 * (the secret is the NaCl signing seed, and we derive box keys from it).
 */
export async function resolveCredentials(
  stored: StoredCredentials,
): Promise<Credentials> {
  await initEncryption();
  const secret = sodium.from_base64(
    stored.secret,
    sodium.base64_variants.ORIGINAL,
  );

  // Derive box keypair for E2EE data key unwrapping
  const hash = sodium.crypto_hash(secret);
  const boxSeed = hash.slice(0, 32);
  const boxKp = sodium.crypto_box_seed_keypair(boxSeed);

  return {
    token: stored.token,
    secret,
    encryption: {
      type: 'dataKey',
      publicKey: boxKp.publicKey,
      privateKey: boxKp.privateKey,
    },
  };
}

/**
 * Authenticate with the server using public key challenge-response.
 * Generates a new random secret if none exists.
 */
export async function authenticate(
  serverUrl: string,
  existingSecret?: Uint8Array,
): Promise<StoredCredentials> {
  await initEncryption();

  const secret = existingSecret ?? getRandomBytes(32);
  const { challenge, publicKey, signature } = authChallenge(secret);

  const response = await fetch(`${serverUrl}/v1/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: encodeBase64(publicKey),
      challenge: encodeBase64(challenge),
      signature: encodeBase64(signature),
    }),
  });

  if (!response.ok) {
    throw new Error(`Authentication failed: ${response.status}`);
  }

  const data = await response.json();
  const creds: StoredCredentials = {
    token: data.token,
    secret: encodeBase64(secret),
  };

  storeCredentials(creds);
  return creds;
}
