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

import "./BaseModule.sol";

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/**
 * @title BaseTransfer
 * @notice Contains common methods to transfer tokens or call third-party contracts.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
abstract contract BaseTransfer is BaseModule {
 
    event Transfer(address indexed wallet, address indexed token, uint256 indexed amount, address to, bytes data);
    event Approved(address indexed wallet, address indexed token, uint256 amount, address spender);
    event CalledContract(address indexed wallet, address indexed to, uint256 amount, bytes data);
    event ApprovedAndCalledContract(
        address indexed wallet,
        address indexed to,
        address spender,
        address indexed token,
        uint256 amountApproved,
        uint256 amountSpent,
        bytes data
    );
    event LimitChanged(address indexed wallet, uint indexed newLimit, uint64 indexed startAfter);

    // *************** Internal Functions ********************* //
    /**
    * @notice Make sure a contract call is not trying to call a module, a feature, or the wallet itself.
    * @param _contract The address of the contract.
     */
    modifier onlyAuthorisedContractCall(address _contract) {
        require(_contract != address(this), "BT: Forbidden contract");
        _;
    }

    /**
    * @notice Helper method to transfer ETH or ERC20
    * @param _token The ERC20 address.
    * @param _to The recipient.
    * @param _value The amount of ETH to transfer
    */
    function doTransfer(address _token, address payable _to, uint256 _value, bytes memory _data) internal {
        if (_token == ETH_TOKEN) {
            // TODO think of the implications of using .transfer instead of the low level .call wiht {value} 
            _to.transfer(_value);
        } else {
            ERC20(_token).transfer(_to, _value);
            // TODO Check transfer is successful, when `transfer` returns a success bool result
            // if (transferSuccessBytes.length > 0) {
            //     require(abi.decode(transferSuccessBytes, (bool)), "RM: Transfer failed");
            // }
        }
        emit Transfer(address(this), _token, _value, _to, _data);
    }

    /**
    * @notice Helper method to approve spending the ERC20 of a wallet.
    * @param _token The ERC20 address.
    * @param _spender The spender address.
    * @param _value The amount of token to transfer.
    */
    function doApproveToken(address _token, address _spender, uint256 _value) internal {
        ERC20(_token).approve(_spender, _value);
        emit Approved(address(this), _token, _value, _spender);
    }

    /**
    * @notice Helper method to call an external contract.
    * @param _contract The contract address.
    * @param _value The ETH value to transfer.
    * @param _data The method data.
    */
    function doCallContract(address _contract, uint256 _value, bytes memory _data) internal {
        // solium-disable-next-line security/no-call-value
        (bool success,) = _contract.call{value: _value}(_data);
        // TODO: check success return
        emit CalledContract(address(this), _contract, _value, _data);
    }

    /**
    * @notice Helper method to approve a certain amount of token and call an external contract.
    * The address that spends the _token and the address that is called with _data can be different.
    * @param _token The ERC20 address.
    * @param _proxy The address to approve.
    * @param _amount The amount of tokens to transfer.
    * @param _contract The contract address.
    * @param _data The method data.
    */
    function doApproveTokenAndCallContract(
        address _token,
        address _proxy,
        uint256 _amount,
        address _contract,
        bytes memory _data
    )
        internal
    {
        address _wallet = address(this);
        // Ensure there is sufficient balance of token before we approve
        uint256 balance = ERC20(_token).balanceOf(_wallet);
        require(balance >= _amount, "BT: insufficient balance");

        uint256 existingAllowance = ERC20(_token).allowance(_wallet, _proxy);
        uint256 totalAllowance = SafeMath.add(existingAllowance, _amount);
        // Approve the desired amount plus existing amount. This logic allows for potential gas saving later
        // when restoring the original approved amount, in cases where the _proxy uses the exact approved _amount.
        bytes memory methodData = abi.encodeWithSignature("approve(address,uint256)", _proxy, totalAllowance);

        ERC20(_token).approve(_proxy, totalAllowance);
        (bool success,) = _contract.call(_data);
        // TODO: check success return

        // Calculate the approved amount that was spent after the call
        uint256 unusedAllowance = ERC20(_token).allowance(_wallet, _proxy);
        uint256 usedAllowance = SafeMath.sub(totalAllowance, unusedAllowance);
        // Ensure the amount spent does not exceed the amount approved for this call
        require(usedAllowance <= _amount, "BT: insufficient amount for call");

        if (unusedAllowance != existingAllowance) {
            // Restore the original allowance amount if the amount spent was different (can be lower).
            ERC20(_token).approve(_proxy, existingAllowance);
        }

        emit ApprovedAndCalledContract(
            _wallet,
            _contract,
            _proxy,
            _token,
            _amount,
            usedAllowance,
            _data);
    }

    /**
    * @notice Helper method to wrap ETH into WETH, approve a certain amount of WETH and call an external contract.
    * The address that spends the WETH and the address that is called with _data can be different.
    * @param _proxy The address to approves.
    * @param _amount The amount of tokens to transfer.
    * @param _contract The contract address.
    * @param _data The method data.
    */
    function doApproveWethAndCallContract(
        address _proxy,
        uint256 _amount,
        address _contract,
        bytes memory _data
    )
        internal
    {
        address _wallet = address(this);
        address _wethToken = Configuration(registry).wethToken();
        uint256 wethBalance = ERC20(_wethToken).balanceOf(_wallet);
        if (wethBalance < _amount) {
            // Wrap ETH into WETH
            IWETH(_wethToken).deposit{value: _amount - wethBalance}();
        }

        doApproveTokenAndCallContract(_wethToken, _proxy, _amount, _contract, _data);
    }
}
