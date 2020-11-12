// File: openzeppelin-solidity/contracts/token/ERC20/IERC20.sol

pragma solidity ^0.5.2;
pragma experimental "ABIEncoderV2";

/**
 * @title ERC20 interface
 * @dev see https://eips.ethereum.org/EIPS/eip-20
 */
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);

    function approve(address spender, uint256 value) external returns (bool);

    function transferFrom(address from, address to, uint256 value) external returns (bool);

    function totalSupply() external view returns (uint256);

    function balanceOf(address who) external view returns (uint256);

    function allowance(address owner, address spender) external view returns (uint256);

    event Transfer(address indexed from, address indexed to, uint256 value);

    event Approval(address indexed owner, address indexed spender, uint256 value);
}

// File: openzeppelin-solidity/contracts/math/SafeMath.sol

pragma solidity ^0.5.2;

/**
 * @title SafeMath
 * @dev Unsigned math operations with safety checks that revert on error
 */
library SafeMath {
    /**
     * @dev Multiplies two unsigned integers, reverts on overflow.
     */
    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        // Gas optimization: this is cheaper than requiring 'a' not being zero, but the
        // benefit is lost if 'b' is also tested.
        // See: https://github.com/OpenZeppelin/openzeppelin-solidity/pull/522
        if (a == 0) {
            return 0;
        }

        uint256 c = a * b;
        require(c / a == b);

        return c;
    }

    /**
     * @dev Integer division of two unsigned integers truncating the quotient, reverts on division by zero.
     */
    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        // Solidity only automatically asserts when dividing by 0
        require(b > 0);
        uint256 c = a / b;
        // assert(a == b * c + a % b); // There is no case in which this doesn't hold

        return c;
    }

    /**
     * @dev Subtracts two unsigned integers, reverts on overflow (i.e. if subtrahend is greater than minuend).
     */
    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b <= a);
        uint256 c = a - b;

        return c;
    }

    /**
     * @dev Adds two unsigned integers, reverts on overflow.
     */
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a);

        return c;
    }

    /**
     * @dev Divides two unsigned integers and returns the remainder (unsigned integer modulo),
     * reverts when dividing by zero.
     */
    function mod(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b != 0);
        return a % b;
    }
}

// File: openzeppelin-solidity/contracts/token/ERC20/ERC20.sol

pragma solidity ^0.5.2;



/**
 * @title Standard ERC20 token
 *
 * @dev Implementation of the basic standard token.
 * https://eips.ethereum.org/EIPS/eip-20
 * Originally based on code by FirstBlood:
 * https://github.com/Firstbloodio/token/blob/master/smart_contract/FirstBloodToken.sol
 *
 * This implementation emits additional Approval events, allowing applications to reconstruct the allowance status for
 * all accounts just by listening to said events. Note that this isn't required by the specification, and other
 * compliant implementations may not do it.
 */
