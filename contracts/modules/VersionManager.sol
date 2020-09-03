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

import "./common/Utils.sol";
import "../infrastructure/base/Owned.sol";
import "../infrastructure/storage/ITransferStorage.sol";
import "../infrastructure/storage/IGuardianStorage.sol";
import "./common/IModule.sol";
import "./common/BaseFeature.sol";

/**
 * @title VersionManager
 * @notice Intermediate contract between features and wallets. VersionManager checks that a calling feature is
 * authorised for the wallet and if so, forwards the call to it.
 * @author Olivier VDB <olivier@argent.xyz>
 */
contract VersionManager is IVersionManager, IModule, BaseFeature, Owned {

    bytes32 constant NAME = "VersionManager";

    bytes4 constant internal ADD_MODULE_PREFIX = bytes4(keccak256("addModule(address,address)"));
    bytes4 constant internal UPGRADE_WALLET_PREFIX = bytes4(keccak256("upgradeWallet(address,address[])"));

    uint256 public lastVersion;
    mapping(address => uint256) public walletVersions; // [wallet] => [version]
    mapping(address => mapping(uint256 => bool)) public isFeatureInVersion; // [feature][version] => bool
    mapping(uint256 => address[]) public featuresToInit; // [version] => [features]

    mapping(uint256 => bytes4[]) public staticCallSignatures; // [version] => [sigs]
    mapping(uint256 => mapping(bytes4 => address)) public staticCallExecutors; // [version][sig] => [feature]

    event VersionAdded(uint256 _version);
    event WalletUpgraded(address _wallet, uint256 _version);

    // The Transfer Storage
    ITransferStorage private transferStorage;
    // The Guardian Storage
    IGuardianStorage private guardianStorage;
    // The Module Registry
    IModuleRegistry private registry;

    /* ***************** Modifiers ************************* */

    modifier onlyFeature(address _wallet) {
        require(isFeatureAuthorised(_wallet, msg.sender), "VM: sender should be authorized feature");
        _;
    }

    /* ***************** Constructor ************************* */

    constructor(
        IModuleRegistry _registry,
        ILockStorage _lockStorage,
        IGuardianStorage _guardianStorage,
        ITransferStorage _transferStorage   
    )
        BaseFeature(_lockStorage, IVersionManager(address(this)), NAME)
        public
    {
        registry = _registry;
        guardianStorage = _guardianStorage;
        transferStorage = _transferStorage;
    }

    /* ***************** onlyOwner ************************* */

    /**
     * @inheritdoc IFeature
     */
    function recoverToken(address _token) external override onlyOwner {
        uint total = ERC20(_token).balanceOf(address(this));
        _token.call(abi.encodeWithSelector(ERC20(_token).transfer.selector, msg.sender, total));
    }

    /**
     * @notice Lets the owner add a new version, i.e. a new bundle of features
     * @param _features the list of features included in the new version
     * @param _featuresToInit the subset of features that need to be initialized for a wallet
     */
    function addVersion(address[] calldata _features, address[] calldata _featuresToInit) external onlyOwner {
        uint256 newVersion = ++lastVersion;
        for(uint256 i = 0; i < _features.length; i++) {
            isFeatureInVersion[_features[i]][newVersion] = true;

            // Store static call information to optimise its use by wallets
            bytes4[] memory sigs = IFeature(_features[i]).getStaticCallSignatures();
            for(uint256 j = 0; j < sigs.length; j++) {
                staticCallSignatures[newVersion].push(sigs[j]);
                staticCallExecutors[newVersion][sigs[j]] = _features[i];
            }
        }
        featuresToInit[newVersion] = _featuresToInit;
        
        emit VersionAdded(newVersion);
    }

    /* ***************** View Methods ************************* */

    /**
     * @inheritdoc IVersionManager
     */
    function isFeatureAuthorised(address _wallet, address _feature) public view override returns (bool) {
        return isFeatureInVersion[_feature][walletVersions[_wallet]] || _feature == address(this);
    }

    /**
     * @inheritdoc IFeature
     */
    function getRequiredSignatures(address /* _wallet */, bytes calldata _data) external view override returns (uint256, OwnerSignature) {
        bytes4 methodId = Utils.functionPrefix(_data);
        // This require ensures that the RelayerManager cannot be used to call a featureOnly VersionManager method
        // that calls a Storage or the BaseWallet for backward-compatibility reason
        require(methodId == UPGRADE_WALLET_PREFIX || methodId == ADD_MODULE_PREFIX, "VM: unknown method");     
        return (1, OwnerSignature.Required);
    }

    /**
     * @notice This method delegates the static call to a target feature
     */
    fallback() external {
        uint256 version = walletVersions[msg.sender];
        address feature = staticCallExecutors[version][msg.sig];
        require(feature != address(0), "VM: Static call not supported for wallet version");

        // solhint-disable-next-line no-inline-assembly
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := staticcall(gas(), feature, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {revert(0, returndatasize())}
            default {return (0, returndatasize())}
        }
    }

    /* ***************** Wallet Upgrade ************************* */

    /**
     * @inheritdoc IFeature
     */
    function init(address _wallet) public override(IModule, BaseFeature) onlyWallet(_wallet) {
        doUpgradeWallet(_wallet, featuresToInit[lastVersion]);
    }

    /**
     * @notice Upgrade a wallet to the latest version.
     * @dev It's cheaper to pass features to init as calldata than reading them from storage
     * @param _wallet the wallet to upgrrade
     * @param _featuresToInit the subset of features that need to be initialized for the walleet
     */
    function upgradeWallet(address _wallet, address[] calldata _featuresToInit) external onlyWalletOwnerOrFeature(_wallet) onlyWhenUnlocked(_wallet) {
        doUpgradeWallet(_wallet, _featuresToInit);
    }

    /**
     * @inheritdoc IModule
     */
    function addModule(address _wallet, address _module) external override onlyWalletOwnerOrFeature(_wallet) onlyWhenUnlocked(_wallet) {
        require(registry.isRegisteredModule(_module), "VM: module is not registered");
        IWallet(_wallet).authoriseModule(_module, true);
    }

    /* ******* Backward Compatibility with old Storages and BaseWallet *************** */

    /**
     * @inheritdoc IVersionManager
     */
    function invokeWallet(
        address _wallet, 
        address _to, 
        uint256 _value, 
        bytes memory _data
    ) 
        external 
        onlyFeature(_wallet)
        override
        returns (bytes memory _res) 
    {
        bool success;
        (success, _res) = _wallet.call(abi.encodeWithSignature("invoke(address,uint256,bytes)", _to, _value, _data));
        if (success && _res.length > 0) { //_res is empty if _wallet is an "old" BaseWallet that can't return output values
            (_res) = abi.decode(_res, (bytes));
        } else if (_res.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        } else if (!success) {
            revert("VM: wallet invoke reverted");
        }
    }

    /**
     * @inheritdoc IVersionManager
     */
    function setOwner(address _wallet, address _newOwner) external override onlyFeature(_wallet) {
        IWallet(_wallet).setOwner(_newOwner);
    }

    /**
     * @inheritdoc IVersionManager
     */
    function setWhitelist(address _wallet, address _target, uint256 _whitelistAfter) external override onlyFeature(_wallet) {
        transferStorage.setWhitelist(_wallet, _target, _whitelistAfter);
    }

    /**
     * @inheritdoc IVersionManager
     */
    function addGuardian(address _wallet, address _guardian) external override onlyFeature(_wallet) {
        guardianStorage.addGuardian(_wallet, _guardian);
    }

    /**
     * @inheritdoc IVersionManager
     */
    function revokeGuardian(address _wallet, address _guardian) external override onlyFeature(_wallet) {
        guardianStorage.revokeGuardian(_wallet, _guardian);
    }


    /* ***************** Internal methods ************************* */

    /**
     * @notice Upgrade a wallet to the latest version
     * @param _wallet the target wallet
     * @param _featuresToInit the subset of features that need to be initialized for the wallet
     */
    function doUpgradeWallet(
        address _wallet, 
        address[] memory _featuresToInit
    ) 
        internal 
    {
        uint256 fromVersion = walletVersions[_wallet];
        uint256 toVersion = lastVersion;
        require(fromVersion < toVersion, "VM: Already on last version");
        walletVersions[_wallet] = toVersion;

        // Setup static call redirection
        bytes4[] storage sigs = staticCallSignatures[toVersion];
        for(uint256 i = 0; i < sigs.length; i++) {
            bytes4 sig = sigs[i];
            if(IWallet(_wallet).enabled(sig) != address(this)) {
                IWallet(_wallet).enableStaticCall(address(this), sig);
            }
        }
        
        // Init features
        for(uint256 i = 0; i < _featuresToInit.length; i++) {
            // We only initialize a feature that was not already initialized in the previous version
            if(!isFeatureInVersion[_featuresToInit[i]][fromVersion] && isFeatureInVersion[_featuresToInit[i]][toVersion]) {
                IFeature(_featuresToInit[i]).init(_wallet);
            }
        }
        
        emit WalletUpgraded(_wallet, toVersion);
    }

}