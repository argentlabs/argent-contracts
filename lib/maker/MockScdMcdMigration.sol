pragma solidity ^0.5.4;

import "../../contracts/modules/MakerV2Base.sol";

contract MockJoin {
    function gem() public pure returns (GemLike) {
        return GemLike(address(0));
    }
    function dai() public pure returns (GemLike) {
        return GemLike(address(0));
    }
    VatLike public vat;
}

/**
 * @title MockScdMcdMigration
 * @dev Mock contract needed to deploy the MakerV2Manager contract
 */
contract MockScdMcdMigration {

    MockJoin public saiJoin;
    MockJoin public daiJoin;

    constructor () public {
        saiJoin = new MockJoin();
        daiJoin = new MockJoin();
    }
}