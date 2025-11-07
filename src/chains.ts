import fs from "fs";
import path from "path";
import { ChainEntry, chainRegistry, chains } from "@rhinestone/shared-configs"
import { Account, Address, Chain, createTestClient, createWalletClient, encodeAbiParameters, encodeFunctionData, encodePacked, erc20Abi, getAddress, Hash, Hex, http, keccak256, multicall3Abi, numberToHex, pad, publicActions, stringToHex, toHex, Transport, zeroAddress } from "viem";
import { getTokenAddress, TokenSymbol } from "@rhinestone/sdk";
import z from "zod";
import { privateKeyToAccount } from 'viem/accounts'
import { fakeRouterAbi } from "./abi/fakeRouter";


const chainMap: Record<number, Chain> = Object.fromEntries(chains.map(c => [c.id, c]));

export const supportedTokens: TokenSymbol[] = ['ETH', 'USDC']

export const NATIVE_TOKEN: Address = "0x0000000000000000000000000000000000000000"

export type Balance = {
    symbol: TokenSymbol
    token: Address,
    amount: BigInt,
    decimals: number,
    chainId: number,
}

export class ChainContext {

    private walletClient

    private testClient

    private tokens

    constructor(private chainId: number, account: Account, private chainEntry: ChainEntry, private chainConfig: ChainConfig) {
        const transport = http(chainConfig.rpc)
        this.walletClient = createWalletClient({
            account,
            transport,
            chain: chainMap[chainId]!
        }).extend(publicActions)

        let tokens: Record<Address, {
            decimals: number;
            balanceSlot: number | null;
            approvalSlot: number | null;
        }> = {}
        for (const tokenEntry of chainEntry.tokens) {
            tokens[tokenEntry.address] = tokenEntry
        }
        this.tokens = tokens

        this.testClient = createTestClient({
            chain: this.walletClient.chain,
            mode: "anvil",
            transport,
        });
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

            const amount = await this.walletClient.getBalance({ address })
            return {
                ...token,
                amount,
            }
        })

        const erc20Tokens = tokens.filter((token) => token.symbol != 'ETH')

        const erc20Calls = erc20Tokens.map((token) => {
            return {
                address: token.token,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [address]
            }
        })

        const erc20CallsPromise = this.walletClient.multicall({ contracts: erc20Calls }).then((res) => res.map((v) => v.result ?? 0n))

        const [erc20Balances, ...nativeBalances] = await Promise.all([erc20CallsPromise, ...nativeCallsPromises])


        return erc20Tokens.map((token, i) => { return { ...token, amount: BigInt(erc20Balances[i]) } }).concat(nativeBalances)
    }

    public transferFrom(to: Address, amount: bigint): Hex {
        return encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transferFrom',
            args: [this.walletClient.account.address, to, amount]
        })
    }

    public transfer(to: Address, amount: bigint): Hex {
        return encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [to, amount]
        })
    }

    public multicall(calls: { to: Address, callData: Hex }[]): { to: Address, callData: Hex } {

        const multicallContract = this.walletClient.chain.contracts?.multicall3
        if (!multicallContract) {
            throw new Error(`Chain ${this.walletClient.chain.name} doesnt support multicall contract`)
        }

        const data = encodeFunctionData({
            abi: multicall3Abi,
            functionName: 'aggregate3',
            args: [calls.map((call) => { return { target: call.to, allowFailure: false, callData: call.callData } })]
        })

        return {
            to: multicallContract.address,
            callData: data
        }
    }

    public async execute(execution: { to: Address, callData: Hex, value: bigint }): Promise<Hash> {
        const receipt = await this.walletClient.sendTransactionSync({
            to: execution.to,
            value: execution.value,
            data: execution.callData,
        })
        if (receipt.status == 'reverted') {
            throw new Error(`Transaction ${receipt.transactionHash} reverted`)
        }
        return receipt.transactionHash
    }

    public async setupAccount(chainConfig: ChainConfig) {
        for (const [addressStr, tokens] of Object.entries(chainConfig.funding)) {
            const address = getAddress(addressStr)
            for (const [symbol, value] of Object.entries(tokens)) {
                await this.fundAccount(address, symbol as TokenSymbol, value)
            }
        }

        for (const [ownerStr, approvals] of Object.entries(chainConfig.erc20approvals)) {
            const owner = getAddress(ownerStr)
            for (const [spenderStr, tokens] of Object.entries(approvals)) {
                const spender = getAddress(spenderStr)
                for (const [symbol, value] of Object.entries(tokens)) {
                    await this.approveSpending(owner, spender, symbol as TokenSymbol, value)
                }
            }
        }
    }

    public async fundAccount(account: Address, token: TokenSymbol, value: bigint) {
        const tokenAddress = getTokenAddress(token, this.chainId)
        if (tokenAddress == zeroAddress) {
            console.log(`${this.walletClient.chain.name}: Native balance for ${account} -> ${value}]`)
            await this.testClient.setBalance({
                address: account,
                value,
            })
        } else {
            const balanceSlot = this.tokens[tokenAddress].balanceSlot
            if (!balanceSlot) {
                throw new Error(`${token} at ${tokenAddress} config has undefined balance slot`)
            }
            const slot = keccak256(
                encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [account, BigInt(balanceSlot)]),
            );
            console.log(`${this.walletClient.chain.name}: Erc20 balance for ${account} on ${token} ( ${tokenAddress}) -> ${value}]`)
            await this.testClient.setStorageAt({
                address: tokenAddress,
                index: slot,
                value: pad(numberToHex(value)),
            })
        }
    }
    public async approveSpending(owner: Address, spender: Address, token: TokenSymbol, value: bigint) {
        const tokenAddress = getTokenAddress(token, this.chainId)
        if (tokenAddress == zeroAddress) {
            // skip natives
        } else {
            const approvalSlot = this.tokens[tokenAddress].approvalSlot
            if (!approvalSlot) {
                throw new Error(`${token} at ${tokenAddress} config has undefined approval slot`)
            }

            const inner = keccak256(encodePacked(["bytes32", "bytes32"], [pad(owner), pad(toHex(approvalSlot))]));
            const slot = keccak256(encodePacked(["bytes32", "bytes32"], [pad(spender), inner]))
            console.log(`${this.walletClient.chain.name}: Erc20 approval from ${owner}, to ${spender} on ${token} ( ${tokenAddress}) -> ${value}]`)
            await this.testClient.setStorageAt({
                address: tokenAddress,
                index: slot,
                value: pad(numberToHex(value)),
            })
        }
    }

    public async overrideCode(address: Address, code: Hex) {
        await this.testClient.setCode({
            address,
            bytecode: code
        })
    }

    public async callFakeRouter(calls: { to: Address, callData: Hex }[]): Promise<{ to: Address, callData: Hex }> {
        const encoded = encodeFunctionData({
            abi: fakeRouterAbi,
            functionName: 'mockFill',
            args: [calls.map((call) => { return { target: call.to, callData: call.callData } })]
        })

        return {
            to: this.chainConfig.routerAddress as Address,
            callData: encoded
        }
    }
}

