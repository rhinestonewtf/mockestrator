import { Address, Hex } from 'viem';

export type QuoteExecutionPlan = {
    accountAddress: Address;
    recipientAddress: Address;
    sourceChainId: number;
    destinationChainId: number;
    tokenRequests: { tokenAddress: Address; amount: bigint }[];
    destinationOps: { to: Address; value: bigint; data: Hex }[];
    setupOps: { to: Address; data: Hex }[];
    settlementLayer: 'INTENT_EXECUTOR' | 'SAME_CHAIN' | 'ACROSS' | 'ECO' | 'RELAY' | 'OFT' | 'NEAR' | 'RHINO' | 'CCTP';
    nonce: bigint;
};

const cache = new Map<string, QuoteExecutionPlan>();

export function saveQuote(intentId: string, plan: QuoteExecutionPlan): void {
    cache.set(intentId, plan);
}

export function takeQuote(intentId: string): QuoteExecutionPlan | undefined {
    return cache.get(intentId);
}
