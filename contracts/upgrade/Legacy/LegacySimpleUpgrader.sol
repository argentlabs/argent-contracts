pragma solidity ^0.5.4;

import "./LegacyUpgrader.sol";
import "../../wallet/BaseWallet.sol";

/**
 * @title LegacySimpleUpgrader
 * @dev Old implementation for the Upgrader interface that added/removed modules.
 * @author Julien Niset - <julien@argent.im>
 */
contract LegacySimpleUpgrader is LegacyUpgrader {

    address[] private disable;
    address[] private enable;

    constructor(address[] memory _disable, address[] memory _enable) public {
        disable = _disable;
        enable = _enable;
    }

    function upgrade(address payable _wallet, address[] calldata _toDisable, address[] calldata _toEnable) external {
        uint256 i = 0;
        //remove old modules
        for(i = 0; i < _toDisable.length; i++) {
            BaseWallet(_wallet).authoriseModule(_toDisable[i], false);
        }
        //add new modules
        for(i = 0; i < _toEnable.length; i++) {
            BaseWallet(_wallet).authoriseModule(_toEnable[i], true);
        }
    }

    function toDisable() external view returns (address[] memory) {
        return disable;
    }

    function toEnable() external view returns (address[] memory) {
        return enable;
    }
}