const TokenPriceProvider = require("../build/TokenPriceProvider");
const WalletFactory = require("../build/WalletFactory");
const ApprovedTransfer = require("../build/ApprovedTransfer");
const CompoundManager = require("../build/CompoundManager");
const GuardianManager = require("../build/GuardianManager");
const LockManager = require("../build/LockManager");
const NftTransfer = require("../build/NftTransfer");
const RecoveryManager = require("../build/RecoveryManager");
const TokenExchanger = require("../build/TokenExchanger");
const TransferManager = require("../build/TransferManager");

const ethers = require("ethers");
const fs = require("fs");

[
  TokenPriceProvider,
  // WalletFactory,
  // ApprovedTransfer,
  // CompoundManager,
  // GuardianManager,
  // LockManager,
  // NftTransfer,
  // RecoveryManager,
  // TokenExchanger,
  // TransferManager
].forEach((contract) => {
  // Use ethers.js Interface object :
  // https://docs.ethers.io/ethers.js/html/api-advanced.html#interface
  const contractInterface = new ethers.utils.Interface(contract.abi);

  contractInterface.interface.functions
  .filter(functionDefinition => functionDefinition.type === "transaction")
  .forEach(functionDefinition => {
    console.log(contract.contractName);
    console.log(functionDefinition);
  });
});