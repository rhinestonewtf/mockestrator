export type Caip2 = `eip155:${number}`;

export function toCaip2(chainId: number | bigint): Caip2 {
    return `eip155:${Number(chainId)}` as Caip2;
}

export function fromCaip2(value: string): number {
    const match = /^eip155:(\d+)$/.exec(value);
    if (!match) {
        throw new Error(`Invalid CAIP-2 chain identifier: ${value}`);
    }
    return Number(match[1]);
}

export function isCaip2(value: unknown): value is Caip2 {
    return typeof value === 'string' && /^eip155:\d+$/.test(value);
}
