/**
 * Authentication flow using TweetNaCl for cryptographic signatures
 */

import axios from 'axios';
import { encodeBase64, encodeBase64Url, authChallenge } from './encryption';
import { configuration } from '../configuration';

/**
 * Authenticate with the server and obtain an auth token
 */
export async function authGetToken(secret: Uint8Array): Promise<string> {
  const { challenge, publicKey, signature } = authChallenge(secret);

  const response = await axios.post(`${configuration.serverUrl}/v1/auth`, {
    challenge: encodeBase64(challenge),
    publicKey: encodeBase64(publicKey),
    signature: encodeBase64(signature)
  });

  if (!response.data.success || !response.data.token) {
    throw new Error('Authentication failed');
  }

  return response.data.token;
}

/**
 * Generate a URL for the mobile app to connect to the server
 */
export function generateAppUrl(secret: Uint8Array): string {
  const secretBase64Url = encodeBase64Url(secret);
  return `consortium://${secretBase64Url}`;
}
