/**
 * End-to-end encryption utilities using TweetNaCl and AES-256-GCM
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import tweetnacl from 'tweetnacl';

/**
 * Encode a Uint8Array to base64 string
 */
export function encodeBase64(buffer: Uint8Array, variant: 'base64' | 'base64url' = 'base64'): string {
  if (variant === 'base64url') {
    return encodeBase64Url(buffer);
  }
  return Buffer.from(buffer).toString('base64')
}

/**
 * Encode a Uint8Array to base64url string (URL-safe base64)
 */
export function encodeBase64Url(buffer: Uint8Array): string {
  return Buffer.from(buffer)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

/**
 * Decode a base64 string to a Uint8Array
 */
export function decodeBase64(base64: string, variant: 'base64' | 'base64url' = 'base64'): Uint8Array {
  if (variant === 'base64url') {
    const base64Standard = base64
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      + '='.repeat((4 - base64.length % 4) % 4);
    return new Uint8Array(Buffer.from(base64Standard, 'base64'));
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * Generate secure random bytes
 */
export function getRandomBytes(size: number): Uint8Array {
  return new Uint8Array(randomBytes(size))
}

export function libsodiumPublicKeyFromSecretKey(seed: Uint8Array): Uint8Array {
  const hashedSeed = new Uint8Array(createHash('sha512').update(seed).digest());
  const secretKey = hashedSeed.slice(0, 32);
  return new Uint8Array(tweetnacl.box.keyPair.fromSecretKey(secretKey).publicKey);
}

export function libsodiumEncryptForPublicKey(data: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  const ephemeralKeyPair = tweetnacl.box.keyPair();
  const nonce = getRandomBytes(tweetnacl.box.nonceLength);
  const encrypted = tweetnacl.box(data, nonce, recipientPublicKey, ephemeralKeyPair.secretKey);

  const result = new Uint8Array(ephemeralKeyPair.publicKey.length + nonce.length + encrypted.length);
  result.set(ephemeralKeyPair.publicKey, 0);
  result.set(nonce, ephemeralKeyPair.publicKey.length);
  result.set(encrypted, ephemeralKeyPair.publicKey.length + nonce.length);

  return result;
}

/**
 * Encrypt data using NaCl secretbox (legacy)
 */
export function encryptLegacy(data: any, secret: Uint8Array): Uint8Array {
  const nonce = getRandomBytes(tweetnacl.secretbox.nonceLength);
  const encrypted = tweetnacl.secretbox(new TextEncoder().encode(JSON.stringify(data)), nonce, secret);
  const result = new Uint8Array(nonce.length + encrypted.length);
  result.set(nonce);
  result.set(encrypted, nonce.length);
  return result;
}

/**
 * Decrypt data using NaCl secretbox (legacy)
 */
export function decryptLegacy(data: Uint8Array, secret: Uint8Array): any | null {
  const nonce = data.slice(0, tweetnacl.secretbox.nonceLength);
  const encrypted = data.slice(tweetnacl.secretbox.nonceLength);
  const decrypted = tweetnacl.secretbox.open(encrypted, nonce, secret);
  if (!decrypted) {
    return null;
  }
  return JSON.parse(new TextDecoder().decode(decrypted));
}

/**
 * Encrypt data using AES-256-GCM with the data encryption key
 */
export function encryptWithDataKey(data: any, dataKey: Uint8Array): Uint8Array {
  const nonce = getRandomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, nonce);

  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  // Bundle: version(1) + nonce (12) + ciphertext + auth tag (16)
  const bundle = new Uint8Array(12 + encrypted.length + 16 + 1);
  bundle.set([0], 0);
  bundle.set(nonce, 1);
  bundle.set(new Uint8Array(encrypted), 13);
  bundle.set(new Uint8Array(authTag), 13 + encrypted.length);

  return bundle;
}

/**
 * Decrypt data using AES-256-GCM with the data encryption key
 */
export function decryptWithDataKey(bundle: Uint8Array, dataKey: Uint8Array): any | null {
  if (bundle.length < 1) return null;
  if (bundle[0] !== 0) return null;
  if (bundle.length < 12 + 16 + 1) return null;

  const nonce = bundle.slice(1, 13);
  const authTag = bundle.slice(bundle.length - 16);
  const ciphertext = bundle.slice(13, bundle.length - 16);

  try {
    const decipher = createDecipheriv('aes-256-gcm', dataKey, nonce);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch (error) {
    return null;
  }
}

export function encrypt(key: Uint8Array, variant: 'legacy' | 'dataKey', data: any): Uint8Array {
  if (variant === 'legacy') {
    return encryptLegacy(data, key);
  } else {
    return encryptWithDataKey(data, key);
  }
}

export function decrypt(key: Uint8Array, variant: 'legacy' | 'dataKey', data: Uint8Array): any | null {
  if (variant === 'legacy') {
    return decryptLegacy(data, key);
  } else {
    return decryptWithDataKey(data, key);
  }
}

/**
 * Generate authentication challenge response
 */
export function authChallenge(secret: Uint8Array): {
  challenge: Uint8Array
  publicKey: Uint8Array
  signature: Uint8Array
} {
  const keypair = tweetnacl.sign.keyPair.fromSeed(secret);
  const challenge = getRandomBytes(32);
  const signature = tweetnacl.sign.detached(challenge, keypair.secretKey);

  return {
    challenge,
    publicKey: keypair.publicKey,
    signature
  };
}
