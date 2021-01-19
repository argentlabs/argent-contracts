const ethers = require("ethers");

const IWallet = artifacts.require("IWallet");
const Registry = artifacts.require("Registry");
const ApprovedTransfer = artifacts.require("ApprovedTransfer");
const CompoundManager = artifacts.require("CompoundManager");
const GuardianManager = artifacts.require("GuardianManager");
const LockManager = artifacts.require("LockManager");
const NftTransfer = artifacts.require("NftTransfer");
const RecoveryManager = artifacts.require("RecoveryManager");
const RelayerManager = artifacts.require("RelayerManager");
const TokenExchanger = artifacts.require("TokenExchanger");
const TransferManager = artifacts.require("TransferManager");

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
    const relayerManager = await RelayerManager.new();
    const tokenExchanger = await TokenExchanger.new();
    const transferManager = await TransferManager.new();

    // IWallet inherits interfaces implemented in modules below
    const modules = [
      //approvedTransfer,
      compoundManager,
      guardianManager,
      lockManager,
      nftTransfer,
      recoveryManager,
      relayerManager,
      tokenExchanger,
      transferManager,
    ];

    // Build a set of function which require no signatures for relaying
    const CONFIRM_ADDITION = web3.eth.abi.encodeFunctionSignature("confirmGuardianAddition(address)");
    const CONFIRM_REVOKATION = web3.eth.abi.encodeFunctionSignature("confirmGuardianRevokation(address)");    
    const FINALIZE_RECOVERY = web3.eth.abi.encodeFunctionSignature("finalizeRecovery()");
    const functionsNoSignature = [CONFIRM_ADDITION, CONFIRM_REVOKATION, FINALIZE_RECOVERY];

    const EXECUTE_RECOVERY = web3.eth.abi.encodeFunctionSignature("executeRecovery(address)");
    const CANCEL_RECOVERY = web3.eth.abi.encodeFunctionSignature("cancelRecovery()");
    const TRANSFER_OWNERSHIP = web3.eth.abi.encodeFunctionSignature("transferOwnership(address)");

    // TODO add maker component registration and upgrade logic

    const walletFunctions = IWallet.abi.filter((functionDefinition) => functionDefinition.type === "function");
    const walletFunctionSigs = walletFunctions.map(fn => web3.eth.abi.encodeFunctionSignature(fn));

    modules.forEach((module) => {
      const functions = module.abi.filter((functionDefinition) => functionDefinition.type === "function");

      let ownerSignatureRequirement;
      let guardianSignatureRequirement;

      // Filter out only IWallet functions
      functions.forEach(async (functionDefinition) => {
        const signature = web3.eth.abi.encodeFunctionSignature(functionDefinition);
        // Register the function if it's part of the IWallet interface
        if (walletFunctionSigs.includes(signature)) {

        console.log("functionDefinition", functionDefinition.name)
          // If the function is one which requires no signatures, set it
          if (functionsNoSignature.includes(signature) || functionDefinition.stateMutability == "view" || functionDefinition.stateMutability == "pure") {
            ownerSignatureRequirement = 0; // OwnerSignature.None
            guardianSignatureRequirement = 0; // GuardianSignature.None
          } else if (signature == EXECUTE_RECOVERY) {
            ownerSignatureRequirement = 3; // OwnerSignature.Disallowed
            guardianSignatureRequirement = 2; // GuardianSignature.Majority
          } else if (signature == CANCEL_RECOVERY) {
            ownerSignatureRequirement = 2; // OwnerSignature.Optional
            guardianSignatureRequirement = 3; // GuardianSignature.MajorityIncOwner
          } else if (signature == TRANSFER_OWNERSHIP) {
            ownerSignatureRequirement = 1; //OwnerSignature.Required
            guardianSignatureRequirement = 2; // GuardianSignature.Majority
          } else {
            switch (module.constructor.contractName) {
              case "ApprovedTransfer":
                ownerSignatureRequirement = 1; // OwnerSignature.Required
                guardianSignatureRequirement = 2; // GuardianSignature.Majority
                break;
      
              case "LockManager":
                ownerSignatureRequirement = 3; // OwnerSignature.Disallowed
                guardianSignatureRequirement = 1; // GuardianSignature.One
                break;
              
              case "CompoundManager":
              case "GuardianManager":
              case "NftTransfer":
              case "TokenExchanger":
              case "TransferManager":
                ownerSignatureRequirement = 1; // OwnerSignature.Required
                guardianSignatureRequirement = 0; // GuardianSignature.None
                break;
        
              default:
                // We exclude recovery manager here as it has different signature requirements per function
                break;
            }
          }
  
          console.log(ownerSignatureRequirement)
          console.log(guardianSignatureRequirement)
          await registry.register(signature, module.address, ownerSignatureRequirement, guardianSignatureRequirement);  
        }
      });
    });

    return { registry, relayerManager, transferManager };
  }
}