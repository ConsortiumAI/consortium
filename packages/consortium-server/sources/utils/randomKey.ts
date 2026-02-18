import * as crypto from 'crypto';

export function randomKey(prefix: string, length: number = 24): string {
    while (true) {
        const randomBytesBuffer = crypto.randomBytes(length * 2);
        const normalized = randomBytesBuffer.toString('base64').replace(/[^a-zA-Z0-9]/g, '');
        if (normalized.length < length) continue;
        return `${prefix}_${normalized.slice(0, length)}`;
    }
}
