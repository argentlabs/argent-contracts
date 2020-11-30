module.exports = {
  client: require('ganache-cli'),
  skipFiles: [
    "../contracts-test",
    "../contracts-legacy",
    "../lib"
  ],
  providerOptions: {
    port: 8555,
    _chainId: 1895,
    network_id: 1597649375983,
    account_keys_path: "./ganache-accounts.json",
    default_balance_ether: 10000
  }
};