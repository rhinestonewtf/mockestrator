import { Request, Response } from 'express';
import { z } from 'zod';
import { jsonify, logRequest } from '../log';
import { chainContexts } from '../chains';
import { zGetChainsResponse } from '../gen/zod.gen';
import { toCaip2 } from '../caip2';
import { sendError } from '../errors';

type ChainsResponse = z.infer<typeof zGetChainsResponse>;

export const chains = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const contexts = chainContexts();
        const result: ChainsResponse = {};

        for (const ctx of Object.values(contexts)) {
            result[toCaip2(ctx.chainId)] = {
                name: ctx.chainName,
                supportedTokens: ctx.supportedTokens().map((symbol) => ({
                    symbol,
                    address: ctx.getTokenAddress(symbol),
                    decimals: ctx.tokenDecimals(symbol) ?? 0,
                })),
                testnet: ctx.isTestnet,
            };
        }

        console.log('Response: ', jsonify(result));
        resp.status(200).json(result);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};
