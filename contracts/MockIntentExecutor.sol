// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC7579ExecutorBase} from "modulekit/Modules.sol";
import {IERC7579Account} from "modulekit/Accounts.sol";
import {ModeLib} from "modulekit/accounts/common/lib/ModeLib.sol";

contract MockIntentExecutor is ERC7579ExecutorBase {
    bytes4 public constant EXECUTE_FROM_EXECUTOR = 0xd691c964;
    // ModeCode: CALLTYPE_BATCH (0x01) | EXECTYPE_DEFAULT (0x00) | 4 bytes unused | 4 bytes mode selector | 22 bytes payload
    bytes32 public constant BATCH_MODE = 0x0100000000000000000000000000000000000000000000000000000000000000;

    uint256 internal constant OFFSET_EXEC_TYPE = 0;
    uint256 internal constant OFFSET_SIG_MODE = 1;
    uint256 internal constant OFFSET_EXEC_DATA = 2;

    enum Type {
        Eip712Hash,
        Calldata,
        ERC7579,
        MultiCall
    }

    enum SigMode {
        EMISSARY,
        ERC1271,
        EMISSARY_ERC1271,
        ERC1271_EMISSARY,
        EMISSARY_EXECUTION,
        EMISSARYEXECUTION_ERC1271,
        ERC1271_EMISSARYEXECUTION
    }

    /**
     * @notice A generic wrapper for an encoded execution payload.
     * @param data The raw bytes of the execution payload, see `SmartExecutionLib`.
     */
    struct Operation {
        bytes data;
    }

    function mockFill(address account, Operation calldata ops) external payable returns (bool) {
        (bool success,) =
            account.call(abi.encodeWithSelector(EXECUTE_FROM_EXECUTOR, BATCH_MODE, ops.data[OFFSET_EXEC_DATA:]));
        require(success, "MockIntentExecutor: execution failed");
        return true;
    }

    function toExecType(Operation calldata ops) internal pure returns (Type _type) {
        if (ops.data.length == 0) return Type.Eip712Hash;
        uint8 typeValue = uint8(ops.data[OFFSET_EXEC_TYPE]);
        _type = Type(typeValue);
    }
    /**
     * Initialize the module with the given data
     *
     * @param data The data to initialize the module with
     */
    function onInstall(bytes calldata data) external override {}

    /**
     * De-initialize the module with the given data
     *
     * @param data The data to de-initialize the module with
     */
    function onUninstall(bytes calldata data) external override {}

    /**
     * Check if the module is initialized
     * @param smartAccount The smart account to check
     *
     * @return true if the module is initialized, false otherwise
     */
    function isInitialized(address smartAccount) external view returns (bool) {}

    /**
     * The name of the module
     *
     * @return name The name of the module
     */
    function name() external pure returns (string memory) {
        return "ExecutorTemplate";
    }

    /**
     * The version of the module
     *
     * @return version The version of the module
     */
    function version() external pure returns (string memory) {
        return "0.0.1";
    }

    /**
     * Check if the module is of a certain type
     *
     * @param typeID The type ID to check
     *
     * @return true if the module is of the given type, false otherwise
     */
    function isModuleType(uint256 typeID) external pure override returns (bool) {
        return typeID == TYPE_EXECUTOR;
    }
}
