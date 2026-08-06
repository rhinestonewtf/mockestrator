import { Address, Hex } from 'viem';
import { ApiError } from '../errors';
import { QuoteExecutionPlan } from './quoteCache';

export type IntentStatus = 'PENDING' | 'PRECONFIRMED' | 'CLAIMED' | 'FILLED' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

export type ClaimRecord = {
    chainId: number;
    status: 'PENDING' | 'EXPIRED' | 'PRECONFIRMED' | 'COMPLETED' | 'FAILED';
    claimTimestamp?: number;
    claimTransactionHash?: Hex;
};

export type IntentRecord = {
    accountAddress: Address;
    destinationChainId: number;
    status: IntentStatus;
    fillTimestamp?: number;
    fillTransactionHash?: Hex;
    claims: ClaimRecord[];
    // Quote-time data, kept so `GET /intents/:id?full=true` can serve `details`.
    plan: QuoteExecutionPlan;
    createdAt: number;
};

const intents = new Map<string, IntentRecord>();

export class IntentNotFoundError extends ApiError {
    constructor(intentId: string) {
        super(404, 'NOT_FOUND', `Intent not found: ${intentId}`);
    }
}

export function getIntent(intentId: string): IntentRecord {
    const intent = intents.get(intentId);
    if (!intent) {
        throw new IntentNotFoundError(intentId);
    }
    return intent;
}

export function saveIntent(intentId: string, record: IntentRecord): void {
    intents.set(intentId, record);
}

// Insertion order is creation order, which is the order `GET /intents` pages over.
export function listIntents(): { id: string; record: IntentRecord }[] {
    return Array.from(intents, ([id, record]) => ({ id, record }));
}
