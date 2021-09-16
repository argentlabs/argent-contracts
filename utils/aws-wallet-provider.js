const ProviderEngine = require("@trufflesuite/web3-provider-engine");
const FiltersSubprovider = require("@trufflesuite/web3-provider-engine/subproviders/filters.js");
const HookedWalletEthTxSubprovider = require("@trufflesuite/web3-provider-engine/subproviders/hooked-wallet-ethtx.js");
const ProviderSubprovider = require("@trufflesuite/web3-provider-engine/subproviders/provider.js");

const Web3 = require("web3");
const AWS = require("aws-sdk");
const ethereumjsWallet = require("ethereumjs-wallet").default;

const kms = new AWS.KMS();
const s3 = new AWS.S3();

function AWSWalletProvider(providerUrl, s3Bucket, s3Key) {
  this.wallet = null;
  this.address = null;

  const self = this;

  this.engine = new ProviderEngine();

  this.engine.addProvider(new HookedWalletEthTxSubprovider({
    getAccounts(cb) {
      if (self.address) { return cb(null, [self.address]); }
      return s3.getObject({ Bucket: s3Bucket, Key: s3Key }, (error, object) => {
        if (error) { return cb(error); }
        return kms.decrypt({ CiphertextBlob: object.Body }, (err, data) => {
          if (err) { return cb(err); }
          const pkey = data.Plaintext.toString("utf8");
          self.wallet = ethereumjsWallet.fromPrivateKey(Buffer.from(pkey, "hex"));
          self.address = `0x${self.wallet.getAddress().toString("hex")}`;
          return cb(null, [self.address]);
        });
      });
    },
    getPrivateKey(address, cb) {
      if (self.address === address) {
        cb(null, self.wallet.getPrivateKey());
      } else { cb("Account not found"); }
    }
  }));

  this.engine.addProvider(new FiltersSubprovider());

  // this.engine.addProvider(new InfuraSubprovider({ network: "ropsten" }));
  // Required to not get 'specified provider does not have a sendAsync method' for HttpProvider
  Web3.providers.HttpProvider.prototype.sendAsync = Web3.providers.HttpProvider.prototype.send;
  this.engine.addProvider(new ProviderSubprovider(new Web3.providers.HttpProvider(providerUrl)));

  this.engine.start(); // Required by the provider engine.
}

AWSWalletProvider.prototype.sendAsync = function sendAsync(...args) {
  this.engine.sendAsync(...args);
};

AWSWalletProvider.prototype.send = function send(...args) {
  return this.engine.send(...args);
};

module.exports = AWSWalletProvider;
