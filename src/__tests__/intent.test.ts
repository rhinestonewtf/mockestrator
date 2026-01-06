import { describe, it, expect } from "vitest";
import {
  Address,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseUnits,
  decodeEventLog,
  Hex,
} from "viem";

const API_BASE_URL = "http://localhost:4000";
const API_KEY = "test-api-key";

// Chain IDs from rpcs.json
const BASE_SEPOLIA_CHAIN_ID = 84532;
const SEPOLIA_CHAIN_ID = 11155111;
// USDC addresses from chains.json
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_SEPOLIA = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
// Router address (funded with tokens) from config.json
const ROUTER_ADDRESS = "0x8a525dc484f893ca64fef507746ebd5036eec256";
// User and recipient addresses
const USER_ADDRESS = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";
const RECIPIENT_ADDRESS = "0x000000000000000000000000000000000000dEaD";
// RPC URLs from rpcs.json
const RPC_URLS: Record<number, string> = {
  [BASE_SEPOLIA_CHAIN_ID]: "http://localhost:30005",
  [SEPOLIA_CHAIN_ID]: "http://localhost:30006",
};

const headers = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
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

// create signed intent from route response
function createSignedIntent(routeResponse: any) {
  return {
    ...routeResponse.intentOp,
    destinationSignature: "0x" + "00".repeat(65),
    originSignatures: ["0x" + "00".repeat(65)],
  };
}

