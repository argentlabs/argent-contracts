pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "../storage/GuardianStorage.sol";

library GuardianUtils {

    /**
    * @dev Checks if an address is an account guardian or an account authorised to sign on behalf of a smart-contract guardian
    * given a list of guardians.
    * @param _guardians the list of guardians
    * @param _guardian the address to test
    * @return true and the list of guardians minus the found guardian upon success, false and the original list of guardians if not found.
    */
    function isGuardian(address[] memory _guardians, address _guardian) internal view returns (bool, address[] memory) {
        if(_guardians.length == 0 || _guardian == address(0)) {
            return (false, _guardians);
        }
        bool isFound = false;
        address[] memory updatedGuardians = new address[](_guardians.length - 1);
        uint256 index = 0;
        for (uint256 i = 0; i < _guardians.length; i++) {
            if(!isFound) {
                // check if _guardian is an account guardian
                if(_guardian == _guardians[i]) {
                    isFound = true;
                    continue;
                }
                // check if _guardian is the owner of a smart contract guardian
                if(isContract(_guardians[i]) && isGuardianOwner(_guardians[i], _guardian)) {
                    isFound = true;
                    continue;
                }
            }
            if(index < updatedGuardians.length) {
                updatedGuardians[index] = _guardians[i];
                index++;
            }
        }
        return isFound ? (true, updatedGuardians) : (false, _guardians);
    }

   /**
    * @dev Checks if an address is a contract.
    * @param _addr The address.
    */
    function isContract(address _addr) internal view returns (bool) {
        uint32 size;
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            size := extcodesize(_addr)
        }
        return (size > 0);
    }

    /**
    * @dev Checks if an address is the owner of a guardian contract. 
    * The method does not revert if the call to the owner() method consumes more then 5000 gas. 
    * @param _guardian The guardian contract
    * @param _owner The owner to verify.
    */
    function isGuardianOwner(address _guardian, address _owner) internal view returns (bool) {
        address owner = address(0);
        bytes4 sig = bytes4(keccak256("owner()"));
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            let ptr := mload(0x40)
            mstore(ptr,sig)
            let result := staticcall(5000, _guardian, ptr, 0x20, ptr, 0x20)
            if eq(result, 1) {
                owner := mload(ptr)
            }
        }
        return owner == _owner;
    }
        
} 
