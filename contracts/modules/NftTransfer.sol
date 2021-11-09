pragma solidity ^0.5.4;

import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "../storage/GuardianStorage.sol";
import "../interfaces/INftFactory.sol";
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

    // Address of the nftFactory to claim Nft's
    INftFactory public nftFactory;
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
        GuardianStorage _guardianStorage.
        address _nftFactory
    )
        BaseModule(_registry, NAME)
        public
    {
        guardianStorage = _guardianStorage;
        nftFactory = _nftFactory;
    }

    // *************** External/Public Functions ********************* //

    /**
     * @dev Inits the module for a wallet by setting up the onERC721Received
     * static call redirection from the wallet to the module.
     * @param _wallet The target wallet.
     */
    function init(BaseWallet _wallet) public onlyWallet(_wallet) {
        _wallet.enableStaticCall(address(this), ERC721_RECEIVED);
    }

    /**
     * @notice Handle the receipt of an NFT
     * @dev An ERC721 smart contract calls this function on the recipient contract
     * after a `safeTransfer`. If the recipient is a BaseWallet, the call to onERC721Received
     * will be forwarded to the method onERC721Received of the present module.
     * @return bytes4 `bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))`
     */
    function onERC721Received(
        address /* operator */,
        address /* from */,
        uint256 /* tokenId */,
        bytes calldata /* data*/
    )
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
            require(isERC721(_nftContract, _tokenId), "NT: Non-compliant NFT contract");
            methodData = abi.encodeWithSignature(
                "transferFrom(address,address,uint256)", address(_wallet), _to, _tokenId);
        }
        
        _wallet.invoke(_nftContract, 0, methodData);
        emit NonFungibleTransfer(address(_wallet), _nftContract, _tokenId, _to, 0x);
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
function claimNFT(
        BaseWallet _wallet,
        address _nftFactory,
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        uint256 tokenId = nftFactory.claimNft(_wallet);
        emit NonFungibleTransfer(address(_wallet), nftFactory.nftContract(), _tokenId, address(_wallet), _data);
    }

    // *************** Internal Functions ********************* //

    /**
    * @dev Check whether a given contract complies with ERC721.
    * @param _nftContract The contract to check.
    * @param _tokenId The tokenId to use for the check.
    * @return true if the contract is an ERC721, false otherwise.
    */
    function isERC721(address _nftContract, uint256 _tokenId) internal returns (bool) {
        // solium-disable-next-line security/no-low-level-calls
        (bool success, bytes memory result) = _nftContract.call(abi.encodeWithSignature('supportsInterface(bytes4)', 0x80ac58cd));
        if(success && result[0] != 0x0) return true;

        // solium-disable-next-line security/no-low-level-calls
        (success, result) = _nftContract.call(abi.encodeWithSignature('supportsInterface(bytes4)', 0x6466353c));
        if(success && result[0] != 0x0) return true;

        // solium-disable-next-line security/no-low-level-calls
        (success,) = _nftContract.call(abi.encodeWithSignature('ownerOf(uint256)', _tokenId));
        return success;
    }

}