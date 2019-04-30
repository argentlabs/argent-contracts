pragma solidity ^0.5.4;

import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "../storage/GuardianStorage.sol";

/**
 * @title NftTransfer
 * @dev Module to transfer NFTs (ERC721),
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract NftTransfer is BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant NAME = "NftTransfer";

    // Equals to `bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))`
    bytes4 private constant ERC721_RECEIVED = 0x150b7a02;

    // The Guardian storage 
    GuardianStorage public guardianStorage;

    // *************** Events *************************** //

    event NonFungibleTransfer(address indexed wallet, address indexed nftContract, uint256 indexed tokenId, address to, bytes data);    

    // *************** Modifiers *************************** //

    /**
     * @dev Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(BaseWallet _wallet) {
        // solium-disable-next-line security/no-block-members
        require(!guardianStorage.isLocked(_wallet), "NT: wallet must be unlocked");
        _;
    }

    // *************** Constructor ********************** //

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage
    ) 
        BaseModule(_registry, NAME)
        public 
    {
        guardianStorage = _guardianStorage;
    }

    // *************** External/Public Functions ********************* //

    /**
     * @dev Inits the module for a wallet by setting up the onERC721Received
     * static call redirection from the wallet to the module.
     * @param _wallet The target wallet.
     */
    function init(BaseWallet _wallet) external onlyWallet(_wallet) {
        _wallet.enableStaticCall(address(this), ERC721_RECEIVED);
    }

    /**
     * @notice Handle the receipt of an NFT
     * @dev An ERC721 smart contract calls this function on the recipient contract
     * after a `safeTransfer`. If the recipient is a BaseWallet, the call to onERC721Received 
     * will be forwarded to the method onERC721Received of the present module. 
     * @param operator The address which called `safeTransferFrom` function
     * @param from The address which previously owned the token
     * @param tokenId The NFT identifier which is being transferred
     * @param data Additional data with no specified format
     * @return bytes4 `bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))`
     */
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external 
        returns (bytes4)
    {
        return ERC721_RECEIVED;
    }

    /**
    * @dev lets the owner transfer NFTs from a wallet.
    * @param _wallet The target wallet.
    * @param _nftContract The ERC721 address.
    * @param _to The recipient.
    * @param _tokenId The NFT id
    * @param _safe Whether to execute a safe transfer or not
    * @param _data The data to pass with the transfer.
    */
    function transferNFT(
        BaseWallet _wallet, 
        address _nftContract, 
        address _to, 
        uint256 _tokenId,
        bool _safe,
        bytes calldata _data
    ) 
        external 
        onlyWalletOwner(_wallet) 
        onlyWhenUnlocked(_wallet)
    {
        bytes memory methodData;
        if(_safe) {
            methodData = abi.encodeWithSignature(
                "safeTransferFrom(address,address,uint256,bytes)", address(_wallet), _to, _tokenId, _data);
        } else {
            methodData = abi.encodeWithSignature(
                "transferFrom(address,address,uint256)", address(_wallet), _to, _tokenId);
        }

        _wallet.invoke(_nftContract, 0, methodData);
        emit NonFungibleTransfer(address(_wallet), _nftContract, _tokenId, _to, _data);
    }

}