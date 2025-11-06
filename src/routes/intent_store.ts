import { ZodError, z } from "zod"
import { jsonify, logRequest } from "../log"
import { Request, Response } from "express"
import { zPostIntentOperationsData, zPostIntentOperationsResponse } from "../gen/zod.gen"
import { addNewIntent, IntentData } from "../services/intentRepo"
import { keccak256 } from "viem"
import { randomBytes } from "crypto"

type SignedIntentData = z.infer<typeof zPostIntentOperationsData>

type SignedIntentResponse = z.infer<typeof zPostIntentOperationsResponse>

export const intent_store = async (req: Request, resp: Response) => {
    logRequest(req)

    try {
        const params = zPostIntentOperationsData.parse({
            body: req.body,
            query: undefined,
            path: undefined,
            headers: req.headers
        })
        const body = await executeIntent({
            ...params,
        })
        console.log('Response: ', jsonify(body))
        resp.status(201).json(body)
    } catch (e) {
        console.log(e)

        if (e instanceof ZodError) {
            resp.status(400).json({
                'error': `${e}`
            })
        } else {
            resp.status(500).json({
                'error': `${e}`
            })
        }
    }
}

const executeIntent = async (signedIntentData: SignedIntentData): Promise<SignedIntentResponse> => {
    const signedIntent = signedIntentData.body!.signedIntentOp

    let intent: IntentData = {
        status: "PENDING",
        claims: []
    }
    await addNewIntent(signedIntent.nonce, intent)

    try {
        // do all the chain work
        // create tx
        intent.status = "PRECONFIRMED"
        intent.fillTimestamp = Date.now() / 1000
        intent.fillTransactionHash = keccak256(randomBytes(32))
        // wait for tx to finish

        intent.status = "COMPLETED"
    } catch (e) {
        intent.status = "FAILED"
        throw e
    }

    return {
        result: {
            id: signedIntent.nonce,
            status: "PENDING"
        }
    }
}