contract ERC20 is IERC20 {
    using SafeMath for uint256;

    mapping (address => uint256) private _balances;

    mapping (address => mapping (address => uint256)) private _allowed;

    uint256 private _totalSupply;

    /**
     * @dev Total number of tokens in existence
     */
    function totalSupply() public view returns (uint256) {
        return _totalSupply;
    }

    /**
     * @dev Gets the balance of the specified address.
     * @param owner The address to query the balance of.
     * @return A uint256 representing the amount owned by the passed address.
     */
    function balanceOf(address owner) public view returns (uint256) {
        return _balances[owner];
    }

    /**
     * @dev Function to check the amount of tokens that an owner allowed to a spender.
     * @param owner address The address which owns the funds.
     * @param spender address The address which will spend the funds.
     * @return A uint256 specifying the amount of tokens still available for the spender.
     */
    function allowance(address owner, address spender) public view returns (uint256) {
        return _allowed[owner][spender];
    }

    /**
     * @dev Transfer token to a specified address
     * @param to The address to transfer to.
     * @param value The amount to be transferred.
     */
    function transfer(address to, uint256 value) public returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    /**
     * @dev Approve the passed address to spend the specified amount of tokens on behalf of msg.sender.
     * Beware that changing an allowance with this method brings the risk that someone may use both the old
     * and the new allowance by unfortunate transaction ordering. One possible solution to mitigate this
     * race condition is to first reduce the spender's allowance to 0 and set the desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     * @param spender The address which will spend the funds.
     * @param value The amount of tokens to be spent.
     */
    function approve(address spender, uint256 value) public returns (bool) {
        _approve(msg.sender, spender, value);
        return true;
    }

    /**
     * @dev Transfer tokens from one address to another.
     * Note that while this function emits an Approval event, this is not required as per the specification,
     * and other compliant implementations may not emit the event.
     * @param from address The address which you want to send tokens from
     * @param to address The address which you want to transfer to
     * @param value uint256 the amount of tokens to be transferred
     */
    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        _transfer(from, to, value);
        _approve(from, msg.sender, _allowed[from][msg.sender].sub(value));
        return true;
    }

    /**
     * @dev Increase the amount of tokens that an owner allowed to a spender.
     * approve should be called when _allowed[msg.sender][spender] == 0. To increment
     * allowed value is better to use this function to avoid 2 calls (and wait until
     * the first transaction is mined)
     * From MonolithDAO Token.sol
     * Emits an Approval event.
     * @param spender The address which will spend the funds.
     * @param addedValue The amount of tokens to increase the allowance by.
     */
    function increaseAllowance(address spender, uint256 addedValue) public returns (bool) {
        _approve(msg.sender, spender, _allowed[msg.sender][spender].add(addedValue));
        return true;
    }

    /**
     * @dev Decrease the amount of tokens that an owner allowed to a spender.
     * approve should be called when _allowed[msg.sender][spender] == 0. To decrement
     * allowed value is better to use this function to avoid 2 calls (and wait until
     * the first transaction is mined)
     * From MonolithDAO Token.sol
     * Emits an Approval event.
     * @param spender The address which will spend the funds.
     * @param subtractedValue The amount of tokens to decrease the allowance by.
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) public returns (bool) {
        _approve(msg.sender, spender, _allowed[msg.sender][spender].sub(subtractedValue));
        return true;
    }

    /**
     * @dev Transfer token for a specified addresses
     * @param from The address to transfer from.
     * @param to The address to transfer to.
     * @param value The amount to be transferred.
     */
    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0));

        _balances[from] = _balances[from].sub(value);
        _balances[to] = _balances[to].add(value);
        emit Transfer(from, to, value);
    }

    /**
     * @dev Internal function that mints an amount of the token and assigns it to
     * an account. This encapsulates the modification of balances such that the
     * proper events are emitted.
     * @param account The account that will receive the created tokens.
     * @param value The amount that will be created.
     */
    function _mint(address account, uint256 value) internal {
        require(account != address(0));

        _totalSupply = _totalSupply.add(value);
        _balances[account] = _balances[account].add(value);
        emit Transfer(address(0), account, value);
    }

    /**
     * @dev Internal function that burns an amount of the token of a given
     * account.
     * @param account The account whose tokens will be burnt.
     * @param value The amount that will be burnt.
     */
    function _burn(address account, uint256 value) internal {
        require(account != address(0));

        _totalSupply = _totalSupply.sub(value);
        _balances[account] = _balances[account].sub(value);
        emit Transfer(account, address(0), value);
    }

    /**
     * @dev Approve an address to spend another addresses' tokens.
     * @param owner The address that owns the tokens.
     * @param spender The address that will spend the tokens.
     * @param value The number of tokens that can be spent.
     */
    function _approve(address owner, address spender, uint256 value) internal {
        require(spender != address(0));
        require(owner != address(0));

        _allowed[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    /**
     * @dev Internal function that burns an amount of the token of a given
     * account, deducting from the sender's allowance for said account. Uses the
     * internal burn function.
     * Emits an Approval event (reflecting the reduced allowance).
     * @param account The account whose tokens will be burnt.
     * @param value The amount that will be burnt.
     */
    function _burnFrom(address account, uint256 value) internal {
        _burn(account, value);
        _approve(account, msg.sender, _allowed[account][msg.sender].sub(value));
    }
}

// File: openzeppelin-solidity/contracts/token/ERC20/ERC20Detailed.sol

pragma solidity ^0.5.2;


/**
 * @title ERC20Detailed token
 * @dev The decimals are only for visualization purposes.
 * All the operations are done using the smallest and indivisible token unit,
 * just as on Ethereum all the operations are done in wei.
 */
contract ERC20Detailed is IERC20 {
    string private _name;
    string private _symbol;
    uint8 private _decimals;

    constructor (string memory name, string memory symbol, uint8 decimals) public {
        _name = name;
        _symbol = symbol;
        _decimals = decimals;
    }

    /**
     * @return the name of the token.
     */
    function name() public view returns (string memory) {
        return _name;
    }

    /**
     * @return the symbol of the token.
     */
    function symbol() public view returns (string memory) {
        return _symbol;
    }

    /**
     * @return the number of decimals of the token.
     */
    function decimals() public view returns (uint8) {
        return _decimals;
    }
}

// File: contracts/lib/CommonMath.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;



library CommonMath {
    using SafeMath for uint256;

    /**
     * Calculates and returns the maximum value for a uint256
     *
     * @return  The maximum value for uint256
     */
    function maxUInt256()
        internal
        pure
        returns (uint256)
    {
        return 2 ** 256 - 1;
    }

    /**
    * @dev Performs the power on a specified value, reverts on overflow.
    */
    function safePower(
        uint256 a,
        uint256 pow
    )
        internal
        pure
        returns (uint256)
    {
        require(a > 0);

        uint256 result = 1;
        for (uint256 i = 0; i < pow; i++){
            uint256 previousResult = result;

            // Using safemath multiplication prevents overflows
            result = previousResult.mul(a);
        }

        return result;
    }

    /**
     * Checks for rounding errors and returns value of potential partial amounts of a principal
     *
     * @param  _principal       Number fractional amount is derived from
     * @param  _numerator       Numerator of fraction
     * @param  _denominator     Denominator of fraction
     * @return uint256          Fractional amount of principal calculated
     */
    function getPartialAmount(
        uint256 _principal,
        uint256 _numerator,
        uint256 _denominator
    )
        internal
        pure
        returns (uint256)
    {
        // Get remainder of partial amount (if 0 not a partial amount)
        uint256 remainder = mulmod(_principal, _numerator, _denominator);

        // Return if not a partial amount
        if (remainder == 0) {
            return _principal.mul(_numerator).div(_denominator);
        }

        // Calculate error percentage
        uint256 errPercentageTimes1000000 = remainder.mul(1000000).div(_numerator.mul(_principal));

        // Require error percentage is less than 0.1%.
        require(
            errPercentageTimes1000000 < 1000,
            "CommonMath.getPartialAmount: Rounding error exceeds bounds"
        );

        return _principal.mul(_numerator).div(_denominator);
    }

}

// File: contracts/core/interfaces/ICore.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;


/**
 * @title ICore
 * @author Set Protocol
 *
 * The ICore Contract defines all the functions exposed in the Core through its
 * various extensions and is a light weight way to interact with the contract.
 */
interface ICore {
    /**
     * Return transferProxy address.
     *
     * @return address       transferProxy address
     */
    function transferProxy()
        external
        view
        returns (address);

    /**
     * Return vault address.
     *
     * @return address       vault address
     */
    function vault()
        external
        view
        returns (address);

    /**
     * Return address belonging to given exchangeId.
     *
     * @param  _exchangeId       ExchangeId number
     * @return address           Address belonging to given exchangeId
     */
    function exchangeIds(
        uint8 _exchangeId
    )
        external
        view
        returns (address);

    /*
     * Returns if valid set
     *
     * @return  bool      Returns true if Set created through Core and isn't disabled
     */
    function validSets(address)
        external
        view
        returns (bool);

    /*
     * Returns if valid module
     *
     * @return  bool      Returns true if valid module
     */
    function validModules(address)
        external
        view
        returns (bool);

    /**
     * Return boolean indicating if address is a valid Rebalancing Price Library.
     *
     * @param  _priceLibrary    Price library address
     * @return bool             Boolean indicating if valid Price Library
     */
    function validPriceLibraries(
        address _priceLibrary
    )
        external
        view
        returns (bool);

    /**
     * Exchanges components for Set Tokens
     *
     * @param  _set          Address of set to issue
     * @param  _quantity     Quantity of set to issue
     */
    function issue(
        address _set,
        uint256 _quantity
    )
        external;

    /**
     * Issues a specified Set for a specified quantity to the recipient
     * using the caller's components from the wallet and vault.
     *
     * @param  _recipient    Address to issue to
     * @param  _set          Address of the Set to issue
     * @param  _quantity     Number of tokens to issue
     */
    function issueTo(
        address _recipient,
        address _set,
        uint256 _quantity
    )
        external;

    /**
     * Converts user's components into Set Tokens held directly in Vault instead of user's account
     *
     * @param _set          Address of the Set
     * @param _quantity     Number of tokens to redeem
     */
    function issueInVault(
        address _set,
        uint256 _quantity
    )
        external;

    /**
     * Function to convert Set Tokens into underlying components
     *
     * @param _set          The address of the Set token
     * @param _quantity     The number of tokens to redeem. Should be multiple of natural unit.
     */
    function redeem(
        address _set,
        uint256 _quantity
    )
        external;

    /**
     * Redeem Set token and return components to specified recipient. The components
     * are left in the vault
     *
     * @param _recipient    Recipient of Set being issued
     * @param _set          Address of the Set
     * @param _quantity     Number of tokens to redeem
     */
    function redeemTo(
        address _recipient,
        address _set,
        uint256 _quantity
    )
        external;

    /**
     * Function to convert Set Tokens held in vault into underlying components
     *
     * @param _set          The address of the Set token
     * @param _quantity     The number of tokens to redeem. Should be multiple of natural unit.
     */
    function redeemInVault(
        address _set,
        uint256 _quantity
    )
        external;

    /**
     * Composite method to redeem and withdraw with a single transaction
     *
     * Normally, you should expect to be able to withdraw all of the tokens.
     * However, some have central abilities to freeze transfers (e.g. EOS). _toExclude
     * allows you to optionally specify which component tokens to exclude when
     * redeeming. They will remain in the vault under the users' addresses.
     *
     * @param _set          Address of the Set
     * @param _to           Address to withdraw or attribute tokens to
     * @param _quantity     Number of tokens to redeem
     * @param _toExclude    Mask of indexes of tokens to exclude from withdrawing
     */
    function redeemAndWithdrawTo(
        address _set,
        address _to,
        uint256 _quantity,
        uint256 _toExclude
    )
        external;

    /**
     * Deposit multiple tokens to the vault. Quantities should be in the
     * order of the addresses of the tokens being deposited.
     *
     * @param  _tokens           Array of the addresses of the ERC20 tokens
     * @param  _quantities       Array of the number of tokens to deposit
     */
    function batchDeposit(
        address[] calldata _tokens,
        uint256[] calldata _quantities
    )
        external;

    /**
     * Withdraw multiple tokens from the vault. Quantities should be in the
     * order of the addresses of the tokens being withdrawn.
     *
     * @param  _tokens            Array of the addresses of the ERC20 tokens
     * @param  _quantities        Array of the number of tokens to withdraw
     */
    function batchWithdraw(
        address[] calldata _tokens,
        uint256[] calldata _quantities
    )
        external;

    /**
     * Deposit any quantity of tokens into the vault.
     *
     * @param  _token           The address of the ERC20 token
     * @param  _quantity        The number of tokens to deposit
     */
    function deposit(
        address _token,
        uint256 _quantity
    )
        external;

    /**
     * Withdraw a quantity of tokens from the vault.
     *
     * @param  _token           The address of the ERC20 token
     * @param  _quantity        The number of tokens to withdraw
     */
    function withdraw(
        address _token,
        uint256 _quantity
    )
        external;

    /**
     * Transfer tokens associated with the sender's account in vault to another user's
     * account in vault.
     *
     * @param  _token           Address of token being transferred
     * @param  _to              Address of user receiving tokens
     * @param  _quantity        Amount of tokens being transferred
     */
    function internalTransfer(
        address _token,
        address _to,
        uint256 _quantity
    )
        external;

    /**
     * Deploys a new Set Token and adds it to the valid list of SetTokens
     *
     * @param  _factory              The address of the Factory to create from
     * @param  _components           The address of component tokens
     * @param  _units                The units of each component token
     * @param  _naturalUnit          The minimum unit to be issued or redeemed
     * @param  _name                 The bytes32 encoded name of the new Set
     * @param  _symbol               The bytes32 encoded symbol of the new Set
     * @param  _callData             Byte string containing additional call parameters
     * @return setTokenAddress       The address of the new Set
     */
    function createSet(
        address _factory,
        address[] calldata _components,
        uint256[] calldata _units,
        uint256 _naturalUnit,
        bytes32 _name,
        bytes32 _symbol,
        bytes calldata _callData
    )
        external
        returns (address);

    /**
     * Exposes internal function that deposits a quantity of tokens to the vault and attributes
     * the tokens respectively, to system modules.
     *
     * @param  _from            Address to transfer tokens from
     * @param  _to              Address to credit for deposit
     * @param  _token           Address of token being deposited
     * @param  _quantity        Amount of tokens to deposit
     */
    function depositModule(
        address _from,
        address _to,
        address _token,
        uint256 _quantity
    )
        external;

    /**
     * Exposes internal function that withdraws a quantity of tokens from the vault and
     * deattributes the tokens respectively, to system modules.
     *
     * @param  _from            Address to decredit for withdraw
     * @param  _to              Address to transfer tokens to
     * @param  _token           Address of token being withdrawn
     * @param  _quantity        Amount of tokens to withdraw
     */
    function withdrawModule(
        address _from,
        address _to,
        address _token,
        uint256 _quantity
    )
        external;

    /**
     * Exposes internal function that deposits multiple tokens to the vault, to system
     * modules. Quantities should be in the order of the addresses of the tokens being
     * deposited.
     *
     * @param  _from              Address to transfer tokens from
     * @param  _to                Address to credit for deposits
     * @param  _tokens            Array of the addresses of the tokens being deposited
     * @param  _quantities        Array of the amounts of tokens to deposit
     */
    function batchDepositModule(
        address _from,
        address _to,
        address[] calldata _tokens,
        uint256[] calldata _quantities
    )
        external;

    /**
     * Exposes internal function that withdraws multiple tokens from the vault, to system
     * modules. Quantities should be in the order of the addresses of the tokens being withdrawn.
     *
     * @param  _from              Address to decredit for withdrawals
     * @param  _to                Address to transfer tokens to
     * @param  _tokens            Array of the addresses of the tokens being withdrawn
     * @param  _quantities        Array of the amounts of tokens to withdraw
     */
    function batchWithdrawModule(
        address _from,
        address _to,
        address[] calldata _tokens,
        uint256[] calldata _quantities
    )
        external;

    /**
     * Expose internal function that exchanges components for Set tokens,
     * accepting any owner, to system modules
     *
     * @param  _owner        Address to use tokens from
     * @param  _recipient    Address to issue Set to
     * @param  _set          Address of the Set to issue
     * @param  _quantity     Number of tokens to issue
     */
    function issueModule(
        address _owner,
        address _recipient,
        address _set,
        uint256 _quantity
    )
        external;

    /**
     * Expose internal function that exchanges Set tokens for components,
     * accepting any owner, to system modules
     *
     * @param  _burnAddress         Address to burn token from
     * @param  _incrementAddress    Address to increment component tokens to
     * @param  _set                 Address of the Set to redeem
     * @param  _quantity            Number of tokens to redeem
     */
    function redeemModule(
        address _burnAddress,
        address _incrementAddress,
        address _set,
        uint256 _quantity
    )
        external;

    /**
     * Expose vault function that increments user's balance in the vault.
     * Available to system modules
     *
     * @param  _tokens          The addresses of the ERC20 tokens
     * @param  _owner           The address of the token owner
     * @param  _quantities      The numbers of tokens to attribute to owner
     */
    function batchIncrementTokenOwnerModule(
        address[] calldata _tokens,
        address _owner,
        uint256[] calldata _quantities
    )
        external;

    /**
     * Expose vault function that decrement user's balance in the vault
     * Only available to system modules.
     *
     * @param  _tokens          The addresses of the ERC20 tokens
     * @param  _owner           The address of the token owner
     * @param  _quantities      The numbers of tokens to attribute to owner
     */
    function batchDecrementTokenOwnerModule(
        address[] calldata _tokens,
        address _owner,
        uint256[] calldata _quantities
    )
        external;

    /**
     * Expose vault function that transfer vault balances between users
     * Only available to system modules.
     *
     * @param  _tokens           Addresses of tokens being transferred
     * @param  _from             Address tokens being transferred from
     * @param  _to               Address tokens being transferred to
     * @param  _quantities       Amounts of tokens being transferred
     */
    function batchTransferBalanceModule(
        address[] calldata _tokens,
        address _from,
        address _to,
        uint256[] calldata _quantities
    )
        external;

    /**
     * Transfers token from one address to another using the transfer proxy.
     * Only available to system modules.
     *
     * @param  _token          The address of the ERC20 token
     * @param  _quantity       The number of tokens to transfer
     * @param  _from           The address to transfer from
     * @param  _to             The address to transfer to
     */
    function transferModule(
        address _token,
        uint256 _quantity,
        address _from,
        address _to
    )
        external;

    /**
     * Expose transfer proxy function to transfer tokens from one address to another
     * Only available to system modules.
     *
     * @param  _tokens         The addresses of the ERC20 token
     * @param  _quantities     The numbers of tokens to transfer
     * @param  _from           The address to transfer from
     * @param  _to             The address to transfer to
     */
    function batchTransferModule(
        address[] calldata _tokens,
        uint256[] calldata _quantities,
        address _from,
        address _to
    )
        external;
}

// File: contracts/core/interfaces/ISetFactory.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;


/**
 * @title ISetFactory
 * @author Set Protocol
 *
 * The ISetFactory interface provides operability for authorized contracts
 * to interact with SetTokenFactory
 */
interface ISetFactory {

    /* ============ External Functions ============ */

    /**
     * Return core address
     *
     * @return address        core address
     */
    function core()
        external
        returns (address);

    /**
     * Deploys a new Set Token and adds it to the valid list of SetTokens
     *
     * @param  _components           The address of component tokens
     * @param  _units                The units of each component token
     * @param  _naturalUnit          The minimum unit to be issued or redeemed
     * @param  _name                 The bytes32 encoded name of the new Set
     * @param  _symbol               The bytes32 encoded symbol of the new Set
     * @param  _callData             Byte string containing additional call parameters
     * @return setTokenAddress       The address of the new Set
     */
    function createSet(
        address[] calldata _components,
        uint[] calldata _units,
        uint256 _naturalUnit,
        bytes32 _name,
        bytes32 _symbol,
        bytes calldata _callData
    )
        external
        returns (address);
}

// File: contracts/core/interfaces/IWhiteList.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;

/**
 * @title IWhiteList
 * @author Set Protocol
 *
 * The IWhiteList interface exposes the whitelist mapping to check components
 */
interface IWhiteList {

    /* ============ External Functions ============ */

    /**
     * Validates address against white list
     *
     * @param  _address       Address to check
     * @return bool           Whether passed in address is whitelisted
     */
    function whiteList(
        address _address
    )
        external
        view
        returns (bool);

    /**
     * Verifies an array of addresses against the whitelist
     *
     * @param  _addresses    Array of addresses to verify
     * @return bool          Whether all addresses in the list are whitelsited
     */
    function areValidAddresses(
        address[] calldata _addresses
    )
        external
        view
        returns (bool);
}

// File: contracts/core/interfaces/IRebalancingSetFactory.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;




/**
 * @title IRebalancingSetFactory
 * @author Set Protocol
 *
 * The IRebalancingSetFactory interface provides operability for authorized contracts
 * to interact with RebalancingSetTokenFactory
 */
contract IRebalancingSetFactory is
    ISetFactory
{
    /**
     * Getter for minimumRebalanceInterval of RebalancingSetTokenFactory, used
     * to enforce rebalanceInterval when creating a RebalancingSetToken
     *
     * @return uint256    Minimum amount of time between rebalances in seconds
     */
    function minimumRebalanceInterval()
        external
        returns (uint256);

    /**
     * Getter for minimumProposalPeriod of RebalancingSetTokenFactory, used
     * to enforce proposalPeriod when creating a RebalancingSetToken
     *
     * @return uint256    Minimum amount of time users can review proposals in seconds
     */
    function minimumProposalPeriod()
        external
        returns (uint256);

    /**
     * Getter for minimumTimeToPivot of RebalancingSetTokenFactory, used
     * to enforce auctionTimeToPivot when proposing a rebalance
     *
     * @return uint256    Minimum amount of time before auction pivot reached
     */
    function minimumTimeToPivot()
        external
        returns (uint256);

    /**
     * Getter for maximumTimeToPivot of RebalancingSetTokenFactory, used
     * to enforce auctionTimeToPivot when proposing a rebalance
     *
     * @return uint256    Maximum amount of time before auction pivot reached
     */
    function maximumTimeToPivot()
        external
        returns (uint256);

    /**
     * Getter for minimumNaturalUnit of RebalancingSetTokenFactory
     *
     * @return uint256    Minimum natural unit
     */
    function minimumNaturalUnit()
        external
        returns (uint256);

    /**
     * Getter for maximumNaturalUnit of RebalancingSetTokenFactory
     *
     * @return uint256    Maximum Minimum natural unit
     */
    function maximumNaturalUnit()
        external
        returns (uint256);

    /**
     * Getter for rebalanceAuctionModule address on RebalancingSetTokenFactory
     *
     * @return address      Address of rebalanceAuctionModule
     */
    function rebalanceAuctionModule()
        external
        returns (address);
}

// File: contracts/core/interfaces/ISetToken.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;

/**
 * @title ISetToken
 * @author Set Protocol
 *
 * The ISetToken interface provides a light-weight, structured way to interact with the
 * SetToken contract from another contract.
 */
interface ISetToken {

    /* ============ External Functions ============ */

    /*
     * Get natural unit of Set
     *
     * @return  uint256       Natural unit of Set
     */
    function naturalUnit()
        external
        view
        returns (uint256);

    /*
     * Get addresses of all components in the Set
     *
     * @return  componentAddresses       Array of component tokens
     */
    function getComponents()
        external
        view
        returns (address[] memory);

    /*
     * Get units of all tokens in Set
     *
     * @return  units       Array of component units
     */
    function getUnits()
        external
        view
        returns (uint256[] memory);

    /*
     * Checks to make sure token is component of Set
     *
     * @param  _tokenAddress     Address of token being checked
     * @return  bool             True if token is component of Set
     */
    function tokenIsComponent(
        address _tokenAddress
    )
        external
        view
        returns (bool);

    /*
     * Mint set token for given address.
     * Can only be called by authorized contracts.
     *
     * @param  _issuer      The address of the issuing account
     * @param  _quantity    The number of sets to attribute to issuer
     */
    function mint(
        address _issuer,
        uint256 _quantity
    )
        external;

    /*
     * Burn set token for given address
     * Can only be called by authorized contracts
     *
     * @param  _from        The address of the redeeming account
     * @param  _quantity    The number of sets to burn from redeemer
     */
    function burn(
        address _from,
        uint256 _quantity
    )
        external;

    /**
    * Transfer token for a specified address
    *
    * @param to The address to transfer to.
    * @param value The amount to be transferred.
    */
    function transfer(
        address to,
        uint256 value
    )
        external;
}

// File: contracts/core/interfaces/IVault.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;

/**
 * @title IVault
 * @author Set Protocol
 *
 * The IVault interface provides a light-weight, structured way to interact with the Vault
 * contract from another contract.
 */
interface IVault {

    /*
     * Withdraws user's unassociated tokens to user account. Can only be
     * called by authorized core contracts.
     *
     * @param  _token          The address of the ERC20 token
     * @param  _to             The address to transfer token to
     * @param  _quantity       The number of tokens to transfer
     */
    function withdrawTo(
        address _token,
        address _to,
        uint256 _quantity
    )
        external;

    /*
     * Increment quantity owned of a token for a given address. Can
     * only be called by authorized core contracts.
     *
     * @param  _token           The address of the ERC20 token
     * @param  _owner           The address of the token owner
     * @param  _quantity        The number of tokens to attribute to owner
     */
    function incrementTokenOwner(
        address _token,
        address _owner,
        uint256 _quantity
    )
        external;

    /*
     * Decrement quantity owned of a token for a given address. Can only
     * be called by authorized core contracts.
     *
     * @param  _token           The address of the ERC20 token
     * @param  _owner           The address of the token owner
     * @param  _quantity        The number of tokens to deattribute to owner
     */
    function decrementTokenOwner(
        address _token,
        address _owner,
        uint256 _quantity
    )
        external;

    /**
     * Transfers tokens associated with one account to another account in the vault
     *
     * @param  _token          Address of token being transferred
     * @param  _from           Address token being transferred from
     * @param  _to             Address token being transferred to
     * @param  _quantity       Amount of tokens being transferred
     */

    function transferBalance(
        address _token,
        address _from,
        address _to,
        uint256 _quantity
    )
        external;


    /*
     * Withdraws user's unassociated tokens to user account. Can only be
     * called by authorized core contracts.
     *
     * @param  _tokens          The addresses of the ERC20 tokens
     * @param  _owner           The address of the token owner
     * @param  _quantities      The numbers of tokens to attribute to owner
     */
    function batchWithdrawTo(
        address[] calldata _tokens,
        address _to,
        uint256[] calldata _quantities
    )
        external;

    /*
     * Increment quantites owned of a collection of tokens for a given address. Can
     * only be called by authorized core contracts.
     *
     * @param  _tokens          The addresses of the ERC20 tokens
     * @param  _owner           The address of the token owner
     * @param  _quantities      The numbers of tokens to attribute to owner
     */
    function batchIncrementTokenOwner(
        address[] calldata _tokens,
        address _owner,
        uint256[] calldata _quantities
    )
        external;

    /*
     * Decrements quantites owned of a collection of tokens for a given address. Can
     * only be called by authorized core contracts.
     *
     * @param  _tokens          The addresses of the ERC20 tokens
     * @param  _owner           The address of the token owner
     * @param  _quantities      The numbers of tokens to attribute to owner
     */
    function batchDecrementTokenOwner(
        address[] calldata _tokens,
        address _owner,
        uint256[] calldata _quantities
    )
        external;

   /**
     * Transfers tokens associated with one account to another account in the vault
     *
     * @param  _tokens           Addresses of tokens being transferred
     * @param  _from             Address tokens being transferred from
     * @param  _to               Address tokens being transferred to
     * @param  _quantities       Amounts of tokens being transferred
     */
    function batchTransferBalance(
        address[] calldata _tokens,
        address _from,
        address _to,
        uint256[] calldata _quantities
    )
        external;

    /*
     * Get balance of particular contract for owner.
     *
     * @param  _token    The address of the ERC20 token
     * @param  _owner    The address of the token owner
     */
    function getOwnerBalance(
        address _token,
        address _owner
    )
        external
        view
        returns (uint256);
}

// File: contracts/core/lib/RebalancingLibrary.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;


/**
 * @title RebalancingLibrary
 * @author Set Protocol
 *
 * The RebalancingLibrary contains functions for facilitating the rebalancing process for
 * Rebalancing Set Tokens. Removes the old calculation functions
 *
 */
library RebalancingLibrary {

    /* ============ Enums ============ */

    enum State { Default, Proposal, Rebalance, Drawdown }

    /* ============ Structs ============ */

    struct AuctionPriceParameters {
        uint256 auctionStartTime;
        uint256 auctionTimeToPivot;
        uint256 auctionStartPrice;
        uint256 auctionPivotPrice;
    }

    struct BiddingParameters {
        uint256 minimumBid;
        uint256 remainingCurrentSets;
        uint256[] combinedCurrentUnits;
        uint256[] combinedNextSetUnits;
        address[] combinedTokenArray;
    }
}

// File: openzeppelin-solidity/contracts/math/Math.sol

pragma solidity ^0.5.2;

/**
 * @title Math
 * @dev Assorted math operations
 */
library Math {
    /**
     * @dev Returns the largest of two numbers.
     */
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a : b;
    }

    /**
     * @dev Returns the smallest of two numbers.
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /**
     * @dev Calculates the average of two numbers. Since these are integers,
     * averages of an even and odd number cannot be represented, and will be
     * rounded down.
     */
    function average(uint256 a, uint256 b) internal pure returns (uint256) {
        // (a + b) / 2 can overflow, so we distribute
        return (a / 2) + (b / 2) + ((a % 2 + b % 2) / 2);
    }
}

