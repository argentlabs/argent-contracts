pragma solidity ^0.4.24;

/**
 * @title Upgrader
 * @dev Interface for a contract that can upgrade wallets by enabling/disabling modules. 
 * @author Julien Niset - <julien@argent.im>
 */
interface Upgrader {

    /**
     * @dev Upgrades a wallet by enabling/disabling modules.
     * @param _wallet The owner.
     */
    function upgrade(address _wallet, address[] _toDisable, address[] _toEnable) external;

    function toDisable() external view returns (address[]);

    function toEnable() external view returns (address[]);
}