/* global artifacts */
global.web3 = web3;
global.artifacts = artifacts;

const TruffleContract = require("@truffle/contract");

const ENSManager = artifacts.require("ArgentENSManager");
const ENSResolver = artifacts.require("ArgentENSResolver");
const MultiSig = artifacts.require("MultiSigWallet");
const WalletFactory16Contract = require("../build-legacy/v1.6.0/WalletFactory");

const WalletFactory16 = TruffleContract(WalletFactory16Contract);

const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");
const utils = require("../utils/utilities.js");

async function main() {
  // //////////////////////////////////
  // Setup
  // //////////////////////////////////
  const { deploymentAccount, configurator, abiUploader } = await deployManager.getProps();
  const { config } = configurator;
  const { domain } = config.ENS;

  WalletFactory16.setProvider(web3.currentProvider);

  const walletFactory16Wrapper = await WalletFactory16.at(config.contracts.WalletFactory16);

  // Instantiate the ENS Registry and existing ENSManager
  const ENSManagerWrapper = await ENSManager.at(config.contracts.ENSManager);
  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const ENSResolverWrapper = await ENSResolver.at(config.contracts.ENSResolver);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);

  // //////////////////////////////////
  // Deploy new contracts
  // //////////////////////////////////

  // Deploy the updated ENSManager
  const NewENSManagerWrapper = await ENSManager.new(domain, utils.namehash(domain), config.ENS.ensRegistry, config.contracts.ENSResolver);

  // //////////////////////////////////
  // Configure ENS
  // //////////////////////////////////

  // Set the backend accounts as a manager of the new ENSManager
  for (const idx in config.backend.accounts) {
    const account = config.backend.accounts[idx];
    console.log(`Set ${account} as the manager of the new ENSManager`);
    await NewENSManagerWrapper.addManager(account);
  }

  // The legacy factory has to be a manager of the new ENSManager as it calls it's register function for new wallets
  await NewENSManagerWrapper.addManager(walletFactory16Wrapper.address);

  await multisigExecutor.executeCall(walletFactory16Wrapper, "changeENSManager", [NewENSManagerWrapper.address]);
  console.log(`EnsManager on legacy wallet factory changed to ${NewENSManagerWrapper.address}`);

  // Set the MultiSig as the owner of the new ENSManager
  await NewENSManagerWrapper.changeOwner(config.contracts.MultiSigWallet);

  // Decomission old ENSManager
  await multisigExecutor.executeCall(ENSManagerWrapper, "changeRootnodeOwner", ["0x0000000000000000000000000000000000000000"]);
  console.log(`Owner of ${domain} changed from from old ENSManager to 0x0000000000000000000000000000000000000000`);

  // Set new ENSManager as a manager of ENSResolver
  await multisigExecutor.executeCall(ENSResolverWrapper, "addManager", [NewENSManagerWrapper.address]);

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////

  configurator.updateInfrastructureAddresses({
    ENSManager: NewENSManagerWrapper.address
  });
  await configurator.save();

  await Promise.all([
    abiUploader.upload(NewENSManagerWrapper, "contracts")
  ]);
}

// For truffle exec
module.exports = function (callback) {
  main().then(() => callback()).catch((err) => callback(err));
};
