const ethers = require("ethers");
const fs = require("fs");
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


const contracts = [
  TokenPriceProvider,
  WalletFactory,
  ApprovedTransfer,
  CompoundManager,
  GuardianManager,
  LockManager,
  NftTransfer,
  RecoveryManager,
  TokenExchanger,
  TransferManager,
];

const jsonOutput = [];

// Use ethers.js Interface object :
// https://docs.ethers.io/ethers.js/html/api-advanced.html#interface
contracts.forEach((contract) => {
  // Contract interface object is richer in information hydrated by ethers, sample entry:
  // _FunctionDescription {
  //   inputs: [ { name: '_manager', type: 'address' } ],
  //   outputs: [],
  //   gas: undefined,
  //   payable: false,
  //   type: 'transaction',
  //   name: 'addManager',
  //   signature: 'addManager(address)',
  //   sighash: '0x2d06177a' }
  const contractInterface = new ethers.utils.Interface(contract.abi);
  // Filters out from contract.abi functions, sample entry
  // { constant: false,
  //   inputs: [ { name: '_manager', type: 'address' } ],
  //   name: 'addManager',
  //   outputs: [],
  //   payable: false,
  //   stateMutability: 'nonpayable',
  //   type: 'function' }
  const functions = contract.abi.filter((functionDefinition) => functionDefinition.type === "function");
  const nonStaticFunctions = functions.filter((functionDefinition) => functionDefinition.constant === false);

  nonStaticFunctions.forEach((functionDefinition) => {
    const entry = {
      contract: contract.contractName,
      name: functionDefinition.name,
      signature: contractInterface.functions[functionDefinition.name].signature,
      sighash: contractInterface.functions[functionDefinition.name].sighash,
      gasLimit: contractInterface.functions[functionDefinition.name].gas,
    };
    jsonOutput.push(entry);
  });
});

fs.writeFileSync("eth_relayTransaction.json", JSON.stringify(jsonOutput, null, 2));
