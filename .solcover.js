// ganache-cli \
//  --chainId 1895 \ (core-option: _chainId)
//  --networkId 1597649375983 \ (core-option: network_id)
//  --gasLimit=20700000 \ (solidity-coverage sets this)
//  -e 10000 \ (default_balance_ether)
//  --acctKeys=\"./ganache-accounts.json\" (core-option: accounts)
//  --deterministic", (maybe hd_path?)

const ganacheAccounts = require('./ganache-accounts.json');
let accounts = [];

for (address of Object.keys(ganacheAccounts.private_keys)){
  accounts.push({
    privateKey: ganacheAccounts.private_keys[address],
    balance: ganacheAccounts.addresses[address].account.balance
  })
}

module.exports = {
  client: require('ganache-cli'),
  skipFiles: ['Migrations.sol'],
  providerOptions: {
    accounts: accounts,
    _chainId: 1895,
    network_id: 1597649375983
  }
};