// File: contracts/core/tokens/rebalancing-libraries/FailAuctionLibrary.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;









/**
 * @title FailAuctionLibrary
 * @author Set Protocol
 *
 * Default implementation of Rebalancing Set Token endFailedAuction function
 */
library FailAuctionLibrary {
    using SafeMath for uint256;

    /**
     * Fail an auction that doesn't complete before reaching the pivot price. Move to Drawdown state
     * if bids have been placed. Reset to Default state if no bids placed.
     *
     * @param _startingCurrentSetAmount     Amount of current set at beginning or rebalance
     * @param _calculatedUnitShares         Calculated unitShares amount if rebalance were to be settled
     * @param _currentSet                   The Set that failed to rebalance
     * @param _coreAddress                  Core address
     * @param _auctionPriceParameters       Struct containing auction price curve parameters
     * @param _biddingParameters            Struct containing relevant data for calculating token flows
     * @param _rebalanceState               State rebalancing set token is in
     * @return                              State of Rebalancing Set after function called
     */
    function endFailedAuction(
        uint256 _startingCurrentSetAmount,
        uint256 _calculatedUnitShares,
        address _currentSet,
        address _coreAddress,
        RebalancingLibrary.AuctionPriceParameters memory _auctionPriceParameters,
        RebalancingLibrary.BiddingParameters memory _biddingParameters,
        uint8 _rebalanceState
    )
        public
        returns (uint8)
    {
        // Token must be in Rebalance State
        require(
            _rebalanceState ==  uint8(RebalancingLibrary.State.Rebalance),
            "RebalanceAuctionModule.endFailedAuction: Rebalancing Set Token must be in Rebalance State"
        );

        // Calculate timestamp when pivot is reached
        uint256 revertAuctionTime = _auctionPriceParameters.auctionStartTime.add(
            _auctionPriceParameters.auctionTimeToPivot
        );

        // Make sure auction has gone past pivot point
        require(
            block.timestamp >= revertAuctionTime,
            "RebalanceAuctionModule.endFailedAuction: Can only be called after auction reaches pivot"
        );

        uint8 newRebalanceState;
        /**
         * If not enough sets have been bid on then allow auction to fail where no bids being registered
         * returns the rebalancing set token to pre-auction state and some bids being registered puts the
         * rebalancing set token in Drawdown mode.
         *
         * However, if enough sets have been bid on. Then allow auction to fail and enter Drawdown state if
         * and only if the calculated post-auction unitShares is equal to 0.
         */
        if (_biddingParameters.remainingCurrentSets >= _biddingParameters.minimumBid) {
            // Check if any bids have been placed
            if (_startingCurrentSetAmount == _biddingParameters.remainingCurrentSets) {
                // If bid not placed, reissue current Set
                ICore(_coreAddress).issueInVault(
                    _currentSet,
                    _startingCurrentSetAmount
                );

                // Set Rebalance Set Token state to Default
                newRebalanceState = uint8(RebalancingLibrary.State.Default);
            } else {
                // Set Rebalancing Set Token to Drawdown state
                newRebalanceState = uint8(RebalancingLibrary.State.Drawdown);
            }
        } else {
            // If settleRebalance can be called then endFailedAuction can't be unless calculatedUnitShares
            // equals 0
            require(
                _calculatedUnitShares == 0,
                "RebalancingSetToken.endFailedAuction: Cannot be called if rebalance is viably completed"
            );

            // If calculated unitShares equals 0 set to Drawdown state
            newRebalanceState = uint8(RebalancingLibrary.State.Drawdown);
        }

        return newRebalanceState;
    }
}

