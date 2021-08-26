// Copyright (C) 2021  Argent Labs Ltd. <https://argent.xyz>

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
pragma solidity ^0.8.3;

import "argent-trustlists/contracts/interfaces/IFilter.sol";
import "argent-trustlists/contracts/DappRegistry.sol";
import "argent-trustlists/contracts/TokenRegistry.sol";
import "argent-trustlists/contracts/filters/yearn/YearnV2Filter.sol";
import "argent-trustlists/contracts/filters/yearn/YearnFilter.sol";
import "argent-trustlists/contracts/filters/uniswap/UniswapV2UniZapFilter.sol";
import "argent-trustlists/contracts/filters/lido/LidoFilter.sol";
import "argent-trustlists/contracts/filters/erc20/OnlyApproveFilter.sol";
import "argent-trustlists/contracts/filters/curve/CurveFilter.sol";
import "argent-trustlists/contracts/filters/BaseFilter.sol";
import "argent-trustlists/contracts/filters/aave/AaveV1Filter.sol";
import "argent-trustlists/contracts/filters/aave/AaveV1ATokenFilter.sol";
import "argent-trustlists/contracts/filters/aave/AaveV2Filter.sol";
import "argent-trustlists/contracts/filters/balancer/BalancerFilter.sol";
import "argent-trustlists/contracts/filters/argent/ArgentEnsManagerFilter.sol";
import "argent-trustlists/contracts/filters/maker/PotFilter.sol";
import "argent-trustlists/contracts/filters/maker/VatFilter.sol";
import "argent-trustlists/contracts/filters/maker/DaiJoinFilter.sol";
import "argent-trustlists/contracts/filters/compound/CompoundCTokenFilter.sol";
import "argent-trustlists/contracts/filters/weth/WethFilter.sol";
import "argent-trustlists/contracts/filters/gro/GroWithdrawFilter.sol";
import "argent-trustlists/contracts/filters/gro/GroDepositFilter.sol";
import "argent-trustlists/contracts/filters/paraswap/ParaswapUniV2RouterFilter.sol";
import "argent-trustlists/contracts/filters/paraswap/ParaswapFilter.sol";
import "argent-trustlists/contracts/filters/paraswap/ParaswapUtils.sol";
import "argent-trustlists/contracts/filters/paraswap/UniswapV3RouterFilter.sol";
import "argent-trustlists/contracts/filters/paraswap/WhitelistedZeroExV4Filter.sol";
import "argent-trustlists/contracts/filters/paraswap/WhitelistedZeroExV2Filter.sol";

contract TestFilter is IFilter {
    function isValid(address /*_wallet*/, address /*_spender*/, address /*_to*/, bytes calldata _data) external override pure returns (bool valid) {
        uint256 state = abi.decode(_data[4:], (uint256));
        return state != 5;
    }
}