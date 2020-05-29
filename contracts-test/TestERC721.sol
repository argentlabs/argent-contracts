// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.8;

import "openzeppelin-solidity/contracts/token/ERC721/ERC721.sol";

contract TestERC721 is ERC721 {
    constructor() ERC721("Argent Kitties", "AGKT") public {
    }

    function mint(address to, uint256 tokenId) public {
        _mint(to, tokenId);
    }
}
