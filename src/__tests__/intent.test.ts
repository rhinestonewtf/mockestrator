import { describe, it, expect } from "vitest";
import {
  Address,
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  Hex,
  http,
  parseUnits,
} from "viem";

const API_BASE_URL = process.env.MOCKESTRATOR_URL ?? "http://localhost:4000";
const API_KEY = "test-api-key";
const API_VERSION = "2026-04.blanc";

// Chain IDs from rpcs.json
const BASE_SEPOLIA_CHAIN_ID = 84532;
const SEPOLIA_CHAIN_ID = 11155111;
const BASE_SEPOLIA_CAIP2 = `eip155:${BASE_SEPOLIA_CHAIN_ID}`;
const SEPOLIA_CAIP2 = `eip155:${SEPOLIA_CHAIN_ID}`;
// USDC addresses from chains.json
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_SEPOLIA = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
// User and recipient addresses
const USER_ADDRESS = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";
// RPC URLs from rpcs.json
const RPC_URLS: Record<number, string> = {
  [BASE_SEPOLIA_CHAIN_ID]: "http://localhost:30005",
  [SEPOLIA_CHAIN_ID]: "http://localhost:30006",
};

const headers = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
  "x-api-version": API_VERSION,
};

async function apiCall<T>(
  method: string,
  path: string,
  body?: object
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }

  return response.json();
}

// Mock signature that mockestrator accepts as "valid" (any non-fake hex)
const MOCK_DEST_SIG = ("0x" + "ab".repeat(65)) as Hex;
const MOCK_ORIGIN_SIG = ("0x" + "cd".repeat(65)) as Hex;

