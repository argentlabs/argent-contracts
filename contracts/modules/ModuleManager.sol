pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "../interfaces/Upgrader.sol";
import "../upgrade/ModuleRegistry.sol";

/**
 * @title ModuleManager
 * @dev Module to manage the addition, removal and upgrade of the modules of wallets.
 * @author Julien Niset - <julien@argent.im>
 */
contract ModuleManager is BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant NAME = "ModuleManager";

    constructor(ModuleRegistry _registry) BaseModule(_registry, NAME) public {

    }

    /**
     * @dev Upgrades the modules of a wallet. 
     * The implementation of the upgrade is delegated to a contract implementing the Upgrade interface.
     * This makes it possible for the manager to implement any possible present and future upgrades
     * without the need to authorise modules just for the upgrade process. 
     * @param _wallet The target wallet.
     * @param _upgrader The address of an implementation of the Upgrader interface.
     */
    function upgrade(BaseWallet _wallet, Upgrader _upgrader) external onlyOwner(_wallet) {
        require(registry.isRegisteredUpgrader(address(_upgrader)), "MM: upgrader is not registered");
        address[] memory toDisable = _upgrader.toDisable();
        address[] memory toEnable = _upgrader.toEnable();
        bytes memory methodData = abi.encodeWithSignature("upgrade(address,address[],address[])", _wallet, toDisable, toEnable);
        // solium-disable-next-line security/no-low-level-calls
        (bool success,) = address(_upgrader).delegatecall(methodData);
        require(success, "MM: upgrade failed");
    }
}