import { Request, Response } from 'express';
import { z } from 'zod';
import { Address, encodeAbiParameters, encodePacked, Hex, toHex, zeroAddress } from 'viem';
import { jsonify, logRequest } from '../log';
import {
    zGetIntentData,
    zGetIntentResponse,
    zCreateIntentData,
    zCreateIntentResponse,
    zListIntentsData,
    zListIntentsResponse,
} from '../gen/zod.gen';
import { chainContexts } from '../chains';
import { ApiError, sendError } from '../errors';
import { ClaimRecord, getIntent, IntentRecord, listIntents, saveIntent } from '../services/intentRepo';
import { QuoteExecutionPlan, takeQuote } from '../services/quoteCache';
import { queryBoolean, queryNumber } from '../query';

type SubmitData = z.infer<typeof zCreateIntentData>;
type SubmitResponse = z.infer<typeof zCreateIntentResponse>;
type IntentStatusResponse = z.infer<typeof zGetIntentResponse>;

export const postIntent = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const data = zCreateIntentData.parse({
            body: req.body,
            path: undefined,
            query: undefined,
            headers: req.headers,
        });
        const body = data.body;
        if (!body) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Missing request body');
        }

        const plan = takeQuote(body.intentId);
        if (!plan) {
            throw new ApiError(404, 'NOT_FOUND', `No quote found for intentId ${body.intentId}`);
        }

        const destinationSignature = body.signatures.destination as Hex;
        const out = await executeQuote(body.intentId, plan, destinationSignature);
        console.log('Response: ', jsonify(out));
        resp.status(201).json(out);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};

export const getIntentStatus = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const data = zGetIntentData.parse({
            body: undefined,
            path: req.params,
            query: { ...req.query, full: queryBoolean(req.query.full) },
            headers: req.headers,
        });
        const intent = getIntent(data.path.id);
        const out = toStatusResponse(data.path.id, intent, data.query?.full ?? false);
        console.log('Response: ', jsonify(out));
        resp.status(200).json(out);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};

type IntentListResponse = z.infer<typeof zListIntentsResponse>;

const DEFAULT_PAGE_SIZE = 20;

export const getIntents = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const data = zListIntentsData.parse({
            body: undefined,
            path: undefined,
            query: { ...req.query, limit: queryNumber(req.query.limit) },
            headers: req.headers,
        });

        const all = listIntents();
        // Opaque to callers by contract; the mock uses the offset it decodes from.
        const offset = Number(data.query?.cursor ?? '0');
        if (!Number.isInteger(offset) || offset < 0) {
            throw new ApiError(400, 'VALIDATION_ERROR', `Invalid cursor ${data.query?.cursor}`);
        }
        const limit = data.query?.limit ?? DEFAULT_PAGE_SIZE;
        const page = all.slice(offset, offset + limit);
        const nextOffset = offset + page.length;

        const out: IntentListResponse = {
            data: page.map(({ id, record }) => ({
                id,
                status: toWireStatus(record.status),
                fromChains: [record.plan.sourceChainId],
                toChain: record.destinationChainId,
                token: record.plan.tokenRequests[0]?.tokenAddress,
                amount: record.plan.tokenRequests[0]?.amount.toString(),
                account: record.accountAddress,
                createdAt: record.createdAt,
            })),
            pagination: {
                // Documented as null on the terminal page; callers paginate on that sentinel.
                nextCursor: nextOffset < all.length ? String(nextOffset) : null,
                hasNextPage: nextOffset < all.length,
            },
        };
        console.log('Response: ', jsonify(out));
        resp.status(200).json(out);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};

type OperationGroup = IntentStatusResponse['operations'][number];
type Operation = OperationGroup['items'][number];
type OperationStatus = Operation['status'];

