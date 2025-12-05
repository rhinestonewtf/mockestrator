import { Request, Response } from "express";
import { getAddress } from "viem";
import { jsonify, logRequest } from "../log";
import { GetAccountsByUserAddressPortfolioResponse } from "../gen";
import { zGetAccountsByUserAddressPortfolioData } from "../gen/zod.gen";
import z, { ZodError } from "zod";
import { chainContexts } from "../chains";

type PortfolioRequestData = z.infer<typeof zGetAccountsByUserAddressPortfolioData>

export const portfolio = async (req: Request, resp: Response) => {
    logRequest(req)

    try {
        const params = zGetAccountsByUserAddressPortfolioData.parse({
            body: req.body,
            path: req.params,
            query: req.query,
            headers: req.headers
        })
        const body = await getPortfolio(params)
        console.log('Response: ', jsonify(body))
        resp.status(200).json(body)
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

type PortfolioBalance = {
    decimals: number,
    amount: number,
    chainBalance: {
        [key: number]: {
            [key: string]: number
        }
    }
}

const getPortfolio = async (params: PortfolioRequestData): Promise<GetAccountsByUserAddressPortfolioResponse> => {
    const userAddress = getAddress(params.path.userAddress)

    const balancesOfBalances = await Promise.all(Object.values(chainContexts()).map(async (chainContext) => chainContext.balanceOf(userAddress, chainContext.supportedTokens())))

    const balanceMap = balancesOfBalances.reduce<{ [key: string]: PortfolioBalance }>((outerMap, balances) => {
        return balances.reduce<{ [key: string]: PortfolioBalance }>((innerMap, balance) => {
            let currentEntry = innerMap[balance.symbol]
            if (!currentEntry) {
                currentEntry = {
                    decimals: balance.decimals,
                    amount: 0,
                    chainBalance: {}
                }
                innerMap[balance.symbol] = currentEntry
            }
            currentEntry.amount += Number(balance.amount)

            let currentChainBalance = currentEntry.chainBalance[balance.chainId]
            if (!currentChainBalance) {
                currentChainBalance = {}
                currentEntry.chainBalance[balance.chainId] = currentChainBalance
            }

            let currentTokenBalance = currentChainBalance[balance.token]
            if (!currentTokenBalance) {
                currentTokenBalance = 0
                currentChainBalance[balance.token] = currentTokenBalance
            }

            currentEntry.chainBalance[balance.chainId][balance.token] += Number(balance.amount)

            return innerMap
        }, outerMap)
    }, {})

    return {
        portfolio: Object.entries(balanceMap).map(([symbol, portfolio]) => {
            return {
                tokenName: symbol,
                tokenDecimals: portfolio.decimals,
                balance: {
                    locked: 0,
                    unlocked: portfolio.amount
                },
                tokenChainBalance: Object.entries(portfolio.chainBalance).flatMap(([chainId, tokenBalance]) => {
                    return Object.entries(tokenBalance).map(([token, amount]) => {
                        return {
                            chainId: parseInt(chainId),
                            tokenAddress: token,
                            balance: {
                                locked: 0,
                                unlocked: amount
                            }
                        }
                    })
                })
            }
        })
    }
}