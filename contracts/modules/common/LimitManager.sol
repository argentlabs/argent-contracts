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
pragma solidity ^0.6.10;

import "./BaseModule.sol";
import "../../infrastructure/storage/ILimitStorage.sol"; 

/**
 * @title LimitManager
 * @dev Module to manage a daily spending limit
 * @author Julien Niset - <julien@argent.xyz>
 */
abstract contract LimitManager is BaseModule {

    // large limit when the limit can be considered disabled
    uint256 constant internal LIMIT_DISABLED = uint256(-1);

    using SafeMath for uint256;

    // The storage contract
    ILimitStorage public lStorage;
    // The default limit
    uint256 public defaultLimit;

    // *************** Events *************************** //

    event LimitChanged(address indexed wallet, uint indexed newLimit, uint64 indexed startAfter);

    // *************** Constructor ********************** //

    constructor(ILimitStorage _limitStorage, uint256 _defaultLimit) public {
        lStorage = _limitStorage;
        defaultLimit = _defaultLimit;
    }

    // *************** Internal Functions ********************* //

    function initLimit(address _wallet) internal {
        lStorage.setLimit(_wallet, defaultLimit, 0, 0);
    }

    /**
     * @dev Changes the daily limit.
     * The limit is expressed in ETH and the change is pending for the security period.
     * @param _wallet The target wallet.
     * @param _newLimit The new limit.
     * @param _securityPeriod The security period.
     */
    function changeLimit(address _wallet, uint256 _newLimit, uint256 _securityPeriod) internal {
        (uint256 current, uint256 pending, uint256 changeAfter) = getLimit(_wallet);
        // solium-disable-next-line security/no-block-members
        uint256 currentLimit = (changeAfter > 0 && changeAfter < now) ? pending : current;
        // solium-disable-next-line security/no-block-members
        lStorage.setLimit(_wallet, currentLimit, _newLimit, now.add(_securityPeriod));
        // solium-disable-next-line security/no-block-members
        emit LimitChanged(_wallet, _newLimit, uint64(now.add(_securityPeriod)));
    }

     /**
     * @dev Disable the daily limit.
     * The change is pending for the security period.
     * @param _wallet The target wallet.
     * @param _securityPeriod The security period.
     */
    function disableLimit(address _wallet, uint256 _securityPeriod) internal {
        changeLimit(_wallet, LIMIT_DISABLED, _securityPeriod);
    }

    /**
    * @dev Checks if a transfer is within the limit. If yes the daily spent is updated.
    * @param _wallet The target wallet.
    * @param _amount The amount for the transfer
    * @return true if the transfer is withing the daily limit.
    */
    function checkAndUpdateDailySpent(address _wallet, uint _amount) internal returns (bool) {
        (uint256 current, uint256 pending, uint256 changeAfter, uint256 alreadySpent, uint256 periodEnd) = getLimitAndDailySpent(_wallet);
        uint256 currentLimit = currentLimit(current, pending, changeAfter);
        if (_amount == 0 || currentLimit == LIMIT_DISABLED) {
            return true;
        } else if (periodEnd <= now && _amount <= currentLimit) {
            // solium-disable-next-line security/no-block-members
            lStorage.setDailySpent(_wallet, _amount, now + 24 hours);
            return true;
        } else if (periodEnd > now && alreadySpent.add(_amount) <= currentLimit) {
            lStorage.setDailySpent(_wallet, alreadySpent.add(_amount), periodEnd);
            return true;
        }
        return false;
    }

    /**
    * @dev Checks if a transfer is within the limit. If yes the daily spent is not updated.
    * @param _wallet The target wallet.
    * @param _amount The amount for the transfer
    * @return true if the transfer is withing the daily limit.
    */
    function checkDailySpent(address _wallet, uint _amount) internal view returns (bool) {
        (uint256 current, uint256 pending, uint256 changeAfter, uint256 alreadySpent, uint256 periodEnd) = getLimitAndDailySpent(_wallet);
        uint256 currentLimit = currentLimit(current, pending, changeAfter);
        if (currentLimit == LIMIT_DISABLED) {
            return true;
        }
        // solium-disable-next-line security/no-block-members
        if (periodEnd < now) {
            return (_amount <= currentLimit);
        } 
        return (alreadySpent.add(_amount) <= currentLimit);
    }

    /**
    * @dev Gets from storage the limit object of a wellet.
    * @param _wallet The target wallet.
    * @return the limit object.
    */
    function getLimit(address _wallet) internal view returns (uint256, uint256, uint256) {
        return lStorage.getLimit(_wallet);
    }

    /**
    * @dev Gets from storage the limit object and the daily spent object of a wellet.
    * @param _wallet The target wallet.
    * @return the limit and daily spent objects.
    */
    function getLimitAndDailySpent(address _wallet) internal view returns (uint256, uint256, uint256, uint256, uint256) {
        return lStorage.getLimitAndDailySpent(_wallet);
    }

    /**
    * @dev Helper method to get the current limit from a Limit struct.
    * @param _current The value of the current parameter
    * @param _pending The value of the pending parameter
    * @param _changeAfter The value of the changeAfter parameter
    */
    function currentLimit(uint256 _current, uint256 _pending, uint256 _changeAfter) internal view returns (uint256) {
        // solium-disable-next-line security/no-block-members
        if (_changeAfter > 0 && _changeAfter < now) {
            return _pending;
        }
        return _current;
    }

}