// The wire exposes three terminal states; the repo tracks the finer-grained
// lifecycle the orchestrator reports internally.
const toWireStatus = (status: IntentRecord['status'] | ClaimRecord['status']): OperationStatus => {
    switch (status) {
        case 'COMPLETED':
            return 'COMPLETED';
        case 'FAILED':
        case 'EXPIRED':
            return 'FAILED';
        default:
            return 'PENDING';
    }
};

type IntentDetails = NonNullable<IntentStatusResponse['details']>;

// `full=true` asks for the extended view. The mock fills it from the quote plan it
// executed; `cost` reports no sponsorship because the mock never sponsors.
const toDetails = (intentId: string, intent: IntentRecord): IntentDetails => {
    const { plan } = intent;
    const tokens = plan.tokenRequests.map((t) => ({
        token: t.tokenAddress,
        amount: t.amount.toString(),
    }));
    const legStatus = toWireStatus(intent.status);

    // Setup and destination calls both run on the destination chain in the mock's
    // router batch, so neither is a PRE_CLAIM leg.
    const executions = [
        ...plan.setupOps.map((op) => ({
            chain: plan.destinationChainId,
            phase: 'DESTINATION' as const,
            to: op.to,
            value: '0',
            data: op.data,
        })),
        ...plan.destinationOps.map((op) => ({
            chain: plan.destinationChainId,
            phase: 'DESTINATION' as const,
            to: op.to,
            value: op.value.toString(),
            data: op.data,
        })),
    ];

    return {
        id: intentId,
        nonce: toHex(plan.nonce, { size: 32 }),
        recipient: plan.recipientAddress,
        createdAt: intent.createdAt,
        latencyMs: intent.fillTimestamp
            ? (intent.fillTimestamp - intent.createdAt) * 1000
            : null,
        settlementLayer: plan.settlementLayer,
        source: [{ chain: plan.sourceChainId, tokens, status: legStatus }],
        destination: {
            chain: plan.destinationChainId,
            tokens,
            txHash: intent.fillTransactionHash,
            timestamp: intent.fillTimestamp,
            status: legStatus,
        },
        executions,
        cost: { sponsored: false },
    };
};

// Operations are grouped by chain (numeric, not CAIP-2, on this endpoint), so a
// same-chain intent's claim and fill share one group.
const toStatusResponse = (
    intentId: string,
    intent: IntentRecord,
    full: boolean,
): IntentStatusResponse => {
    const groups = new Map<number, OperationGroup>();
    const groupFor = (chain: number): OperationGroup => {
        let group = groups.get(chain);
        if (!group) {
            group = { chain, items: [] };
            groups.set(chain, group);
        }
        return group;
    };

    for (const claim of intent.claims) {
        groupFor(claim.chainId).items.push({
            type: 'CLAIM',
            status: toWireStatus(claim.status),
            txHash: claim.claimTransactionHash,
            timestamp: claim.claimTimestamp,
        });
    }

    groupFor(intent.destinationChainId).items.push({
        type: 'FILL',
        status: toWireStatus(intent.status),
        txHash: intent.fillTransactionHash,
        timestamp: intent.fillTimestamp,
    });

    return {
        status: toWireStatus(intent.status),
        accountAddress: intent.accountAddress,
        operations: Array.from(groups.values()),
        ...(full ? { details: toDetails(intentId, intent) } : {}),
    };
};

const executeQuote = async (
    intentId: string,
    plan: QuoteExecutionPlan,
    destinationSignature: Hex,
): Promise<SubmitResponse> => {
    const executor = chainContexts()[plan.destinationChainId];
    if (!executor) {
        throw new ApiError(400, 'VALIDATION_ERROR', `Unsupported destination chain ${plan.destinationChainId}`);
    }

    const hasDestinationOps = plan.destinationOps.length > 0;
    const hasValidSignature = destinationSignature && destinationSignature !== '0x' && !isFakeSignature(destinationSignature);

    if (hasDestinationOps && !hasValidSignature) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Destination signature required for destination operations');
    }

    const txHash = hasDestinationOps
        ? await executeIntentExecutorFlow(plan, destinationSignature)
        : await executeLegacyFlow(plan);

    saveIntent(intentId, {
        accountAddress: plan.recipientAddress,
        destinationChainId: plan.destinationChainId,
        status: 'COMPLETED',
        fillTimestamp: Math.floor(Date.now() / 1000),
        fillTransactionHash: txHash,
        claims: [],
        plan,
        createdAt: Math.floor(Date.now() / 1000),
    });

    return { intentId };
};

