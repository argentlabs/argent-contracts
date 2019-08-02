pragma solidity ^0.5.4;

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
    function upgrade(address payable _wallet, address[] calldata _toDisable, address[] calldata _toEnable) external;

    function toDisable() external view returns (address[] memory);

    function toEnable() external view returns (address[] memory);
}