describe("Mockestrator Intent Flow", () => {
  describe("Portfolio API", () => {
    it("should return portfolio for a user address", async () => {
      const userAddress = USER_ADDRESS;
      const response = await apiCall<any>(
        "GET",
        `/accounts/${userAddress}/portfolio`
      );

      expect(response).toHaveProperty("portfolio");
      expect(Array.isArray(response.portfolio)).toBe(true);

      const usdcEntry = response.portfolio.find(
        (p: any) => p.tokenName === "USDC"
      );
      expect(usdcEntry).toBeDefined();
      expect(usdcEntry.balance.unlocked).toBeGreaterThan(0);
    });
  });

  describe("Same-chain Intent Flow", () => {
    it("should route and execute same-chain USDC transfer intent", async () => {
      const userAddress = USER_ADDRESS;
      const transferAmount = parseUnits("100", 6); // 100 USDC

      // route intent
      const routePayload = {
        destinationChainId: BASE_SEPOLIA_CHAIN_ID,
        tokenRequests: [
          {
            tokenAddress: USDC_BASE_SEPOLIA,
            amount: transferAmount.toString(),
          },
        ],
        account: {
          address: userAddress,
        },
        accountAccessList: {
          chainIds: [BASE_SEPOLIA_CHAIN_ID],
        },
      };

      const routeResponse = await apiCall<any>(
        "POST",
        "/intents/route",
        routePayload
      );

      expect(routeResponse).toHaveProperty("intentOp");
      expect(routeResponse).toHaveProperty("intentCost");
      expect(routeResponse.intentCost.hasFulfilledAll).toBe(true);
      expect(
        routeResponse.intentOp.elements[0].mandate.qualifier.settlementContext
          .settlementLayer
      ).toBe("SAME_CHAIN");

      // submit signed intent
      const signedIntent = createSignedIntent(routeResponse);

      const submitPayload = {
        signedIntentOp: signedIntent,
      };

      const submitResponse = await apiCall<any>(
        "POST",
        "/intent-operations",
        submitPayload
      );

      expect(submitResponse).toHaveProperty("result");
      expect(submitResponse.result.status).toBe("PENDING");
      const intentId = submitResponse.result.id;

      // check intent status
      const statusResponse = await apiCall<any>(
        "GET",
        `/intent-operation/${intentId}`
      );

      expect(statusResponse.status).toBe("COMPLETED");
      expect(statusResponse.destinationChainId).toBe(
        BASE_SEPOLIA_CHAIN_ID.toString()
      );
      expect(statusResponse.fillTransactionHash).toBeDefined();

      // verify the transaction receipt has Transfer event
      const publicClient = createPublicClient({
        transport: http(RPC_URLS[BASE_SEPOLIA_CHAIN_ID]),
      });

      const receipt = await publicClient.getTransactionReceipt({
        hash: statusResponse.fillTransactionHash as Hex,
      });

      expect(receipt.status).toBe("success");

      // find Transfer event for USDC
      const transferLogs = receipt.logs.filter(
        (log) => log.address.toLowerCase() === USDC_BASE_SEPOLIA.toLowerCase()
      );

      expect(transferLogs.length).toBeGreaterThan(0);

      // decode and verify Transfer event
      const transferLog = transferLogs[0];
      const decodedLog = decodeEventLog({
        abi: erc20Abi,
        data: transferLog.data,
        topics: transferLog.topics,
      });

      expect(decodedLog.eventName).toBe("Transfer");
      expect((decodedLog.args as any).to.toLowerCase()).toBe(
        userAddress.toLowerCase()
      );
      expect((decodedLog.args as any).value).toBe(transferAmount);
    });
  });

  describe("Cross-chain Intent Flow", () => {
    it("should route and execute cross-chain USDC transfer (Base Sepolia → Sepolia)", async () => {
      const userAddress = USER_ADDRESS;
      const transferAmount = parseUnits("50", 6);

      // route intent: source on base sepolia, destination on sepolia
      const routePayload = {
        destinationChainId: SEPOLIA_CHAIN_ID,
        tokenRequests: [
          {
            tokenAddress: USDC_SEPOLIA,
            amount: transferAmount.toString(),
          },
        ],
        account: {
          address: userAddress,
        },
        accountAccessList: {
          chainIds: [BASE_SEPOLIA_CHAIN_ID],
        },
      };

      const routeResponse = await apiCall<any>(
        "POST",
        "/intents/route",
        routePayload
      );

      expect(routeResponse).toHaveProperty("intentOp");
      expect(
        routeResponse.intentOp.elements[0].mandate.qualifier.settlementContext
          .settlementLayer
      ).toBe("ACROSS");

      // submit signed intent
      const signedIntent = createSignedIntent(routeResponse);
      const submitResponse = await apiCall<any>("POST", "/intent-operations", {
        signedIntentOp: signedIntent,
      });

      expect(submitResponse.result.status).toBe("PENDING");
      const intentId = submitResponse.result.id;

      // check status
      const statusResponse = await apiCall<any>(
        "GET",
        `/intent-operation/${intentId}`
      );

      expect(statusResponse.status).toBe("COMPLETED");
      expect(statusResponse.destinationChainId).toBe(
        SEPOLIA_CHAIN_ID.toString()
      );
      expect(statusResponse.fillTransactionHash).toBeDefined();

      // verify transaction on destination chain (sepolia)
      const publicClient = createPublicClient({
        transport: http(RPC_URLS[SEPOLIA_CHAIN_ID]),
      });

      const receipt = await publicClient.getTransactionReceipt({
        hash: statusResponse.fillTransactionHash as Hex,
      });

      expect(receipt.status).toBe("success");

      // find Transfer event for usdc on sepolia
      const transferLogs = receipt.logs.filter(
        (log) => log.address.toLowerCase() === USDC_SEPOLIA.toLowerCase()
      );

      expect(transferLogs.length).toBeGreaterThan(0);

      const decodedLog = decodeEventLog({
        abi: erc20Abi,
        data: transferLogs[0].data,
        topics: transferLogs[0].topics,
      });

      expect(decodedLog.eventName).toBe("Transfer");
      expect((decodedLog.args as any).to.toLowerCase()).toBe(
        userAddress.toLowerCase()
      );
    });
  });

  describe("Intent with Destination Operations", () => {
    it("should execute destination ops that perform ERC-20 transfer", async () => {
      const userAddress = USER_ADDRESS;
      const finalRecipient = RECIPIENT_ADDRESS;
      const transferAmount = parseUnits("25", 6);
      const destOpsAmount = parseUnits("10", 6);

      // encode ERC-20 transfer call for destination ops
      const transferCalldata = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [finalRecipient as Address, destOpsAmount],
      });

      const routePayload = {
        destinationChainId: BASE_SEPOLIA_CHAIN_ID,
        tokenRequests: [
          {
            tokenAddress: USDC_BASE_SEPOLIA,
            amount: transferAmount.toString(),
          },
        ],
        account: {
          address: userAddress,
        },
        accountAccessList: {
          chainIds: [BASE_SEPOLIA_CHAIN_ID],
        },
        // dest op: transfer usdc to recipient address
        destinationExecutions: [
          {
            to: USDC_BASE_SEPOLIA,
            value: "0",
            data: transferCalldata,
          },
        ],
      };

      const routeResponse = await apiCall<any>(
        "POST",
        "/intents/route",
        routePayload
      );

      expect(routeResponse).toHaveProperty("intentOp");
      expect(
        routeResponse.intentOp.elements[0].mandate.destinationOps
      ).toHaveLength(1);

      // submit signed intent
      const signedIntent = createSignedIntent(routeResponse);
      const submitResponse = await apiCall<any>("POST", "/intent-operations", {
        signedIntentOp: signedIntent,
      });

      const intentId = submitResponse.result.id;
      const statusResponse = await apiCall<any>(
        "GET",
        `/intent-operation/${intentId}`
      );

      expect(statusResponse.status).toBe("COMPLETED");

      // verify transaction receipt
      const publicClient = createPublicClient({
        transport: http(RPC_URLS[BASE_SEPOLIA_CHAIN_ID]),
      });

      const receipt = await publicClient.getTransactionReceipt({
        hash: statusResponse.fillTransactionHash as Hex,
      });

      expect(receipt.status).toBe("success");

      // should have multiple transfer events:
      //   transfer to userAddress
      //   transfer to finalRecipient
      const transferLogs = receipt.logs.filter(
        (log) => log.address.toLowerCase() === USDC_BASE_SEPOLIA.toLowerCase()
      );

      expect(transferLogs.length).toBeGreaterThanOrEqual(2);

      const decodedTransfers = transferLogs
        .map((log) => {
          try {
            return decodeEventLog({
              abi: erc20Abi,
              data: log.data,
              topics: log.topics,
            });
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      // verify we have transfers to both recipients
      const transferToUser = decodedTransfers.find(
        (t: any) => t?.args?.to?.toLowerCase() === userAddress.toLowerCase()
      );
      const transferToFinal = decodedTransfers.find(
        (t: any) => t?.args?.to?.toLowerCase() === finalRecipient.toLowerCase()
      );

      expect(transferToUser).toBeDefined();
      expect(transferToFinal).toBeDefined();
      expect((transferToFinal as any).args.value).toBe(destOpsAmount);

      console.log("Destination ops executed successfully!");
      console.log(`   - Token transfer to user: ${userAddress}`);
      console.log(`   - Destination op transfer to: ${finalRecipient}`);
      console.log(`   - Tx hash: ${statusResponse.fillTransactionHash}`);
    });
  });

  describe("call flow verification (router → account → target)", () => {
    // verify dest op are executed with the correct
    // call flow: router → account → target
    // todo: fix and later remove the .fails
    it.fails(
      "should execute destination ops through the account (msg.sender = account)",
      async () => {
        const userAccount = USER_ADDRESS;
        const finalRecipient = "0x000000000000000000000000000000000000bEEF";
        const transferAmount = parseUnits("100", 6);
        const destOpsAmount = parseUnits("20", 6);

        // encode ERC-20 transfer, this will use msg.sender as the from field
        const transferCalldata = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [finalRecipient as Address, destOpsAmount],
        });

        const routePayload = {
          destinationChainId: BASE_SEPOLIA_CHAIN_ID,
          tokenRequests: [
            {
              tokenAddress: USDC_BASE_SEPOLIA,
              amount: transferAmount.toString(),
            },
          ],
          account: {
            address: userAccount,
          },
          accountAccessList: {
            chainIds: [BASE_SEPOLIA_CHAIN_ID],
          },
          destinationExecutions: [
            {
              to: USDC_BASE_SEPOLIA,
              value: "0",
              data: transferCalldata,
            },
          ],
        };

        const routeResponse = await apiCall<any>(
          "POST",
          "/intents/route",
          routePayload
        );
        const signedIntent = createSignedIntent(routeResponse);
        const submitResponse = await apiCall<any>(
          "POST",
          "/intent-operations",
          {
            signedIntentOp: signedIntent,
          }
        );

        const intentId = submitResponse.result.id;
        const statusResponse = await apiCall<any>(
          "GET",
          `/intent-operation/${intentId}`
        );

        expect(statusResponse.status).toBe("COMPLETED");

        const publicClient = createPublicClient({
          transport: http(RPC_URLS[BASE_SEPOLIA_CHAIN_ID]),
        });

        const receipt = await publicClient.getTransactionReceipt({
          hash: statusResponse.fillTransactionHash as Hex,
        });

        expect(receipt.status).toBe("success");

        // find all transfer events
        const transferLogs = receipt.logs.filter(
          (log) => log.address.toLowerCase() === USDC_BASE_SEPOLIA.toLowerCase()
        );

        const decodedTransfers = transferLogs
          .map((log) => {
            try {
              return decodeEventLog({
                abi: erc20Abi,
                data: log.data,
                topics: log.topics,
              });
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        // find the transfer to finalRecipient (the destination op transfer)
        const destOpTransfer = decodedTransfers.find(
          (t: any) =>
            t?.args?.to?.toLowerCase() === finalRecipient.toLowerCase()
        );

        expect(destOpTransfer).toBeDefined();

        // todo; verify the from field is the user's account, not the router
        const transferFrom = (destOpTransfer as any).args.from.toLowerCase();

        console.log("\n📋 Call Flow Verification:");
        console.log(`   Router address: ${ROUTER_ADDRESS}`);
        console.log(`   User account: ${userAccount}`);
        console.log(`   Transfer from: ${transferFrom}`);
        console.log(`   Transfer to: ${finalRecipient}`);

        // the transfer should come from the user account (msg.sender in target = account)
        expect(transferFrom).toBe(userAccount.toLowerCase());
        expect(transferFrom).not.toBe(ROUTER_ADDRESS.toLowerCase());
      }
    );

    // todo; this test currently fails because MockRouter calls targets directly
    it.fails(
      "should preserve msg.sender as account when calling target contracts",
      async () => {
        // encode approve call, this sets allowance[msg.sender][spender] = amount
        const userAccount = USER_ADDRESS;
        const spender = "0x1111111111111111111111111111111111111111";
        const transferAmount = parseUnits("50", 6);
        const approvalAmount = parseUnits("1000", 6);

        const approveCalldata = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [spender as Address, approvalAmount],
        });

        const routePayload = {
          destinationChainId: BASE_SEPOLIA_CHAIN_ID,
          tokenRequests: [
            {
              tokenAddress: USDC_BASE_SEPOLIA,
              amount: transferAmount.toString(),
            },
          ],
          account: {
            address: userAccount,
          },
          accountAccessList: {
            chainIds: [BASE_SEPOLIA_CHAIN_ID],
          },
          destinationExecutions: [
            {
              to: USDC_BASE_SEPOLIA,
              value: "0",
              data: approveCalldata,
            },
          ],
        };

        const routeResponse = await apiCall<any>(
          "POST",
          "/intents/route",
          routePayload
        );
        const signedIntent = createSignedIntent(routeResponse);
        const submitResponse = await apiCall<any>(
          "POST",
          "/intent-operations",
          {
            signedIntentOp: signedIntent,
          }
        );

        const intentId = submitResponse.result.id;
        const statusResponse = await apiCall<any>(
          "GET",
          `/intent-operation/${intentId}`
        );

        expect(statusResponse.status).toBe("COMPLETED");

        const publicClient = createPublicClient({
          transport: http(RPC_URLS[BASE_SEPOLIA_CHAIN_ID]),
        });

        const receipt = await publicClient.getTransactionReceipt({
          hash: statusResponse.fillTransactionHash as Hex,
        });

        expect(receipt.status).toBe("success");

        // find approval event
        const approvalAbi = [
          {
            type: "event",
            name: "Approval",
            inputs: [
              { indexed: true, name: "owner", type: "address" },
              { indexed: true, name: "spender", type: "address" },
              { indexed: false, name: "value", type: "uint256" },
            ],
          },
        ] as const;

        const approvalLogs = receipt.logs.filter(
          (log) => log.address.toLowerCase() === USDC_BASE_SEPOLIA.toLowerCase()
        );

        const decodedApprovals = approvalLogs
          .map((log) => {
            try {
              return decodeEventLog({
                abi: approvalAbi,
                data: log.data,
                topics: log.topics,
              });
            } catch {
              return null;
            }
          })
          .filter((e) => e?.eventName === "Approval");

        const approval = decodedApprovals.find(
          (a: any) => a?.args?.spender?.toLowerCase() === spender.toLowerCase()
        );

        expect(approval).toBeDefined();

        // todo: verify the owner in the approval event is the user account
        const owner = (approval as any).args.owner.toLowerCase();

        console.log("\n📋 Approval Event Verification:");
        console.log(`   Router address: ${ROUTER_ADDRESS}`);
        console.log(`   User account: ${userAccount}`);
        console.log(`   Approval owner: ${owner}`);
        console.log(`   Approval spender: ${spender}`);

        expect(owner).toBe(userAccount.toLowerCase());
        expect(owner).not.toBe(ROUTER_ADDRESS.toLowerCase());

        console.log(
          "msg.sender preserved: account is the owner of the approval"
        );

        // verify we can read the allowance from the contract
        const allowance = await publicClient.readContract({
          address: USDC_BASE_SEPOLIA as Address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [userAccount as Address, spender as Address],
        });

        // todo: verify the allowance is set correctly
        expect(allowance).toBe(approvalAmount);

        console.log(
          `Allowance verified: ${allowance} (expected: ${approvalAmount})`
        );
      }
    );
  });
});
