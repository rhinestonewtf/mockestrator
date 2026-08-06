import { Request, Response } from 'express';
import { getAddress } from 'viem';
import { z } from 'zod';
import { jsonify, logRequest } from '../log';
import { zCreateQuoteEstimateData, zCreateQuoteEstimateResponse } from '../gen/zod.gen';
import { chainContexts } from '../chains';
import { fromCaip2, isCaip2 } from '../caip2';
import { ApiError, sendError } from '../errors';

type EstimateData = z.infer<typeof zCreateQuoteEstimateData>;
type EstimateResponse = z.infer<typeof zCreateQuoteEstimateResponse>;
type EstimateBody = NonNullable<EstimateData['body']>;
type EstimateLeg = EstimateResponse['routes'][number]['input'];

export const quoteEstimate = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const data = zCreateQuoteEstimateData.parse({
            body: req.body,
            path: undefined,
            query: undefined,
            headers: req.headers,
        });
        const body = data.body;
        if (!body) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Missing request body');
        }
        const out = buildEstimate(body);
        console.log('Response: ', jsonify(out));
        resp.status(200).json(out);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};

// The estimate is indicative and non-binding, so the mock quotes 1:1 with zero fees
// rather than modelling a route. Amounts echo whichever side the caller pinned.
const buildEstimate = (body: EstimateBody): EstimateResponse => {
    const sourceChainId = toEvmChainId(body.sourceChainId);
    const destinationChainId = toEvmChainId(body.destinationChainId);
    const amount = (body.direction === 'exactIn' ? body.amountIn : body.amountOut) ?? '0';

    const settlementLayer = sourceChainId === destinationChainId ? 'INTENT_EXECUTOR' : 'ACROSS';

    return {
        routes: [
            {
                settlementLayer,
                accuracy: 'approximated',
                status: 'ok',
                input: buildLeg(body.sourceChainId, sourceChainId, body.sourceToken, amount),
                output: buildLeg(
                    body.destinationChainId,
                    destinationChainId,
                    body.destinationToken,
                    amount,
                ),
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
                estimatedFillTime: { seconds: settlementLayer === 'INTENT_EXECUTOR' ? 1 : 5 },
            },
        ],
    };
};

const buildLeg = (
    caip2: string,
    chainId: number,
    tokenAddress: string,
    amount: string,
): EstimateLeg => {
    const address = getAddress(tokenAddress);
    const token = describeToken(chainId, address);
    return {
        chainId: caip2,
        tokenAddress: address,
        symbol: token?.symbol ?? 'UNKNOWN',
        decimals: token?.decimals ?? 0,
        // No price oracle in the mock; the field is explicitly nullable for that case.
        price: null,
        amount,
    };
};

// An estimate is indicative, so an unconfigured chain or unrecognised token is
// described generically rather than rejected.
const describeToken = (
    chainId: number,
    address: string,
): { symbol: string; decimals: number } | undefined => {
    const ctx = chainContexts()[chainId];
    if (!ctx) return undefined;
    const symbol = ctx.supportedTokens().find((s) => ctx.maybeAddress(s) === address);
    return symbol ? { symbol, decimals: ctx.tokenDecimals(symbol) ?? 0 } : undefined;
};

const toEvmChainId = (chainId: string): number => {
    if (!isCaip2(chainId)) {
        throw new ApiError(400, 'VALIDATION_ERROR', `Unsupported chain ${chainId}`);
    }
    return fromCaip2(chainId);
};
