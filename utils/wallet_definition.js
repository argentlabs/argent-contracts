const ethers = require("ethers");

const Registry = artifacts.require("Registry");
const ApprovedTransfer = artifacts.require("ApprovedTransfer");
const CompoundManager = artifacts.require("CompoundManager");
const GuardianManager = artifacts.require("GuardianManager");
const LockManager = artifacts.require("LockManager");
const NftTransfer = artifacts.require("NftTransfer");
const RecoveryManager = artifacts.require("RecoveryManager");
const TokenExchanger = artifacts.require("TokenExchanger");
//const TransferManager = artifacts.require("TransferManager");

const deployManager = require("../utils/deploy-manager.js");

module.exports = {
  // Creates a new Registry contract and registers all IWallet interface function to their respective module implementations
  async setupWalletVersion(
    {
      tokenPriceRegistry = ethers.constants.AddressZero,
      wethToken = ethers.constants.AddressZero,
      comptroller = ethers.constants.AddressZero,
      compoundRegistry = ethers.constants.AddressZero,
      ckAddress = ethers.constants.AddressZero,
      dexRegistry = ethers.constants.AddressZero,
      paraswap = ethers.constants.AddressZero
    }) {
    const { configurator } = await deployManager.getProps();
    const { config } = configurator;

    // Setup the wallet version registry
    const registry = await Registry.new(
      tokenPriceRegistry,
      wethToken,
      comptroller,
      compoundRegistry,
      ckAddress,
      dexRegistry,
      paraswap,
      "argent",
      config.settings.lockPeriod,
      config.settings.recoveryPeriod,
      config.settings.securityPeriod,
      config.settings.securityWindow,
      config.settings.defaultLimit);

    // Setup the wallet modules
    const approvedTransfer = await ApprovedTransfer.new();
    const compoundManager = await CompoundManager.new();
    const guardianManager = await GuardianManager.new();
    const lockManager = await LockManager.new();
    const nftTransfer = await NftTransfer.new();
    const recoveryManager = await RecoveryManager.new();
    const tokenExchanger = await TokenExchanger.new();
    // const transferManager = await TransferManager.new();

    // IWallet inherits interfaces implemented in modules below
    const modules = [
      approvedTransfer,
      compoundManager,
      guardianManager,
      lockManager,
      nftTransfer,
      recoveryManager,
      tokenExchanger,
      // transferManager,
    ];

    modules.forEach((module) => {
      const functions = module.abi.filter((functionDefinition) => functionDefinition.type === "function");
    
      functions.forEach(async (functionDefinition) => {
        console.log("name", functionDefinition.name)
        const signature = web3.eth.abi.encodeFunctionSignature(functionDefinition);
        await registry.register(signature, module.address);
      });
    });

    return registry;
  }
}