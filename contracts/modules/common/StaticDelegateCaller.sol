// Copyright (C) 2018  Argent Labs Ltd. <https://argent.xyz>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;


/**
 * @title StaticDelegateCaller
 * @notice An abstract utility class providing the ability to perform "static" delegatecalls to a subclass.
 * Based on https://github.com/gnosis/util-contracts/pull/31/files
 * @author Olivier VDB <olivier@argent.xyz>
 */
abstract contract StaticDelegateCaller {

    bool private unlocked;

    bytes4 constant internal DO_DELEGATECALL_AND_REVERT_SELECTOR = bytes4(keccak256("doDelegateCallAndRevert(address,bytes)"));

    /* ***************** External Methods ************************* */

    /**
     * @dev Performs a delegetecall on a target contract in the context of self.
     * Internally reverts execution to avoid side effects (making it static). Returns encoded result as revert message
     * concatenated with the success flag of the inner call as a last byte.
     * @param target address of the contract containing the code to execute.
     * @param data calldata that should be sent to the target contract (encoded method name and arguments).
     */
    function doDelegateCallAndRevert(address target, bytes memory data) external returns (bytes memory) {
        // require(msg.sender == address(this), "SDC: sender should be this");
        // require(unlocked, "SDC: should be called via doStaticDelegatecall()");
        (bool success, bytes memory response) = target.delegatecall(data);
        bytes memory packed = abi.encodePacked(response, success);
        // solhint-disable-next-line no-inline-assembly
        assembly { 
            revert(add(packed, 0x20), mload(packed)) // return the packed response without appending sig("Error(string)") to them
        }
    }

    /* ***************** Internal Methods ************************* */

    /**
     * @dev Performs a delegetecall on a target contract in the context of self.
     * Internally reverts execution to avoid side effects (making it static). Catches revert and returns encoded result as bytes.
     * @param target address of the contract containing the code to execute.
     * @param data calldata that should be sent to the target contract (encoded method name and arguments).
     */
    function doStaticDelegatecall(
        address target,
        bytes memory data
    ) internal returns (bytes memory) {
        bytes memory innerCall = abi.encodeWithSelector(DO_DELEGATECALL_AND_REVERT_SELECTOR, target, data);
        // unlocked = true;
        (, bytes memory response) = address(this).delegatecall(innerCall);
        // unlocked = false;
        bool innerSuccess = response[response.length - 1] == 0x01;
        // solhint-disable-next-line no-inline-assembly
        assembly { 
            mstore(response, sub(mload(response), 1))  // popping the success flag off the response
        }
        if (innerSuccess) {
            return response;
        } else {
            // solhint-disable-next-line no-inline-assembly
            assembly { 
                revert(add(response, 0x20), mload(response)) // return the raw error bytes without appending sig("Error(string)") to them
            }
        }
    }
}