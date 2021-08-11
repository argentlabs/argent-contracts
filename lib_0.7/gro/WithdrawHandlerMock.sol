pragma solidity >=0.6.0 <0.8.0;

contract WithdrawHandlerMock {

    function withdrawalFee(bool pwrd) external view returns (uint256) {}

    function withdrawByLPToken(
        bool pwrd,
        uint256 lpAmount,
        uint256[3] calldata minAmounts
    ) external {}

    function withdrawByStablecoin(
        bool pwrd,
        uint256 index,
        uint256 lpAmount,
        uint256 minAmount
    ) external {}

    function withdrawAllSingle(
        bool pwrd,
        uint256 index,
        uint256 minAmount
    ) external {}

    function withdrawAllBalanced(bool pwrd, uint256[3] calldata minAmounts) external {}
}