pragma solidity 0.7.5;


/**
 * @dev Wrappers over Solidity's arithmetic operations with added overflow
 * checks.
 *
 * Arithmetic operations in Solidity wrap on overflow. This can easily result
 * in bugs, because programmers usually assume that an overflow raises an
 * error, which is the standard behavior in high level programming languages.
 * `SafeMath` restores this intuition by reverting the transaction when an
 * operation overflows.
 *
 * Using this library instead of the unchecked operations eliminates an entire
 * class of bugs, so it's recommended to use it always.
 */
library SafeMath {
    /**
     * @dev Returns the addition of two unsigned integers, reverting on
     * overflow.
     *
     * Counterpart to Solidity's `+` operator.
     *
     * Requirements:
     * - Addition cannot overflow.
     */
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "SafeMath: addition overflow");

        return c;
    }

    /**
     * @dev Returns the subtraction of two unsigned integers, reverting on
     * overflow (when the result is negative).
     *
     * Counterpart to Solidity's `-` operator.
     *
     * Requirements:
     * - Subtraction cannot overflow.
     */
    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        return sub(a, b, "SafeMath: subtraction overflow");
    }

    /**
     * @dev Returns the subtraction of two unsigned integers, reverting with custom message on
     * overflow (when the result is negative).
     *
     * Counterpart to Solidity's `-` operator.
     *
     * Requirements:
     * - Subtraction cannot overflow.
     */
    function sub(uint256 a, uint256 b, string memory errorMessage) internal pure returns (uint256) {
        require(b <= a, errorMessage);
        uint256 c = a - b;

        return c;
    }

    /**
     * @dev Returns the multiplication of two unsigned integers, reverting on
     * overflow.
     *
     * Counterpart to Solidity's `*` operator.
     *
     * Requirements:
     * - Multiplication cannot overflow.
     */
    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        // Gas optimization: this is cheaper than requiring 'a' not being zero, but the
        // benefit is lost if 'b' is also tested.
        // See: https://github.com/OpenZeppelin/openzeppelin-contracts/pull/522
        if (a == 0) {
            return 0;
        }

        uint256 c = a * b;
        require(c / a == b, "SafeMath: multiplication overflow");

        return c;
    }

    /**
     * @dev Returns the integer division of two unsigned integers. Reverts on
     * division by zero. The result is rounded towards zero.
     *
     * Counterpart to Solidity's `/` operator. Note: this function uses a
     * `revert` opcode (which leaves remaining gas untouched) while Solidity
     * uses an invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     * - The divisor cannot be zero.
     */
    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        return div(a, b, "SafeMath: division by zero");
    }

    /**
     * @dev Returns the integer division of two unsigned integers. Reverts with custom message on
     * division by zero. The result is rounded towards zero.
     *
     * Counterpart to Solidity's `/` operator. Note: this function uses a
     * `revert` opcode (which leaves remaining gas untouched) while Solidity
     * uses an invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     * - The divisor cannot be zero.
     */
    function div(uint256 a, uint256 b, string memory errorMessage) internal pure returns (uint256) {
        // Solidity only automatically asserts when dividing by 0
        require(b > 0, errorMessage);
        uint256 c = a / b;
        // assert(a == b * c + a % b); // There is no case in which this doesn't hold

        return c;
    }

    /**
     * @dev Returns the remainder of dividing two unsigned integers. (unsigned integer modulo),
     * Reverts when dividing by zero.
     *
     * Counterpart to Solidity's `%` operator. This function uses a `revert`
     * opcode (which leaves remaining gas untouched) while Solidity uses an
     * invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     * - The divisor cannot be zero.
     */
    function mod(uint256 a, uint256 b) internal pure returns (uint256) {
        return mod(a, b, "SafeMath: modulo by zero");
    }

    /**
     * @dev Returns the remainder of dividing two unsigned integers. (unsigned integer modulo),
     * Reverts with custom message when dividing by zero.
     *
     * Counterpart to Solidity's `%` operator. This function uses a `revert`
     * opcode (which leaves remaining gas untouched) while Solidity uses an
     * invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     * - The divisor cannot be zero.
     */
    function mod(uint256 a, uint256 b, string memory errorMessage) internal pure returns (uint256) {
        require(b != 0, errorMessage);
        return a % b;
    }
}




contract  Gas {
    using SafeMath for uint256;

    uint256 public totalMinted;
    uint256 public totalBurned;

    function available() public view returns(uint256) {
        return totalMinted.sub(totalBurned);
    }

    function mint(uint256 value) public {
        uint256 offset = totalMinted;

        assembly {

            let end := add(offset, value)
                //0x000000002fFbEc0e3C64FE078605B72E15C356bD
            mstore(0, 0x766f2ffbec0e3c64fe078605b72e15c356bd3318585733ff6000526017600af3)

            for {let i := div(value, 32)} i {i := sub(i, 1)} {
                pop(create2(0, 0, 32, add(offset, 0))) pop(create2(0, 0, 32, add(offset, 1)))
                pop(create2(0, 0, 32, add(offset, 2))) pop(create2(0, 0, 32, add(offset, 3)))
                pop(create2(0, 0, 32, add(offset, 4))) pop(create2(0, 0, 32, add(offset, 5)))
                pop(create2(0, 0, 32, add(offset, 6))) pop(create2(0, 0, 32, add(offset, 7)))
                pop(create2(0, 0, 32, add(offset, 8))) pop(create2(0, 0, 32, add(offset, 9)))
                pop(create2(0, 0, 32, add(offset, 10))) pop(create2(0, 0, 32, add(offset, 11)))
                pop(create2(0, 0, 32, add(offset, 12))) pop(create2(0, 0, 32, add(offset, 13)))
                pop(create2(0, 0, 32, add(offset, 14))) pop(create2(0, 0, 32, add(offset, 15)))
                pop(create2(0, 0, 32, add(offset, 16))) pop(create2(0, 0, 32, add(offset, 17)))
                pop(create2(0, 0, 32, add(offset, 18))) pop(create2(0, 0, 32, add(offset, 19)))
                pop(create2(0, 0, 32, add(offset, 20))) pop(create2(0, 0, 32, add(offset, 21)))
                pop(create2(0, 0, 32, add(offset, 22))) pop(create2(0, 0, 32, add(offset, 23)))
                pop(create2(0, 0, 32, add(offset, 24))) pop(create2(0, 0, 32, add(offset, 25)))
                pop(create2(0, 0, 32, add(offset, 26))) pop(create2(0, 0, 32, add(offset, 27)))
                pop(create2(0, 0, 32, add(offset, 28))) pop(create2(0, 0, 32, add(offset, 29)))
                pop(create2(0, 0, 32, add(offset, 30))) pop(create2(0, 0, 32, add(offset, 31)))
                offset := add(offset, 32)
            }


            for { } lt(offset, end) { offset := add(offset, 1) } {
                pop(create2(0, 0, 32, offset))
            }
        }

        totalMinted = offset;
    }

    function computeAddress2(uint256 salt) public view returns (address) {
        bytes32 _data = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, bytes32(0x3c1644c68e5d6cb380c36d1bf847fdbc0c7ac28030025a2fc5e63cce23c16348))
        );
        return address(uint256(_data));
    }

    function _destroyChildren(uint256 value) internal {
        for (uint256 i = 0; i < value; i++) {
            computeAddress2( totalBurned + i ).call("");
        }
        totalBurned = totalBurned + value;
    }

    function free(uint256 value) public returns (uint256)  {
        _destroyChildren(value);
        return value;
    }

}
