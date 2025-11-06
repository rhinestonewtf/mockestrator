import z from "zod"
import { zGetIntentOperationByIdResponse } from "../gen/zod.gen"


type IntentData = z.infer<typeof zGetIntentOperationByIdResponse>

let intents: Record<string, IntentData> = {}


class IntentNotFoundError extends Error {
    constructor(intentId: bigint) {
        super(`Intent not found: ${intentId}`)
        this.name = 'IntentNotFoundError'
    }
}

const getIntentById = async (intentId: bigint): Promise<IntentData> => {
    const intent = intents[intentId.toString()]
    if (!intent) {
        throw new IntentNotFoundError(intentId)
    }
    return intent
}

const addNewIntent = async (id: bigint, intent: IntentData) => {
    intents[id.toString()] = intent
}


export {
    IntentData, getIntentById, addNewIntent, IntentNotFoundError
}