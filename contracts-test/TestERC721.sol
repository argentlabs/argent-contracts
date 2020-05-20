pragma solidity ^0.6.8;

import "openzeppelin-solidity/contracts/token/ERC721/ERC721Full.sol";
import "openzeppelin-solidity/contracts/token/ERC721/ERC721Mintable.sol";

contract TestERC721 is ERC721Full, ERC721Mintable {
    constructor() ERC721Full("Argent Kitties", "AGKT") public {
    }
}
