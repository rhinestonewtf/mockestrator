import z, { ZodError } from "zod"
import { jsonify, logRequest } from "../log"
import { Request, Response } from "express"
import { zGetIntentOperationByIdData, zGetIntentOperationByIdResponse } from "../gen/zod.gen"
import { getIntentById, IntentNotFoundError } from "../services/intentRepo"

type IntentStatusData = z.infer<typeof zGetIntentOperationByIdData>
type IntentStatusResponse = z.infer<typeof zGetIntentOperationByIdResponse>

export const intent_status = async (req: Request, resp: Response) => {
    logRequest(req)

    try {
        const params = zGetIntentOperationByIdData.parse({
            body: undefined,
            query: req.query,
            path: req.params,
            headers: req.headers
        })
        const body = await getIntentStatus({
            ...params,
        })
        console.log('Response: ', jsonify(body))
        resp.status(200).json(body)
    } catch (e) {
        console.log(e)

        if (e instanceof ZodError) {
            resp.status(400).json({
                'error': `${e}`
            })
        } else if (e instanceof IntentNotFoundError) {
            resp.status(404).json({
                'error': `${e}`
            })
        } else {
            resp.status(500).json({
                'error': `${e}`
            })
        }
    }
}

const getIntentStatus = async (intentRequest: IntentStatusData): Promise<IntentStatusResponse> => {
    const intentId = BigInt(intentRequest.path.id)
    return await getIntentById(intentId)
}