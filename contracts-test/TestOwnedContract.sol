// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.3;
import "../contracts/infrastructure/base/Owned.sol";

/**
 * @title TestOwnedContract
 * @notice Represents an arbitrary contract implementing Owned.
 */
contract TestOwnedContract is Owned {

    uint256 public state;

    event StateSet(uint256 indexed _state, uint256 indexed _value);

    function setStateRestricted(uint256 _state) public onlyOwner payable {
        state = _state;
        emit StateSet(_state, msg.value);
    }
}