pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./AaveV2ATokenMock.sol";

contract AaveV2LendingPoolMock {
    mapping (address => address) public aTokens;

    constructor(address[] memory _assets) {
        for(uint i = 0; i < _assets.length; i++) {
            aTokens[_assets[i]] = address(new AaveV2ATokenMock(_assets[i]));
        }
    }

    function deposit(address _asset, uint256 _amount, address _onBehalfOf, uint16 /* _referralCode */) external {
        address aToken = aTokens[_asset];
        require(aToken != address(0), "unknown asset");
        require(IERC20(_asset).transferFrom(msg.sender, aToken, _amount), "asset transfer failed");
        AaveV2ATokenMock(aToken).mint(_onBehalfOf, _amount);
    }

    function withdraw(address _asset, uint256 _amount, address _to) external returns (uint256) {
        address aToken = aTokens[_asset];
        require(aToken != address(0), "unknown asset");
        AaveV2ATokenMock(aToken).burn(msg.sender, _to, _amount);
    }

    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external {}
    function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) external {}
}