pragma solidity ^0.8.3;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";


contract AaveV2ATokenMock is ERC20("aToken", "AERC20") {
    address asset;
    address lendingPool;

    constructor(address _asset) {
        asset = _asset;
        lendingPool = msg.sender;
    }

    modifier onlyLendingPool() {
        require(msg.sender == lendingPool, "not lending pool");
        _;
    }

    function mint(address _user, uint _amount) external onlyLendingPool {
        _mint(_user, _amount);
    }

    function burn(address _user, address _to, uint _amount) external onlyLendingPool {
        _burn(_user, _amount);
        require(IERC20(asset).transfer(_to, _amount), "asset transfer failed");
    }
}