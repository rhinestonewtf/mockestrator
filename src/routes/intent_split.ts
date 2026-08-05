import { Request, Response } from 'express';
import { z } from 'zod';
import { jsonify, logRequest } from '../log';
import { zGetSplitData, zGetSplitResponse } from '../gen/zod.gen';
import { sendError } from '../errors';

type SplitData = z.infer<typeof zGetSplitData>;
type SplitResponse = z.infer<typeof zGetSplitResponse>;

export const intent_split = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const params = zGetSplitData.parse({
            body: req.body,
            path: undefined,
            query: undefined,
            headers: req.headers,
        });
        const body = createSplitResponse(params);
        console.log('Response: ', jsonify(body));
        resp.status(200).json(body);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};

const createSplitResponse = (data: SplitData): SplitResponse => {
    const tokens = data.body?.tokens ?? {};
    const single: Record<string, string> = {};
    for (const [address, amount] of Object.entries(tokens)) {
        single[address] = amount.toString();
    }
    return { intents: Object.keys(single).length > 0 ? [single] : [] };
};
