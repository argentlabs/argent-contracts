pragma solidity ^0.5.4;
import "../../wallet/BaseWallet.sol";
import "../../upgrade/ModuleRegistry.sol";
import "../../interfaces/Module.sol";
import "../../exchange/ERC20.sol";

/**
 * @title BaseModule
 * @dev Basic module that contains some methods common to all modules.
 * @author Julien Niset - <julien@argent.im>
 */
contract BaseModule is Module {

    // The adddress of the module registry.
    ModuleRegistry internal registry;

    event ModuleCreated(bytes32 name);
    event ModuleInitialised(address wallet);

    constructor(ModuleRegistry _registry, bytes32 _name) public {
        registry = _registry;
        emit ModuleCreated(_name);
    }

    /**
     * @dev Throws if the sender is not the target wallet of the call.
     */
    modifier onlyWallet(BaseWallet _wallet) {
        require(msg.sender == address(_wallet), "BM: caller must be wallet");
        _;
    }

    /**
     * @dev Throws if the sender is not the owner of the target wallet or the module itself.
     */
    modifier onlyOwner(BaseWallet _wallet) {
        require(msg.sender == address(this) || isOwner(_wallet, msg.sender), "BM: must be an owner for the wallet");
        _;
    }

    /**
     * @dev Throws if the sender is not the owner of the target wallet.
     */
    modifier strictOnlyOwner(BaseWallet _wallet) {
        require(isOwner(_wallet, msg.sender), "BM: msg.sender must be an owner for the wallet");
        _;
    }

    /**
     * @dev Inits the module for a wallet by logging an event.
     * The method can only be called by the wallet itself.
     * @param _wallet The wallet.
     */
    function init(BaseWallet _wallet) external onlyWallet(_wallet) {
        emit ModuleInitialised(address(_wallet));
    }

    /**
     * @dev Adds a module to a wallet. First checks that the module is registered.
     * @param _wallet The target wallet.
     * @param _module The modules to authorise.
     */
    function addModule(BaseWallet _wallet, Module _module) external strictOnlyOwner(_wallet) {
        require(registry.isRegisteredModule(address(_module)), "BM: module is not registered");
        _wallet.authoriseModule(address(_module), true);
    }

    /**
    * @dev Utility method enbaling anyone to recover ERC20 token sent to the
    * module by mistake and transfer them to the Module Registry. 
    * @param _token The token to recover.
    */
    function recoverToken(address _token) external {
        uint total = ERC20(_token).balanceOf(address(this));
        ERC20(_token).transfer(address(registry), total);
    }

    /**
     * @dev Helper method to check if an address is the owner of a target wallet.
     * @param _wallet The target wallet.
     * @param _addr The address.
     */
    function isOwner(BaseWallet _wallet, address _addr) internal view returns (bool) {
        return _wallet.owner() == _addr;
    }
}