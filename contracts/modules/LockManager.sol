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
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "../utils/GuardianUtils.sol";

/**
 * @title LockManager
 * @dev Module to manage the state of a wallet's lock.
 * Other modules can use the state of the lock to determine if their operations
 * should be authorised or blocked. Only the guardians of a wallet can lock and unlock it.
 * The lock automatically unlocks after a given period. The lock state is stored on a saparate
 * contract to facilitate its use by other modules.
 * @author Julien Niset - <julien@argent.im>
 * @author Olivier Van Den Biggelaar - <olivier@argent.im>
 */
contract LockManager is BaseModule, RelayerModule {

    bytes32 constant NAME = "LockManager";

    // The lock period
    uint256 public lockPeriod;

    // *************** Events *************************** //

    event Locked(address indexed wallet, uint64 releaseAfter);
    event Unlocked(address indexed wallet);

    // *************** Modifiers ************************ //

    /**
     * @dev Throws if the wallet is not locked.
     */
    modifier onlyWhenLocked(BaseWallet _wallet) {
        // solium-disable-next-line security/no-block-members
        require(guardianStorage.isLocked(_wallet), "GD: wallet must be locked");
        _;
    }

    /**
     * @dev Throws if the caller is not a guardian for the wallet.
     */
    modifier onlyGuardian(BaseWallet _wallet) {
        (bool isGuardian, ) = GuardianUtils.isGuardian(guardianStorage.getGuardians(_wallet), msg.sender);
        require(msg.sender == address(this) || isGuardian, "GD: wallet must be unlocked");
        _;
    }

    // *************** Constructor ************************ //

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        uint256 _lockPeriod
    )
        BaseModule(_registry, _guardianStorage, NAME) public {
        lockPeriod = _lockPeriod;
    }

    // *************** External functions ************************ //

    /**
     * @dev Lets a guardian lock a wallet.
     * @param _wallet The target wallet.
     */
    function lock(BaseWallet _wallet) external onlyGuardian(_wallet) onlyWhenUnlocked(_wallet) {
        guardianStorage.setLock(_wallet, now + lockPeriod);
        emit Locked(address(_wallet), uint64(now + lockPeriod));
    }

    /**
     * @dev Lets a guardian unlock a locked wallet.
     * @param _wallet The target wallet.
     */
    function unlock(BaseWallet _wallet) external onlyGuardian(_wallet) onlyWhenLocked(_wallet) {
        address locker = guardianStorage.getLocker(_wallet);
        require(locker == address(this), "LM: cannot unlock a wallet that was locked by another module");
        guardianStorage.setLock(_wallet, 0);
        emit Unlocked(address(_wallet));
    }

    /**
     * @dev Returns the release time of a wallet lock or 0 if the wallet is unlocked.
     * @param _wallet The target wallet.
     * @return The epoch time at which the lock will release (in seconds).
     */
    function getLock(BaseWallet _wallet) public view returns(uint64 _releaseAfter) {
        uint256 lockEnd = guardianStorage.getLock(_wallet);
        if (lockEnd > now) {
            _releaseAfter = uint64(lockEnd);
        }
    }

    /**
     * @dev Checks if a wallet is locked.
     * @param _wallet The target wallet.
     * @return true if the wallet is locked.
     */
    function isLocked(BaseWallet _wallet) external view returns (bool _isLocked) {
        return guardianStorage.isLocked(_wallet);
    }

    // *************** Implementation of RelayerModule methods ********************* //

    // Overrides to use the incremental nonce and save some gas
    function checkAndUpdateUniqueness(BaseWallet _wallet, uint256 _nonce, bytes32 /* _signHash */) internal returns (bool) {
        return checkAndUpdateNonce(_wallet, _nonce);
    }

    function validateSignatures(
        BaseWallet _wallet,
        bytes memory /* _data */,
        bytes32 _signHash,
        bytes memory _signatures
    )
        internal
        view
        returns (bool)
    {
        return validateSignatures(_wallet, _signHash, _signatures, OwnerSignature.Disallowed);
    }

    function getRequiredSignatures(BaseWallet /* _wallet */, bytes memory /* _data */) internal view returns (uint256) {
        return 1;
    }
}