// Copyright (C) 2018  Argent Labs Ltd. <https://argent.xyz>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.5.4;
import "../wallet/BaseWallet.sol";
import "../utils/GuardianUtils.sol";
import "./common/BaseModule.sol";
import "./common/RelayerModule.sol";

/**
 * @title GuardianManager
 * @dev Module to manage the guardians of wallets.
 * Guardians are accounts (EOA or contracts) that are authorized to perform specific
 * security operations on wallets such as toggle a safety lock, start a recovery procedure,
 * or confirm transactions. Addition or revokation of guardians is initiated by the owner
 * of a wallet and must be confirmed after a security period (e.g. 24 hours).
 * The list of guardians for a wallet is stored on a saparate
 * contract to facilitate its use by other modules.
 * @author Julien Niset - <julien@argent.im>
 * @author Olivier Van Den Biggelaar - <olivier@argent.im>
 */
contract GuardianManager is BaseModule, RelayerModule {

    bytes32 constant NAME = "GuardianManager";

    bytes4 constant internal CONFIRM_ADDITION_PREFIX = bytes4(keccak256("confirmGuardianAddition(address,address)"));
    bytes4 constant internal CONFIRM_REVOKATION_PREFIX = bytes4(keccak256("confirmGuardianRevokation(address,address)"));

    struct GuardianManagerConfig {
        // the time at which a guardian addition or revokation will be confirmable by the owner
        mapping (bytes32 => uint256) pending;
    }

    // the wallet specific storage
    mapping (address => GuardianManagerConfig) internal configs;
    // the security period
    uint256 public securityPeriod;
    // the security window
    uint256 public securityWindow;

    // *************** Events *************************** //

    event GuardianAdditionRequested(address indexed wallet, address indexed guardian, uint256 executeAfter);
    event GuardianRevokationRequested(address indexed wallet, address indexed guardian, uint256 executeAfter);
    event GuardianAdditionCancelled(address indexed wallet, address indexed guardian);
    event GuardianRevokationCancelled(address indexed wallet, address indexed guardian);
    event GuardianAdded(address indexed wallet, address indexed guardian);
    event GuardianRevoked(address indexed wallet, address indexed guardian);

    // *************** Constructor ********************** //

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        uint256 _securityPeriod,
        uint256 _securityWindow
    )
        BaseModule(_registry, _guardianStorage, NAME)
        public
    {
        securityPeriod = _securityPeriod;
        securityWindow = _securityWindow;
    }

    // *************** External Functions ********************* //

    /**
     * @dev Lets the owner add a guardian to its wallet.
     * The first guardian is added immediately. All following additions must be confirmed
     * by calling the confirmGuardianAddition() method.
     * @param _wallet The target wallet.
     * @param _guardian The guardian to add.
     */
    function addGuardian(BaseWallet _wallet, address _guardian) external onlyWalletOwner(_wallet) onlyWhenUnlocked(_wallet) {
        require(!isOwner(_wallet, _guardian), "GM: target guardian cannot be owner");
        require(!isGuardian(_wallet, _guardian), "GM: target is already a guardian");
        // Guardians must either be an EOA or a contract with an owner()
        // method that returns an address with a 5000 gas stipend.
        // Note that this test is not meant to be strict and can be bypassed by custom malicious contracts.
        // solium-disable-next-line security/no-low-level-calls
        (bool success,) = _guardian.call.gas(5000)(abi.encodeWithSignature("owner()"));
        require(success, "GM: guardian must be EOA or implement owner()");
        if (guardianStorage.guardianCount(_wallet) == 0) {
            guardianStorage.addGuardian(_wallet, _guardian);
            emit GuardianAdded(address(_wallet), _guardian);
        } else {
            bytes32 id = keccak256(abi.encodePacked(address(_wallet), _guardian, "addition"));
            GuardianManagerConfig storage config = configs[address(_wallet)];
            require(
                config.pending[id] == 0 || now > config.pending[id] + securityWindow,
                "GM: addition of target as guardian is already pending");
            config.pending[id] = now + securityPeriod;
            emit GuardianAdditionRequested(address(_wallet), _guardian, now + securityPeriod);
        }
    }

    /**
     * @dev Confirms the pending addition of a guardian to a wallet.
     * The method must be called during the confirmation window and
     * can be called by anyone to enable orchestration.
     * @param _wallet The target wallet.
     * @param _guardian The guardian.
     */
    function confirmGuardianAddition(BaseWallet _wallet, address _guardian) public onlyWhenUnlocked(_wallet) {
        bytes32 id = keccak256(abi.encodePacked(address(_wallet), _guardian, "addition"));
        GuardianManagerConfig storage config = configs[address(_wallet)];
        require(config.pending[id] > 0, "GM: no pending addition as guardian for target");
        require(config.pending[id] < now, "GM: Too early to confirm guardian addition");
        require(now < config.pending[id] + securityWindow, "GM: Too late to confirm guardian addition");
        guardianStorage.addGuardian(_wallet, _guardian);
        delete config.pending[id];
        emit GuardianAdded(address(_wallet), _guardian);
    }

    /**
     * @dev Lets the owner cancel a pending guardian addition.
     * @param _wallet The target wallet.
     * @param _guardian The guardian.
     */
    function cancelGuardianAddition(BaseWallet _wallet, address _guardian) public onlyWalletOwner(_wallet) onlyWhenUnlocked(_wallet) {
        bytes32 id = keccak256(abi.encodePacked(address(_wallet), _guardian, "addition"));
        GuardianManagerConfig storage config = configs[address(_wallet)];
        require(config.pending[id] > 0, "GM: no pending addition as guardian for target");
        delete config.pending[id];
        emit GuardianAdditionCancelled(address(_wallet), _guardian);
    }

    /**
     * @dev Lets the owner revoke a guardian from its wallet.
     * Revokation must be confirmed by calling the confirmGuardianRevokation() method.
     * @param _wallet The target wallet.
     * @param _guardian The guardian to revoke.
     */
    function revokeGuardian(BaseWallet _wallet, address _guardian) external onlyWalletOwner(_wallet) {
        require(isGuardian(_wallet, _guardian), "GM: must be an existing guardian");
        bytes32 id = keccak256(abi.encodePacked(address(_wallet), _guardian, "revokation"));
        GuardianManagerConfig storage config = configs[address(_wallet)];
        require(
            config.pending[id] == 0 || now > config.pending[id] + securityWindow,
            "GM: revokation of target as guardian is already pending"); // TODO need to allow if confirmation window passed
        config.pending[id] = now + securityPeriod;
        emit GuardianRevokationRequested(address(_wallet), _guardian, now + securityPeriod);
    }

    /**
     * @dev Confirms the pending revokation of a guardian to a wallet.
     * The method must be called during the confirmation window and
     * can be called by anyone to enable orchestration.
     * @param _wallet The target wallet.
     * @param _guardian The guardian.
     */
    function confirmGuardianRevokation(BaseWallet _wallet, address _guardian) public {
        bytes32 id = keccak256(abi.encodePacked(address(_wallet), _guardian, "revokation"));
        GuardianManagerConfig storage config = configs[address(_wallet)];
        require(config.pending[id] > 0, "GM: no pending guardian revokation for target");
        require(config.pending[id] < now, "GM: Too early to confirm guardian revokation");
        require(now < config.pending[id] + securityWindow, "GM: Too late to confirm guardian revokation");
        guardianStorage.revokeGuardian(_wallet, _guardian);
        delete config.pending[id];
        emit GuardianRevoked(address(_wallet), _guardian);
    }

    /**
     * @dev Lets the owner cancel a pending guardian revokation.
     * @param _wallet The target wallet.
     * @param _guardian The guardian.
     */
    function cancelGuardianRevokation(BaseWallet _wallet, address _guardian) public onlyWalletOwner(_wallet) onlyWhenUnlocked(_wallet) {
        bytes32 id = keccak256(abi.encodePacked(address(_wallet), _guardian, "revokation"));
        GuardianManagerConfig storage config = configs[address(_wallet)];
        require(config.pending[id] > 0, "GM: no pending guardian revokation for target");
        delete config.pending[id];
        emit GuardianRevokationCancelled(address(_wallet), _guardian);
    }

    /**
     * @dev Checks if an address is a guardian for a wallet.
     * @param _wallet The target wallet.
     * @param _guardian The address to check.
     * @return true if the address if a guardian for the wallet.
     */
    function isGuardian(BaseWallet _wallet, address _guardian) public view returns (bool _isGuardian) {
        (_isGuardian, ) = GuardianUtils.isGuardian(guardianStorage.getGuardians(_wallet), _guardian);
    }

    /**
     * @dev Counts the number of active guardians for a wallet.
     * @param _wallet The target wallet.
     * @return the number of active guardians for a wallet.
     */
    function guardianCount(BaseWallet _wallet) external view returns (uint256 _count) {
        return guardianStorage.guardianCount(_wallet);
    }

    // *************** Implementation of RelayerModule methods ********************* //

    // Overrides to use the incremental nonce and save some gas
    function checkAndUpdateUniqueness(BaseWallet _wallet, uint256 _nonce, bytes32 /* _signHash */) internal returns (bool) {
        return checkAndUpdateNonce(_wallet, _nonce);
    }

    function validateSignatures(
        BaseWallet _wallet,
        bytes memory /* _data */,
        bytes32 _signHash,
        bytes memory _signatures
    )
        internal
        view
        returns (bool)
    {
        return validateSignatures(_wallet, _signHash, _signatures, OwnerSignature.Required);
    }

    function getRequiredSignatures(BaseWallet /* _wallet */, bytes memory _data) internal view returns (uint256) {
        bytes4 methodId = functionPrefix(_data);
        if (methodId == CONFIRM_ADDITION_PREFIX || methodId == CONFIRM_REVOKATION_PREFIX) {
            return 0;
        }
        return 1;
    }
}