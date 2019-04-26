pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";
import "./common/OnlyOwnerModule.sol";
import "../storage/GuardianStorage.sol";

/**
 * @title TokenExchanger
 * @dev Module to trade tokens (ETH or ERC20) using KyberNetworks.
 * @author Julien Niset - <julien@argent.im>
 */
contract IepManager is Owned, BaseModule, RelayerModule, OnlyOwnerModule {

    bytes32 constant NAME = "TokenExchanger";

    // The Guardian storage 
    GuardianStorage public guardianStorage;
    // Supported providers
    mapping (bytes32 => Provider) public providers; 

    struct Provider {
        address addr;
        address oracle;
    }

    modifier onlyContractOwner {
        require(msg.sender == owner, "Must be owner");
        _;
    }

    /**
     * @dev Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(BaseWallet _wallet) {
        // solium-disable-next-line security/no-block-members
        require(!guardianStorage.isLocked(_wallet), "TT: wallet must be unlocked");
        _;
    }

    constructor(
        ModuleRegistry _registry, 
        GuardianStorage _guardianStorage
    ) 
        BaseModule(_registry, NAME) 
        public 
    {
        guardianStorage = _guardianStorage;

    }

    /**
     * @dev Invest tokens for a given period.
     * @param _wallet The target wallet.
     * @param _tokens The array of token address.
     * @param _amounts The amount to invest for each token.
     * @param _period The period over which the tokens may be locked in the investment (optional).
     */
    function addInvestment(
        BaseWallet _wallet, 
        bytes32 _providerKey, 
        address[] calldata _tokens, 
        uint256[] calldata _amounts, 
        uint256 _period
    ) 
        external
        onlyWhenUnlocked(_wallet) 
    {
        bytes memory methodData = abi.encodeWithSignature(
            "openIep(address,address[],uint256[],uint256,address)", 
            address(_wallet), 
            _tokens,
            _amounts,
            _period,
            providers[_providerKey].oracle
            );
        (bool success, bytes memory data) = delegateToProvider(_providerKey, methodData);
        require(success, "IepManager: request to provider failed");
    }

    /**
     * @dev Removes a fraction of the tokens from an investment.
     * @param _wallet The target wallet.s
     * @param _tokens The array of token address.
     * @param _fractions The fraction of invested tokens to exit in per 10000. 
     */
    function removeInvestment(
        BaseWallet _wallet, 
        bytes32 _providerKey,
        address[] calldata _tokens, 
        uint256 _fraction
    ) 
        external 
        onlyWhenUnlocked(_wallet) 
    {
        bytes memory methodData = abi.encodeWithSignature(
            "closeIep(address,address[],uint256,address)", 
            address(_wallet), 
            _tokens,
            _fraction,
            providers[_providerKey].oracle
            );
        (bool success, bytes memory data) = delegateToProvider(_providerKey, methodData);
        require(success, "IepManager: request to provider failed");
    }

    function addProvider(bytes32 _key, address _addr, address _oracle) public onlyContractOwner {
        providers[_key] = Provider(_addr, _oracle);
    } 

    function getProvider(bytes32 _key) public view returns (address _addr, address _oracle) {
        _addr = providers[_key].addr;
        _oracle = providers[_key].oracle;
    }

    function delegateToProvider(bytes32 _providerKey, bytes memory _methodData) internal returns (bool, bytes memory) {
        address provider = providers[_providerKey].addr;
        require(provider != address(0), "IepManager: Unknown provider");
        return provider.delegatecall(_methodData);
    }
}