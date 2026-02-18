/**
 * Deterministic JSON utilities for consistent object serialization and hashing
 */

import { createHash } from 'crypto';

export function deterministicStringify(obj: any): string {
    const seen = new WeakSet();

    function processValue(value: any): any {
        if (value === null) return null;
        if (value === undefined) return undefined;
        if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value;
        if (value instanceof Date) return value.toISOString();
        if (typeof value === 'function' || typeof value === 'symbol') return undefined;

        if (seen.has(value)) throw new Error('Circular reference detected');
        seen.add(value);

        if (Array.isArray(value)) {
            const processed = value.map(item => processValue(item)).filter(item => item !== undefined);
            seen.delete(value);
            return processed;
        }

        if (value.constructor === Object || value.constructor === undefined) {
            const processed: Record<string, any> = {};
            const keys = Object.keys(value).sort();
            for (const k of keys) {
                const processedValue = processValue(value[k]);
                if (processedValue !== undefined) processed[k] = processedValue;
            }
            seen.delete(value);
            return processed;
        }

        try {
            const plain = { ...value };
            seen.delete(value);
            return processValue(plain);
        } catch {
            seen.delete(value);
            return String(value);
        }
    }

    return JSON.stringify(processValue(obj));
}

export function hashObject(obj: any, encoding: 'hex' | 'base64' | 'base64url' = 'hex'): string {
    const jsonString = deterministicStringify(obj);
    return createHash('sha256').update(jsonString).digest(encoding);
}
