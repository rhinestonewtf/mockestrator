import { describe, it, expect, afterEach } from 'vitest'
import {
  Address,
  createPublicClient,
  createTestClient,
  erc20Abi,
  http,
  parseEther,
  parseUnits,
  encodeFunctionData,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { RhinestoneSDK } from '@rhinestone/sdk'
import { baseSepolia, sepolia } from 'viem/chains'

const API_BASE_URL =
  process.env.MOCKESTRATOR_URL ?? 'http://localhost:4000'
const API_KEY = 'test-api-key'

const BASE_SEPOLIA_CHAIN_ID = 84532
const SEPOLIA_CHAIN_ID = 11155111
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const USDC_DECIMALS = 6

const RPC_URLS: Record<number, string> = {
  [BASE_SEPOLIA_CHAIN_ID]: 'http://localhost:30005',
  [SEPOLIA_CHAIN_ID]: 'http://localhost:30006',
}

const headers = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
}

async function activateError(scenarioId: string) {
  await fetch(`${API_BASE_URL}/__admin/errors`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      scenarios: [{ id: scenarioId, enabled: true }],
    }),
  })
}

async function activateCategory(category: string) {
  await fetch(`${API_BASE_URL}/__admin/errors/category/${category}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ probability: 1.0 }),
  })
}

async function resetErrors() {
  await fetch(`${API_BASE_URL}/__admin/errors`, {
    method: 'DELETE',
    headers,
  })
}

async function apiCall<T>(
  method: string,
  path: string,
  body?: object,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`API error ${response.status}: ${error}`)
  }

  return response.json()
}

function createSdk() {
  return new RhinestoneSDK({
    apiKey: API_KEY,
    endpointUrl: API_BASE_URL,
  })
}

async function createFundedAccount(sdk: RhinestoneSDK) {
  const owner = privateKeyToAccount(generatePrivateKey())

  const account = await sdk.createAccount({
    owners: { type: 'ecdsa', accounts: [owner] },
    account: { type: 'nexus' },
  })

  const address = account.getAddress()

  const testClient = createTestClient({
    chain: baseSepolia,
    mode: 'anvil',
    transport: http(RPC_URLS[BASE_SEPOLIA_CHAIN_ID]),
  })

  await testClient.setBalance({
    address,
    value: parseEther('10'),
  })

  return { account, address, owner }
}

// ─── Happy Paths ──────────────────────────────────────────────

describe('SDK Client - Happy Paths', () => {
  it('same-chain USDC transfer via full SDK flow', async () => {
    const sdk = createSdk()
    const { account, address } = await createFundedAccount(sdk)

    const preparedTx = await account.prepareTransaction({
      targetChain: baseSepolia,
      tokenRequests: [
        {
          address: USDC_BASE_SEPOLIA as Address,
          amount: parseUnits('1', USDC_DECIMALS),
        },
      ],
    })

    expect(preparedTx.intentRoute).toBeDefined()
    expect(preparedTx.intentRoute.intentOp).toBeDefined()
    expect(preparedTx.intentRoute.intentCost).toBeDefined()

    const signedTx = await account.signTransaction(preparedTx)
    expect(signedTx.originSignatures).toBeDefined()

    const result = await account.submitTransaction(signedTx)
    expect(result.type).toBe('intent')
    expect(result.id).toBeDefined()

    await new Promise((r) => setTimeout(r, 1000))

    const status = await apiCall<any>(
      'GET',
      `/intent-operation/${result.id}`,
    )
    expect(status.status).toBe('COMPLETED')
    expect(status.fillTransactionHash).toBeDefined()

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URLS[BASE_SEPOLIA_CHAIN_ID]),
    })

    const usdcBalance = await publicClient.readContract({
      address: USDC_BASE_SEPOLIA as Address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    })
    expect(usdcBalance).toBe(parseUnits('1', USDC_DECIMALS))
  })

  it('cross-chain USDC transfer via SDK', async () => {
    const sdk = createSdk()
    const { account } = await createFundedAccount(sdk)

    const preparedTx = await account.prepareTransaction({
      targetChain: sepolia,
      tokenRequests: [
        {
          address: USDC_SEPOLIA as Address,
          amount: parseUnits('1', USDC_DECIMALS),
        },
      ],
    })

    expect(preparedTx.intentRoute).toBeDefined()
    expect(preparedTx.intentRoute.intentOp).toBeDefined()

    const signedTx = await account.signTransaction(preparedTx)
    const result = await account.submitTransaction(signedTx)

    expect(result.type).toBe('intent')
    expect(result.id).toBeDefined()
  })

  it('transaction with destination operations', async () => {
    const sdk = createSdk()
    const { account, address } = await createFundedAccount(sdk)

    const spender = '0x1111111111111111111111111111111111111111' as Address
    const approveAmount = parseUnits('50', USDC_DECIMALS)

    const preparedTx = await account.prepareTransaction({
      targetChain: baseSepolia,
      tokenRequests: [
        {
          address: USDC_BASE_SEPOLIA as Address,
          amount: parseUnits('1', USDC_DECIMALS),
        },
      ],
      calls: [
        {
          to: USDC_BASE_SEPOLIA as Address,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [spender, approveAmount],
          }),
        },
      ],
    })

    expect(preparedTx.intentRoute).toBeDefined()

    const signedTx = await account.signTransaction(preparedTx)
    expect(signedTx.destinationSignature).toBeDefined()
    expect(signedTx.destinationSignature.length).toBeGreaterThan(2)

    const result = await account.submitTransaction(signedTx)
    expect(result.type).toBe('intent')

    await new Promise((r) => setTimeout(r, 1000))

    const status = await apiCall<any>(
      'GET',
      `/intent-operation/${result.id}`,
    )
    expect(status.status).toBe('COMPLETED')

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URLS[BASE_SEPOLIA_CHAIN_ID]),
    })

    const allowance = await publicClient.readContract({
      address: USDC_BASE_SEPOLIA as Address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, spender],
    })
    expect(allowance).toBe(approveAmount)
  })
})

// ─── Sad Paths via Admin API ──────────────────────────────────

describe('SDK Client - Sad Paths via Admin API', () => {
  afterEach(resetErrors)

  it('auth.invalid-api-key rejects prepareTransaction', async () => {
    const sdk = createSdk()
    const { account } = await createFundedAccount(sdk)

    await activateError('auth.invalid-api-key')

    try {
      await account.prepareTransaction({
        targetChain: baseSepolia,
        tokenRequests: [
          {
            address: USDC_BASE_SEPOLIA as Address,
            amount: parseUnits('1', USDC_DECIMALS),
          },
        ],
      })
      expect.fail('Should have thrown for 401')
    } catch (error: any) {
      expect(error.message).toBeDefined()
    }
  })

  it('path.no-path-found rejects routing', async () => {
    const sdk = createSdk()
    const { account } = await createFundedAccount(sdk)

    await activateError('path.no-path-found')

    try {
      await account.prepareTransaction({
        targetChain: baseSepolia,
        tokenRequests: [
          {
            address: USDC_BASE_SEPOLIA as Address,
            amount: parseUnits('1', USDC_DECIMALS),
          },
        ],
      })
      expect.fail('Should have thrown for no path found')
    } catch (error: any) {
      expect(error.message).toBeDefined()
    }
  })

  it('token.insufficient-balance rejects routing', async () => {
    const sdk = createSdk()
    const { account } = await createFundedAccount(sdk)

    await activateError('token.insufficient-balance')

    try {
      await account.prepareTransaction({
        targetChain: baseSepolia,
        tokenRequests: [
          {
            address: USDC_BASE_SEPOLIA as Address,
            amount: parseUnits('1', USDC_DECIMALS),
          },
        ],
      })
      expect.fail('Should have thrown for insufficient balance')
    } catch (error: any) {
      expect(error.message).toBeDefined()
    }
  })

  it('infra.rate-limit returns 429', async () => {
    const sdk = createSdk()
    const { account } = await createFundedAccount(sdk)

    await activateError('infra.rate-limit')

    try {
      await account.prepareTransaction({
        targetChain: baseSepolia,
        tokenRequests: [
          {
            address: USDC_BASE_SEPOLIA as Address,
            amount: parseUnits('1', USDC_DECIMALS),
          },
        ],
      })
      expect.fail('Should have thrown for rate limit')
    } catch (error: any) {
      expect(error.message).toBeDefined()
    }
  })

  it('validation.deadline-passed rejects submission', async () => {
    const sdk = createSdk()
    const { account } = await createFundedAccount(sdk)

    // First prepare and sign on happy path
    const preparedTx = await account.prepareTransaction({
      targetChain: baseSepolia,
      tokenRequests: [
        {
          address: USDC_BASE_SEPOLIA as Address,
          amount: parseUnits('1', USDC_DECIMALS),
        },
      ],
    })
    const signedTx = await account.signTransaction(preparedTx)

    // Now activate error for submission
    await activateError('validation.deadline-passed')

    try {
      await account.submitTransaction(signedTx)
      expect.fail('Should have thrown for deadline passed')
    } catch (error: any) {
      expect(error.message).toBeDefined()
    }
  })

  it('simulation.bundle-failed rejects submission', async () => {
    const sdk = createSdk()
    const { account } = await createFundedAccount(sdk)

    const preparedTx = await account.prepareTransaction({
      targetChain: baseSepolia,
      tokenRequests: [
        {
          address: USDC_BASE_SEPOLIA as Address,
          amount: parseUnits('1', USDC_DECIMALS),
        },
      ],
    })
    const signedTx = await account.signTransaction(preparedTx)

    await activateError('simulation.bundle-failed')

    try {
      await account.submitTransaction(signedTx)
      expect.fail('Should have thrown for simulation failure')
    } catch (error: any) {
      expect(error.message).toBeDefined()
    }
  })

  it('state.bundle-not-found rejects status check', async () => {
    await activateError('state.bundle-not-found')

    try {
      await apiCall('GET', '/intent-operation/999999')
      expect.fail('Should have thrown for bundle not found')
    } catch (error: any) {
      expect(error.message).toContain('404')
    }
  })

  it('category activation: all auth errors block SDK calls', async () => {
    const sdk = createSdk()
    const { account } = await createFundedAccount(sdk)

    await activateCategory('auth')

    try {
      await account.prepareTransaction({
        targetChain: baseSepolia,
        tokenRequests: [
          {
            address: USDC_BASE_SEPOLIA as Address,
            amount: parseUnits('1', USDC_DECIMALS),
          },
        ],
      })
      expect.fail('Should have thrown for auth category')
    } catch (error: any) {
      expect(error.message).toBeDefined()
    }
  })

  it('error reset restores happy path', async () => {
    const sdk = createSdk()
    const { account } = await createFundedAccount(sdk)

    // Activate error — routing should fail
    await activateError('path.no-path-found')

    try {
      await account.prepareTransaction({
        targetChain: baseSepolia,
        tokenRequests: [
          {
            address: USDC_BASE_SEPOLIA as Address,
            amount: parseUnits('1', USDC_DECIMALS),
          },
        ],
      })
      expect.fail('Should have thrown')
    } catch {
      // Expected
    }

    // Reset — routing should succeed
    await resetErrors()

    const preparedTx = await account.prepareTransaction({
      targetChain: baseSepolia,
      tokenRequests: [
        {
          address: USDC_BASE_SEPOLIA as Address,
          amount: parseUnits('1', USDC_DECIMALS),
        },
      ],
    })
    expect(preparedTx.intentRoute).toBeDefined()
    expect(preparedTx.intentRoute.intentOp).toBeDefined()
  })
})
