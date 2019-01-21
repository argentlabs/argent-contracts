pragma solidity ^0.4.24;
import "../interfaces/Upgrader.sol";
import "../interfaces/Module.sol";

/**
 * @title SimpleUpgrader
 * @dev Simple implementation for the Upgrader interface that just adds/removes modules.
 * @author Julien Niset - <julien@argent.im>
 */
contract SimpleUpgrader is Upgrader {

    address[] private disable;
    address[] private enable;

    constructor(address[] _disable, address[] _enable) public {
        disable = _disable;
        enable = _enable;
    }

    function upgrade(address _wallet, address[] _toDisable, address[] _toEnable) external {
        uint256 i = 0;
        //remove old modules
        for(i = 0; i < _toDisable.length; i++) {
            BaseWallet(_wallet).authoriseModule(Module(_toDisable[i]), false);
        }
        //add new modules
        for(i = 0; i < _toEnable.length; i++) {
            BaseWallet(_wallet).authoriseModule(Module(_toEnable[i]), true);
        }
    }

    function toDisable() external view returns (address[]) {
        return disable;
    }

    function toEnable() external view returns (address[]) {
        return enable;
    }
}