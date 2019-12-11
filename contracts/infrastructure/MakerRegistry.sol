pragma solidity ^0.5.4;
import "../base/Owned.sol";

contract GemLike {
    function balanceOf(address) public view returns (uint);
    function transferFrom(address, address, uint) public returns (bool);
    function approve(address, uint) public returns (bool success);
}

contract VatLike {
    struct Ilk {
        uint256 Art;   // Total Normalised Debt     [wad]
        uint256 rate;  // Accumulated Rates         [ray]
        uint256 spot;  // Price with Safety Margin  [ray]
        uint256 line;  // Debt Ceiling              [rad]
        uint256 dust;  // Urn Debt Floor            [rad]
    }
    struct Urn {
        uint256 ink;   // Locked Collateral  [wad]
        uint256 art;   // Normalised Debt    [wad]
    }
    mapping (bytes32 => Ilk) public ilks;
    mapping (bytes32 => mapping (address => Urn )) public urns;
    function can(address, address) public view returns (uint);
    function dai(address) public view returns (uint);
    function hope(address) public;
}

contract JoinLike {
    function ilk() public view returns (bytes32);
    function gem() public view returns (GemLike);
    function dai() public view returns (GemLike);
    function join(address, uint) public;
    function exit(address, uint) public;
    VatLike public vat;
    uint    public live;
}

/**
 * @title MakerRegistry
 * @dev Simple registry containing a mapping between token collaterals and their corresponding Maker Join adapters.
 * @author Olivier VDB - <olivier@argent.xyz>
 */
contract MakerRegistry is Owned {

    address[] public tokens;

    mapping (address => Collateral) public collaterals;

    mapping (bytes32 => address) public collateralTokensByIlks;

    struct Collateral {
        bool exists;
        uint128 index;
        JoinLike join;
        bytes32 ilk;
    }

    event CollateralAdded(address indexed _token);
    event CollateralRemoved(address indexed _token);

    /**
     * @dev Adds a new token as possible CDP collateral.
     * @param _joinAdapter The Join Adapter for the token.
     */
    function addCollateral(JoinLike _joinAdapter) external onlyOwner {
        address token = address(_joinAdapter.gem());
        require(!collaterals[token].exists, "MR: collateral already added");
        collaterals[token].exists = true;
        collaterals[token].index = uint128(tokens.push(token) - 1);
        collaterals[token].join = _joinAdapter;
        bytes32 ilk = _joinAdapter.ilk();
        collaterals[token].ilk = ilk;
        collateralTokensByIlks[ilk] = token;
        emit CollateralAdded(token);
    }

    /**
     * @dev Removes a token as possible CDP collateral.
     * @param _token The token to remove as collateral.
     */
    function removeCollateral(address _token) external onlyOwner {
        require(collaterals[_token].exists, "MR: collateral does not exist");
        delete collateralTokensByIlks[collaterals[_token].ilk];

        address last = tokens[tokens.length - 1];
        if(_token != last) {
            uint128 targetIndex = collaterals[_token].index;
            tokens[targetIndex] = last;
            collaterals[last].index = targetIndex;
        }
        tokens.length --;
        delete collaterals[_token];
        emit CollateralRemoved(_token);
    }

    /**
    * @dev Gets the list of supported collaterals.
    */
    function getCollateralTokens() external view returns (address[] memory _tokens) {
        _tokens = new address[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            _tokens[i] = tokens[i];
        }
        return _tokens;
    }

    /**
     * @dev Gets the ilk for a given token collateral.
     * @param _token The token collateral.
     */
    function getIlk(address _token) external view returns (bytes32 _ilk) {
        _ilk = collaterals[_token].ilk;
    }

    /**
    * @dev Gets the join adapter and collateral token for a given ilk.
    */
    function getCollateral(bytes32 _ilk) external view returns (JoinLike _join, GemLike _token) {
        _token = GemLike(collateralTokensByIlks[_ilk]);
        _join = collaterals[address(_token)].join;
    }
}