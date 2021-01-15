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

// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "../base/Utils.sol";
import "../base/BaseTransfer.sol";
import "../base/Configuration.sol";
import "./ITransferManager.sol";

/**
 * @title TransferManager
 * @notice Feature to transfer and approve tokens (ETH or ERC20) or data (contract call) based on a security context (daily limit, whitelist, etc).
 * @author Julien Niset - <julien@argent.xyz>
 */
contract TransferManager is ITransferManager, BaseTransfer {

    bytes4 private constant ERC1271_ISVALIDSIGNATURE_BYTES32 = bytes4(keccak256("isValidSignature(bytes32,bytes)"));

    using SafeMath for uint256;

    // TODO
    // function getStaticCallSignatures() external virtual override view returns (bytes4[] memory _sigs) {
    //     _sigs = new bytes4[](1);
    //     _sigs[0] = ERC1271_ISVALIDSIGNATURE_BYTES32;
    // }

    /**
     * @inheritdoc ITransferManager
     */
    function isValidSignature(bytes32 _msgHash, bytes memory _signature) public override view returns (bytes4) {
        require(_signature.length == 65, "TM: invalid signature length");
        address signer = Utils.recoverSigner(_msgHash, _signature, 0);
        require(owner == signer, "TM: Invalid signer");
        return ERC1271_ISVALIDSIGNATURE_BYTES32;
    }

    /**
     * @inheritdoc ITransferManager
     */
    function transferToken(address _token, address payable _to, uint256 _amount, bytes calldata _data)
    external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        if (isWhitelisted(_to)) {
            // transfer to whitelist
            doTransfer(_token, _to, _amount, _data);
        } else {
            uint256 etherAmount = (_token == ETH_TOKEN) ? _amount : getEtherValue(_amount, _token);
            if (checkAndUpdateDailySpent(etherAmount)) {
                // transfer under the limit
                doTransfer(_token, _to, _amount, _data);
            } else {
                // transfer above the limit
                (bytes32 id, uint256 executeAfter) = addPendingAction(ActionType.Transfer, _token, _to, _amount, _data);
                emit PendingTransferCreated(address(this), id, executeAfter, _token, _to, _amount, _data);
            }
        }
    }

    /**
     * @inheritdoc ITransferManager
     */
    function approveToken(address _token, address _spender, uint256 _amount)
    external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        if (isWhitelisted(_spender)) {
            // approve to whitelist
            doApproveToken(_token, _spender, _amount);
        } else {
            // get current alowance
            uint256 currentAllowance = ERC20(_token).allowance(address(this), _spender);
            if (_amount <= currentAllowance) {
                // approve if we reduce the allowance
                doApproveToken(_token, _spender, _amount);
            } else {
                // check if delta is under the limit
                uint delta = _amount - currentAllowance;
                uint256 deltaInEth = getEtherValue(delta, _token);
                require(checkAndUpdateDailySpent(deltaInEth), "TM: Approve above daily limit");
                // approve if under the limit
                doApproveToken(_token, _spender, _amount);
            }
        }
    }

    /**
     * @inheritdoc ITransferManager
     */
    function callContract(address _contract, uint256 _value, bytes calldata _data)
    external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    onlyAuthorisedContractCall(_contract)
    {
        checkAndUpdateDailySpentIfNeeded(ETH_TOKEN, _value, _contract);
        doCallContract(_contract, _value, _data);
    }

    /**
     * @inheritdoc ITransferManager
     */
    function approveTokenAndCallContract(
        address _token,
        address _proxy,
        uint256 _amount,
        address _contract,
        bytes calldata _data
    )
        external override
        onlyWalletOwner()
        onlyWhenUnlocked()
        onlyAuthorisedContractCall(_contract)
    {
        checkAndUpdateDailySpentIfNeeded(_token, _amount, _contract);
        doApproveTokenAndCallContract(_token, _proxy, _amount, _contract, _data);
    }

    /**
     * @inheritdoc ITransferManager
     */
    function approveWethAndCallContract(
        address _proxy,
        uint256 _amount,
        address _contract,
        bytes calldata _data
    )
        external override
        onlyWalletOwner()
        onlyWhenUnlocked()
        onlyAuthorisedContractCall(_contract)
    {
        address wethToken = Configuration(registry).wethToken();
        checkAndUpdateDailySpentIfNeeded(wethToken, _amount, _contract);
        doApproveWethAndCallContract(_proxy, _amount, _contract, _data);
    }

    /**
     * @inheritdoc ITransferManager
     */
    function getPendingTransfer(bytes32 _id) external override view returns (uint64 _executeAfter) {
        _executeAfter = uint64(pendingActions[_id]);
    }

    /**
     * @inheritdoc ITransferManager
     */
    function executePendingTransfer(
        address _token,
        address payable _to,
        uint _amount,
        bytes calldata _data,
        uint _block
    )
        external override
        onlyWhenUnlocked()
    {
        bytes32 id = keccak256(abi.encodePacked(ActionType.Transfer, _token, _to, _amount, _data, _block));
        uint executeAfter = pendingActions[id];
        require(executeAfter > 0, "TM: unknown pending transfer");
        uint securityWindow = Configuration(registry).securityWindow();
        uint executeBefore = executeAfter.add(securityWindow);

        require(executeAfter <= block.timestamp && block.timestamp <= executeBefore, "TM: transfer outside of the execution window");
        delete pendingActions[id];
        doTransfer(_token, _to, _amount, _data);
        emit PendingTransferExecuted(address(this), id);
    }

    /**
     * @inheritdoc ITransferManager
     */
    function cancelPendingTransfer(bytes32 _id)
    external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        require(pendingActions[_id] > 0, "TM: unknown pending action");
        delete pendingActions[_id];
        emit PendingTransferCanceled(address(this), _id);
    }

    /**
     * @inheritdoc ITransferManager
     */
    function addToWhitelist(address _target)
    external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        require(!isWhitelisted(_target), "TM: target already whitelisted");

        uint256 securityPeriod = Configuration(registry).securityPeriod();
        uint256 whitelistAfter = block.timestamp.add(securityPeriod);
        whitelist[_target] = whitelistAfter;
        emit AddedToWhitelist(address(this), _target, uint64(whitelistAfter));
    }

    /**
     * @inheritdoc ITransferManager
     */
    function removeFromWhitelist(address _target)
    external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        whitelist[_target] = 0;
        emit RemovedFromWhitelist(address(this), _target);
    }

    /**
     * @inheritdoc ITransferManager
     */
    function isWhitelisted(address _target) public override view returns (bool _isWhitelisted) {
        uint whitelistAfter = whitelist[_target];
        return whitelistAfter > 0 && whitelistAfter < block.timestamp;
    }

    /**
     * @inheritdoc ITransferManager
     */
    function changeLimit(uint256 _newLimit) external override
    onlyWalletOwner()
    onlyWhenUnlocked()
    {
        uint256 currentLimit = getCurrentLimit();
        Limit memory newLimit;
        if (_newLimit <= currentLimit) {
            uint128 targetLimit = Utils.safe128(_newLimit);
            newLimit = Limit(targetLimit, targetLimit, Utils.safe64(block.timestamp));
        } else {
            uint256 securityPeriod = Configuration(registry).securityPeriod();
            newLimit = Limit(Utils.safe128(currentLimit), Utils.safe128(_newLimit), Utils.safe64(block.timestamp.add(securityPeriod)));
        }
        limit = newLimit;

        emit LimitChanged(address(this), _newLimit, limit.changeAfter);
    }

    /**
     * @inheritdoc ITransferManager
     */
    function disableLimit() external override
    onlyWalletOwner()
    onlyWhenUnlocked() 
    {
        uint256 securityPeriod = Configuration(registry).securityPeriod();
        Limit memory newLimit;
        newLimit = Limit(limit.current, Utils.safe128(LIMIT_DISABLED), Utils.safe64(block.timestamp.add(securityPeriod)));
        limit = newLimit;
        emit DailyLimitDisabled(address(this), securityPeriod);
    }

    /**
     * @inheritdoc ITransferManager
     */
    function getCurrentLimit() public override view returns (uint256 _currentLimit) {
        if (limit.changeAfter > 0 && limit.changeAfter < block.timestamp) {
            return limit.pending;
        }

        if (limit.current == 0) {
            uint256 defaultLimit = Configuration(registry).defaultLimit();
            return defaultLimit;
        }

        return limit.current;
    }

    /**
     * @inheritdoc ITransferManager
     */
    function isLimitDisabled() public override view returns (bool _limitDisabled) {
        uint256 currentLimit = getCurrentLimit();
        return (currentLimit == LIMIT_DISABLED);
    }

    /**
     * @inheritdoc ITransferManager
     */
    function getPendingLimit() external override view returns (uint256 _pendingLimit, uint64 _changeAfter) {
        return ((block.timestamp < limit.changeAfter)? (limit.pending, uint64(limit.changeAfter)) : (0,0));
    }

    /**
     * @inheritdoc ITransferManager
     */
    function getDailyUnspent() external override view returns (uint256 _unspent, uint64 _periodEnd) {
        uint256 currentLimit = getCurrentLimit();

        if (block.timestamp > dailySpent.periodEnd) {
            return (currentLimit, uint64(block.timestamp.add(24 hours)));
        } else if (dailySpent.alreadySpent < currentLimit) {
            return (currentLimit.sub(dailySpent.alreadySpent), dailySpent.periodEnd);
        } else {
            return (0, dailySpent.periodEnd);
        }
    }

    /**
     * @inheritdoc ITransferManager
     */
    function getDailySpent() external override view returns (DataTypes.DailySpent memory _dailySpent) {
        return dailySpent;
    }

    // *************** Internal Functions ********************* //

    /**
     * @notice Creates a new pending action for a wallet.
     * @param _action The target action.
     * @param _token The target token for the action.
     * @param _to The recipient of the action.
     * @param _amount The amount of token associated to the action.
     * @param _data The data associated to the action.
     * @return id The identifier for the new pending action.
     * @return executeAfter The time when the action can be executed
     */
    function addPendingAction(
        ActionType _action,
        address _token,
        address _to,
        uint _amount,
        bytes memory _data
    )
        internal
        returns (bytes32 id, uint256 executeAfter)
    {
        id = keccak256(abi.encodePacked(_action, _token, _to, _amount, _data, block.number));
        require(pendingActions[id] == 0, "TM: duplicate pending action");

        uint256 securityPeriod = Configuration(registry).securityPeriod();
        executeAfter = block.timestamp.add(securityPeriod);
        pendingActions[id] = executeAfter;
    }

    /**
    * @notice Make sure a contract call is not trying to call a supported ERC20.
    * @param _contract The address of the contract.
     */
    function coveredByDailyLimit(address _contract) internal view returns (bool) {
        ITokenPriceRegistry _tokenPriceRegistry = Configuration(registry).tokenPriceRegistry();
        return (_tokenPriceRegistry.getTokenPrice(_contract) > 0 && !isLimitDisabled());
    }

    /**
    * @notice Verify and update the daily spent if the spender is not whitelisted.
    * Reverts if the daily spent is insufficient or if the contract to call is
    * protected by the daily limit (i.e. is a token contract).
    * @param _token The token that the spender will spend.
    * @param _amount The amount of ERC20 or ETH that the spender will spend.
    * @param _contract The address of the contract called by the wallet for the spend to occur.
    */
    function checkAndUpdateDailySpentIfNeeded(address _token, uint256 _amount, address _contract)
    internal
    {
        if (!isWhitelisted(_contract)) {
            // Make sure we don't call a supported ERC20 that's not whitelisted
            require(!coveredByDailyLimit(_contract), "TM: Forbidden contract");

            // Check if the amount is under the daily limit.
            // Check the entire amount because the currently approved amount will be restored and should still count towards the daily limit
            uint256 valueInEth;
            address wethToken = Configuration(registry).wethToken();
            if (_token == ETH_TOKEN || _token == wethToken) {
                valueInEth = _amount;
            } else {
                valueInEth = getEtherValue(_amount, _token);
            }
            require(checkAndUpdateDailySpent(valueInEth), "TM: Approve above daily limit");
        }
    }

    /**
    * @notice Checks if a transfer is within the limit. If yes the daily spent is updated.
    * @param _amount The amount for the transfer
    * @return true if the transfer is withing the daily limit.
    */
    function checkAndUpdateDailySpent(uint256 _amount) internal returns (bool)
    {
        uint256 currentLimit = getCurrentLimit();
        if (_amount == 0 || currentLimit == LIMIT_DISABLED) {
            return true;
        }
        DailySpent memory newDailySpent;
        if (dailySpent.periodEnd <= block.timestamp && _amount <= currentLimit) {
            newDailySpent = DailySpent(Utils.safe128(_amount), Utils.safe64(block.timestamp + 24 hours));
            dailySpent = newDailySpent;
            return true;
        } else if (dailySpent.periodEnd > block.timestamp && _amount.add(dailySpent.alreadySpent) <= currentLimit) {
            newDailySpent = DailySpent(Utils.safe128(_amount.add(dailySpent.alreadySpent)), Utils.safe64(dailySpent.periodEnd));
            dailySpent = newDailySpent;
            return true;
        }
        return false;
    }

    /**
    * @notice Helper method to get the ether value equivalent of a token amount.
    * @notice For low value amounts of tokens we accept this to return zero as these are small enough to disregard.
    * Note that the price stored for tokens = price for 1 token (in ETH wei) * 10^(18-token decimals).
    * @param _amount The token amount.
    * @param _token The address of the token.
    * @return The ether value for _amount of _token.
    */
    function getEtherValue(uint256 _amount, address _token) internal view returns (uint256) {
        ITokenPriceRegistry tokenPriceRegistry = Configuration(registry).tokenPriceRegistry();

        uint256 price = tokenPriceRegistry.getTokenPrice(_token);
        uint256 etherValue = price.mul(_amount).div(10**18);
        return etherValue;
    }
}
