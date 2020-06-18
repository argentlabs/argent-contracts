pragma solidity ^0.5.4;


interface IBZX {

    function mint(
        address receiver,
        uint256 depositAmount
    )
    external
    returns (uint256 mintAmount);

    function mintWithEther(address receiver) external payable returns (uint256 mintAmount);

    function burn(
        address receiver,
        uint256 burnAmount
    )
        external
        returns (uint256 loanAmountPaid);

    function burnToEther(
        address payable receiver,
        uint256 burnAmount
    )
        external
        returns (uint256 loanAmountPaid);

    function loanTokenAddress() external view returns(address );
}