describe("Mockestrator Intent Flow", () => {
  describe("Portfolio API", () => {
    it("should return portfolio for an account", async () => {
      const response = await apiCall<any>(
        "GET",
        `/accounts/${USER_ADDRESS}/portfolio`
      );

      expect(response).toHaveProperty("portfolio");
      expect(Array.isArray(response.portfolio)).toBe(true);

      const usdcEntry = response.portfolio.find(
        (p: any) => p.symbol === "USDC"
      );
      expect(usdcEntry).toBeDefined();
      expect(usdcEntry.chains.length).toBeGreaterThanOrEqual(2);
      expect(BigInt(usdcEntry.chains[0].amount)).toBeGreaterThan(0n);
    });

    it("should return ETH balance entry", async () => {
      const response = await apiCall<any>(
        "GET",
        `/accounts/${USER_ADDRESS}/portfolio`
      );

      const ethEntry = response.portfolio.find((p: any) => p.symbol === "ETH");
      expect(ethEntry).toBeDefined();
      expect(ethEntry.chains[0].decimals).toBe(18);
      expect(BigInt(ethEntry.chains[0].amount)).toBeGreaterThan(0n);
    });

    it("should return per-chain balances using CAIP-2 ids", async () => {
      const response = await apiCall<any>(
        "GET",
        `/accounts/${USER_ADDRESS}/portfolio`
      );

      const usdcEntry = response.portfolio.find(
        (p: any) => p.symbol === "USDC"
      );
      const baseSepoliaBalance = usdcEntry.chains.find(
        (c: any) => c.chainId === BASE_SEPOLIA_CAIP2
      );
      expect(baseSepoliaBalance).toBeDefined();
      expect(baseSepoliaBalance.address.toLowerCase()).toBe(
        USDC_BASE_SEPOLIA.toLowerCase()
      );

      const sepoliaBalance = usdcEntry.chains.find(
        (c: any) => c.chainId === SEPOLIA_CAIP2
      );
      expect(sepoliaBalance).toBeDefined();
      expect(sepoliaBalance.address.toLowerCase()).toBe(
        USDC_SEPOLIA.toLowerCase()
      );
    });
  });

  describe("Intent Splits API", () => {
    it("should return single intent with full amount for a single token", async () => {
      const response = await apiCall<any>("POST", "/intents/splits", {
        chainId: BASE_SEPOLIA_CAIP2,
        tokens: { [USDC_BASE_SEPOLIA]: "1000000" },
      });

      expect(response).toHaveProperty("intents");
      expect(response.intents).toHaveLength(1);
      expect(response.intents[0][USDC_BASE_SEPOLIA]).toBe("1000000");
    });

    it("should return single intent with all tokens for multi-token request", async () => {
      const response = await apiCall<any>("POST", "/intents/splits", {
        chainId: SEPOLIA_CAIP2,
        tokens: {
          [USDC_SEPOLIA]: "5000000",
          "0x0000000000000000000000000000000000000000": "1000000000000000000",
        },
      });

      expect(response.intents).toHaveLength(1);
      expect(response.intents[0][USDC_SEPOLIA]).toBe("5000000");
      expect(
        response.intents[0]["0x0000000000000000000000000000000000000000"]
      ).toBe("1000000000000000000");
    });

    it("should return empty intents for empty tokens", async () => {
      const response = await apiCall<any>("POST", "/intents/splits", {
        chainId: BASE_SEPOLIA_CAIP2,
        tokens: {},
      });

      expect(response.intents).toHaveLength(0);
    });
  });

  describe("Validation errors", () => {
    it("should return 400 for quote request with missing required fields", async () => {
      const response = await fetch(`${API_BASE_URL}/quotes`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.traceId).toBeDefined();
    });

    it("should return 400 for quote request with missing tokenRequests", async () => {
      const response = await fetch(`${API_BASE_URL}/quotes`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          destinationChainId: BASE_SEPOLIA_CAIP2,
          account: { address: USER_ADDRESS },
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should return 400 for splits request with missing chainId", async () => {
      const response = await fetch(`${API_BASE_URL}/intents/splits`, {
        method: "POST",
        headers,
        body: JSON.stringify({ tokens: { [USDC_BASE_SEPOLIA]: "1000000" } }),
      });

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent intent", async () => {
      const response = await fetch(
        `${API_BASE_URL}/intents/9999999999999999999`,
        { method: "GET", headers }
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.code).toBe("NOT_FOUND");
    });

    it("should return 400 for unsupported x-api-version", async () => {
      const response = await fetch(`${API_BASE_URL}/chains`, {
        method: "GET",
        headers: { ...headers, "x-api-version": "2026-01.alps" },
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Same-chain Intent Flow", () => {
    it("should quote and execute same-chain USDC transfer intent", async () => {
      const transferAmount = parseUnits("100", 6);

      const quoteResponse = await apiCall<any>("POST", "/quotes", {
        destinationChainId: BASE_SEPOLIA_CAIP2,
        tokenRequests: [
          {
            tokenAddress: USDC_BASE_SEPOLIA,
            amount: transferAmount.toString(),
          },
        ],
        account: { address: USER_ADDRESS },
        accountAccessList: { chainIds: [BASE_SEPOLIA_CAIP2] },
      });

      expect(quoteResponse).toHaveProperty("routes");
      expect(quoteResponse.routes).toHaveLength(1);
      const route = quoteResponse.routes[0];
      expect(route.intentId).toMatch(/^\d+$/);
      expect(route.settlementLayer).toBe("INTENT_EXECUTOR");

      const submitResponse = await apiCall<any>("POST", "/intents", {
        intentId: route.intentId,
        signatures: {
          origin: [MOCK_ORIGIN_SIG],
          destination: MOCK_DEST_SIG,
        },
      });

      expect(submitResponse.intentId).toBe(route.intentId);

      const statusResponse = await apiCall<any>(
        "GET",
        `/intents/${route.intentId}`
      );

      expect(statusResponse.status).toBe("COMPLETED");
      expect(statusResponse.destinationChainId).toBe(BASE_SEPOLIA_CAIP2);
      expect(statusResponse.fillTransactionHash).toBeDefined();

      const publicClient = createPublicClient({
        transport: http(RPC_URLS[BASE_SEPOLIA_CHAIN_ID]),
      });

      const receipt = await publicClient.getTransactionReceipt({
        hash: statusResponse.fillTransactionHash as Hex,
      });
      expect(receipt.status).toBe("success");

      const transferLogs = receipt.logs.filter(
        (log) => log.address.toLowerCase() === USDC_BASE_SEPOLIA.toLowerCase()
      );
      expect(transferLogs.length).toBeGreaterThan(0);

      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: transferLogs[0].data,
        topics: transferLogs[0].topics,
      });
      expect(decoded.eventName).toBe("Transfer");
      expect((decoded.args as any).to.toLowerCase()).toBe(
        USER_ADDRESS.toLowerCase()
      );
      expect((decoded.args as any).value).toBe(transferAmount);
    });
  });

  describe("Cross-chain Intent Flow", () => {
    it("should quote and execute cross-chain USDC transfer (Base Sepolia → Sepolia)", async () => {
      const transferAmount = parseUnits("50", 6);

      const quoteResponse = await apiCall<any>("POST", "/quotes", {
        destinationChainId: SEPOLIA_CAIP2,
        tokenRequests: [
          { tokenAddress: USDC_SEPOLIA, amount: transferAmount.toString() },
        ],
        account: { address: USER_ADDRESS },
        accountAccessList: { chainIds: [BASE_SEPOLIA_CAIP2] },
      });

      const route = quoteResponse.routes[0];
      expect(route.settlementLayer).toBe("ACROSS");

      await apiCall<any>("POST", "/intents", {
        intentId: route.intentId,
        signatures: {
          origin: [MOCK_ORIGIN_SIG],
          destination: MOCK_DEST_SIG,
        },
      });

      const statusResponse = await apiCall<any>(
        "GET",
        `/intents/${route.intentId}`
      );

      expect(statusResponse.status).toBe("COMPLETED");
      expect(statusResponse.destinationChainId).toBe(SEPOLIA_CAIP2);

      const publicClient = createPublicClient({
        transport: http(RPC_URLS[SEPOLIA_CHAIN_ID]),
      });
      const receipt = await publicClient.getTransactionReceipt({
        hash: statusResponse.fillTransactionHash as Hex,
      });
      expect(receipt.status).toBe("success");

      const transferLogs = receipt.logs.filter(
        (log) => log.address.toLowerCase() === USDC_SEPOLIA.toLowerCase()
      );
      expect(transferLogs.length).toBeGreaterThan(0);

      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: transferLogs[0].data,
        topics: transferLogs[0].topics,
      });
      expect(decoded.eventName).toBe("Transfer");
      expect((decoded.args as any).to.toLowerCase()).toBe(
        USER_ADDRESS.toLowerCase()
      );
    });
  });

  describe("Quote response shape", () => {
    it("should include full route metadata with CAIP-2 cost and fee breakdown", async () => {
      const amount = parseUnits("10", 6);
      const before = Math.floor(Date.now() / 1000);

      const quoteResponse = await apiCall<any>("POST", "/quotes", {
        destinationChainId: BASE_SEPOLIA_CAIP2,
        tokenRequests: [
          { tokenAddress: USDC_BASE_SEPOLIA, amount: amount.toString() },
        ],
        account: { address: USER_ADDRESS },
        accountAccessList: { chainIds: [BASE_SEPOLIA_CAIP2] },
      });

      expect(quoteResponse.routes).toHaveLength(1);
      const route = quoteResponse.routes[0];

      expect(route.expiresAt).toBeGreaterThan(before);
      expect(route.estimatedFillTime?.seconds).toBeGreaterThanOrEqual(0);

      expect(Array.isArray(route.cost.input)).toBe(true);
      expect(Array.isArray(route.cost.output)).toBe(true);
      for (const leg of [...route.cost.input, ...route.cost.output]) {
        expect(leg.chainId).toMatch(/^eip155:\d+$/);
        expect(typeof leg.tokenAddress).toBe("string");
        expect(typeof leg.amount).toBe("string");
      }

      expect(route.cost.fees.total).toHaveProperty("usd");
      const breakdown = route.cost.fees.breakdown;
      for (const key of ["gas", "bridge", "protocol", "swap", "settlement"]) {
        expect(breakdown[key]).toHaveProperty("usd");
      }

      expect(Array.isArray(route.signData.origin)).toBe(true);
      expect(route.signData.destination).toHaveProperty("primaryType");
    });
  });

  describe("Recipient routing", () => {
    it("should land funds at recipient.address rather than account.address", async () => {
      const recipient = "0x000000000000000000000000000000000000beef" as Address;
      const amount = parseUnits("7", 6);

      const publicClient = createPublicClient({
        transport: http(RPC_URLS[BASE_SEPOLIA_CHAIN_ID]),
      });
      const before = await publicClient.readContract({
        address: USDC_BASE_SEPOLIA as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [recipient],
      });

      const quoteResponse = await apiCall<any>("POST", "/quotes", {
        destinationChainId: BASE_SEPOLIA_CAIP2,
        tokenRequests: [
          { tokenAddress: USDC_BASE_SEPOLIA, amount: amount.toString() },
        ],
        account: { address: USER_ADDRESS },
        recipient: { address: recipient },
        accountAccessList: { chainIds: [BASE_SEPOLIA_CAIP2] },
      });

      const route = quoteResponse.routes[0];
      await apiCall<any>("POST", "/intents", {
        intentId: route.intentId,
        signatures: { origin: [MOCK_ORIGIN_SIG], destination: MOCK_DEST_SIG },
      });

      const after = await publicClient.readContract({
        address: USDC_BASE_SEPOLIA as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [recipient],
      });
      expect(after - before).toBe(amount);
    });
  });

  describe("Multi-token tokenRequests", () => {
    it("should fulfil USDC and native ETH in a single quote", async () => {
      const recipient = "0x000000000000000000000000000000000000c0de" as Address;
      const usdcAmount = parseUnits("3", 6);
      const ethAmount = parseUnits("0.0005", 18);

      const publicClient = createPublicClient({
        transport: http(RPC_URLS[BASE_SEPOLIA_CHAIN_ID]),
      });
      const usdcBefore = await publicClient.readContract({
        address: USDC_BASE_SEPOLIA as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [recipient],
      });
      const ethBefore = await publicClient.getBalance({ address: recipient });

      const quoteResponse = await apiCall<any>("POST", "/quotes", {
        destinationChainId: BASE_SEPOLIA_CAIP2,
        tokenRequests: [
          { tokenAddress: USDC_BASE_SEPOLIA, amount: usdcAmount.toString() },
          {
            tokenAddress: "0x0000000000000000000000000000000000000000",
            amount: ethAmount.toString(),
          },
        ],
        account: { address: USER_ADDRESS },
        recipient: { address: recipient },
        accountAccessList: { chainIds: [BASE_SEPOLIA_CAIP2] },
      });

      const route = quoteResponse.routes[0];
      await apiCall<any>("POST", "/intents", {
        intentId: route.intentId,
        signatures: { origin: [MOCK_ORIGIN_SIG], destination: MOCK_DEST_SIG },
      });

      const usdcAfter = await publicClient.readContract({
        address: USDC_BASE_SEPOLIA as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [recipient],
      });
      const ethAfter = await publicClient.getBalance({ address: recipient });

      expect(usdcAfter - usdcBefore).toBe(usdcAmount);
      expect(ethAfter - ethBefore).toBe(ethAmount);
    });
  });

  describe("Submit unknown intentId", () => {
    it("should 404 with NOT_FOUND when intentId was never quoted", async () => {
      const response = await fetch(`${API_BASE_URL}/intents`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          intentId: "999999999999999999999",
          signatures: {
            origin: [MOCK_ORIGIN_SIG],
            destination: MOCK_DEST_SIG,
          },
        }),
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.code).toBe("NOT_FOUND");
      expect(body.traceId).toBeDefined();
    });
  });

  describe("Portfolio query filters", () => {
    it("should filter portfolio by chainIds", async () => {
      const response = await apiCall<any>(
        "GET",
        `/accounts/${USER_ADDRESS}/portfolio?chainIds=${encodeURIComponent(
          BASE_SEPOLIA_CAIP2
        )}`
      );

      const allChainIds = response.portfolio.flatMap((p: any) =>
        p.chains.map((c: any) => c.chainId)
      );
      expect(allChainIds.length).toBeGreaterThan(0);
      for (const id of allChainIds) {
        expect(id).toBe(BASE_SEPOLIA_CAIP2);
      }
    });
  });

  describe("Liquidity endpoint", () => {
    it("should return the unlimited mock shape", async () => {
      const response = await apiCall<any>(
        "GET",
        `/liquidity?sourceChainId=${encodeURIComponent(
          BASE_SEPOLIA_CAIP2
        )}&sourceToken=${USDC_BASE_SEPOLIA}&destinationChainId=${encodeURIComponent(
          SEPOLIA_CAIP2
        )}&destinationToken=${USDC_SEPOLIA}`
      );

      expect(response).toMatchObject({
        unlimited: true,
        maxAmount: null,
      });
      expect(typeof response.symbol).toBe("string");
      expect(typeof response.decimals).toBe("number");
    });
  });
});
