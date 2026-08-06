import { Request, Response } from 'express';
import { getAddress } from 'viem';
import { z } from 'zod';
import { jsonify, logRequest } from '../log';
import {
    zGetPortfolioData,
    zGetPortfolioResponse,
} from '../gen/zod.gen';
import { chainContexts } from '../chains';
import { sendError } from '../errors';
import { fromCaip2, toCaip2 } from '../caip2';
import { queryArray, queryBoolean } from '../query';

type PortfolioRequestData = z.infer<typeof zGetPortfolioData>;
type PortfolioResponse = z.infer<typeof zGetPortfolioResponse>;

export const portfolio = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        // OpenAPI uses `style: form, explode: true` for chainIds/tokens, so a single
        // `?chainIds=eip155:1` should still parse as an array. Express' default qs
        // parser surfaces it as a string — coerce before validation.
        const query = {
            ...req.query,
            chainIds: queryArray(req.query.chainIds),
            tokens: queryArray(req.query.tokens),
            filterEmpty: queryBoolean(req.query.filterEmpty),
        };
        const params = zGetPortfolioData.parse({
            body: undefined,
            path: req.params,
            query,
            headers: req.headers,
        });
        const body = await getPortfolio(params);
        console.log('Response: ', jsonify(body));
        resp.status(200).json(body);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};

const getPortfolio = async (params: PortfolioRequestData): Promise<PortfolioResponse> => {
    const accountAddress = getAddress(params.path.accountAddress);
    const filterChainIds = queryArray(params.query?.chainIds)?.map(fromCaip2);
    const filterEmpty = params.query?.filterEmpty ?? false;

    const contexts = Object.values(chainContexts()).filter((ctx) =>
        filterChainIds ? filterChainIds.includes(ctx.chainId) : true,
    );
    const balancesPerChain = await Promise.all(
        contexts.map(async (ctx) => ctx.balanceOf(accountAddress, ctx.supportedTokens())),
    );

    const bySymbol = new Map<string, PortfolioResponse['portfolio'][number]>();

    for (const balances of balancesPerChain) {
        for (const balance of balances) {
            if (filterEmpty && BigInt(balance.amount.toString()) === 0n) continue;
            let entry = bySymbol.get(balance.symbol);
            if (!entry) {
                entry = { symbol: balance.symbol, chains: [] };
                bySymbol.set(balance.symbol, entry);
            }
            entry.chains.push({
                chainId: toCaip2(balance.chainId),
                address: balance.token,
                decimals: balance.decimals,
                amount: balance.amount.toString(),
            });
        }
    }

    return { portfolio: Array.from(bySymbol.values()) };
};
