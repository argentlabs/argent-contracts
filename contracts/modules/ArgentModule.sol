// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;


import "./common/BaseModule.sol";
import "./RelayerManager.sol";
import "./SecurityManager.sol";
import "./TransactionManager.sol";

/**
 * @title RecoveryManager
 * @notice Feature to manage the recovery of a wallet owner.
 * Recovery is executed by a consensus of the wallet's guardians and takes 24 hours before it can be finalized.
 * Once finalised the ownership of the wallet is transfered to a new address.
 * @author Julien Niset - <julien@argent.xyz>
 * @author Olivier Van Den Biggelaar - <olivier@argent.xyz>
 */
contract ArgentModule is BaseModule, RelayerManager, SecurityManager, TransactionManager {

    bytes32 constant NAME = "ArgentModule";

    constructor (
        IModuleRegistry _registry,
        ILockStorage _lockStorage,
        IGuardianStorage _guardianStorage,
        ITransferStorage _userWhitelist,
        IAuthoriser _authoriser,
        uint256 _securityPeriod,
        uint256 _securityWindow,
        uint256 _recoveryPeriod,
        uint256 _lockPeriod
    )
        BaseModule(_registry, _lockStorage, _guardianStorage, _userWhitelist, _authoriser, _securityPeriod, NAME)
        SecurityManager(_recoveryPeriod, _lockPeriod, _securityWindow)
        public
    {
        
    }

    /**
     * @inheritdoc IModule
     */
    function init(address _wallet) external override onlyWallet(_wallet) {
        TransactionManager._init(_wallet);
    }
    
    /**
     * @inheritdoc RelayerManager
     */
    function getRequiredSignatures(address _wallet, bytes calldata _data) public view override returns (uint256, OwnerSignature) {
        bytes4 methodId = Utils.functionPrefix(_data);
        if (methodId == TransactionManager.multiCall.selector || methodId == BaseModule.addModule.selector) {
            return (1, OwnerSignature.Required);
        } 
        if (methodId == TransactionManager.multiCallWithSession.selector) {
            return (1, OwnerSignature.Session);
        } 
        if (methodId == EXECUTE_RECOVERY_PREFIX) {
            uint walletGuardians = guardianStorage.guardianCount(_wallet);
            require(walletGuardians > 0, "SM: no guardians set on wallet");
            uint numberOfSignaturesRequired = Utils.ceil(walletGuardians, 2);
            return (numberOfSignaturesRequired, OwnerSignature.Disallowed);
        }
        if (methodId == CANCEL_RECOVERY_PREFIX) {
            uint numberOfSignaturesRequired = Utils.ceil(recoveryConfigs[_wallet].guardianCount + 1, 2);
            return (numberOfSignaturesRequired, OwnerSignature.Optional);
        }
        if (methodId == TRANSFER_OWNERSHIP_PREFIX) {
            uint majorityGuardians = Utils.ceil(guardianStorage.guardianCount(_wallet), 2);
            uint numberOfSignaturesRequired = SafeMath.add(majorityGuardians, 1);
            return (numberOfSignaturesRequired, OwnerSignature.Required);
        }
        if (methodId == LOCK_PREFIX || methodId == UNLOCK_PREFIX) {
            return (1, OwnerSignature.Disallowed);
        }
        if (methodId == ADD_GUARDIAN_PREFIX ||
            methodId == REVOKE_GUARDIAN_PREFIX ||
            methodId == CANCEL_GUARDIAN_ADDITION_PREFIX ||
            methodId == CANCEL_GUARDIAN_REVOKATION_PREFIX) 
        {
            return (1, OwnerSignature.Required);
        }
        if (methodId == FINALIZE_RECOVERY_PREFIX ||
            methodId == CONFIRM_GUARDIAN_ADDITION_PREFIX ||
            methodId == CONFIRM_GUARDIAN_REVOKATION_PREFIX)
        {
            return (0, OwnerSignature.Anyone);
        }
        revert("SM: unknown method");
    }

}