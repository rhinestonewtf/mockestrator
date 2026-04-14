import { Request, Response } from "express";
import { logRequest } from "../log";
import { zPostIntentsSplitData } from "../gen/zod.gen";
import { ZodError } from "zod";

export const intent_split = async (req: Request, resp: Response) => {
    logRequest(req)

    try {
        zPostIntentsSplitData.parse({
            body: req.body,
            query: undefined,
            path: undefined,
            headers: req.headers
        })

        resp.status(200).json({ intents: [] })
    } catch (e) {
        if (e instanceof ZodError) {
            resp.status(400).json({ 'error': `${e}` })
        } else {
            resp.status(500).json({ 'error': `${e}` })
        }
    }
}
