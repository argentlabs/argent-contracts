/*

    Copyright 2019 dYdX Trading Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

*/

pragma solidity ^0.5.7;
pragma experimental ABIEncoderV2;

import { TypedSignature } from "../external/lib/TypedSignature.sol";
import { Math } from "../protocol/lib/Math.sol";
import { Require } from "../protocol/lib/Require.sol";
import { Time } from "../protocol/lib/Time.sol";
import { Token } from "../protocol/lib/Token.sol";
import { Types } from "../protocol/lib/Types.sol";


/**
 * @title TestLib
 * @author dYdX
 *
 * Contract for testing pure library functions
 */
contract TestLib {

    // ============ Constants ============

    bytes32 constant FILE = "TestLib";

    // ============ TypedSignature Functions ============

    function TypedSignatureRecover(
        bytes32 hash,
        bytes calldata signatureWithType
    )
        external
        pure
        returns (address)
    {
        return TypedSignature.recover(hash, signatureWithType);
    }

    // ============ Math Functions ============

    function MathGetPartial(
        uint256 target,
        uint256 numerator,
        uint256 denominator
    )
        external
        pure
        returns (uint256)
    {
        return Math.getPartial(target, numerator, denominator);
    }

    function MathGetPartialRoundUp(
        uint256 target,
        uint256 numerator,
        uint256 denominator
    )
        external
        pure
        returns (uint256)
    {
        return Math.getPartialRoundUp(target, numerator, denominator);
    }

    function MathTo128(
        uint256 x
    )
        external
        pure
        returns (uint128)
    {
        return Math.to128(x);
    }

    function MathTo96(
        uint256 x
    )
        external
        pure
        returns (uint96)
    {
        return Math.to96(x);
    }

    function MathTo32(
        uint256 x
    )
        external
        pure
        returns (uint32)
    {
        return Math.to32(x);
    }

    // ============ Require Functions ============

    function RequireThat0(
        bytes32 reason
    )
        external
        pure
    {
        Require.that(
            false,
            FILE,
            reason
        );
    }

    function RequireThat1(
        bytes32 reason,
        uint256 payloadA
    )
        external
        pure
    {
        Require.that(
            false,
            FILE,
            reason,
            payloadA
        );
    }

    function RequireThat2(
        bytes32 reason,
        uint256 payloadA,
        uint256 payloadB
    )
        external
        pure
    {
        Require.that(
            false,
            FILE,
            reason,
            payloadA,
            payloadB
        );
    }

    function RequireThatA0(
        bytes32 reason,
        address payloadA
    )
        external
        pure
    {
        Require.that(
            false,
            FILE,
            reason,
            payloadA
        );
    }

    function RequireThatA1(
        bytes32 reason,
        address payloadA,
        uint256 payloadB
    )
        external
        pure
    {
        Require.that(
            false,
            FILE,
            reason,
            payloadA,
            payloadB
        );
    }

    function RequireThatA2(
        bytes32 reason,
        address payloadA,
        uint256 payloadB,
        uint256 payloadC
    )
        external
        pure
    {
        Require.that(
            false,
            FILE,
            reason,
            payloadA,
            payloadB,
            payloadC
        );
    }

    function RequireThatB0(
        bytes32 reason,
        bytes32 payloadA
    )
        external
        pure
    {
        Require.that(
            false,
            FILE,
            reason,
            payloadA
        );
    }

    function RequireThatB2(
        bytes32 reason,
        bytes32 payloadA,
        uint256 payloadB,
        uint256 payloadC
    )
        external
        pure
    {
        Require.that(
            false,
            FILE,
            reason,
            payloadA,
            payloadB,
            payloadC
        );
    }

    // ============ Time Functions ============

    function TimeCurrentTime()
        external
        view
        returns (uint32)
    {
        return Time.currentTime();
    }

    // ============ Token Functions ============

    function TokenBalanceOf(
        address token,
        address owner
    )
        external
        view
        returns (uint256)
    {
        return Token.balanceOf(token, owner);
    }

    function TokenAllowance(
        address token,
        address owner,
        address spender
    )
        external
        view
        returns (uint256)
    {
        return Token.allowance(token, owner, spender);
    }

    function TokenApprove(
        address token,
        address spender,
        uint256 amount
    )
        external
    {
        Token.approve(token, spender, amount);
    }

    function TokenApproveMax(
        address token,
        address spender
    )
        external
    {
        Token.approveMax(token, spender);
    }

    function TokenTransfer(
        address token,
        address to,
        uint256 amount
    )
        external
    {
        Token.transfer(token, to, amount);
    }

    function TokenTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    )
        external
    {
        Token.transferFrom(
            token,
            from,
            to,
            amount
        );
    }

    // ============ Types Functions ============

    function TypesZeroPar()
        external
        pure
        returns (Types.Par memory)
    {
        return Types.zeroPar();
    }

    function TypesParSub(
        Types.Par memory a,
        Types.Par memory b
    )
        public
        pure
        returns (Types.Par memory)
    {
        return Types.sub(a, b);
    }

    function TypesParAdd(
        Types.Par memory a,
        Types.Par memory b
    )
        public
        pure
        returns (Types.Par memory)
    {
        return Types.add(a, b);
    }

    function TypesParEquals(
        Types.Par memory a,
        Types.Par memory b
    )
        public
        pure
        returns (bool)
    {
        return Types.equals(a, b);
    }

    function TypesParNegative(
        Types.Par memory a
    )
        public
        pure
        returns (Types.Par memory)
    {
        return Types.negative(a);
    }

    function TypesParIsNegative(
        Types.Par memory a
    )
        public
        pure
        returns (bool)
    {
        return Types.isNegative(a);
    }

    function TypesParIsPositive(
        Types.Par memory a
    )
        public
        pure
        returns (bool)
    {
        return Types.isPositive(a);
    }

    function TypesParIsZero(
        Types.Par memory a
    )
        public
        pure
        returns (bool)
    {
        return Types.isZero(a);
    }

    function TypesZeroWei()
        external
        pure
        returns (Types.Wei memory)
    {
        return Types.zeroWei();
    }

    function TypesWeiSub(
        Types.Wei memory a,
        Types.Wei memory b
    )
        public
        pure
        returns (Types.Wei memory)
    {
        return Types.sub(a, b);
    }

    function TypesWeiAdd(
        Types.Wei memory a,
        Types.Wei memory b
    )
        public
        pure
        returns (Types.Wei memory)
    {
        return Types.add(a, b);
    }

    function TypesWeiEquals(
        Types.Wei memory a,
        Types.Wei memory b
    )
        public
        pure
        returns (bool)
    {
        return Types.equals(a, b);
    }

    function TypesWeiNegative(
        Types.Wei memory a
    )
        public
        pure
        returns (Types.Wei memory)
    {
        return Types.negative(a);
    }

    function TypesWeiIsNegative(
        Types.Wei memory a
    )
        public
        pure
        returns (bool)
    {
        return Types.isNegative(a);
    }

    function TypesWeiIsPositive(
        Types.Wei memory a
    )
        public
        pure
        returns (bool)
    {
        return Types.isPositive(a);
    }

    function TypesWeiIsZero(
        Types.Wei memory a
    )
        public
        pure
        returns (bool)
    {
        return Types.isZero(a);
    }
}