// File: contracts/core/lib/auction-price-libraries/IAuctionPriceCurve.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;



/**
 * @title IAuctionPriceCurve
 * @author Set Protocol
 *
 * The IAuctionPriceCurve interface provides a structured way to interact with any AuctionLibrary
 */
interface IAuctionPriceCurve {

    /*
     * Getter for priceDivisor variable on Auction Price Curve Library
     */
    function priceDivisor()
        external
        view
        returns (uint256);

    /*
     * Validate any auction parameters that have library-specific restrictions
     *
     * @param _auctionPriceParameters   Struct containing relevant auction price parameters
     */
    function validateAuctionPriceParameters(
        RebalancingLibrary.AuctionPriceParameters calldata _auctionPriceParameters
    )
        external
        view;

    /*
     * Calculate the current priceRatio for an auction given defined price and time parameters
     *
     * @param _auctionPriceParameters     Struct containing relevant auction price parameters
     * @return uint256                    The auction price numerator
     * @return uint256                    The auction price denominator
     */
    function getCurrentPrice(
        RebalancingLibrary.AuctionPriceParameters calldata _auctionPriceParameters
    )
        external
        view
        returns (uint256, uint256);
}

// File: contracts/core/tokens/rebalancing-libraries/PlaceBidLibrary.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;







/**
 * @title PlaceBidLibrary
 * @author Set Protocol
 *
 * Default implementation of Rebalancing Set Token placeBid function
 */
library PlaceBidLibrary {
    using SafeMath for uint256;

    /* ============ Internal Functions ============ */

    /*
     * Place bid during rebalance auction. Can only be called by Core.
     *
     * @param _quantity                 The amount of currentSet to be rebalanced
     * @param _coreAddress              Core address
     * @param _biddingParameters        Struct containing relevant data for calculating token flows
     * @return inflowUnitArray          Array of amount of tokens inserted into system in bid
     * @return outflowUnitArray         Array of amount of tokens taken out of system in bid
     */
    function validatePlaceBid(
        uint256 _quantity,
        address _coreAddress,
        RebalancingLibrary.BiddingParameters memory _biddingParameters
    )
        public
        view
        returns (uint256)
    {
        // Make sure sender is a module
        require(
            ICore(_coreAddress).validModules(msg.sender),
            "RebalancingSetToken.placeBid: Sender must be approved module"
        );

        // Make sure that bid amount is greater than zero
        require(
            _quantity > 0,
            "RebalancingSetToken.placeBid: Bid must be > 0"
        );

        // Make sure that bid amount is multiple of minimum bid amount
        require(
            _quantity.mod(_biddingParameters.minimumBid) == 0,
            "RebalancingSetToken.placeBid: Must bid multiple of minimum bid"
        );

        // Make sure that bid Amount is less than remainingCurrentSets
        require(
            _quantity <= _biddingParameters.remainingCurrentSets,
            "RebalancingSetToken.placeBid: Bid exceeds remaining current sets"
        );
    }

    /*
     * Get token inflows and outflows required for bid. Also the amount of Rebalancing
     * Sets that would be generated.
     *
     * @param _quantity               The amount of currentSet to be rebalanced
     * @param _auctionLibrary         Auction library used in rebalance
     * @param _biddingParameters      Struct containing relevant data for calculating token flows
     * @param _auctionPriceParameters Struct containing auction price curve parameters
     * @param _rebalanceState         State of rebalancing set token
     * @return inflowUnitArray        Array of amount of tokens inserted into system in bid
     * @return outflowUnitArray       Array of amount of tokens taken out of system in bid
     */
    function getBidPrice(
        uint256 _quantity,
        address _auctionLibrary,
        RebalancingLibrary.BiddingParameters memory _biddingParameters,
        RebalancingLibrary.AuctionPriceParameters memory _auctionPriceParameters,
        uint8 _rebalanceState
    )
        public
        view
        returns (uint256[] memory, uint256[] memory)
    {
        // Confirm in Rebalance State
        require(
            _rebalanceState == uint8(RebalancingLibrary.State.Rebalance),
            "RebalancingSetToken.getBidPrice: State must be Rebalance"
        );

        // Get bid conversion price, currently static placeholder for calling auctionlibrary
        uint256 priceNumerator;
        uint256 priceDivisor;
        (priceNumerator, priceDivisor) = IAuctionPriceCurve(_auctionLibrary).getCurrentPrice(
            _auctionPriceParameters
        );

        // Normalized quantity amount
        uint256 unitsMultiplier = _quantity.div(_biddingParameters.minimumBid).mul(priceDivisor);

        // Calculate token flow arrays
        return createTokenFlowArrays(
            unitsMultiplier,
            priceNumerator,
            priceDivisor,
            _biddingParameters
        );
    }

    /*
     * Creates arrays of token inflows and outflows
     *
     * @param _unitsMultiplier        Bid amount normalized to number of standard bid amounts
     * @param _priceNumerator         The numerator of the price ratio
     * @param _priceDivisor           The denominator of the price ratio
     * @param _biddingParameters      Struct containing relevant data for calculating token flows
     * @return inflowUnitArray        Array of amount of tokens inserted into system in bid
     * @return outflowUnitArray       Array of amount of tokens taken out of system in bid
     */
    function createTokenFlowArrays(
        uint256 _unitsMultiplier,
        uint256 _priceNumerator,
        uint256 _priceDivisor,
        RebalancingLibrary.BiddingParameters memory _biddingParameters
    )
        public
        pure
        returns (uint256[] memory, uint256[] memory)
    {
        // Declare unit arrays in memory
        uint256 combinedTokenCount = _biddingParameters.combinedTokenArray.length;
        uint256[] memory inflowUnitArray = new uint256[](combinedTokenCount);
        uint256[] memory outflowUnitArray = new uint256[](combinedTokenCount);

        // Cycle through each token in combinedTokenArray, calculate inflow/outflow and store
        // result in array
        for (uint256 i = 0; i < combinedTokenCount; i++) {
            (
                inflowUnitArray[i],
                outflowUnitArray[i]
            ) = calculateTokenFlows(
                _biddingParameters.combinedCurrentUnits[i],
                _biddingParameters.combinedNextSetUnits[i],
                _unitsMultiplier,
                _priceNumerator,
                _priceDivisor
            );
        }

        return (inflowUnitArray, outflowUnitArray);
    }

    /*
     * Calculates token inflow/outflow for single component in combinedTokenArray
     *
     * @param _currentUnit          Amount of token i in currentSet per minimum bid amount
     * @param _nextSetUnit          Amount of token i in nextSet per minimum bid amount
     * @param _unitsMultiplier      Bid amount normalized to number of minimum bid amounts
     * @param _priceNumerator       The numerator of the price ratio
     * @param _priceDivisor         The denominator of the price ratio
     * @return inflowUnit           Amount of token i transferred into the system
     * @return outflowUnit          Amount of token i transferred to the bidder
     */
    function calculateTokenFlows(
        uint256 _currentUnit,
        uint256 _nextSetUnit,
        uint256 _unitsMultiplier,
        uint256 _priceNumerator,
        uint256 _priceDivisor
    )
        public
        pure
        returns (uint256, uint256)
    {
        /*
         * Below is a mathematically simplified formula for calculating token inflows and
         * outflows, the following is it's derivation:
         * token_flow = (bidQuantity/price)*(nextUnit - price*currentUnit)
         *
         * Where,
         * 1) price = (priceNumerator/priceDivisor),
         * 2) nextUnit and currentUnit are the amount of component i needed for a
         * standardAmount of sets to be rebalanced where one standardAmount =
         * max(natural unit nextSet, natural unit currentSet), and
         * 3) bidQuantity is a normalized amount in terms of the standardAmount used
         * to calculate nextUnit and currentUnit. This is represented by the unitsMultiplier
         * variable.
         *
         * Given these definitions we can derive the below formula as follows:
         * token_flow = (unitsMultiplier/(priceNumerator/priceDivisor))*
         * (nextUnit - (priceNumerator/priceDivisor)*currentUnit)
         *
         * We can then multiply this equation by (priceDivisor/priceDivisor)
         * which simplifies the above equation to:
         *
         * (unitsMultiplier/priceNumerator)* (nextUnit*priceDivisor - currentUnit*priceNumerator)
         *
         * This is the equation seen below, but since unsigned integers are used we must check to see if
         * nextUnit*priceDivisor > currentUnit*priceNumerator, otherwise those two terms must be
         * flipped in the equation.
         */
        uint256 inflowUnit;
        uint256 outflowUnit;

        // Use if statement to check if token inflow or outflow
        if (_nextSetUnit.mul(_priceDivisor) > _currentUnit.mul(_priceNumerator)) {
            // Calculate inflow amount
            inflowUnit = _unitsMultiplier.mul(
                _nextSetUnit.mul(_priceDivisor).sub(_currentUnit.mul(_priceNumerator))
            ).div(_priceNumerator);

            // Set outflow amount to 0 for component i, since tokens need to be injected in rebalance
            outflowUnit = 0;
        } else {
            // Calculate outflow amount
            outflowUnit = _unitsMultiplier.mul(
                _currentUnit.mul(_priceNumerator).sub(_nextSetUnit.mul(_priceDivisor))
            ).div(_priceNumerator);

            // Set inflow amount to 0 for component i, since tokens need to be returned in rebalance
            inflowUnit = 0;
        }

        return (inflowUnit, outflowUnit);
    }
}

// File: contracts/core/tokens/rebalancing-libraries/ProposeLibrary.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;










/**
 * @title ProposeLibrary
 * @author Set Protocol
 *
 * Default implementation of Rebalancing Set Token propose function
 */
