/**
 * A pushable async iterable that allows external pushing of values
 */
export class PushableAsyncIterable<T> implements AsyncIterableIterator<T> {
    private queue: T[] = []
    private waiters: Array<{
        resolve: (value: IteratorResult<T>) => void
        reject: (error: Error) => void
    }> = []
    private isDone = false
    private error: Error | null = null
    private started = false

    push(value: T): void {
        if (this.isDone) throw new Error('Cannot push to completed iterable')
        if (this.error) throw this.error

        const waiter = this.waiters.shift()
        if (waiter) {
            waiter.resolve({ done: false, value })
        } else {
            this.queue.push(value)
        }
    }

    end(): void {
        if (this.isDone) return
        this.isDone = true
        this.cleanup()
    }

    setError(err: Error): void {
        if (this.isDone) return
        this.error = err
        this.isDone = true
        this.cleanup()
    }

    private cleanup(): void {
        while (this.waiters.length > 0) {
            const waiter = this.waiters.shift()!
            if (this.error) {
                waiter.reject(this.error)
            } else {
                waiter.resolve({ done: true, value: undefined })
            }
        }
    }

    async next(): Promise<IteratorResult<T>> {
        if (this.queue.length > 0) return { done: false, value: this.queue.shift()! }
        if (this.isDone) {
            if (this.error) throw this.error
            return { done: true, value: undefined }
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
            this.waiters.push({ resolve, reject })
        })
    }

    async return(_value?: any): Promise<IteratorResult<T>> {
        this.end()
        return { done: true, value: undefined }
    }

    async throw(e: any): Promise<IteratorResult<T>> {
        this.setError(e instanceof Error ? e : new Error(String(e)))
        throw this.error
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<T> {
        if (this.started) throw new Error('PushableAsyncIterable can only be iterated once')
        this.started = true
        return this
    }

    get done(): boolean { return this.isDone }
    get hasError(): boolean { return this.error !== null }
    get queueSize(): number { return this.queue.length }
    get waiterCount(): number { return this.waiters.length }
}
