import { ZodError, z } from "zod"
import { jsonify, logRequest } from "../log"
import { Request, Response } from "express"
import { zPostIntentOperationsData, zPostIntentOperationsResponse } from "../gen/zod.gen"
import { addNewIntent } from "../services/intentRepo"
import { Address, encodeAbiParameters, encodePacked, fromHex, getAddress, Hex, pad, slice, toHex, zeroAddress } from "viem"
import { AddressSchema, BigIntSchema, chainContexts, VarHex } from "../chains"

type SignedIntentData = z.infer<typeof zPostIntentOperationsData>

type SignedIntentResponse = z.infer<typeof zPostIntentOperationsResponse>

export const intent_store = async (req: Request, resp: Response) => {
    logRequest(req)
    console.log('[intent_store] handler entered')

    try {
        const params = zPostIntentOperationsData.parse({
            body: req.body,
            query: undefined,
            path: undefined,
            headers: req.headers
        })
        console.log('[intent_store] Zod parsing succeeded')
        const body = await executeIntent({
            ...params,
        })
        console.log('Response: ', jsonify(body))
        resp.status(201).json(body)
    } catch (e) {
        console.log('[intent_store] ERROR:', e)

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

    const sponsor = getAddress(signedIntent.sponsor)
    const recipient = getAddress(signedIntent.elements[0].mandate.recipient)
    const destinationChain = Number(signedIntent.elements[0].mandate.destinationChainId)
    const nonce = BigInt(signedIntent.nonce)

    const executor = chainContexts()[destinationChain]

    const destinationOps = toDestinationOpsEncoded(signedIntent.elements)
    const destinationSignature = (signedIntent.destinationSignature ?? '0x') as Hex

    const hasDestinationOps = destinationOps && destinationOps !== '0x'
    const hasValidDestinationSignature = destinationSignature &&
        destinationSignature !== '0x' &&
        destinationSignature.length > 2 &&
        !isFakeSignature(destinationSignature)

    console.log(`[intent_store] sponsor=${sponsor}, recipient=${recipient}, chain=${destinationChain}`)
    console.log(`[intent_store] destinationOps=${destinationOps}, hasDestOps=${hasDestinationOps}`)
    console.log(`[intent_store] destSig=${destinationSignature.slice(0, 10)}..., hasValidDestSig=${hasValidDestinationSignature}`)

    if (hasDestinationOps && !hasValidDestinationSignature) {
        throw new Error('Destination signature required for destination operations')
    }

    let txHash: Hex

    if (hasDestinationOps) {
        console.log('Executing via IntentExecutor with signature verification')
        txHash = await executeIntentExecutorFlow(
            executor,
            signedIntent,
            sponsor,
            nonce,
            recipient,
            destinationOps,
            destinationSignature
        )
    } else {
        console.log('Executing via FakeRouter')
        txHash = await executeLegacyFlow(executor, signedIntent, recipient)
    }

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

// fallback path for intents without destination ops, intent executor requires a destination signature
const executeLegacyFlow = async (
    executor: ReturnType<typeof chainContexts>[number],
    signedIntent: any,
    recipient: Address
): Promise<Hex> => {
    // Skip setupOps from the SDK — they install ERC-7579 modules on smart accounts
    // that don't exist on the anvil forks (accounts are virtual/counterfactual)
    const setupCalls: { to: Address; callData: Hex }[] = []

    const tokenTransfers = toTokenTransfers(signedIntent.elements)
    console.log(`[legacy] tokenTransfers: ${JSON.stringify(tokenTransfers.map(t => ({ addr: t.address, val: t.value.toString() })))}`)
    const tokenTransferCalls = tokenTransfers
        .filter((t) => t.address != zeroAddress)
        .map((transfer) => ({
            to: transfer.address,
            callData: executor.transfer(recipient, transfer.value)
        }))

    const destinationOps = toDestinationOps(signedIntent.elements)
    console.log(`[legacy] destinationOps count: ${destinationOps.length}`)
    const executions = [...setupCalls, ...tokenTransferCalls, ...destinationOps]
    console.log(`[legacy] total executions: ${executions.length}, calls: ${JSON.stringify(executions.map(e => e.to))}`)

    const nativeTransferValue = tokenTransfers.filter((t) => t.address == zeroAddress).map((t) => t.value)[0] ?? 0n
    console.log(`[legacy] nativeTransferValue: ${nativeTransferValue}`)

    if (executions.length === 0 && nativeTransferValue === 0n) {
        console.log('[legacy] no executions, no native transfer — returning zero hash')
        return '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex
    }

    if (executions.length === 0 && nativeTransferValue > 0n) {
        console.log('[legacy] native-only transfer')
        return executor.execute({ to: recipient, callData: '0x' as Hex, value: nativeTransferValue })
    }

    console.log('[legacy] executing via FakeRouter')
    const txCallData = await executor.callFakeRouter(executions)
    return executor.execute({ ...txCallData, value: nativeTransferValue })
}

const executeIntentExecutorFlow = async (
    executor: ReturnType<typeof chainContexts>[number],
    signedIntent: any,
    sponsor: Address,
    nonce: bigint,
    recipient: Address,
    destinationOps: Hex,
    destinationSignature: Hex
): Promise<Hex> => {
    const tokenTransfers = toTokenTransfers(signedIntent.elements)
    const tokenTransferCalls = tokenTransfers
        .filter((t) => t.address != zeroAddress)
        .map((transfer) => ({
            to: transfer.address,
            callData: executor.transfer(recipient, transfer.value)
        }))

    const nativeTransferValue = tokenTransfers.filter((t) => t.address == zeroAddress).map((t) => t.value)[0] ?? 0n

    // Skip setupOps — smart accounts are counterfactual on anvil forks
    const routerCalls = [
        ...tokenTransferCalls,
        executor.intentExecutorCall(sponsor, nonce, destinationOps, destinationSignature)
    ]

    const txCallData = await executor.callFakeRouter(routerCalls)
    const routerTxHash = await executor.execute({ ...txCallData, value: nativeTransferValue })

    return routerTxHash
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
    return elements.flatMap((element) => {
        const destOps = element.mandate.destinationOps as unknown[] | { vt: string; ops: unknown[] } | undefined
        // SDK 1.1.0 sends destinationOps as { vt, ops } instead of array
        // Handle both old format (array) and new format ({ vt, ops })
        const opsArray = Array.isArray(destOps) ? destOps : ((destOps as { ops?: unknown[] })?.ops ?? [])
        return DestinationOps.parse(opsArray)
    })
}

function toDestinationOpsEncoded(elements: { mandate: { destinationOps: unknown } }[]): Hex {
    const allOps: { to: Address; value: bigint; data: Hex }[] = []
    let execType = 0x02  
    let sigMode = 0x01   

    for (const element of elements) {
        const destOps = element.mandate.destinationOps as { vt?: string; ops?: unknown[] } | undefined
        if (!destOps || !destOps.ops || destOps.ops.length === 0) {
            continue
        }

        // extract execType and sigMode from the first element's vt field
        if (allOps.length === 0 && destOps.vt) {
            const vt = destOps.vt as Hex
            execType = fromHex(slice(vt, 0, 1), 'number')
            sigMode = fromHex(slice(vt, 1, 2), 'number')
        }

        for (const op of destOps.ops) {
            const parsed = DestinationOpWithValue.parse(op)
            allOps.push(parsed)
        }
    }

    if (allOps.length === 0) {
        return '0x' as Hex
    }

    const encodedExecs = encodeAbiParameters(
        [
            {
                type: 'tuple[]',
                components: [
                    { type: 'address', name: 'to' },
                    { type: 'uint256', name: 'value' },
                    { type: 'bytes', name: 'data' },
                ],
            },
        ],
        [allOps]
    )

    return encodePacked(
        ['uint8', 'uint8', 'bytes'],
        [execType, sigMode, encodedExecs]
    )
}

const DestinationOpWithValue = z.object({
    to: AddressSchema,
    value: z.union([BigIntSchema, z.string()]).transform((v) => BigInt(v)),
    data: VarHex
}).transform((v) => ({
    to: v.to,
    value: v.value,
    data: v.data
}))

function isFakeSignature(signature: Hex): boolean {
    if (!signature || signature === '0x') return true
    const sigWithoutPrefix = signature.slice(2)
    return /^0+$/.test(sigWithoutPrefix)
}
