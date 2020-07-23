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
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../infrastructure/storage/ILimitStorage.sol";
import "../../infrastructure/storage/ITokenPriceStorage.sol";

/**
 * @title LimitManager
 * @dev Helper library to manage the daily limit and interact with a contract implementing the ILimitStorage interface.
 * @author Julien Niset - <julien@argent.xyz>
 */
library LimitUtils {

    // large limit when the limit can be considered disabled
    uint128 constant internal LIMIT_DISABLED = uint128(-1);

    using SafeMath for uint256;

    // *************** Internal Functions ********************* //

    /**
     * @dev Changes the daily limit (expressed in ETH).
     * Decreasing the limit is immediate while increasing the limit is pending for the security period.
     * @param _lStorage The storage contract.
     * @param _wallet The target wallet.
     * @param _targetLimit The target limit.
     * @param _securityPeriod The security period.
     */
    function changeLimit(
        ILimitStorage _lStorage,
        address _wallet,
        uint256 _targetLimit,
        uint256 _securityPeriod
    )
        internal
        returns (ILimitStorage.Limit memory)
    {
        ILimitStorage.Limit memory limit = _lStorage.getLimit(_wallet);
        uint256 currentLimit = currentLimit(limit);
        ILimitStorage.Limit memory newLimit;
        if (_targetLimit <= currentLimit) {
            uint128 targetLimit = safe128(_targetLimit);
            newLimit = ILimitStorage.Limit(targetLimit, targetLimit, safe64(now));
        } else {
            newLimit = ILimitStorage.Limit(safe128(currentLimit), safe128(_targetLimit), safe64(now.add(_securityPeriod)));
        }
        _lStorage.setLimit(_wallet, newLimit);
        return newLimit;
    }

     /**
     * @dev Disable the daily limit.
     * The change is pending for the security period.
     * @param _lStorage The storage contract.
     * @param _wallet The target wallet.
     * @param _securityPeriod The security period.
     */
    function disableLimit(
        ILimitStorage _lStorage,
        address _wallet,
        uint256 _securityPeriod
    )
        internal
    {
        changeLimit(_lStorage, _wallet, LIMIT_DISABLED, _securityPeriod);
    }

    /**
    * @dev Returns whether the daily limit is disabled for a wallet.
    * @param _wallet The target wallet.
    * @return _limitDisabled true if the daily limit is disabled, false otherwise.
    */
    function isLimitDisabled(ILimitStorage _lStorage, address _wallet) internal view returns (bool) {
        ILimitStorage.Limit memory limit = _lStorage.getLimit(_wallet);
        uint256 currentLimit = currentLimit(limit);
        return (currentLimit == LIMIT_DISABLED);
    }

    /**
    * @dev Checks if a transfer is within the limit. If yes the daily spent is updated.
    * @param _lStorage The storage contract.
    * @param _wallet The target wallet.
    * @param _amount The amount for the transfer
    * @return true if the transfer is withing the daily limit.
    */
    function checkAndUpdateDailySpent(
        ILimitStorage _lStorage,
        address _wallet,
        uint256 _amount
    )
        internal
        returns (bool)
    {
        (ILimitStorage.Limit memory limit, ILimitStorage.DailySpent memory dailySpent) = _lStorage.getLimitAndDailySpent(_wallet);
        uint256 currentLimit = currentLimit(limit);
        if (_amount == 0 || currentLimit == LIMIT_DISABLED) {
            return true;
        }
        ILimitStorage.DailySpent memory newDailySpent;
        if (dailySpent.periodEnd <= now && _amount <= currentLimit) {
            newDailySpent = ILimitStorage.DailySpent(safe128(_amount), safe64(now + 24 hours));
            _lStorage.setDailySpent(_wallet, newDailySpent);
            return true;
        } else if (dailySpent.periodEnd > now && _amount.add(dailySpent.alreadySpent) <= currentLimit) {
            newDailySpent = ILimitStorage.DailySpent(safe128(_amount.add(dailySpent.alreadySpent)), safe64(dailySpent.periodEnd));
            _lStorage.setDailySpent(_wallet, newDailySpent);
            return true;
        }
        return false;
    }

    /**
    * @dev Helper method to Reset the daily consumption.
    * @param _wallet The target wallet.
    */
    function resetDailySpent(ILimitStorage _lStorage, address _wallet) internal {
        _lStorage.setDailySpent(_wallet, ILimitStorage.DailySpent(uint128(0), uint64(0)));
    }

    /**
    * @notice Helper method to get the ether value equivalent of a token amount.
    * @dev For low value amounts of tokens we accept this to return zero as these are small enough to disregard.
    * Note that the price stored for tokens = price for 1 token (in ETH wei) * 10^(18-token decimals).
    * @param _amount The token amount.
    * @param _token The address of the token.
    * @return The ether value for _amount of _token.
    */
    function getEtherValue(ITokenPriceStorage _priceStorage, uint256 _amount, address _token) internal view returns (uint256) {
        uint256 price = _priceStorage.getTokenPrice(_token);
        uint256 etherValue = price.mul(_amount).div(10**18);
        return etherValue;
    }

    /**
    * @dev Helper method to get the current limit from a Limit struct.
    * @param _limit The limit struct
    */
    function currentLimit(ILimitStorage.Limit memory _limit) internal view returns (uint256) {
        if (_limit.changeAfter > 0 && _limit.changeAfter < now) {
            return _limit.pending;
        }
        return _limit.current;
    }

    function safe128(uint256 _num) internal pure returns (uint128) {
        require(_num < 2**128, "LU: more then 128 bits");
        return uint128(_num);
    }

    function safe64(uint256 _num) internal pure returns (uint64) {
        require(_num < 2**64, "LU: more then 64 bits");
        return uint64(_num);
    }

}