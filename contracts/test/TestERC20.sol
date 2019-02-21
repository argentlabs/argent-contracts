pragma solidity ^0.5.4;

/**
 * ERC20 contract interface.
 */
contract ERC20 {
    function totalSupply() public view returns (uint);
    function balanceOf(address tokenOwner) public view returns (uint balance);
    function allowance(address tokenOwner, address spender) public view returns (uint remaining);
    function transfer(address to, uint tokens) public returns (bool success);
    function approve(address spender, uint tokens) public returns (bool success);
    function transferFrom(address from, address to, uint tokens) public returns (bool success);

    event Transfer(address indexed from, address indexed to, uint tokens);
    event Approval(address indexed tokenOwner, address indexed spender, uint tokens);
}

/**
 * ERC20 test contract.
 */
contract TestERC20 is ERC20 {

    string constant public symbol = "AGT";
    string constant public name = "ArgentToken";
    uint8 public decimals;
    uint internal _totalSupply;

    mapping(address => uint) balances;
    mapping(address => mapping(address => uint)) allowed;

    constructor(address[] memory _owners, uint _supply, uint8 _decimals) public {
        decimals = _decimals;
        for(uint i = 0; i < _owners.length; i++) {
            balances[_owners[i]] = _supply * 10**uint(_decimals);
        }
        _totalSupply = _owners.length * _supply * 10**uint(_decimals);
    }

    function totalSupply() public view returns (uint) {
        return _totalSupply  - balances[address(0)];
    }

    function balanceOf(address tokenOwner) public view returns (uint balance) {
        return balances[tokenOwner];
    }

    function transfer(address to, uint tokens) public returns (bool success) {
        require(balances[msg.sender] >= tokens);
        balances[msg.sender] = balances[msg.sender] - tokens;
        balances[to] = balances[to] + tokens;
        require(balances[to] + tokens > balances[to]);
        emit Transfer(msg.sender, to, tokens);
        return true;
    }

    function approve(address spender, uint tokens) public returns (bool success) {
        allowed[msg.sender][spender] = tokens;
        emit Approval(msg.sender, spender, tokens);
        return true;
    }

    function transferFrom(address from, address to, uint tokens) public returns (bool success) {
        require(balances[from] >= tokens);
        balances[from] = balances[from] - tokens;
        require(allowed[from][msg.sender] >= tokens);
        allowed[from][msg.sender] = allowed[from][msg.sender] - tokens;
        balances[to] = balances[to] + tokens;
        require(balances[to] + tokens > balances[to]);
        emit Transfer(from, to, tokens);
        return true;
    }

    function allowance(address tokenOwner, address spender) public view returns (uint remaining) {
        return allowed[tokenOwner][spender];
    }

    function () external payable {
        revert();
    }
}