const SupportedTokensSchema = z.union(supportedTokens.map(t => z.literal(t) as z.ZodLiteral<TokenSymbol>))


type ChainContexts = { [key: number]: ChainContext }

const fixedHex = (numbytes: number) => {
    return z.string().regex(
        new RegExp(`^0x[a-fA-F0-9]{${numbytes * 2}}$`),
        { message: `Expected 0x-prefixed hex string of ${numbytes} bytes` }
    )
}

const VarHex = z.string().regex(
    new RegExp(/^0x[a-fA-F0-9]+$/),
    { message: `Expected variable length 0x-prefixed hex string` }
)


const AddressSchema = fixedHex(20)

const BigIntSchema = z.coerce.bigint()

const ConfigSchema = z.record(z.string(), z.object({
    rpc: z.string(),
    relayerKey: fixedHex(32),
    relayerAddress: AddressSchema,
    funding: z.record(AddressSchema, z.record(SupportedTokensSchema, BigIntSchema)),
    routerAddress: AddressSchema,
    erc20approvals: z.record(AddressSchema, z.record(AddressSchema, z.record(z.string(), BigIntSchema)))
}))

type Config = z.infer<typeof ConfigSchema>

type ChainConfig = Config["rpc"]

const CodeSchema = z.record(AddressSchema, VarHex)
type CodeOverrides = z.infer<typeof CodeSchema>


async function loadChainContexts(): Promise<ChainContexts> {
    const filePath = process.env.RPCS ?? 'rpcs.json'
    const rawData = fs.readFileSync(path.resolve(filePath), "utf-8");
    const configJson = JSON.parse(rawData);
    const config: Config = ConfigSchema.parse(configJson)

    const codeFilePath = process.env.CODE ?? 'code.json'
    const codeRawData = fs.readFileSync(path.resolve(codeFilePath), "utf-8");
    const codeJson = JSON.parse(codeRawData);
    const codeOverrides: CodeOverrides = CodeSchema.parse(codeJson)


    let res: ChainContexts = {}

    for (const [key, chainConfig] of Object.entries(config)) {
        const chainId = parseInt(key);

        const chainEntry = chainRegistry[key]
        if (!chainEntry) {
            throw new Error(`Unsupported chain ${key} in rpcs file`)
        }

        const account = privateKeyToAccount(chainConfig.relayerKey as Hex)
        const accountAddress = getAddress(chainConfig.relayerAddress as Hex)
        if (account.address != accountAddress) {
            throw new Error(`Invalid configuration: expected relayer address: ${accountAddress} doesn't match derived from key: ${account.address}`)
        }

        const chainContext = new ChainContext(chainId, account, chainEntry, chainConfig)

        await chainContext.setupAccount(chainConfig)

        for (const [addressStr, code] of Object.entries(codeOverrides)) {
            await chainContext.overrideCode(getAddress(addressStr), code as Hex)
        }

        res[chainId] = chainContext
    }


    return res
}

let chainContextMap: ChainContexts | undefined

export const initContexts = async () => {
    chainContextMap = await loadChainContexts()
}

export const chainContexts = (): ChainContexts => {
    if (!chainContextMap) {
        throw new Error(`Chain contexts not initialized - please call initContexts()`)
    }
    return chainContextMap!
}

export function chainContext(chain: number): ChainContext {
    const chainContext = chainContexts()[chain]
    if (!chainContext) {
        throw new Error('Unsupported chain context ${chain}')
    }
    return chainContext
}