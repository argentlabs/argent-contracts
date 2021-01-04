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
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;


/**
 * @title ApprovedTransfer
 * @notice Feature to transfer tokens (ETH or ERC20) or call third-party contracts with the approval of guardians.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract ApprovedTransfer {
  address constant internal ETH_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    /**
    * @notice Transfers tokens (ETH or ERC20) from a wallet.
    * @param _token The address of the token to transfer.
    * @param _to The destination address
    * @param _amount The amount of token to transfer
    */
    function transferToken(address _token, address payable _to, uint256 _amount) public
        // onlyWalletFeature(_wallet)
        // onlyWhenUnlocked(_wallet)
    {
        doTransfer(_token, _to, _amount);
        // LimitUtils.resetDailySpent(versionManager, limitStorage, _wallet);
    }

    function doTransfer(address _token, address payable _to, uint256 _value) internal {
        if (_token == ETH_TOKEN) {
          _to.transfer(_value);
        } else {
            //bool success = ERC20(_token).transfer(_to, _value);
            // Check transfer is successful, when `transfer` returns a success bool result
            // TODO provide for cases where a boolean is not returned
           // require(success, "RM: Transfer failed");
        }
        //emit Transfer(_wallet, _token, _value, _to, _data);
    }
}