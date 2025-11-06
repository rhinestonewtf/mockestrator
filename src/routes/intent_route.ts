import { Request, Response } from "express";
import { jsonify, logRequest } from "../log";
import { zPostIntentsRouteData, zPostIntentsRouteResponse } from "../gen/zod.gen";
import { z, ZodError } from "zod";
import { getAddress, hexToBigInt } from "viem";
import { randomBytes } from "crypto";

type UserIntent = z.infer<typeof zPostIntentsRouteData>

type UserIntentRouteResponse = z.infer<typeof zPostIntentsRouteResponse>

export const intent_route = async (req: Request, resp: Response) => {
    logRequest(req)

    try {
        const params = zPostIntentsRouteData.parse({
            body: req.body,
            query: undefined,
            path: undefined,
            headers: req.headers
        })
        const body = await create_intent_route({
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

const create_intent_route = async (data: UserIntent): Promise<UserIntentRouteResponse> => {

    const userIntent = data.body!

    const sponsor = getAddress(userIntent.account.address)
    // there should be a way to specify different address
    const recipient = sponsor
    // do we need it or we can put to random value
    const arbiter = "0xdead00000000000000000000000000000000beef"

    const randomBigInt = hexToBigInt('0x' + randomBytes(32).toString('hex') as `0x${string}`);

    const currentDate = Math.floor(Date.now() / 1000);
    const expires = currentDate + 3600 // expires in 1h

    return {
        intentOp: {
            sponsor,
            nonce: randomBigInt,
            expires: BigInt(expires),
            elements: [
                {
                    arbiter,
                    chainId: 11155111n, //TODO: select from intentOp.accountAccessList or take first supported chain
                    idsAndAmounts: [],
                    spendTokens: [],
                    mandate: {
                        recipient,
                        tokenOut: [],
                        destinationChainId: BigInt(userIntent.destinationChainId),
                        fillDeadline: BigInt(expires),
                        preClaimOps: [],
                        destinationOps: [],
                        qualifier: {
                            settlementContext: {
                                settlementLayer: "ACROSS"
                            },
                            encodedVal: "0xfefe"
                        },
                        v: 0,
                        minGas: 0n
                    }
                }
            ],
            serverSignature: "4f8c3b1d2f3a7e61c8f4a9170a4b2f8e5c9d0b6a3c7e8f4a9172b3c1d4e5f6a0",  // random, doesn't mean anything
            signedMetadata: {
                tokenPrices: {},
                gasPrices: {},
                account: {
                    address: "",
                    accountType: "",
                    accountContext: {}
                }
            }
        },
        intentCost: {
            tokensSpent: {},
            tokensReceived: []
        }
    }
}