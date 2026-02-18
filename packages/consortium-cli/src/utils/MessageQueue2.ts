/**
 * Mode-aware message queue that stores messages with their modes.
 * Returns consistent batches of messages with the same mode.
 */

import { logger } from "../ui/logger";

interface QueueItem<T> {
    message: string;
    mode: T;
    modeHash: string;
    isolate?: boolean;
}

export class MessageQueue2<T> {
    public queue: QueueItem<T>[] = [];
    private waiter: ((hasMessages: boolean) => void) | null = null;
    private closed = false;
    private onMessageHandler: ((message: string, mode: T) => void) | null = null;
    modeHasher: (mode: T) => string;

    constructor(
        modeHasher: (mode: T) => string,
        onMessageHandler: ((message: string, mode: T) => void) | null = null
    ) {
        this.modeHasher = modeHasher;
        this.onMessageHandler = onMessageHandler;
        logger.debug(`[MessageQueue2] Initialized`);
    }

    setOnMessage(handler: ((message: string, mode: T) => void) | null): void {
        this.onMessageHandler = handler;
    }

    push(message: string, mode: T): void {
        if (this.closed) throw new Error('Cannot push to closed queue');
        const modeHash = this.modeHasher(mode);
        this.queue.push({ message, mode, modeHash, isolate: false });
        if (this.onMessageHandler) this.onMessageHandler(message, mode);
        if (this.waiter) {
            const waiter = this.waiter;
            this.waiter = null;
            waiter(true);
        }
    }

    pushImmediate(message: string, mode: T): void {
        if (this.closed) throw new Error('Cannot push to closed queue');
        const modeHash = this.modeHasher(mode);
        this.queue.push({ message, mode, modeHash, isolate: false });
        if (this.onMessageHandler) this.onMessageHandler(message, mode);
        if (this.waiter) {
            const waiter = this.waiter;
            this.waiter = null;
            waiter(true);
        }
    }

    pushIsolateAndClear(message: string, mode: T): void {
        if (this.closed) throw new Error('Cannot push to closed queue');
        const modeHash = this.modeHasher(mode);
        this.queue = [];
        this.queue.push({ message, mode, modeHash, isolate: true });
        if (this.onMessageHandler) this.onMessageHandler(message, mode);
        if (this.waiter) {
            const waiter = this.waiter;
            this.waiter = null;
            waiter(true);
        }
    }

    unshift(message: string, mode: T): void {
        if (this.closed) throw new Error('Cannot unshift to closed queue');
        const modeHash = this.modeHasher(mode);
        this.queue.unshift({ message, mode, modeHash, isolate: false });
        if (this.onMessageHandler) this.onMessageHandler(message, mode);
        if (this.waiter) {
            const waiter = this.waiter;
            this.waiter = null;
            waiter(true);
        }
    }

    reset(): void {
        this.queue = [];
        this.closed = false;
        this.waiter = null;
    }

    close(): void {
        this.closed = true;
        if (this.waiter) {
            const waiter = this.waiter;
            this.waiter = null;
            waiter(false);
        }
    }

    isClosed(): boolean {
        return this.closed;
    }

    size(): number {
        return this.queue.length;
    }

    async waitForMessagesAndGetAsString(abortSignal?: AbortSignal): Promise<{ message: string, mode: T, isolate: boolean, hash: string } | null> {
        if (this.queue.length > 0) return this.collectBatch();
        if (this.closed || abortSignal?.aborted) return null;
        const hasMessages = await this.waitForMessages(abortSignal);
        if (!hasMessages) return null;
        return this.collectBatch();
    }

    private collectBatch(): { message: string, mode: T, hash: string, isolate: boolean } | null {
        if (this.queue.length === 0) return null;
        const firstItem = this.queue[0];
        const sameModeMessages: string[] = [];
        let mode = firstItem.mode;
        let isolate = firstItem.isolate ?? false;
        const targetModeHash = firstItem.modeHash;

        if (firstItem.isolate) {
            const item = this.queue.shift()!;
            sameModeMessages.push(item.message);
        } else {
            while (this.queue.length > 0 &&
                this.queue[0].modeHash === targetModeHash &&
                !this.queue[0].isolate) {
                const item = this.queue.shift()!;
                sameModeMessages.push(item.message);
            }
        }

        return {
            message: sameModeMessages.join('\n'),
            mode,
            hash: targetModeHash,
            isolate
        };
    }

    private waitForMessages(abortSignal?: AbortSignal): Promise<boolean> {
        return new Promise((resolve) => {
            let abortHandler: (() => void) | null = null;

            if (abortSignal) {
                abortHandler = () => {
                    if (this.waiter === waiterFunc) this.waiter = null;
                    resolve(false);
                };
                abortSignal.addEventListener('abort', abortHandler);
            }

            const waiterFunc = (hasMessages: boolean) => {
                if (abortHandler && abortSignal) abortSignal.removeEventListener('abort', abortHandler);
                resolve(hasMessages);
            };

            if (this.queue.length > 0) {
                if (abortHandler && abortSignal) abortSignal.removeEventListener('abort', abortHandler);
                resolve(true);
                return;
            }
            if (this.closed || abortSignal?.aborted) {
                if (abortHandler && abortSignal) abortSignal.removeEventListener('abort', abortHandler);
                resolve(false);
                return;
            }
            this.waiter = waiterFunc;
        });
    }
}
