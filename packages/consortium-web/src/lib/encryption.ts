/**
 * Browser-compatible E2EE encryption utilities
 *
 * Supports two variants:
 * - 'legacy': NaCl secretbox (tweetnacl via libsodium)
 * - 'dataKey': AES-256-GCM via SubtleCrypto
 *
 * Wire format for dataKey: [0x00][nonce:12][ciphertext][authTag:16]
 * Wire format for legacy: [nonce:24][ciphertext]
 */

import sodium from 'libsodium-wrappers';

let ready = false;

export async function initEncryption(): Promise<void> {
  if (ready) return;
  await sodium.ready;
  ready = true;
}

// --- Base64 helpers ---

export function encodeBase64(data: Uint8Array): string {
  return sodium.to_base64(data, sodium.base64_variants.ORIGINAL);
}

export function decodeBase64(str: string): Uint8Array {
  return sodium.from_base64(str, sodium.base64_variants.ORIGINAL);
}

export function encodeBase64Url(data: Uint8Array): string {
  return sodium.to_base64(data, sodium.base64_variants.URLSAFE_NO_PADDING);
}

// --- Random bytes ---

export function getRandomBytes(size: number): Uint8Array {
  return sodium.randombytes_buf(size);
}

// --- Auth challenge-response ---

export function authChallenge(secret: Uint8Array): {
  challenge: Uint8Array;
  publicKey: Uint8Array;
  signature: Uint8Array;
} {
  const keypair = sodium.crypto_sign_seed_keypair(secret);
  const challenge = getRandomBytes(32);
  const signature = sodium.crypto_sign_detached(challenge, keypair.privateKey);
  return { challenge, publicKey: keypair.publicKey, signature };
}

// --- NaCl box encryption (for data encryption key unwrapping) ---

export function decryptBox(
  bundle: Uint8Array,
  recipientSecretKey: Uint8Array,
): Uint8Array | null {
  const ephemeralPublicKey = bundle.slice(0, 32);
  const nonce = bundle.slice(32, 56);
  const encrypted = bundle.slice(56);
  try {
    return sodium.crypto_box_open_easy(
      encrypted,
      nonce,
      ephemeralPublicKey,
      recipientSecretKey,
    );
  } catch {
    return null;
  }
}

export function boxKeyPairFromSeed(seed: Uint8Array): {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
} {
  // Derive box keypair from a 32-byte seed via SHA-512 first 32 bytes
  const hash = sodium.crypto_hash(seed);
  const secretKey = hash.slice(0, 32);
  const kp = sodium.crypto_box_seed_keypair(secretKey);
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

// --- NaCl secretbox (legacy encryption) ---

export function encryptLegacy(data: unknown, secret: Uint8Array): Uint8Array {
  const nonce = getRandomBytes(24);
  const plaintext = sodium.from_string(JSON.stringify(data));
  const encrypted = sodium.crypto_secretbox_easy(plaintext, nonce, secret);
  const result = new Uint8Array(nonce.length + encrypted.length);
  result.set(nonce);
  result.set(encrypted, nonce.length);
  return result;
}

export function decryptLegacy(
  data: Uint8Array,
  secret: Uint8Array,
): unknown | null {
  const nonce = data.slice(0, 24);
  const encrypted = data.slice(24);
  try {
    const decrypted = sodium.crypto_secretbox_open_easy(
      encrypted,
      nonce,
      secret,
    );
    return JSON.parse(sodium.to_string(decrypted));
  } catch {
    return null;
  }
}

// --- AES-256-GCM (dataKey encryption) ---

/** Convert Uint8Array to ArrayBuffer (needed for SubtleCrypto) */
function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

let aesKeyCache = new WeakMap<Uint8Array, CryptoKey>();

async function getAesKey(dataKey: Uint8Array): Promise<CryptoKey> {
  let cached = aesKeyCache.get(dataKey);
  if (cached) return cached;
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(dataKey),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
  aesKeyCache.set(dataKey, key);
  return key;
}

export async function encryptWithDataKey(
  data: unknown,
  dataKey: Uint8Array,
): Promise<Uint8Array> {
  const nonce = getRandomBytes(12);
  const key = await getAesKey(dataKey);
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
    key,
    plaintext,
  );
  // SubtleCrypto appends authTag to the ciphertext
  const encryptedBytes = new Uint8Array(encrypted);

  // Bundle: version(1) + nonce(12) + ciphertext+authTag
  const bundle = new Uint8Array(1 + 12 + encryptedBytes.length);
  bundle[0] = 0; // version
  bundle.set(nonce, 1);
  bundle.set(encryptedBytes, 13);
  return bundle;
}

export async function decryptWithDataKey(
  bundle: Uint8Array,
  dataKey: Uint8Array,
): Promise<unknown | null> {
  if (bundle.length < 1 || bundle[0] !== 0) return null;
  if (bundle.length < 13 + 16) return null;

  const nonce = bundle.slice(1, 13);
  // SubtleCrypto expects authTag appended to ciphertext
  const ciphertextWithTag = bundle.slice(13);

  try {
    const key = await getAesKey(dataKey);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
      key,
      toArrayBuffer(ciphertextWithTag),
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    return null;
  }
}

// --- Unified encrypt/decrypt ---

export async function encrypt(
  key: Uint8Array,
  variant: 'legacy' | 'dataKey',
  data: unknown,
): Promise<Uint8Array> {
  if (variant === 'legacy') {
    return encryptLegacy(data, key);
  }
  return encryptWithDataKey(data, key);
}

export async function decrypt(
  key: Uint8Array,
  variant: 'legacy' | 'dataKey',
  data: Uint8Array,
): Promise<unknown | null> {
  if (variant === 'legacy') {
    return decryptLegacy(data, key);
  }
  return decryptWithDataKey(data, key);
}
