pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";


interface IBancor {

    function quickConvert(
        address[] calldata _path,
        uint256 _amount,
        uint256 _minReturn
    )
    external
    payable
    returns (uint256);

    function convert2(
        IERC20[] calldata _path,
        uint256 _amount,
        uint256 _minReturn,
        address _affiliateAccount,
        uint256 _affiliateFee
    )
    external
    payable
    returns (uint256);

    function claimAndConvert2(
        IERC20[] calldata _path,
        uint256 _amount,
        uint256 _minReturn,
        address _affiliateAccount,
        uint256 _affiliateFee
    )
    external
    returns (uint256);

    function claimAndConvertFor2(
        IERC20[] calldata _path,
        uint256 _amount,
        uint256 _minReturn,
        address _for,
        address _affiliateAccount,
        uint256 _affiliateFee
    )
    external
    returns (uint256);

}