library ProposeLibrary {
    using SafeMath for uint256;

    /* ============ Structs ============ */

    struct ProposalContext {
        address manager;
        address currentSet;
        address coreAddress;
        address componentWhitelist;
        address factoryAddress;
        uint256 lastRebalanceTimestamp;
        uint256 rebalanceInterval;
        uint8 rebalanceState;
    }

    /* ============ Internal Functions ============ */

    /**
     * Function used to validate inputs to propose function
     *
     * @param _nextSet                    The Set to rebalance into
     * @param _auctionLibrary             The library used to calculate the Dutch Auction price
     * @param _proposalContext            Rebalancing Set Token state parameters needed for proposal validation
     */
    function validateProposal(
        address _nextSet,
        address _auctionLibrary,
        ProposalContext memory _proposalContext,
        RebalancingLibrary.AuctionPriceParameters memory _auctionPriceParameters
    )
        public
    {
        ICore coreInstance = ICore(_proposalContext.coreAddress);
        IRebalancingSetFactory factoryInstance = IRebalancingSetFactory(_proposalContext.factoryAddress);

        // Make sure it is manager that is proposing the rebalance
        require(
            msg.sender == _proposalContext.manager,
            "ProposeLibrary.validateProposal: Sender must be manager"
        );

        // New Proposal can only be made in Default and Proposal state
        require(
            _proposalContext.rebalanceState == uint8(RebalancingLibrary.State.Default) ||
            _proposalContext.rebalanceState == uint8(RebalancingLibrary.State.Proposal),
            "ProposeLibrary.validateProposal: State must be in Propose or Default"
        );

        // Make sure enough time has passed from last rebalance to start a new proposal
        require(
            block.timestamp >= _proposalContext.lastRebalanceTimestamp.add(
                _proposalContext.rebalanceInterval
            ),
            "ProposeLibrary.validateProposal: Rebalance interval not elapsed"
        );

        // Check that new proposed Set is valid Set created by Core
        require(
            coreInstance.validSets(_nextSet),
            "ProposeLibrary.validateProposal: Invalid or disabled proposed SetToken address"
        );

        // Check proposed components on whitelist. This is to ensure managers are unable to add contract addresses
        // to a propose that prohibit the set from carrying out an auction i.e. a token that only the manager possesses
        require(
            IWhiteList(
                _proposalContext.componentWhitelist
            ).areValidAddresses(ISetToken(_nextSet).getComponents()),
            "ProposeLibrary.validateProposal: Proposed set contains invalid component token"
        );

        // Check that the auction library is a valid priceLibrary tracked by Core
        require(
            coreInstance.validPriceLibraries(_auctionLibrary),
            "ProposeLibrary.validateProposal: Invalid or disabled PriceLibrary address"
        );

        // Check that auctionTimeToPivot is greater than or equal to 6 hours
        require(
            _auctionPriceParameters.auctionTimeToPivot >= factoryInstance.minimumTimeToPivot(),
            "ProposeLibrary.validateProposal: Time to pivot must be greater than minimum"
        );

        // Check that auctionTimeToPivot is less than or equal to 3 days
        require(
            _auctionPriceParameters.auctionTimeToPivot <= factoryInstance.maximumTimeToPivot(),
            "ProposeLibrary.validateProposal: Time to pivot must be greater than maximum"
        );

        // Check that the proposed set natural unit is a multiple of current set natural unit, or vice versa.
        // Done to make sure that when calculating token units there will are no rounding errors.
        uint256 currentNaturalUnit = ISetToken(_proposalContext.currentSet).naturalUnit();
        uint256 nextSetNaturalUnit = ISetToken(_nextSet).naturalUnit();
        require(
            Math.max(currentNaturalUnit, nextSetNaturalUnit).mod(
                Math.min(currentNaturalUnit, nextSetNaturalUnit)
            ) == 0,
            "ProposeLibrary.validateProposal: Invalid proposed Set natural unit"
        );

        // Check that pivot price is compliant with library restrictions
        IAuctionPriceCurve(_auctionLibrary).validateAuctionPriceParameters(
            _auctionPriceParameters
        );
    }
}

// File: contracts/core/lib/SetTokenLibrary.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;




library SetTokenLibrary {
    using SafeMath for uint256;

    struct SetDetails {
        uint256 naturalUnit;
        address[] components;
        uint256[] units;
    }

    /**
     * Validates that passed in tokens are all components of the Set
     *
     * @param _set                      Address of the Set
     * @param _tokens                   List of tokens to check
     */
    function validateTokensAreComponents(
        address _set,
        address[] calldata _tokens
    )
        external
        view
    {
        for (uint256 i = 0; i < _tokens.length; i++) {
            // Make sure all tokens are members of the Set
            require(
                ISetToken(_set).tokenIsComponent(_tokens[i]),
                "SetTokenLibrary.validateTokensAreComponents: Component must be a member of Set"
            );

        }
    }

    /**
     * Validates that passed in quantity is a multiple of the natural unit of the Set.
     *
     * @param _set                      Address of the Set
     * @param _quantity                   Quantity to validate
     */
    function isMultipleOfSetNaturalUnit(
        address _set,
        uint256 _quantity
    )
        external
        view
    {
        require(
            _quantity.mod(ISetToken(_set).naturalUnit()) == 0,
            "SetTokenLibrary.isMultipleOfSetNaturalUnit: Quantity is not a multiple of nat unit"
        );
    }

    /**
     * Retrieves the Set's natural unit, components, and units.
     *
     * @param _set                      Address of the Set
     * @return SetDetails               Struct containing the natural unit, components, and units
     */
    function getSetDetails(
        address _set
    )
        internal
        view
        returns (SetDetails memory)
    {
        // Declare interface variables
        ISetToken setToken = ISetToken(_set);

        // Fetch set token properties
        uint256 naturalUnit = setToken.naturalUnit();
        address[] memory components = setToken.getComponents();
        uint256[] memory units = setToken.getUnits();

        return SetDetails({
            naturalUnit: naturalUnit,
            components: components,
            units: units
        });
    }
}

// File: contracts/core/tokens/rebalancing-libraries/SettleRebalanceLibrary.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;










/**
 * @title SettleRebalanceLibrary
 * @author Set Protocol
 *
 * Default implementation of Rebalancing Set Token settle rebalance and related functions.
 */
library SettleRebalanceLibrary {
    using SafeMath for uint256;
    /* ============ Internal Functions ============ */

    /**
     * Calculate the amount of nextSets to issue by using the component amounts in the
     * vault, new unitShares follow from this calculation
     *
     * @param   _totalSupply            Total supply of rebalancing set token
     * @param   _remainingCurrentSets   Amount of currentSets remaining
     * @param   _minimumBid             Minimum bid allowed, used to see if valid settle
     * @param   _naturalUnit            Natural unit of rebalancing set token
     * @param   _nextSet                Address of next set
     * @param   _coreAddress            Core address
     * @param   _vaultAddress           Vault address
     * @return  uint256                 Amount of nextSets to issue
     */
    function settleRebalance(
        uint256 _totalSupply,
        uint256 _remainingCurrentSets,
        uint256 _minimumBid,
        uint256 _naturalUnit,
        address _nextSet,
        address _coreAddress,
        address _vaultAddress,
        uint8 _rebalanceState
    )
        public
        returns (uint256)
    {
        // Must be in Rebalance state to call settlement
        require(
            _rebalanceState == uint8(RebalancingLibrary.State.Rebalance),
            "RebalancingSetToken.settleRebalance: State must be Rebalance"
        );

        // Make sure all currentSets have been rebalanced
        require(
            _remainingCurrentSets < _minimumBid,
            "RebalancingSetToken.settleRebalance: Rebalance not completed"
        );

        // Calculate next Set quantities
        uint256 issueAmount;
        uint256 nextUnitShares;
        (
            issueAmount,
            nextUnitShares
        ) = calculateNextSetIssueQuantity(
            _totalSupply,
            _naturalUnit,
            _nextSet,
            _vaultAddress
        );

        require(
            nextUnitShares > 0,
            "RebalancingSetToken.settleRebalance: Failed rebalance, unitshares equals 0. Call endFailedAuction."
        );

        // Issue nextSet to RebalancingSetToken
        ICore(_coreAddress).issueInVault(
            _nextSet,
            issueAmount
        );

        return nextUnitShares;
    }

    /**
     * Calculate the amount of nextSets to issue by using the component amounts in the
     * vault, unitShares following from this calculation.
     *
     * @param   _totalSupply        Total supply of rebalancing set token
     * @param   _naturalUnit        Natural unit of rebalancing set token
     * @param   _nextSet            Address of next set
     * @param   _vaultAddress       Vault address
     * @return  uint256             Amount of nextSets to issue
     * @return  uint256             New unitShares for the rebalancingSetToken
     */
    function calculateNextSetIssueQuantity(
        uint256 _totalSupply,
        uint256 _naturalUnit,
        address _nextSet,
        address _vaultAddress
    )
        public
        view
        returns (uint256, uint256)
    {
        // Collect data necessary to compute issueAmounts
        SetTokenLibrary.SetDetails memory nextSetToken = SetTokenLibrary.getSetDetails(_nextSet);
        uint256 maxIssueAmount = calculateMaxIssueAmount(
            _vaultAddress,
            nextSetToken
        );

        // Calculate the amount of naturalUnits worth of rebalancingSetToken outstanding
        uint256 naturalUnitsOutstanding = _totalSupply.div(_naturalUnit);

        // Issue amount of Sets that is closest multiple of nextNaturalUnit to the maxIssueAmount
        // Since the initial division will round down to the nearest whole number when we multiply
        // by that same number we will return the closest multiple less than the maxIssueAmount
        uint256 issueAmount = maxIssueAmount.div(nextSetToken.naturalUnit).mul(nextSetToken.naturalUnit);

        // Divide final issueAmount by naturalUnitsOutstanding to get newUnitShares
        uint256 newUnitShares = issueAmount.div(naturalUnitsOutstanding);
        return (issueAmount, newUnitShares);
    }

    /**
     * Get the maximum possible issue amount of nextSet based on number of components owned by rebalancing
     * set token.
     *
     * @param _vaultAddress     Vault address
     * @param _setToken         nextSet details
     * @return uint256          maxIssueAmount
     */
    function calculateMaxIssueAmount(
        address _vaultAddress,
        SetTokenLibrary.SetDetails memory _setToken
    )
        public
        view
        returns (uint256)
    {
        uint256 maxIssueAmount = CommonMath.maxUInt256();
        IVault vaultInstance = IVault(_vaultAddress);

        for (uint256 i = 0; i < _setToken.components.length; i++) {
            // Get amount of components in vault owned by rebalancingSetToken
            uint256 componentAmount = vaultInstance.getOwnerBalance(
                _setToken.components[i],
                address(this)
            );

            // Calculate amount of Sets that can be issued from those components, if less than amount for other
            // components then set that as maxIssueAmount
            uint256 componentIssueAmount = componentAmount.div(_setToken.units[i]).mul(_setToken.naturalUnit);
            if (componentIssueAmount < maxIssueAmount) {
                maxIssueAmount = componentIssueAmount;
            }
        }

        return maxIssueAmount;
    }
}

// File: contracts/lib/AddressArrayUtils.sol

// Pulled in from Cryptofin Solidity package in order to control Solidity compiler version
// https://github.com/cryptofinlabs/cryptofin-solidity/blob/master/contracts/array-utils/AddressArrayUtils.sol

pragma solidity 0.5.7;


