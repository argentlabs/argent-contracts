// Copyright (C) 2020  Argent Labs Ltd. <https://argent.xyz>

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

/**
 * @title Utils
 * @dev Common utility methods used by some of the modules.
 */
library Utils {

    /**
    * @dev Helper method to recover the signer at a given position from a list of concatenated signatures.
    * @param _signedHash The signed hash
    * @param _signatures The concatenated signatures.
    * @param _index The index of the signature to recover.
    */
    function recoverSigner(bytes32 _signedHash, bytes memory _signatures, uint _index) internal pure returns (address) {
        uint8 v;
        bytes32 r;
        bytes32 s;
        // we jump 32 (0x20) as the first slot of bytes contains the length
        // we jump 65 (0x41) per signature
        // for v we load 32 bytes ending with v (the first 31 come from s) then apply a mask
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            r := mload(add(_signatures, add(0x20,mul(0x41,_index))))
            s := mload(add(_signatures, add(0x40,mul(0x41,_index))))
            v := and(mload(add(_signatures, add(0x41,mul(0x41,_index)))), 0xff)
        }
        require(v == 27 || v == 28); // solium-disable-line error-reason
        return ecrecover(_signedHash, v, r, s);
    }

    /**
    * @dev Helper method to parse data and extract the method signature.
    */
    function functionPrefix(bytes memory _data) internal pure returns (bytes4 prefix) {
        require(_data.length >= 4, "RM: Invalid functionPrefix");
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            prefix := mload(add(_data, 0x20))
        }
    }

    /**
    * @dev Helper method to return ceil(a / b).
    */
    function ceil(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a / b;
        if (a % b == 0) {
            return c;
        } else {
            return c + 1;
        }
    }
}
