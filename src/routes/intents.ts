import { Request, Response } from 'express';
import { z } from 'zod';
import { Address, encodeAbiParameters, encodePacked, Hex, zeroAddress } from 'viem';
import { jsonify, logRequest } from '../log';
import {
    zGetIntentsByIdData,
    zGetIntentsByIdResponse,
    zPostIntentsData,
    zPostIntentsResponse,
} from '../gen/zod.gen';
import { chainContexts } from '../chains';
import { ApiError, sendError } from '../errors';
import { getIntent, IntentRecord, saveIntent } from '../services/intentRepo';
import { QuoteExecutionPlan, takeQuote } from '../services/quoteCache';
import { toCaip2 } from '../caip2';

type SubmitData = z.infer<typeof zPostIntentsData>;
type SubmitResponse = z.infer<typeof zPostIntentsResponse>;
type IntentStatusResponse = z.infer<typeof zGetIntentsByIdResponse>;

export const postIntent = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const data = zPostIntentsData.parse({
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
        const data = zGetIntentsByIdData.parse({
            body: undefined,
            path: req.params,
            query: req.query,
            headers: req.headers,
        });
        const intent = getIntent(data.path.id);
        const out = toStatusResponse(intent);
        console.log('Response: ', jsonify(out));
        resp.status(200).json(out);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};

const toStatusResponse = (intent: IntentRecord): IntentStatusResponse => ({
    status: intent.status,
    fillTimestamp: intent.fillTimestamp,
    fillTransactionHash: intent.fillTransactionHash,
    destinationChainId: toCaip2(intent.destinationChainId),
    accountAddress: intent.accountAddress,
    claims: intent.claims.map((c) => ({
        chainId: toCaip2(c.chainId),
        status: c.status,
        claimTimestamp: c.claimTimestamp,
        claimTransactionHash: c.claimTransactionHash,
    })),
});

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
