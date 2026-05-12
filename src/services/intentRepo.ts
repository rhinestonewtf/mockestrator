import { Address, Hex } from 'viem';
import { ApiError } from '../errors';

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
