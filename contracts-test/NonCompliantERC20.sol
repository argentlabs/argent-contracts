// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.3;

/**
 * NonCompliantERC20 test contract.
 * Ref: https://medium.com/coinmonks/missing-return-value-bug-at-least-130-tokens-affected-d67bf08521ca
 * https://medium.com/coinmonks/missing-return-value-bug-at-least-130-tokens-affected-d67bf08521ca
 * This contract is modelled as a basic version of the OMG token 0xd26114cd6EE289AccF82350c8d8487fedB8A0C07
 * which is probably the more popular token example of the non-ERC20 compliant token problem described above.
 */

contract BasicToken {

    mapping(address => uint) balances;

    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);


    /**
    * @notice Fix for the ERC20 short address attack.
    */
    modifier onlyPayloadSize(uint size) {
        if (msg.data.length < size + 4) {
            revert("throw");
        }
        _;
    }

    /**
    * @notice transfer token for a specified address
    * @param _to The address to transfer to.
    * @param _value The amount to be transferred.
    */
    function transfer(address _to, uint _value) public onlyPayloadSize(2 * 32) {
        balances[msg.sender] = balances[msg.sender] - _value;
        balances[_to] = balances[_to] + _value;
        emit Transfer(msg.sender, _to, _value);
    }

    /**
    * @notice Gets the balance of the specified address.
    * @param _owner The address to query the the balance of.
    * @return balance An uint representing the amount owned by the passed address.
    */
    function balanceOf(address _owner) public view returns (uint balance) {
        return balances[_owner];
    }
}

contract StandardToken is BasicToken {
    mapping (address => mapping (address => uint)) allowed;

    /**
    * @notice Transfer tokens from one address to another
    * @param _from address The address which you want to send tokens from
    * @param _to address The address which you want to transfer to
    * @param _value uint the amout of tokens to be transfered
    */
    function transferFrom(address _from, address _to, uint _value) public onlyPayloadSize(3 * 32) {
        uint _allowance = allowed[_from][msg.sender];

        // Check is not needed because (_allowance - _value) will already throw if this condition is not met
        // if (_value > _allowance) throw;

        balances[_to] = balances[_to] + _value;
        balances[_from] = balances[_from] - _value;
        allowed[_from][msg.sender] = _allowance - _value;
        emit Transfer(_from, _to, _value);
    }

    /**
    * @notice Aprove the passed address to spend the specified amount of tokens on beahlf of msg.sender.
    * @param _spender The address which will spend the funds.
    * @param _value The amount of tokens to be spent.
    */
    function approve(address _spender, uint _value) public {
        // To change the approve amount you first have to reduce the addresses`
        //  allowance to zero by calling `approve(_spender, 0)` if it is not
        //  already 0 to mitigate the race condition described here:
        //  https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
        if ((_value != 0) && (allowed[msg.sender][_spender] != 0)) {
            revert("throw");
        }

        allowed[msg.sender][_spender] = _value;
        emit Approval(msg.sender, _spender, _value);
    }

    /**
    * @notice Function to check the amount of tokens than an owner allowed to a spender.
    * @param _owner address The address which owns the funds.
    * @param _spender address The address which will spend the funds.
    * @return remaining A uint specifing the amount of tokens still avaible for the spender.
    */
    function allowance(address _owner, address _spender) public view returns (uint remaining) {
        return allowed[_owner][_spender];
    }

}

contract MintableToken is StandardToken {
    event Mint(address indexed to, uint value);
    event MintFinished();

    bool public mintingFinished = false;
    uint public totalSupply = 0;

    modifier canMint() {
        if (mintingFinished) {
            revert("throw");
        }
        _;
    }

    /**
    * @notice Function to mint tokens
    * @param _to The address that will recieve the minted tokens.
    * @param _amount The amount of tokens to mint.
    * @return A boolean that indicates if the operation was successful.
    */
    function mint(address _to, uint _amount) public canMint returns (bool) {
        totalSupply = totalSupply + _amount;
        balances[_to] = balances[_to] + _amount;
        emit Mint(_to, _amount);
        return true;
    }

    /**
    * @notice Function to stop minting new tokens.
    * @return True if the operation was successful.
    */
    function finishMinting() public returns (bool) {
        mintingFinished = true;
        emit MintFinished();
        return true;
    }
}

contract NonCompliantERC20 is MintableToken {

}