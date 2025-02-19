interface IncrementalTextConsumer {
    /**
     * Push new text to the consumer.
     * Text should be incremental but still include the previous text. E.g. "Hel" -> "Hello" -> "Hello, world!"
     */
    update: (content: string) => void

    /**
     * Notify the consumer that the text is complete.
     */
    close: () => void

    /**
     * Notify the consumer about an error.
     */
    error?: (error: Error) => void
}

// Maximum/minimum amount of time to wait between character chunks
const MAX_DELAY_MS = 200
const MIN_DELAY_MS = 5

const MIN_CHAR_CHUNK_SIZE = 1

/**
 * Typewriter class that implements the IncrementalTextConsumer interface.
 * Used to simulate a typing effect by providing text incrementally.
 */
export class Typewriter implements IncrementalTextConsumer {
    private upstreamClosed = false
    private text = ''
    private i = 0
    private interval: ReturnType<typeof setInterval> | undefined

    /**
     * Creates a Typewriter which will buffer incremental text and pass it
     * through to `consumer` simulating a typing effect.
     * @param consumer the consumer to pipe "typing" through to.
     */
    constructor(private readonly consumer: IncrementalTextConsumer) {}

    /**
     * Gets the next valid slice point that won't break UTF-16 surrogate pairs
     */
    private getNextValidSlicePoint(currentIndex: number, increment: number): number {
        const codePoints = Array.from(this.text)
        const targetIndex = Math.min(codePoints.length, currentIndex + increment)
        return codePoints.slice(0, targetIndex).join('').length
    }

    // IncrementalTextConsumer implementation. The "write" side of the pipe.
    public update(content: string): void {
        if (this.upstreamClosed) {
            throw new Error('Typewriter already closed')
        }
        if (content === this.text) {
            return
        }
        if (this.text.length >= content.length) {
            throw new Error('Content must be supplied incrementally')
        }
        this.text = content

        /**
         * If we already have an interval running, stop it to avoid stacking
         * multiple intervals on top of each other.
         */
        if (this.interval) {
            clearInterval(this.interval)
            this.interval = undefined
        }

        /**
         * Calculate the delay from the remaining characters we know we have left to process
         * This ensures that the typewriter effect will speed up if we start to fall behind.
         */
        const calculatedDelay = MAX_DELAY_MS / (this.text.length - this.i)

        /**
         * We limit how small our delay can be to ensure we always have some form of typing effect.
         */
        const dynamicDelay = Math.max(calculatedDelay, MIN_DELAY_MS)

        /**
         * To ensure we still can keep up with the updated text, we instead increase the character chunk size.
         * We calculate this by working out how many characters we would need to maintain the same minimum delay.
         * This ensures we always keep up with the text, no matter how large the incoming chunks are.
         *
         * Note: For particularly large chunks, this will result in a character chunk size that is far bigger than you would expect for a typing effect.
         * This is an accepted trade-off in order to ensure we stay in sync with the incoming text.
         */
        const charChunkSize =
            calculatedDelay < MIN_DELAY_MS
                ? Math.round(MIN_DELAY_MS / calculatedDelay)
                : MIN_CHAR_CHUNK_SIZE

        this.interval = setInterval(() => {
            this.i = this.getNextValidSlicePoint(this.i, charChunkSize)
            this.consumer.update(this.text.slice(0, this.i))

            /** Clean up, notify when we have reached the end of the known remaining text. */
            if (this.i === this.text.length) {
                clearInterval(this.interval)
                this.interval = undefined

                if (this.upstreamClosed) {
                    this.consumer.close()
                }
            }
        }, dynamicDelay)
    }

    public close(): void {
        this.upstreamClosed = true
    }

    /** Stop the typewriter, immediately emit any remaining text */
    public stop(error?: Error): void {
        // Stop the animation
        if (this.interval) {
            clearInterval(this.interval)
            this.interval = undefined
        }
        // Flush any pending content to the consumer.
        if (this.i < this.text.length) {
            this.consumer.update(this.text)
        }
        // Clean up the consumer, finished promise.
        if (this.upstreamClosed) {
            if (error) {
                if (this.consumer.error) {
                    this.consumer.error(error)
                    return
                }
            }
            this.consumer.close()
        }
    }
}
