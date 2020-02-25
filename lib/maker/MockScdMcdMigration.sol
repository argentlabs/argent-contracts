pragma solidity ^0.5.4;

contract JoinLike {
    function gem() public returns (GemLike) {
        return GemLike(address(0));
    }
    function dai() public returns (GemLike) {
        return GemLike(address(0));
    }
    VatLike public vat;
}

contract VatLike {

}

contract GemLike {

}

/**
 * @title MockScdMcdMigration
 * @dev Mock contract needed to deploy the MakerV2Manager contract
 */
contract MockScdMcdMigration {

    JoinLike public saiJoin;
    JoinLike public daiJoin;

    constructor () public {
        saiJoin = new JoinLike();
        daiJoin = new JoinLike();
    }
}