const executeLegacyFlow = async (plan: QuoteExecutionPlan): Promise<Hex> => {
    const executor = chainContexts()[plan.destinationChainId];
    const setupCalls = plan.setupOps.map((op) => ({ to: op.to, callData: op.data }));

    const tokenTransferCalls = plan.tokenRequests
        .filter((t) => t.tokenAddress !== zeroAddress)
        .map((t) => ({
            to: t.tokenAddress,
            callData: executor.transfer(plan.recipientAddress, t.amount),
        }));

    const nativeTransferValue = plan.tokenRequests
        .filter((t) => t.tokenAddress === zeroAddress)
        .reduce((acc, t) => acc + t.amount, 0n);

    const executions = [...setupCalls, ...tokenTransferCalls];

    if (executions.length === 0 && nativeTransferValue === 0n) {
        return ('0x' + '00'.repeat(32)) as Hex;
    }

    // FakeRouter.mockFill is non-payable, so native value cannot ride along with
    // the ERC-20 batch. When both are present, run the router batch first and
    // then a direct native transfer, returning the latter's hash as the fill tx.
    if (executions.length > 0) {
        const txCallData = await executor.callFakeRouter(executions);
        const routerHash = await executor.execute({ ...txCallData, value: 0n });
        if (nativeTransferValue === 0n) return routerHash;
    }

    return executor.execute({
        to: plan.recipientAddress,
        callData: '0x' as Hex,
        value: nativeTransferValue,
    });
};

const executeIntentExecutorFlow = async (plan: QuoteExecutionPlan, destinationSignature: Hex): Promise<Hex> => {
    const executor = chainContexts()[plan.destinationChainId];

    const setupCalls = plan.setupOps.map((op) => ({ to: op.to, callData: op.data }));

    const tokenTransferCalls = plan.tokenRequests
        .filter((t) => t.tokenAddress !== zeroAddress)
        .map((t) => ({
            to: t.tokenAddress,
            callData: executor.transfer(plan.recipientAddress, t.amount),
        }));

    const nativeTransferValue = plan.tokenRequests
        .filter((t) => t.tokenAddress === zeroAddress)
        .reduce((acc, t) => acc + t.amount, 0n);

    const opsData = encodeDestinationOps(plan.destinationOps);

    const routerCalls = [
        ...setupCalls,
        ...tokenTransferCalls,
        executor.intentExecutorCall(plan.accountAddress, plan.nonce, opsData, destinationSignature),
    ];

    const txCallData = await executor.callFakeRouter(routerCalls);
    const routerHash = await executor.execute({ ...txCallData, value: 0n });

    if (nativeTransferValue === 0n) return routerHash;

    return executor.execute({
        to: plan.recipientAddress,
        callData: '0x' as Hex,
        value: nativeTransferValue,
    });
};

const encodeDestinationOps = (ops: { to: Address; value: bigint; data: Hex }[]): Hex => {
    const execType = 0x02;
    const sigMode = 0x01;
    const encoded = encodeAbiParameters(
        [
            {
                type: 'tuple[]',
                components: [
                    { type: 'address', name: 'to' },
                    { type: 'uint256', name: 'value' },
                    { type: 'bytes', name: 'data' },
                ],
            },
        ],
        [ops],
    );
    return encodePacked(['uint8', 'uint8', 'bytes'], [execType, sigMode, encoded]);
};

const isFakeSignature = (signature: Hex): boolean => {
    if (!signature || signature === '0x') return true;
    return /^0+$/.test(signature.slice(2));
};
