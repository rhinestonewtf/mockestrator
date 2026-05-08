import { Request, Response } from 'express';
import { Address, getAddress, Hex } from 'viem';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { jsonify, logRequest } from '../log';
import { zPostQuotesData, zPostQuotesResponse } from '../gen/zod.gen';
import { chainContexts } from '../chains';
import { fromCaip2, toCaip2 } from '../caip2';
import { ApiError, sendError } from '../errors';
import { saveQuote } from '../services/quoteCache';

type QuoteRequestData = z.infer<typeof zPostQuotesData>;
type QuoteResponseData = z.infer<typeof zPostQuotesResponse>;
type QuoteRequestBody = NonNullable<QuoteRequestData['body']>;
type AccountAccessList = NonNullable<QuoteRequestBody['accountAccessList']>;

export const quote = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const data = zPostQuotesData.parse({
            body: req.body,
            path: undefined,
            query: undefined,
            headers: req.headers,
        });
        const body = data.body;
        if (!body) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Missing request body');
        }
        const out = await buildQuoteResponse(body);
        console.log('Response: ', jsonify(out));
        resp.status(200).json(out);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};

const buildQuoteResponse = async (body: QuoteRequestBody): Promise<QuoteResponseData> => {
    const destinationChainId = fromCaip2(body.destinationChainId);
    const sourceChainId = pickSourceChain(body.accountAccessList, destinationChainId);
    const accountAddress = getAddress(body.account.address);
    const recipientAddress = body.recipient ? getAddress(body.recipient.address) : accountAddress;

    const settlementLayer = sourceChainId === destinationChainId ? 'INTENT_EXECUTOR' : 'ACROSS';

    const tokenRequests = body.tokenRequests.map((req) => ({
        tokenAddress: getAddress(req.tokenAddress) as Address,
        amount: BigInt(req.amount ?? '0'),
    }));

    const destinationOps = (body.destinationExecutions ?? []).map((op) => ({
        to: getAddress(op.to) as Address,
        value: BigInt(op.value),
        data: op.data as Hex,
    }));

    const setupOps = (body.account.setupOps ?? []).map((op) => ({
        to: getAddress(op.to) as Address,
        data: op.data as Hex,
    }));

    const intentId = generateIntentId();
    const nonce = BigInt(intentId);

    saveQuote(intentId, {
        accountAddress,
        recipientAddress,
        sourceChainId,
        destinationChainId,
        tokenRequests,
        destinationOps,
        setupOps,
        settlementLayer,
        nonce,
    });

    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const signData = buildSignData(sourceChainId, destinationChainId, accountAddress, intentId);

    return {
        routes: [
            {
                intentId,
                expiresAt,
                estimatedFillTime: { seconds: settlementLayer === 'INTENT_EXECUTOR' ? 1 : 5 },
                settlementLayer,
                signData,
                cost: buildMockCost(destinationChainId, sourceChainId, tokenRequests),
            },
        ],
    };
};

const generateIntentId = (): string => {
    const max = 1n << 128n;
    const value = (BigInt('0x' + randomBytes(16).toString('hex')) % (max - 1n)) + 1n;
    return value.toString();
};

const buildSignData = (
    sourceChainId: number,
    destinationChainId: number,
    accountAddress: Address,
    intentId: string,
): QuoteResponseData['routes'][number]['signData'] => {
    const types = {
        Intent: [
            { name: 'account', type: 'address' },
            { name: 'intentId', type: 'uint256' },
        ],
    };
    const message = { account: accountAddress, intentId };
    const verifyingContract = '0x0000000000000000000000000000000000000000';

    // Despite the OpenAPI spec showing `domain.chainId` as a CAIP-2 string, the
    // SDK feeds the domain straight into viem's `hashDomain` (uint256), so the
    // production server actually emits a numeric chainId here.
    const buildTyped = (chainId: number) => ({
        domain: {
            name: 'Mockestrator',
            version: '1',
            chainId: chainId as unknown as string,
            verifyingContract,
        },
        types,
        primaryType: 'Intent',
        message,
    });

    return {
        origin: [buildTyped(sourceChainId)],
        destination: buildTyped(destinationChainId),
    };
};

const buildMockCost = (
    destinationChainId: number,
    sourceChainId: number,
    tokenRequests: { tokenAddress: Address; amount: bigint }[],
): QuoteResponseData['routes'][number]['cost'] => {
    const output = tokenRequests.map((req) => ({
        chainId: toCaip2(destinationChainId),
        tokenAddress: req.tokenAddress,
        symbol: null,
        decimals: null,
        price: null,
        amount: req.amount.toString(),
    }));
    const input = tokenRequests.map((req) => ({
        chainId: toCaip2(sourceChainId),
        tokenAddress: req.tokenAddress,
        symbol: null,
        decimals: null,
        price: null,
        amount: req.amount.toString(),
    }));
    return {
        input,
        output,
        fees: {
            total: { usd: 0 },
            breakdown: {
                gas: { usd: 0 },
                bridge: { usd: 0 },
                protocol: { usd: 0 },
                swap: { usd: 0 },
                settlement: { usd: 0 },
            },
        },
    };
};

const pickSourceChain = (list: AccountAccessList | undefined, fallback: number): number => {
    if (!list) {
        const first = Object.keys(chainContexts())[0];
        return first ? parseInt(first) : fallback;
    }
    if (list.chainIds && list.chainIds.length > 0) {
        return fromCaip2(list.chainIds[0]);
    }
    if (list.chainTokens) {
        const keys = Object.keys(list.chainTokens);
        if (keys.length > 0) return fromCaip2(keys[0]);
    }
    if (list.chainTokenAmounts) {
        const keys = Object.keys(list.chainTokenAmounts);
        if (keys.length > 0) return fromCaip2(keys[0]);
    }
    return fallback;
};
