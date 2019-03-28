pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/token/ERC721/ERC721Full.sol";
import "openzeppelin-solidity/contracts/token/ERC721/ERC721Mintable.sol";

contract TestERC721 is ERC721Full, ERC721Mintable {
    constructor() ERC721Full("Argent Kitties", "AGKT") public {
    }
}
