/**
 * Minimal persistence for relay CLI
 *
 * Handles settings and private key storage in ~/.consortium/
 * Stripped: removed AIBackendProfile, profile management, daemon state, daemon lock
 */

import { readFile, writeFile, mkdir, open, unlink, rename, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { constants } from 'node:fs'
import { configuration } from './configuration'
import * as z from 'zod';
import { encodeBase64 } from './api/encryption';
import { logger } from './ui/logger';

interface Settings {
  onboardingCompleted: boolean
  machineId?: string
}

const defaultSettings: Settings = {
  onboardingCompleted: false,
}

export async function readSettings(): Promise<Settings> {
  if (!existsSync(configuration.settingsFile)) {
    return { ...defaultSettings }
  }
  try {
    const content = await readFile(configuration.settingsFile, 'utf8')
    const raw = JSON.parse(content)
    return { ...defaultSettings, ...raw };
  } catch (error: any) {
    logger.warn(`Failed to read settings: ${error.message}`);
    return { ...defaultSettings }
  }
}

export async function writeSettings(settings: Settings): Promise<void> {
  if (!existsSync(configuration.consortiumHomeDir)) {
    await mkdir(configuration.consortiumHomeDir, { recursive: true })
  }
  await writeFile(configuration.settingsFile, JSON.stringify(settings, null, 2))
}

/**
 * Atomically update settings with file locking
 */
export async function updateSettings(
  updater: (current: Settings) => Settings | Promise<Settings>
): Promise<Settings> {
  const LOCK_RETRY_INTERVAL_MS = 100;
  const MAX_LOCK_ATTEMPTS = 50;
  const STALE_LOCK_TIMEOUT_MS = 10000;

  const lockFile = configuration.settingsFile + '.lock';
  const tmpFile = configuration.settingsFile + '.tmp';
  let fileHandle;
  let attempts = 0;

  while (attempts < MAX_LOCK_ATTEMPTS) {
    try {
      fileHandle = await open(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      break;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));
        try {
          const stats = await stat(lockFile);
          if (Date.now() - stats.mtimeMs > STALE_LOCK_TIMEOUT_MS) {
            await unlink(lockFile).catch(() => { });
          }
        } catch { }
      } else {
        throw err;
      }
    }
  }

  if (!fileHandle) {
    throw new Error(`Failed to acquire settings lock after ${MAX_LOCK_ATTEMPTS * LOCK_RETRY_INTERVAL_MS / 1000} seconds`);
  }

  try {
    const current = await readSettings() || { ...defaultSettings };
    const updated = await updater(current);
    if (!existsSync(configuration.consortiumHomeDir)) {
      await mkdir(configuration.consortiumHomeDir, { recursive: true });
    }
    await writeFile(tmpFile, JSON.stringify(updated, null, 2));
    await rename(tmpFile, configuration.settingsFile);
    return updated;
  } finally {
    await fileHandle.close();
    await unlink(lockFile).catch(() => { });
  }
}

//
// Authentication
//

const credentialsSchema = z.object({
  token: z.string(),
  secret: z.string().base64().nullish(),
  encryption: z.object({
    publicKey: z.string().base64(),
    machineKey: z.string().base64()
  }).nullish()
})

export type Credentials = {
  token: string,
  encryption: {
    type: 'legacy', secret: Uint8Array
  } | {
    type: 'dataKey', publicKey: Uint8Array, machineKey: Uint8Array
  }
}

export async function readCredentials(): Promise<Credentials | null> {
  if (!existsSync(configuration.privateKeyFile)) {
    return null
  }
  try {
    const keyBase64 = (await readFile(configuration.privateKeyFile, 'utf8'));
    const credentials = credentialsSchema.parse(JSON.parse(keyBase64));
    if (credentials.secret) {
      return {
        token: credentials.token,
        encryption: {
          type: 'legacy',
          secret: new Uint8Array(Buffer.from(credentials.secret, 'base64'))
        }
      };
    } else if (credentials.encryption) {
      return {
        token: credentials.token,
        encryption: {
          type: 'dataKey',
          publicKey: new Uint8Array(Buffer.from(credentials.encryption.publicKey, 'base64')),
          machineKey: new Uint8Array(Buffer.from(credentials.encryption.machineKey, 'base64'))
        }
      }
    }
  } catch {
    return null
  }
  return null
}

export async function writeCredentialsLegacy(credentials: { secret: Uint8Array, token: string }): Promise<void> {
  if (!existsSync(configuration.consortiumHomeDir)) {
    await mkdir(configuration.consortiumHomeDir, { recursive: true })
  }
  await writeFile(configuration.privateKeyFile, JSON.stringify({
    secret: encodeBase64(credentials.secret),
    token: credentials.token
  }, null, 2));
}

export async function writeCredentialsDataKey(credentials: { publicKey: Uint8Array, machineKey: Uint8Array, token: string }): Promise<void> {
  if (!existsSync(configuration.consortiumHomeDir)) {
    await mkdir(configuration.consortiumHomeDir, { recursive: true })
  }
  await writeFile(configuration.privateKeyFile, JSON.stringify({
    encryption: { publicKey: encodeBase64(credentials.publicKey), machineKey: encodeBase64(credentials.machineKey) },
    token: credentials.token
  }, null, 2));
}

export async function clearCredentials(): Promise<void> {
  if (existsSync(configuration.privateKeyFile)) {
    await unlink(configuration.privateKeyFile);
  }
}
