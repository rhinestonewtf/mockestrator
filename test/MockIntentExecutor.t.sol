// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Test, console2 } from "forge-std/Test.sol";
import { RhinestoneModuleKit, ModuleKitHelpers, AccountInstance } from "modulekit/ModuleKit.sol";
import { MODULE_TYPE_EXECUTOR } from "modulekit/accounts/common/interfaces/IERC7579Module.sol";
import { ExecutionLib } from "modulekit/accounts/erc7579/lib/ExecutionLib.sol";
import { Execution } from "modulekit/accounts/common/interfaces/IERC7579Account.sol";
import { MockIntentExecutor } from "../contracts/MockIntentExecutor.sol";

contract MockIntentExecutorTest is RhinestoneModuleKit, Test {
    using ModuleKitHelpers for *;

    // account and modules
    AccountInstance internal instance;
    MockIntentExecutor internal executor;

    function setUp() public {
        init();

        // Create the account first
        instance = makeAccountInstance("TestAccount");
        vm.label(address(instance.account), "SmartAccount");
        vm.deal(address(instance.account), 10 ether);

        // Deploy the account
        instance.deployAccount();

        // Create the executor
        executor = new MockIntentExecutor();
        vm.label(address(executor), "MockIntentExecutor");

        // Install the executor on the account
        instance.installModule({
            moduleTypeId: MODULE_TYPE_EXECUTOR,
            module: address(executor),
            data: ""
        });
    }

    function testMockFill() public {
        // Create a target address
        address target = makeAddr("target");
        uint256 value = 1 ether;

        // Get the current balance of the target
        uint256 prevBalance = target.balance;

        // Create a batch execution with a single transfer
        Execution[] memory executions = new Execution[](1);
        executions[0] = Execution({
            target: target,
            value: value,
            callData: ""
        });

        // Encode the batch execution
        bytes memory batchCallData = ExecutionLib.encodeBatch(executions);

        // Build the Operation data:
        // byte 0: exec type (0x02 for ERC7579)
        // byte 1: sig mode (0x00 for EMISSARY)
        // bytes 2+: the actual execution data (abi.encode(Execution[]))
        bytes memory operationData = abi.encodePacked(
            uint8(2), // Type.ERC7579
            uint8(0), // SigMode.EMISSARY
            batchCallData
        );

        MockIntentExecutor.Operation memory ops = MockIntentExecutor.Operation({
            data: operationData
        });

        // Execute mockFill - the executor calls executeFromExecutor on the account
        bool success = executor.mockFill(address(instance.account), ops);

        // Verify the execution succeeded
        assertTrue(success, "mockFill should return true");

        // Check if the balance of the target has increased
        assertEq(target.balance, prevBalance + value, "Target should receive ETH");
    }

    function testMockFillMultipleExecutions() public {
        // Create target addresses
        address target1 = makeAddr("target1");
        address target2 = makeAddr("target2");
        uint256 value1 = 1 ether;
        uint256 value2 = 2 ether;

        // Get current balances
        uint256 prevBalance1 = target1.balance;
        uint256 prevBalance2 = target2.balance;

        // Create a batch execution with multiple transfers
        Execution[] memory executions = new Execution[](2);
        executions[0] = Execution({
            target: target1,
            value: value1,
            callData: ""
        });
        executions[1] = Execution({
            target: target2,
            value: value2,
            callData: ""
        });

        // Encode the batch execution
        bytes memory batchCallData = ExecutionLib.encodeBatch(executions);

        // Build the Operation data
        bytes memory operationData = abi.encodePacked(
            uint8(2), // Type.ERC7579
            uint8(0), // SigMode.EMISSARY
            batchCallData
        );

        MockIntentExecutor.Operation memory ops = MockIntentExecutor.Operation({
            data: operationData
        });

        // Execute mockFill
        bool success = executor.mockFill(address(instance.account), ops);

        // Verify the execution succeeded
        assertTrue(success, "mockFill should return true");

        // Check if the balances have increased
        assertEq(target1.balance, prevBalance1 + value1, "Target1 should receive ETH");
        assertEq(target2.balance, prevBalance2 + value2, "Target2 should receive ETH");
    }

    function testMockFillWithCalldata() public {
        // Deploy a simple counter contract to test calldata execution
        Counter counter = new Counter();
        vm.label(address(counter), "Counter");

        // Get initial count
        uint256 initialCount = counter.count();

        // Create execution that calls increment()
        Execution[] memory executions = new Execution[](1);
        executions[0] = Execution({
            target: address(counter),
            value: 0,
            callData: abi.encodeWithSelector(Counter.increment.selector)
        });

        // Encode the batch execution
        bytes memory batchCallData = ExecutionLib.encodeBatch(executions);

        // Build the Operation data
        bytes memory operationData = abi.encodePacked(
            uint8(2), // Type.ERC7579
            uint8(0), // SigMode.EMISSARY
            batchCallData
        );

        MockIntentExecutor.Operation memory ops = MockIntentExecutor.Operation({
            data: operationData
        });

        // Execute mockFill
        bool success = executor.mockFill(address(instance.account), ops);

        // Verify the execution succeeded
        assertTrue(success, "mockFill should return true");

        // Check if count was incremented
        assertEq(counter.count(), initialCount + 1, "Counter should be incremented");
    }
}

// Simple counter contract for testing calldata execution
contract Counter {
    uint256 public count;

    function increment() external {
        count++;
    }
}
