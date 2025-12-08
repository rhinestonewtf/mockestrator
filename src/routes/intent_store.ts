import { ZodError, z } from "zod"
import { jsonify, logRequest } from "../log"
import { Request, Response } from "express"
import { zPostIntentOperationsData, zPostIntentOperationsResponse } from "../gen/zod.gen"
import { addNewIntent, IntentData } from "../services/intentRepo"
import { Address, encodeFunctionData, erc20Abi, getAddress, Hex, keccak256, pad, stringToHex, toHex, zeroAddress } from "viem"
import { randomBytes } from "crypto"
import { AddressSchema, BigIntSchema, chainContexts, VarHex } from "../chains"

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

    const recipient = getAddress(signedIntent.elements[0].mandate.recipient)
    const destinationChain = Number(signedIntent.elements[0].mandate.destinationChainId)

    const executor = chainContexts()[destinationChain]

    const setupOps = signedIntent.signedMetadata.account.setupOps

    const setupCalls = setupOps ? setupOps.map((op) => {
        return {
            to: getAddress(op.to),
            callData: op.data as Hex
        }
    }) : []

    const tokenTransfers = toTokenTransfers(signedIntent.elements)
    const nativeTransferValue = tokenTransfers.filter((t) => t.address == zeroAddress).map((t) => t.value)[0] ?? 0n

    const erc20transfers = tokenTransfers.filter((t) => t.address != zeroAddress).map((t) => {
        return {
            to: t.address,
            callData: executor.transfer(recipient, t.value)
        }
    })

    const destinationOps = toDestinationOps(signedIntent.elements)

    const executions = [...setupCalls, ...erc20transfers, ...destinationOps]

    const txCallData = await executor.callFakeRouter(executions)

    const txHash = await executor.execute({ ...txCallData, value: nativeTransferValue })

    await addNewIntent(signedIntent.nonce, {
        userAddress: recipient,
        destinationChainId: BigInt(destinationChain),
        status: "COMPLETED" as const,
        fillTimestamp: Math.floor(Date.now() / 1000),
        fillTransactionHash: txHash,
        claims: []
    })

    return {
        result: {
            id: signedIntent.nonce,
            status: "PENDING"
        }
    }
}

type TokenTransfer = {
    address: Address
    value: bigint
}

const IdAndAmount = z.tuple([BigIntSchema, BigIntSchema]).transform((v) => {
    return {
        address: pad(toHex(BigInt(v[0])), { size: 20 }),
        value: BigInt(v[1])
    }
})

const IdsAndAmounts = z.array(IdAndAmount)

function toTokenTransfers(elements: { mandate: { tokenOut: unknown } }[]): TokenTransfer[] {
    return elements.flatMap((element) => IdsAndAmounts.parse(element.mandate.tokenOut))
}

const DestinationOp = z.object({
    to: AddressSchema,
    data: VarHex
}).transform((v) => {
    return {
        to: v.to,
        callData: v.data
    }
})

const DestinationOps = z.array(DestinationOp)

function toDestinationOps(elements: { mandate: { destinationOps: unknown } }[]): { to: Address, callData: Hex }[] {
    return elements.flatMap((element) => DestinationOps.parse(element.mandate.destinationOps))
}