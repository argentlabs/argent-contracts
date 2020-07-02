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

/**
 * @title ITokenPriceStorage
 * @dev TokenPriceStorage interface
 */
interface ITokenPriceStorage {

    function getTokenPrice(address _token) external view returns (uint256 _price);

    function getPriceForTokenList(address[] calldata _tokens) external view returns (uint256[] memory _prices);

    function setPriceForTokenList(address[] calldata _tokens, uint256[] calldata _prices) external;

    function setPrice(address _token, uint256 _price) external;
}