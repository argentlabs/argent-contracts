// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.3;
import "./TokenConsumer.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title TestContract
 * @notice Represents an arbitrary contract.
 * @author Olivier Vdb - <olivier@argent.xyz>
 */
contract TestContract {

    uint256 public state;
    TokenConsumer public tokenConsumer;

    event StateSet(uint256 indexed _state, uint256 indexed _value);
    event GasUsed(uint _gas);

    constructor() {
        tokenConsumer = new TokenConsumer();
    }

    function setState(uint256 _state) public payable {
        state = _state;
        emit StateSet(_state, msg.value);
    }

    function setStateAndPayToken(uint256 _state, address _erc20, uint256 _amount) public {
        ERC20(_erc20).transferFrom(msg.sender, address(this), _amount);
        state = _state;
        emit StateSet(_state, _amount);
    }

    function setStateAndPayTokenWithConsumer(uint256 _state, address _erc20, uint256 _amount) public {
        bool success = tokenConsumer.consume(_erc20, msg.sender, address(this), _amount);
        if (success) {
            state = _state;
            emit StateSet(_state, _amount);
        }
    }
    
    function testERC165Gas(address _wallet, bytes4 _interfaceId) external {
        uint startGas = gasleft();
        IERC165(_wallet).supportsInterface{gas: 10000}(_interfaceId);
        uint endGas = gasleft();
        emit GasUsed(startGas - endGas);
    }
}