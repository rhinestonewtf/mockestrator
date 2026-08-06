import { ApiError } from './errors';

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

// Several endpoints accept the spec's non-EVM CAIP-2 forms (`solana:`, `tron:`,
// `hypercore:`), which a fork-backed mock cannot serve. Reject those cleanly
// instead of letting `fromCaip2` throw its way to a 500.
export function toEvmChainId(value: string): number {
    if (!isCaip2(value)) {
        throw new ApiError(400, 'VALIDATION_ERROR', `Unsupported chain ${value}`);
    }
    return fromCaip2(value);
}
