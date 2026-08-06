import { Request, Response } from 'express';
import { z } from 'zod';
import { jsonify, logRequest } from '../log';
import { zListLiquidityData, zListLiquidityResponse } from '../gen/zod.gen';
import { sendError } from '../errors';
import { toEvmChainId } from '../caip2';

type LiquidityResponse = z.infer<typeof zListLiquidityResponse>;

export const liquidity = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const data = zListLiquidityData.parse({
            body: undefined,
            path: undefined,
            query: req.query,
            headers: req.headers,
        });
        // The query schema allows non-EVM destinations. Reject them here too, so a
        // liquidity probe can't report a chain as fillable that `POST /quotes` refuses.
        toEvmChainId(data.query.destinationChainId);

        const out: LiquidityResponse = {
            symbol: 'MOCK',
            decimals: 18,
            unlimited: true,
            maxAmount: null,
        };
        console.log('Response: ', jsonify(out));
        resp.status(200).json(out);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};
