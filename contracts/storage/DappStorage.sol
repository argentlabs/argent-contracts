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

pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./Storage.sol";

/**
 * @title DappStorage
 * @dev Contract storing the state of wallets related to authorised dapps.
 * The contract only defines basic setters and getters with no logic. Only modules authorised
 * for a wallet can modify its state.
 * @author Olivier Van Den Biggelaar - <olivier@argent.im>
 */
contract DappStorage is Storage {

    // [wallet][dappkey][contract][signature][bool]
    mapping (address => mapping (address => mapping (address => mapping (bytes4 => bool)))) internal whitelistedMethods;

    // *************** External Functions ********************* //

    /**
     * @dev (De)authorizes an external contract's methods to be called by a dapp key of the wallet.
     * @param _wallet The wallet.
     * @param _dapp The address of the signing key.
     * @param _contract The contract address.
     * @param _signatures The methods' signatures.
     * @param _authorized true to whitelist, false to blacklist.
     */
    function setMethodAuthorization(
        BaseWallet _wallet,
        address _dapp,
        address _contract,
        bytes4[] calldata _signatures,
        bool _authorized
    )
        external
        onlyModule(_wallet)
    {
        for (uint i = 0; i < _signatures.length; i++) {
            whitelistedMethods[address(_wallet)][_dapp][_contract][_signatures[i]] = _authorized;
        }
    }

    /**
     * @dev Gets the authorization status for an external contract's method.
     * @param _wallet The wallet.
     * @param _dapp The address of the signing key.
     * @param _contract The contract address.
     * @param _signature The call signature.
     * @return true if the method is whitelisted, false otherwise
     */
    function getMethodAuthorization(BaseWallet _wallet, address _dapp, address _contract, bytes4 _signature) external view returns (bool) {
        return whitelistedMethods[address(_wallet)][_dapp][_contract][_signature];
    }
}