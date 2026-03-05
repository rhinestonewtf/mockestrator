import { Request, Response } from "express";
import { jsonify, logRequest } from "../log";
import { zPostIntentsRouteData } from "../gen/zod.gen";
import { z, ZodError } from "zod";
import { Address, getAddress, hexToBigInt } from "viem";
import { randomBytes } from "crypto";
import { chainContexts } from "../chains";

type UserIntent = z.infer<typeof zPostIntentsRouteData>

type AccountAccessListType = NonNullable<UserIntent["body"]>["accountAccessList"];

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

const create_intent_route = async (data: UserIntent): Promise<any> => {

    const userIntent = data.body!

    const sponsor = getAddress(userIntent.account.address)
    // there should be a way to specify different address
    const recipient = sponsor
    // do we need it or we can put to random value
    const arbiter = "0xdead00000000000000000000000000000000beef"

    const maxNonce = (1n << 63n) - 1n
    const randomBigInt = (hexToBigInt('0x' + randomBytes(8).toString('hex') as `0x${string}`) % maxNonce) + 1n

    const currentDate = Math.floor(Date.now() / 1000);
    const expires = currentDate + 3600 // expires in 1h

    const destinatinoChain = userIntent.destinationChainId
    const sourceChain = extractSourceChain(userIntent.accountAccessList)

    const qualifier = (() => {
        if (sourceChain == destinatinoChain) {
            return {
                settlementContext: {
                    settlementLayer: "INTENT_EXECUTOR" as const,
                    fundingMethod: "NO_FUNDING" as const,
                    using7579: true as const,
                    gasRefund: {
                        token: "0x0000000000000000000000000000000000000000",
                        exchangeRate: 0,
                        overhead: 0
                    }
                },
                encodedVal: "0xff"
            }
        } else {
            return {
                settlementContext: {
                    settlementLayer: "ACROSS" as const,
                    fundingMethod: "PERMIT2" as const,
                    using7579: true
                },
                encodedVal: "0xff"
            }
        }
    })()


    const tokenOut = userIntent.tokenRequests.map((transfer) => {
        // TODO: a check if token is supported by our mock system?

        return [hexToBigInt(transfer.tokenAddress as Address), transfer.amount]
    })

    // Map destinationExecutions to the Op format expected by the SDK.
    // Each execution must have { to, value, data } — the SDK's Execution type.
    const destOps = (userIntent.destinationExecutions ?? []).map((exec: any) => ({
        to: exec.to,
        value: exec.value ?? 0n,
        data: exec.data,
    }))

    // The vt field encodes execType (byte 0) and sigMode (byte 1).
    // 0x02 = batch execution, 0x01 = ERC-1271 signature mode.
    const destOpsVt = destOps.length > 0
        ? "0x0201000000000000000000000000000000000000000000000000000000000000"
        : "0x0000000000000000000000000000000000000000000000000000000000000000"

    return {
        intentOp: {
            sponsor,
            nonce: randomBigInt,
            targetExecutionNonce: randomBigInt,
            expires: BigInt(expires),
            elements: [
                {
                    arbiter,
                    chainId: BigInt(sourceChain),
                    idsAndAmounts: [],
                    spendTokens: [],
                    beforeFill: false,
                    mandate: {
                        recipient,
                        tokenOut,
                        destinationChainId: BigInt(userIntent.destinationChainId),
                        fillDeadline: BigInt(expires),
                        preClaimOps: { vt: "0x0000000000000000000000000000000000000000000000000000000000000000", ops: [] },
                        destinationOps: { vt: destOpsVt, ops: destOps },
                        qualifier,
                        v: 0,
                        minGas: 0n
                    }
                }
            ],
            serverSignature: "4f8c3b1d2f3a7e61c8f4a9170a4b2f8e5c9d0b6a3c7e8f4a9172b3c1d4e5f6a0",
            signedMetadata: {
                tokenPrices: {
                    "ETH": 123,
                    "USDC": 123,
                    "WETH": 123,
                    "USDT0": 123,
                    "XDAI": 123,
                    "POL": 123,
                    "WPOL": 123,
                    "S": 123,
                    "USDT": 123,
                    "XPL": 123,
                    "WXPL": 123
                },
                fees: {},
                gasPrices: {},
                account: {
                    ...userIntent.account,
                    accountContext: {
                        [destinatinoChain]: {
                            accountType: "smartAccount" as const,
                            isDeployed: false,
                            isERC7579: true,
                            erc7579AccountType: "Nexus",
                            erc7579AccountVersion: "1.0.0",
                        }
                    },
                },
                opGasParams: { estimatedCalldataSize: 0 },
                quotes: {},
            }
        },
        intentCost: {
            hasFulfilledAll: true,
            tokensSpent: {},
            tokensReceived: [],
            sponsorFee: {
                relayer: 0,
                protocol: 0
            }
        }
    }
}

function extractSourceChain(accountAccessList: AccountAccessListType | undefined): number {
    if (!accountAccessList) {
        return parseInt(Object.keys(chainContexts())[0])
    }


    // Case 1: array of { chainId, tokenAddress }
    if (Array.isArray(accountAccessList) && accountAccessList.length > 0) {
        return accountAccessList[0].chainId;
    }

    // Case 2: object with optional chainIds
    if (!Array.isArray(accountAccessList) && accountAccessList.chainIds?.length) {
        return accountAccessList.chainIds[0];
    }

    throw new Error('Unreachable')
}
