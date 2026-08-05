import { Request, Response } from 'express';
import { Address, getAddress, Hex } from 'viem';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { jsonify, logRequest } from '../log';
import { zCreateQuoteData, zCreateQuoteResponse } from '../gen/zod.gen';
import { chainContexts } from '../chains';
import { fromCaip2, isCaip2, toCaip2 } from '../caip2';
import { ApiError, sendError } from '../errors';
import { saveQuote } from '../services/quoteCache';

type QuoteRequestData = z.infer<typeof zCreateQuoteData>;
type QuoteResponseData = z.infer<typeof zCreateQuoteResponse>;
type QuoteRequestBody = NonNullable<QuoteRequestData['body']>;
type AccountAccessList = NonNullable<QuoteRequestBody['accountAccessList']>;

export const quote = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const data = zCreateQuoteData.parse({
            body: decodeChainIdArrays(req.body),
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

// `chainIds` arrays arrive CAIP-2 on the wire, but the published spec types them
// numeric: the orchestrator decodes CAIP-2 in a Zod `preprocess`, which OpenAPI
// generation cannot see. Decode before validating so the mock accepts the same
// payloads production does. Recursive because `accountAccessList.exclude` repeats
// the same fields.
const decodeChainIdArrays = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(decodeChainIdArrays);
    if (!node || typeof node !== 'object') return node;

    return Object.fromEntries(
        Object.entries(node).map(([key, value]) => [
            key,
            key === 'chainIds' && Array.isArray(value)
                ? value.map((id) => (isCaip2(id) ? fromCaip2(id) : id))
                : decodeChainIdArrays(value),
        ]),
    );
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

    // Numeric, not CAIP-2: the SDK feeds this domain straight into viem's
    // `hashDomain` (uint256).
    const buildTyped = (chainId: number) => ({
        domain: {
            name: 'Mockestrator',
            version: '1',
            chainId,
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
                gas: { usd: 0, sponsored: false },
                bridge: { usd: 0, sponsored: false },
                swap: { usd: 0, sponsored: false },
                app: { usd: 0, sponsored: false },
                protocol: { usd: 0, sponsored: false },
                sponsorSurcharge: { usd: 0, sponsored: false },
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
        return list.chainIds[0];
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
