import fs from "fs";
import path from "path";
import { ChainEntry, chainRegistry, chains } from "@rhinestone/shared-configs"
import { Address, Chain, createPublicClient, http, parseAbi, Transport } from "viem";
import { getTokenAddress, TokenSymbol } from "@rhinestone/sdk";


const chainMap: Record<number, Chain> = Object.fromEntries(chains.map(c => [c.id, c]));


const balancesAbi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
])

export type Balance = {
    symbol: TokenSymbol
    token: Address,
    amount: BigInt,
    decimals: number,
    chainId: number,
}

export class ChainContext {

    private rpcClient

    private tokens

    constructor(private chainId: number, private chainEntry: ChainEntry, transport: Transport) {
        this.rpcClient = createPublicClient({
            transport,
            chain: chainMap[chainId]!
        })

        let tokens: Record<Address, {
            decimals: number;
            balanceSlot: number | null;
            approvalSlot: number | null;
        }> = {}
        for (const tokenEntry of chainEntry.tokens) {
            tokens[tokenEntry.address] = tokenEntry
        }
        this.tokens = tokens
    }


    public async balanceOf(address: Address, tokenSymbols: TokenSymbol[]): Promise<Balance[]> {

        const tokens = tokenSymbols.map((symbol) => {
            const tokenAddress = getTokenAddress(symbol, this.chainId)
            return {
                symbol,
                decimals: this.tokens[tokenAddress].decimals,
                token: tokenAddress,
                chainId: this.chainId
            }
        })

        const nativeCallsPromises = tokens.filter((token) => token.symbol == 'ETH').map(async (token) => {

            const amount = await this.rpcClient.getBalance({ address })
            return {
                ...token,
                amount,
            }
        })

        const erc20Tokens = tokens.filter((token) => token.symbol != 'ETH')

        const erc20Calls = erc20Tokens.map((token) => {
            return {
                address: token.token,
                abi: balancesAbi,
                functionName: 'balanceOf',
                args: [address]
            }
        })

        const erc20CallsPromise = this.rpcClient.multicall({ contracts: erc20Calls }).then((res) => res.map((v) => v.result ?? 0n))

        const [erc20Balances, ...nativeBalances] = await Promise.all([erc20CallsPromise, ...nativeCallsPromises])


        return erc20Tokens.map((token, i) => { return { ...token, amount: erc20Balances[i] } }).concat(nativeBalances)
    }
}

function loadChainContexts(): { [key: number]: ChainContext } {
    const filePath = process.env.RPCS ?? 'rpcs.json'
    const rawData = fs.readFileSync(path.resolve(filePath), "utf-8");
    const config = JSON.parse(rawData);

    let res: { [key: number]: ChainContext } = {}

    for (const [key, value] of Object.entries(config)) {
        const chainId = parseInt(key);
        const rpcConfig = value as { rpc: string };

        const chainEntry = chainRegistry[key]
        if (!chainEntry) {
            throw new Error(`Unsupported chain ${key} in rpcs file`)
        }


        res[chainId] = new ChainContext(chainId, chainEntry, http(rpcConfig.rpc))
    }


    return res
}

export const chainContexts = loadChainContexts()

export function chainContext(chain: number): ChainContext {
    const chainContext = chainContexts[chain]
    if (!chainContext) {
        throw new Error('Unsupported chain context ${chain}')
    }
    return chainContext
}