library AddressArrayUtils {

    /**
     * Finds the index of the first occurrence of the given element.
     * @param A The input array to search
     * @param a The value to find
     * @return Returns (index and isIn) for the first occurrence starting from index 0
     */
    function indexOf(address[] memory A, address a) internal pure returns (uint256, bool) {
        uint256 length = A.length;
        for (uint256 i = 0; i < length; i++) {
            if (A[i] == a) {
                return (i, true);
            }
        }
        return (0, false);
    }

    /**
    * Returns true if the value is present in the list. Uses indexOf internally.
    * @param A The input array to search
    * @param a The value to find
    * @return Returns isIn for the first occurrence starting from index 0
    */
    function contains(address[] memory A, address a) internal pure returns (bool) {
        bool isIn;
        (, isIn) = indexOf(A, a);
        return isIn;
    }

    /// @return Returns index and isIn for the first occurrence starting from
    /// end
    function indexOfFromEnd(address[] memory A, address a) internal pure returns (uint256, bool) {
        uint256 length = A.length;
        for (uint256 i = length; i > 0; i--) {
            if (A[i - 1] == a) {
                return (i, true);
            }
        }
        return (0, false);
    }

    /**
     * Returns the combination of the two arrays
     * @param A The first array
     * @param B The second array
     * @return Returns A extended by B
     */
    function extend(address[] memory A, address[] memory B) internal pure returns (address[] memory) {
        uint256 aLength = A.length;
        uint256 bLength = B.length;
        address[] memory newAddresses = new address[](aLength + bLength);
        for (uint256 i = 0; i < aLength; i++) {
            newAddresses[i] = A[i];
        }
        for (uint256 j = 0; j < bLength; j++) {
            newAddresses[aLength + j] = B[j];
        }
        return newAddresses;
    }

    /**
     * Returns the array with a appended to A.
     * @param A The first array
     * @param a The value to append
     * @return Returns A appended by a
     */
    function append(address[] memory A, address a) internal pure returns (address[] memory) {
        address[] memory newAddresses = new address[](A.length + 1);
        for (uint256 i = 0; i < A.length; i++) {
            newAddresses[i] = A[i];
        }
        newAddresses[A.length] = a;
        return newAddresses;
    }

    /**
     * Returns the combination of two storage arrays.
     * @param A The first array
     * @param B The second array
     * @return Returns A appended by a
     */
    function sExtend(address[] storage A, address[] storage B) internal {
        uint256 length = B.length;
        for (uint256 i = 0; i < length; i++) {
            A.push(B[i]);
        }
    }

    /**
     * Returns the intersection of two arrays. Arrays are treated as collections, so duplicates are kept.
     * @param A The first array
     * @param B The second array
     * @return The intersection of the two arrays
     */
    function intersect(address[] memory A, address[] memory B) internal pure returns (address[] memory) {
        uint256 length = A.length;
        bool[] memory includeMap = new bool[](length);
        uint256 newLength = 0;
        for (uint256 i = 0; i < length; i++) {
            if (contains(B, A[i])) {
                includeMap[i] = true;
                newLength++;
            }
        }
        address[] memory newAddresses = new address[](newLength);
        uint256 j = 0;
        for (uint256 k = 0; k < length; k++) {
            if (includeMap[k]) {
                newAddresses[j] = A[k];
                j++;
            }
        }
        return newAddresses;
    }

    /**
     * Returns the union of the two arrays. Order is not guaranteed.
     * @param A The first array
     * @param B The second array
     * @return The union of the two arrays
     */
    function union(address[] memory A, address[] memory B) internal pure returns (address[] memory) {
        address[] memory leftDifference = difference(A, B);
        address[] memory rightDifference = difference(B, A);
        address[] memory intersection = intersect(A, B);
        return extend(leftDifference, extend(intersection, rightDifference));
    }

    /**
     * Alternate implementation
     * Assumes there are no duplicates
     */
    function unionB(address[] memory A, address[] memory B) internal pure returns (address[] memory) {
        bool[] memory includeMap = new bool[](A.length + B.length);
        uint256 count = 0;
        for (uint256 i = 0; i < A.length; i++) {
            includeMap[i] = true;
            count++;
        }
        for (uint256 j = 0; j < B.length; j++) {
            if (!contains(A, B[j])) {
                includeMap[A.length + j] = true;
                count++;
            }
        }
        address[] memory newAddresses = new address[](count);
        uint256 k = 0;
        for (uint256 m = 0; m < A.length; m++) {
            if (includeMap[m]) {
                newAddresses[k] = A[m];
                k++;
            }
        }
        for (uint256 n = 0; n < B.length; n++) {
            if (includeMap[A.length + n]) {
                newAddresses[k] = B[n];
                k++;
            }
        }
        return newAddresses;
    }

    /**
     * Computes the difference of two arrays. Assumes there are no duplicates.
     * @param A The first array
     * @param B The second array
     * @return The difference of the two arrays
     */
    function difference(address[] memory A, address[] memory B) internal pure returns (address[] memory) {
        uint256 length = A.length;
        bool[] memory includeMap = new bool[](length);
        uint256 count = 0;
        // First count the new length because can't push for in-memory arrays
        for (uint256 i = 0; i < length; i++) {
            address e = A[i];
            if (!contains(B, e)) {
                includeMap[i] = true;
                count++;
            }
        }
        address[] memory newAddresses = new address[](count);
        uint256 j = 0;
        for (uint256 k = 0; k < length; k++) {
            if (includeMap[k]) {
                newAddresses[j] = A[k];
                j++;
            }
        }
        return newAddresses;
    }

    /**
    * @dev Reverses storage array in place
    */
    function sReverse(address[] storage A) internal {
        address t;
        uint256 length = A.length;
        for (uint256 i = 0; i < length / 2; i++) {
            t = A[i];
            A[i] = A[A.length - i - 1];
            A[A.length - i - 1] = t;
        }
    }

    /**
    * Removes specified index from array
    * Resulting ordering is not guaranteed
    * @return Returns the new array and the removed entry
    */
    function pop(address[] memory A, uint256 index)
        internal
        pure
        returns (address[] memory, address)
    {
        uint256 length = A.length;
        address[] memory newAddresses = new address[](length - 1);
        for (uint256 i = 0; i < index; i++) {
            newAddresses[i] = A[i];
        }
        for (uint256 j = index + 1; j < length; j++) {
            newAddresses[j - 1] = A[j];
        }
        return (newAddresses, A[index]);
    }

    /**
     * @return Returns the new array
     */
    function remove(address[] memory A, address a)
        internal
        pure
        returns (address[] memory)
    {
        (uint256 index, bool isIn) = indexOf(A, a);
        if (!isIn) {
            revert();
        } else {
            (address[] memory _A,) = pop(A, index);
            return _A;
        }
    }

    function sPop(address[] storage A, uint256 index) internal returns (address) {
        uint256 length = A.length;
        if (index >= length) {
            revert("Error: index out of bounds");
        }
        address entry = A[index];
        for (uint256 i = index; i < length - 1; i++) {
            A[i] = A[i + 1];
        }
        A.length--;
        return entry;
    }

    /**
    * Deletes address at index and fills the spot with the last address.
    * Order is not preserved.
    * @return Returns the removed entry
    */
    function sPopCheap(address[] storage A, uint256 index) internal returns (address) {
        uint256 length = A.length;
        if (index >= length) {
            revert("Error: index out of bounds");
        }
        address entry = A[index];
        if (index != length - 1) {
            A[index] = A[length - 1];
            delete A[length - 1];
        }
        A.length--;
        return entry;
    }

    /**
     * Deletes address at index. Works by swapping it with the last address, then deleting.
     * Order is not preserved
     * @param A Storage array to remove from
     */
    function sRemoveCheap(address[] storage A, address a) internal {
        (uint256 index, bool isIn) = indexOf(A, a);
        if (!isIn) {
            revert("Error: entry not found");
        } else {
            sPopCheap(A, index);
            return;
        }
    }

    /**
     * Returns whether or not there's a duplicate. Runs in O(n^2).
     * @param A Array to search
     * @return Returns true if duplicate, false otherwise
     */
    function hasDuplicate(address[] memory A) internal pure returns (bool) {
        if (A.length == 0) {
            return false;
        }
        for (uint256 i = 0; i < A.length - 1; i++) {
            for (uint256 j = i + 1; j < A.length; j++) {
                if (A[i] == A[j]) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Returns whether the two arrays are equal.
     * @param A The first array
     * @param B The second array
     * @return True is the arrays are equal, false if not.
     */
    function isEqual(address[] memory A, address[] memory B) internal pure returns (bool) {
        if (A.length != B.length) {
            return false;
        }
        for (uint256 i = 0; i < A.length; i++) {
            if (A[i] != B[i]) {
                return false;
            }
        }
        return true;
    }

    /**
     * Returns the elements indexed at indexArray.
     * @param A The array to index
     * @param indexArray The array to use to index
     * @return Returns array containing elements indexed at indexArray
     */
    function argGet(address[] memory A, uint256[] memory indexArray)
        internal
        pure
        returns (address[] memory)
    {
        address[] memory array = new address[](indexArray.length);
        for (uint256 i = 0; i < indexArray.length; i++) {
            array[i] = A[indexArray[i]];
        }
        return array;
    }

}

// File: contracts/core/tokens/rebalancing-libraries/StartRebalanceLibrary.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;










/**
 * @title StartRebalanceLibrary
 * @author Set Protocol
 *
 * Default implementation of Rebalancing Set Token startRebalance function
 */


library StartRebalanceLibrary {
    using SafeMath for uint256;
    using AddressArrayUtils for address[];

    /* ============ Internal Functions ============ */

    /**
     * Function used to validate time passed to start a rebalance
     *
     * @param _proposalStartTime    Start time of proposal period
     * @param _proposalPeriod       Required length of proposal period
     * @param _rebalanceState       State rebalancing set token is in
     */
    function validateStartRebalance(
        uint256 _proposalStartTime,
        uint256 _proposalPeriod,
        uint8 _rebalanceState
    )
        external
    {
        // Must be in "Proposal" state before going into "Rebalance" state
        require(
            _rebalanceState == uint8(RebalancingLibrary.State.Proposal),
            "RebalancingSetToken.validateStartRebalance: State must be Proposal"
        );

        // Be sure the full proposal period has elapsed
        require(
            block.timestamp >= _proposalStartTime.add(_proposalPeriod),
            "RebalancingSetToken.validateStartRebalance: Proposal period not elapsed"
        );
    }

    /**
     * Function used to validate inputs to propose function and initialize biddingParameters struct
     *
     * @param _currentSet           Address of current Set
     * @param _nextSet              Address of next Set
     * @param _auctionLibrary       Address of auction library being used in rebalance
     * @param _coreAddress          Core address
     * @param _vaultAddress         Vault address
     * @return                      Struct containing bidding parameters
     */
    function redeemCurrentSetAndGetBiddingParameters(
        address _currentSet,
        address _nextSet,
        address _auctionLibrary,
        address _coreAddress,
        address _vaultAddress
    )
        public
        returns (RebalancingLibrary.BiddingParameters memory)
    {
        // Redeem rounded quantity of current Sets and return redeemed amount of Sets
        uint256 remainingCurrentSets = redeemCurrentSet(
            _currentSet,
            _coreAddress,
            _vaultAddress
        );

        // Create combined array data structures and calculate minimum bid needed for auction
        RebalancingLibrary.BiddingParameters memory biddingParameters = setUpBiddingParameters(
            _currentSet,
            _nextSet,
            _auctionLibrary,
            remainingCurrentSets
        );

        return biddingParameters;
    }

    /**
     * Create struct that holds array representing all components in currentSet and nextSet.
     * Calcualate unit difference between both sets relative to the largest natural
     * unit of the two sets. Calculate minimumBid.
     *
     * @param _currentSet           Address of current Set
     * @param _nextSet              Address of next Set
     * @param _auctionLibrary       Address of auction library being used in rebalance
     * @param _remainingCurrentSets Quantity of Current Sets redeemed
     * @return                      Struct containing bidding parameters
     */
    function setUpBiddingParameters(
        address _currentSet,
        address _nextSet,
        address _auctionLibrary,
        uint256 _remainingCurrentSets
    )
        public
        returns (RebalancingLibrary.BiddingParameters memory)
    {
        // Get set details for currentSet and nextSet (units, components, natural units)
        SetTokenLibrary.SetDetails memory currentSet = SetTokenLibrary.getSetDetails(_currentSet);
        SetTokenLibrary.SetDetails memory nextSet = SetTokenLibrary.getSetDetails(_nextSet);

        // Create combinedTokenArray
        address[] memory combinedTokenArray = currentSet.components.union(
            nextSet.components
        );

        // Calcualate minimumBid
        uint256 minimumBid = calculateMinimumBid(
            currentSet.naturalUnit,
            nextSet.naturalUnit,
            _auctionLibrary
        );

        // Require remainingCurrentSets to be greater than minimumBid otherwise no bidding would
        // be allowed
        require(
            _remainingCurrentSets >= minimumBid,
            "RebalancingSetToken.setUpBiddingParameters: Not enough collateral to rebalance"
        );

        // Create memory version of combinedNextSetUnits and combinedCurrentUnits to only make one
        // call to storage once arrays have been created
        uint256[] memory combinedCurrentUnits;
        uint256[] memory combinedNextSetUnits;
        (
            combinedCurrentUnits,
            combinedNextSetUnits
        ) = calculateCombinedUnitArrays(
            currentSet,
            nextSet,
            minimumBid,
            _auctionLibrary,
            combinedTokenArray
        );

        // Build Bidding Parameters struct and return
        return RebalancingLibrary.BiddingParameters({
            minimumBid: minimumBid,
            remainingCurrentSets: _remainingCurrentSets,
            combinedCurrentUnits: combinedCurrentUnits,
            combinedNextSetUnits: combinedNextSetUnits,
            combinedTokenArray: combinedTokenArray
        });
    }

    /**
     * Calculate the minimumBid allowed for the rebalance
     *
     * @param _currentSetNaturalUnit    Natural unit of currentSet
     * @param _nextSetNaturalUnit       Natural of nextSet
     * @param _auctionLibrary           Address of auction library being used in rebalance
     * @return                          Minimum bid amount
     */
    function calculateMinimumBid(
        uint256 _currentSetNaturalUnit,
        uint256 _nextSetNaturalUnit,
        address _auctionLibrary
    )
        private
        view
        returns (uint256)
    {
        // Get priceDivisor from auctionLibrary
        uint256 priceDivisor = IAuctionPriceCurve(_auctionLibrary).priceDivisor();

        return Math.max(
            _currentSetNaturalUnit.mul(priceDivisor),
            _nextSetNaturalUnit.mul(priceDivisor)
        );
    }

    /**
     * Create arrays that represents all components in currentSet and nextSet.
     * Calcualate unit difference between both sets relative to the largest natural
     * unit of the two sets.
     *
     * @param _currentSet               Information on currentSet
     * @param _nextSet                  Information on nextSet
     * @param _minimumBid               Minimum bid amount
     * @param _auctionLibrary           Address of auction library being used in rebalance
     * @param _combinedTokenArray       Array of component tokens involved in rebalance
     * @return                          Unit inflow/outflow arrays for current and next Set
     */
    function calculateCombinedUnitArrays(
        SetTokenLibrary.SetDetails memory _currentSet,
        SetTokenLibrary.SetDetails memory _nextSet,
        uint256 _minimumBid,
        address _auctionLibrary,
        address[] memory _combinedTokenArray
    )
        public
        returns (uint256[] memory, uint256[] memory)
    {
        // Create memory version of combinedNextSetUnits and combinedCurrentUnits to only make one
        // call to storage once arrays have been created
        uint256[] memory memoryCombinedCurrentUnits = new uint256[](_combinedTokenArray.length);
        uint256[] memory memoryCombinedNextSetUnits = new uint256[](_combinedTokenArray.length);

        for (uint256 i = 0; i < _combinedTokenArray.length; i++) {
            memoryCombinedCurrentUnits[i] = calculateCombinedUnit(
                _currentSet,
                _minimumBid,
                _auctionLibrary,
                _combinedTokenArray[i]
            );

            memoryCombinedNextSetUnits[i] = calculateCombinedUnit(
                _nextSet,
                _minimumBid,
                _auctionLibrary,
                _combinedTokenArray[i]
            );
        }

        return (memoryCombinedCurrentUnits, memoryCombinedNextSetUnits);
    }

    /**
     * Calculations the unit amount of Token to include in the the combined Set units.
     *
     * @param _setToken                 Information on the SetToken
     * @param _minimumBid               Minimum bid amount
     * @param _auctionLibrary           Address of auction library being used in rebalance
     * @param _currentComponent         Current component in iteration
     * @return                          Unit inflow/outflow
     */
    function calculateCombinedUnit(
        SetTokenLibrary.SetDetails memory _setToken,
        uint256 _minimumBid,
        address _auctionLibrary,
        address _currentComponent
    )
        private
        returns (uint256)
    {
        // Check if component in arrays and get index if it is
        uint256 indexCurrent;
        bool isComponent;
        (indexCurrent, isComponent) = _setToken.components.indexOf(_currentComponent);

        // Compute unit amounts of token in Set
        if (isComponent) {
            return computeTransferValue(
                _setToken.units[indexCurrent],
                _setToken.naturalUnit,
                _minimumBid,
                _auctionLibrary
            );
        }

        return 0;
    }

    /**
     * Calculates the maximum redemption quantity and redeems the Set into the vault.
     * Also updates remainingCurrentSets state variable
     *
     * @param _currentSet           Address of current Set
     * @param _coreAddress          Core address
     * @param _vaultAddress         Vault address
     * @return                      Amount of currentSets remaining
     */
    function redeemCurrentSet(
        address _currentSet,
        address _coreAddress,
        address _vaultAddress
    )
        public
        returns (uint256)
    {
        // Get remainingCurrentSets and make it divisible by currentSet natural unit
        uint256 currentSetBalance = IVault(_vaultAddress).getOwnerBalance(
            _currentSet,
            address(this)
        );

        // Calculates the set's natural unit
        uint256 currentSetNaturalUnit = ISetToken(_currentSet).naturalUnit();

        // Rounds the redemption quantity to a multiple of the current Set natural unit and sets variable
        uint256 remainingCurrentSets = currentSetBalance.div(currentSetNaturalUnit).mul(currentSetNaturalUnit);

        ICore(_coreAddress).redeemInVault(
            _currentSet,
            remainingCurrentSets
        );

        return remainingCurrentSets;
    }

   /**
     * Function to calculate the transfer value of a component given a standardized bid amount
     * (minimumBid/priceDivisor)
     *
     * @param   _unit           Units of the component token
     * @param   _naturalUnit    Natural unit of the Set token
     * @param   _minimumBid     Minimum bid amount
     * @return  uint256         Amount of tokens per standard bid amount (minimumBid/priceDivisor)
     */
    function computeTransferValue(
        uint256 _unit,
        uint256 _naturalUnit,
        uint256 _minimumBid,
        address _auctionLibrary
    )
        internal
        returns (uint256)
    {
        uint256 priceDivisor = IAuctionPriceCurve(_auctionLibrary).priceDivisor();
        return _minimumBid.mul(_unit).div(_naturalUnit).div(priceDivisor);
    }
}

// File: contracts/core/tokens/RebalancingSetToken.sol

/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;

















/**
 * @title RebalancingSetToken
 * @author Set Protocol
 *
 * Implementation of Rebalancing Set token.
 */
contract RebalancingSetToken is
    ERC20,
    ERC20Detailed
{
    using SafeMath for uint256;

    /* ============ State Variables ============ */

    // Dependency variables
    address public core;
    address public factory;
    address public vault;
    address public componentWhiteListAddress;

    // Core and Vault instances
    ICore private coreInstance;
    IVault private vaultInstance;
    IWhiteList private componentWhiteListInstance;

    uint256 public naturalUnit;
    address public manager;
    RebalancingLibrary.State public rebalanceState;

    // State updated after every rebalance
    address public currentSet;
    uint256 public unitShares;
    uint256 public lastRebalanceTimestamp;

    // State governing rebalance cycle
    uint256 public proposalPeriod;
    uint256 public rebalanceInterval;

    // State to track proposal period
    uint256 public proposalStartTime;

    // State needed for auction/rebalance
    address public nextSet;
    address public auctionLibrary;
    uint256 public startingCurrentSetAmount;
    RebalancingLibrary.AuctionPriceParameters public auctionPriceParameters;
    RebalancingLibrary.BiddingParameters public biddingParameters;

    // To be used if token put into Drawdown State
    address[] public failedAuctionWithdrawComponents;

    /* ============ Events ============ */

    event NewManagerAdded(
        address newManager,
        address oldManager
    );

    event RebalanceProposed(
        address nextSet,
        address indexed auctionLibrary,
        uint256 indexed proposalPeriodEndTime
    );

    event RebalanceStarted(
        address oldSet,
        address newSet
    );

    /* ============ Constructor ============ */

    /**
     * Constructor function for Rebalancing Set Token
     *
     * @param _factory                   Factory used to create the Rebalancing Set
     * @param _manager                   Manager of the Rebalancing Set
     * @param _initialSet                Initial set that collateralizes the Rebalancing set
     * @param _initialUnitShares         Units of currentSet that equals one share
     * @param _naturalUnit               The minimum multiple of Sets that can be issued or redeemed
     * @param _proposalPeriod            Amount of time for users to inspect a rebalance proposal
     * @param _rebalanceInterval         Minimum amount of time between rebalances
     * @param _componentWhiteList        Address of component WhiteList contract
     * @param _name                      The name of the new RebalancingSetToken
     * @param _symbol                    The symbol of the new RebalancingSetToken
     */

    constructor(
        address _factory,
        address _manager,
        address _initialSet,
        uint256 _initialUnitShares,
        uint256 _naturalUnit,
        uint256 _proposalPeriod,
        uint256 _rebalanceInterval,
        address _componentWhiteList,
        string memory _name,
        string memory _symbol
    )
        public
        ERC20Detailed(
            _name,
            _symbol,
            18
        )
    {
        // Require initial unit shares is non-zero
        require(
            _initialUnitShares > 0,
            "RebalancingSetToken.constructor: Unit shares must be positive"
        );

        IRebalancingSetFactory tokenFactory = IRebalancingSetFactory(_factory);

        require(
            _naturalUnit >= tokenFactory.minimumNaturalUnit(),
            "RebalancingSetToken.constructor: Natural Unit too low"
        );

        require(
            _naturalUnit <= tokenFactory.maximumNaturalUnit(),
            "RebalancingSetToken.constructor: Natural Unit too large"
        );

        // Require manager address is non-zero
        require(
            _manager != address(0),
            "RebalancingSetToken.constructor: Invalid manager address"
        );

        // Require minimum rebalance interval and proposal period from factory
        require(
            _proposalPeriod >= tokenFactory.minimumProposalPeriod(),
            "RebalancingSetToken.constructor: Proposal period too short"
        );
        require(
            _rebalanceInterval >= tokenFactory.minimumRebalanceInterval(),
            "RebalancingSetToken.constructor: Rebalance interval too short"
        );

        core = IRebalancingSetFactory(_factory).core();
        coreInstance = ICore(core);
        vault = coreInstance.vault();
        vaultInstance = IVault(vault);
        componentWhiteListAddress = _componentWhiteList;
        componentWhiteListInstance = IWhiteList(_componentWhiteList);
        factory = _factory;
        manager = _manager;
        currentSet = _initialSet;
        unitShares = _initialUnitShares;
        naturalUnit = _naturalUnit;

        proposalPeriod = _proposalPeriod;
        rebalanceInterval = _rebalanceInterval;
        lastRebalanceTimestamp = block.timestamp;
        rebalanceState = RebalancingLibrary.State.Default;
    }

    /* ============ Public Functions ============ */

    /**
     * Function used to set the terms of the next rebalance and start the proposal period
     *
     * @param _nextSet                      The Set to rebalance into
     * @param _auctionLibrary               The library used to calculate the Dutch Auction price
     * @param _auctionTimeToPivot           The amount of time for the auction to go ffrom start to pivot price
     * @param _auctionStartPrice            The price to start the auction at
     * @param _auctionPivotPrice            The price at which the price curve switches from linear to exponential
     */
    function propose(
        address _nextSet,
        address _auctionLibrary,
        uint256 _auctionTimeToPivot,
        uint256 _auctionStartPrice,
        uint256 _auctionPivotPrice
    )
        external
    {
        // Put together auction price parameters
        RebalancingLibrary.AuctionPriceParameters memory auctionPriceParams =
            RebalancingLibrary.AuctionPriceParameters({
                auctionTimeToPivot: _auctionTimeToPivot,
                auctionStartPrice: _auctionStartPrice,
                auctionPivotPrice: _auctionPivotPrice,
                auctionStartTime: 0
            });

        // Create ProposeAuctionParameters
        ProposeLibrary.ProposalContext memory proposalContext =
            ProposeLibrary.ProposalContext({
                manager: manager,
                currentSet: currentSet,
                coreAddress: core,
                componentWhitelist: componentWhiteListAddress,
                factoryAddress: factory,
                lastRebalanceTimestamp: lastRebalanceTimestamp,
                rebalanceInterval: rebalanceInterval,
                rebalanceState: uint8(rebalanceState)
            });

        // Validate proposal inputs and initialize auctionPriceParameters
        ProposeLibrary.validateProposal(
            _nextSet,
            _auctionLibrary,
            proposalContext,
            auctionPriceParams
        );

        // Update state parameters
        auctionPriceParameters = auctionPriceParams;
        nextSet = _nextSet;
        auctionLibrary = _auctionLibrary;
        proposalStartTime = block.timestamp;
        rebalanceState = RebalancingLibrary.State.Proposal;

        emit RebalanceProposed(
            _nextSet,
            _auctionLibrary,
            proposalStartTime.add(proposalPeriod)
        );
    }

    /*
     * Initiate rebalance for the rebalancing set if the proposal period has elapsed after
     * a proposal.
     */
    function startRebalance()
        external
    {
        // Validate the correct rebalance state and time elapsed
        StartRebalanceLibrary.validateStartRebalance(
            proposalStartTime,
            proposalPeriod,
            uint8(rebalanceState)
        );

        // Redeem currentSet and set up biddingParameters
        biddingParameters = StartRebalanceLibrary.redeemCurrentSetAndGetBiddingParameters(
            currentSet,
            nextSet,
            auctionLibrary,
            core,
            vault
        );

        // Update state parameters
        startingCurrentSetAmount = biddingParameters.remainingCurrentSets;
        auctionPriceParameters.auctionStartTime = block.timestamp;
        rebalanceState = RebalancingLibrary.State.Rebalance;

        emit RebalanceStarted(currentSet, nextSet);
    }

    /*
     * Initiate settlement for the rebalancing set. Full functionality now returned to
     * set owners
     *
     */
    function settleRebalance()
        external
    {
        // Settle the rebalance and mint next Sets
        unitShares = SettleRebalanceLibrary.settleRebalance(
            totalSupply(),
            biddingParameters.remainingCurrentSets,
            biddingParameters.minimumBid,
            naturalUnit,
            nextSet,
            core,
            vault,
            uint8(rebalanceState)
        );

        // Update other state parameters
        currentSet = nextSet;
        lastRebalanceTimestamp = block.timestamp;
        rebalanceState = RebalancingLibrary.State.Default;
        clearAuctionState();
    }

    /*
     * Place bid during rebalance auction. Can only be called by Core.
     *
     * @param _quantity                 The amount of currentSet to be rebalanced
     * @return combinedTokenArray       Array of token addresses invovled in rebalancing
     * @return inflowUnitArray          Array of amount of tokens inserted into system in bid
     * @return outflowUnitArray         Array of amount of tokens taken out of system in bid
     */
    function placeBid(
        uint256 _quantity
    )
        external
        returns (address[] memory, uint256[] memory, uint256[] memory)
    {
        // Validate bid quantity and module is sender
        PlaceBidLibrary.validatePlaceBid(
            _quantity,
            core,
            biddingParameters
        );

        // Place bid and get back inflow and outflow arrays
        uint256[] memory inflowUnitArray;
        uint256[] memory outflowUnitArray;
        (
            inflowUnitArray,
            outflowUnitArray
        ) = getBidPrice(_quantity);

        // Update remainingCurrentSet figure to account for placed bid
        biddingParameters.remainingCurrentSets = biddingParameters.remainingCurrentSets.sub(_quantity);

        return (biddingParameters.combinedTokenArray, inflowUnitArray, outflowUnitArray);
    }

    /*
     * Fail an auction that doesn't complete before reaching the pivot price. Move to Drawdown state
     * if bids have been placed. Reset to Default state if no bids placed.
     *
     */
    function endFailedAuction()
        external
    {
        uint256 calculatedUnitShares;
        (
            ,
            calculatedUnitShares
        ) = SettleRebalanceLibrary.calculateNextSetIssueQuantity(
            totalSupply(),
            naturalUnit,
            nextSet,
            vault
        );

        // Fail auction and either reset to Default state or kill Rebalancing Set Token and enter Drawdown
        // state
        uint8 integerRebalanceState = FailAuctionLibrary.endFailedAuction(
            startingCurrentSetAmount,
            calculatedUnitShares,
            currentSet,
            core,
            auctionPriceParameters,
            biddingParameters,
            uint8(rebalanceState)
        );
        rebalanceState = RebalancingLibrary.State(integerRebalanceState);

        // Reset lastRebalanceTimestamp to now
        lastRebalanceTimestamp = block.timestamp;

        // Save combined token arrays to failedAuctionWithdrawComponents
        failedAuctionWithdrawComponents = biddingParameters.combinedTokenArray;

        // Clear auction state
        clearAuctionState();
    }

    /*
     * Get token inflows and outflows required for bid. Also the amount of Rebalancing
     * Sets that would be generated.
     *
     * @param _quantity               The amount of currentSet to be rebalanced
     * @return inflowUnitArray        Array of amount of tokens inserted into system in bid
     * @return outflowUnitArray       Array of amount of tokens taken out of system in bid
     */
    function getBidPrice(
        uint256 _quantity
    )
        public
        view
        returns (uint256[] memory, uint256[] memory)
    {
        return PlaceBidLibrary.getBidPrice(
            _quantity,
            auctionLibrary,
            biddingParameters,
            auctionPriceParameters,
            uint8(rebalanceState)
        );
    }

    /*
     * Mint set token for given address.
     * Can only be called by Core contract.
     *
     * @param  _issuer      The address of the issuing account
     * @param  _quantity    The number of sets to attribute to issuer
     */
    function mint(
        address _issuer,
        uint256 _quantity
    )
        external
    {
        // Check that function caller is Core
        require(
            msg.sender == core,
            "RebalancingSetToken.mint: Sender must be core"
        );

        // Check that set is not in Rebalance State
        require(
            rebalanceState != RebalancingLibrary.State.Rebalance,
            "RebalancingSetToken.mint: Cannot mint during Rebalance"
        );

        // Check that set is not in Drawdown State
        require(
            rebalanceState != RebalancingLibrary.State.Drawdown,
            "RebalancingSetToken.mint: Cannot mint during Drawdown"
        );

        // Update token balance of the manager
        _mint(_issuer, _quantity);
    }

    /*
     * Burn set token for given address.
     * Can only be called by authorized contracts.
     *
     * @param  _from        The address of the redeeming account
     * @param  _quantity    The number of sets to burn from redeemer
     */
    function burn(
        address _from,
        uint256 _quantity
    )
        external
    {
        // Check that set is not in Rebalancing State
        require(
            rebalanceState != RebalancingLibrary.State.Rebalance,
            "RebalancingSetToken.burn: Cannot burn during Rebalance"
        );

        // Check to see if state is Drawdown
        if (rebalanceState == RebalancingLibrary.State.Drawdown) {
            // In Drawdown Sets can only be burned as part of the withdrawal process
            require(
                coreInstance.validModules(msg.sender),
                "RebalancingSetToken.burn: Set cannot be redeemed during Drawdown"
            );
        } else {
            // When in non-Rebalance or Drawdown state, check that function caller is Core
            // so that Sets can be redeemed
            require(
                msg.sender == core,
                "RebalancingSetToken.burn: Sender must be core"
            );
        }

        _burn(_from, _quantity);
    }

    /*
     * Set new manager address
     *
     * @param  _newManager       The address of the new manager account
     */
    function setManager(
        address _newManager
    )
        external
    {
        require(
            msg.sender == manager,
            "RebalancingSetToken.setManager: Sender must be the manager"
        );

        emit NewManagerAdded(_newManager, manager);
        manager = _newManager;
    }

    /* ============ Getter Functions ============ */

    /*
     * Get addresses of setToken underlying the Rebalancing Set
     *
     * @return  componentAddresses       Array of currentSet
     */
    function getComponents()
        external
        view
        returns (address[] memory)
    {
        address[] memory components = new address[](1);
        components[0] = currentSet;
        return components;
    }

    /*
     * Get unitShares of Rebalancing Set
     *
     * @return  units       Array of component unit
     */
    function getUnits()
        external
        view
        returns (uint256[] memory)
    {
        uint256[] memory units = new uint256[](1);
        units[0] = unitShares;
        return units;
    }

    /*
     * Get biddingParameters of Rebalancing Set
     *
     * @return  biddingParams       Object with bidding information
     */
    function getBiddingParameters()
        external
        view
        returns (uint256[] memory)
    {
        uint256[] memory biddingParams = new uint256[](2);
        biddingParams[0] = biddingParameters.minimumBid;
        biddingParams[1] = biddingParameters.remainingCurrentSets;
        return biddingParams;
    }

    /*
     * Get auctionPriceParameters of Rebalancing Set
     *
     * @return  auctionParams       Object with auction information
     */
    function getAuctionPriceParameters()
        external
        view
        returns (uint256[] memory)
    {
        uint256[] memory auctionParams = new uint256[](4);
        auctionParams[0] = auctionPriceParameters.auctionStartTime;
        auctionParams[1] = auctionPriceParameters.auctionTimeToPivot;
        auctionParams[2] = auctionPriceParameters.auctionStartPrice;
        auctionParams[3] = auctionPriceParameters.auctionPivotPrice;
        return auctionParams;
    }

    /*
     * Checks to make sure address is the current set of the RebalancingSetToken.
     * Conforms to the ISetToken Interface.
     *
     * @param  _tokenAddress     Address of token being checked
     * @return  bool             True if token is the current Set
     */
    function tokenIsComponent(
        address _tokenAddress
    )
        external
        view
        returns (bool)
    {
        return _tokenAddress == currentSet;
    }

    /*
     * Get combinedTokenArray of Rebalancing Set
     *
     * @return  combinedTokenArray
     */
    function getCombinedTokenArrayLength()
        external
        view
        returns (uint256)
    {
        return biddingParameters.combinedTokenArray.length;
    }

    /*
     * Get combinedTokenArray of Rebalancing Set
     *
     * @return  combinedTokenArray
     */
    function getCombinedTokenArray()
        external
        view
        returns (address[] memory)
    {
        return biddingParameters.combinedTokenArray;
    }

    /*
     * Get combinedCurrentUnits of Rebalancing Set
     *
     * @return  combinedCurrentUnits
     */
    function getCombinedCurrentUnits()
        external
        view
        returns (uint256[] memory)
    {
        return biddingParameters.combinedCurrentUnits;
    }

    /*
     * Get combinedNextSetUnits of Rebalancing Set
     *
     * @return  combinedNextSetUnits
     */
    function getCombinedNextSetUnits()
        external
        view
        returns (uint256[] memory)
    {
        return biddingParameters.combinedNextSetUnits;
    }

    /*
     * Get failedAuctionWithdrawComponents of Rebalancing Set
     *
     * @return  failedAuctionWithdrawComponents
     */
    function getFailedAuctionWithdrawComponents()
        external
        view
        returns (address[] memory)
    {
        return failedAuctionWithdrawComponents;
    }

    /* ============ Internal Functions ============ */

    /*
     * Reset auction specific state after failed or successful rebalance
     */
    function clearAuctionState()
        internal
    {
        nextSet = address(0);
        auctionLibrary = address(0);
        startingCurrentSetAmount = 0;
        delete auctionPriceParameters;
        delete biddingParameters;
    }
}
