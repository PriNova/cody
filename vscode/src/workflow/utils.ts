export class StringBuilder {
    private parts: string[] = []

    append(str: string): void {
        this.parts.push(str)
    }

    toString(): string {
        return this.parts.join('')
    }

    get length(): number {
        return this.parts.reduce((acc, part) => acc + part.length, 0)
    }
}
