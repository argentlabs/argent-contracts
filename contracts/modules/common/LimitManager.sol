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
pragma solidity ^0.6.8;

import "../../wallet/BaseWallet.sol";
import "./BaseModule.sol";

/**
 * @title LimitManager
 * @dev Module to manage a daily spending limit
 * @author Julien Niset - <julien@argent.im>
 */
contract LimitManager is BaseModule {

    // large limit when the limit can be considered disabled
    uint128 constant private LIMIT_DISABLED = uint128(-1); // 3.40282366920938463463374607431768211455e+38

    using SafeMath for uint256;

    struct LimitManagerConfig {
        // The daily limit
        Limit limit;
        // The current usage
        DailySpent dailySpent;
    }

    struct Limit {
        // the current limit
        uint128 current;
        // the pending limit if any
        uint128 pending;
        // when the pending limit becomes the current limit
        uint64 changeAfter;
    }

    struct DailySpent {
        // The amount already spent during the current period
        uint128 alreadySpent;
        // The end of the current period
        uint64 periodEnd;
    }

    // wallet specific storage
    mapping (address => LimitManagerConfig) internal limits;
    // The default limit
    uint256 public defaultLimit;

    // *************** Events *************************** //

    event LimitChanged(address indexed wallet, uint indexed newLimit, uint64 indexed startAfter);

    // *************** Constructor ********************** //

    constructor(uint256 _defaultLimit) public {
        defaultLimit = _defaultLimit;
    }

    // *************** External/Public Functions ********************* //

    /**
     * @dev Inits the module for a wallet by setting the limit to the default value.
     * @param _wallet The target wallet.
     */
    function init(BaseWallet _wallet) public onlyWallet(_wallet) {
        Limit storage limit = limits[address(_wallet)].limit;
        if (limit.current == 0 && limit.changeAfter == 0) {
            limit.current = uint128(defaultLimit);
        }
    }

    // *************** Internal Functions ********************* //

    /**
     * @dev Changes the daily limit.
     * The limit is expressed in ETH and the change is pending for the security period.
     * @param _wallet The target wallet.
     * @param _newLimit The new limit.
     * @param _securityPeriod The security period.
     */
    function changeLimit(BaseWallet _wallet, uint256 _newLimit, uint256 _securityPeriod) internal {
        Limit storage limit = limits[address(_wallet)].limit;
        // solium-disable-next-line security/no-block-members
        uint128 current = (limit.changeAfter > 0 && limit.changeAfter < now) ? limit.pending : limit.current;
        limit.current = current;
        limit.pending = uint128(_newLimit);
        // solium-disable-next-line security/no-block-members
        limit.changeAfter = uint64(now.add(_securityPeriod));
        // solium-disable-next-line security/no-block-members
        emit LimitChanged(address(_wallet), _newLimit, uint64(now.add(_securityPeriod)));
    }

     /**
     * @dev Disable the daily limit.
     * The change is pending for the security period.
     * @param _wallet The target wallet.
     * @param _securityPeriod The security period.
     */
    function disableLimit(BaseWallet _wallet, uint256 _securityPeriod) internal {
        changeLimit(_wallet, LIMIT_DISABLED, _securityPeriod);
    }

    /**
    * @dev Gets the current daily limit for a wallet.
    * @param _wallet The target wallet.
    * @return the current limit expressed in ETH.
    */
    function getCurrentLimit(BaseWallet _wallet) public view returns (uint256 _currentLimit) {
        Limit storage limit = limits[address(_wallet)].limit;
        _currentLimit = uint256(currentLimit(limit.current, limit.pending, limit.changeAfter));
    }

    /**
    * @dev Returns whether the daily limit is disabled for a wallet.
    * @param _wallet The target wallet.
    * @return true if the daily limit is disabled, false otherwise.
    */
    function isLimitDisabled(BaseWallet _wallet) public view returns (bool _limitDisabled) {
        uint256 currentLimit = getCurrentLimit(_wallet);
        _limitDisabled = currentLimit == LIMIT_DISABLED;
    }

    /**
    * @dev Gets a pending limit for a wallet if any.
    * @param _wallet The target wallet.
    * @return the pending limit (in ETH) and the time at chich it will become effective.
    */
    function getPendingLimit(BaseWallet _wallet) external view returns (uint256 _pendingLimit, uint64 _changeAfter) {
        Limit storage limit = limits[address(_wallet)].limit;
        // solium-disable-next-line security/no-block-members
        return ((now < limit.changeAfter)? (uint256(limit.pending), limit.changeAfter) : (0,0));
    }

    /**
    * @dev Gets the amount of tokens that has not yet been spent during the current period.
    * @param _wallet The target wallet.
    * @return the amount of tokens (in ETH) that has not been spent yet and the end of the period.
    */
    function getDailyUnspent(BaseWallet _wallet) external view returns (uint256 _unspent, uint64 _periodEnd) {
        uint256 limit = getCurrentLimit(_wallet);
        DailySpent storage expense = limits[address(_wallet)].dailySpent;
        // solium-disable-next-line security/no-block-members
        if (now > expense.periodEnd) {
            _unspent = limit;
            // solium-disable-next-line security/no-block-members
            _periodEnd = uint64(now + 24 hours);
        } else {
            _periodEnd = expense.periodEnd;
            if (expense.alreadySpent < limit) {
                _unspent = limit - expense.alreadySpent;
            }
        }
    }

    /**
    * @dev Helper method to check if a transfer is within the limit.
    * If yes the daily unspent for the current period is updated.
    * @param _wallet The target wallet.
    * @param _amount The amount for the transfer
    */
    function checkAndUpdateDailySpent(BaseWallet _wallet, uint _amount) internal returns (bool) {
        if (_amount == 0)
            return true;
        Limit storage limit = limits[address(_wallet)].limit;
        uint128 current = currentLimit(limit.current, limit.pending, limit.changeAfter);
        if (isWithinDailyLimit(_wallet, current, _amount)) {
            updateDailySpent(_wallet, current, _amount);
            return true;
        }
        return false;
    }

    /**
    * @dev Helper method to update the daily spent for the current period.
    * @param _wallet The target wallet.
    * @param _limit The current limit for the wallet.
    * @param _amount The amount to add to the daily spent.
    */
    function updateDailySpent(BaseWallet _wallet, uint128 _limit, uint _amount) internal {
        if (_limit != LIMIT_DISABLED) {
            DailySpent storage expense = limits[address(_wallet)].dailySpent;
            // solium-disable-next-line security/no-block-members
            if (expense.periodEnd < now) {
                // solium-disable-next-line security/no-block-members
                expense.periodEnd = uint64(now + 24 hours);
                expense.alreadySpent = uint128(_amount);
            } else {
                expense.alreadySpent += uint128(_amount);
            }
        }
    }

    /**
    * @dev Checks if a transfer amount is withing the daily limit for a wallet.
    * @param _wallet The target wallet.
    * @param _limit The current limit for the wallet.
    * @param _amount The transfer amount.
    * @return true if the transfer amount is withing the daily limit.
    */
    function isWithinDailyLimit(BaseWallet _wallet, uint _limit, uint _amount) internal view returns (bool) {
        if (_limit == LIMIT_DISABLED) {
            return true;
        }
        DailySpent storage expense = limits[address(_wallet)].dailySpent;
        // solium-disable-next-line security/no-block-members
        if (expense.periodEnd < now) {
            return (_amount <= _limit);
        } else {
            return (expense.alreadySpent + _amount <= _limit && expense.alreadySpent + _amount >= expense.alreadySpent);
        }
    }

    /**
    * @dev Helper method to get the current limit from a Limit struct.
    * @param _current The value of the current parameter
    * @param _pending The value of the pending parameter
    * @param _changeAfter The value of the changeAfter parameter
    */
    function currentLimit(uint128 _current, uint128 _pending, uint64 _changeAfter) internal view returns (uint128) {
        // solium-disable-next-line security/no-block-members
        if (_changeAfter > 0 && _changeAfter < now) {
            return _pending;
        }
        return _current;
    }

}