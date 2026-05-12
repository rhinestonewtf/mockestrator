import { Request, Response } from 'express';
import { z } from 'zod';
import { jsonify, logRequest } from '../log';
import { zGetLiquidityData, zGetLiquidityResponse } from '../gen/zod.gen';
import { sendError } from '../errors';

type LiquidityResponse = z.infer<typeof zGetLiquidityResponse>;

export const liquidity = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        zGetLiquidityData.parse({
            body: undefined,
            path: undefined,
            query: req.query,
            headers: req.headers,
        });
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
