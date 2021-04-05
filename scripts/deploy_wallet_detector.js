// ///////////////////////////////////////////////////////////////////
// Script to deploy a new ArgentWalletDectector.
//
// To deploy a new ArgentWalletDectector:
// bash ./scripts/execute_script.sh --no-compile scripts/deploy_wallet_detector.js <network>
//
// where:
//    - network = [test, staging, prod]
// ////////////////////////////////////////////////////////////////////

/* global artifacts */
global.web3 = web3;
const ArgentWalletDetector = artifacts.require("ArgentWalletDetector");

const deployManager = require("../utils/deploy-manager.js");

const PROXYWALLET_CODEHASH = [
  "0x0b44c9be520023d9f6091278e7e5a8853257eb9fb3d78e6951315df59679e3b2", // factory prod Mar-30-2020
  "0x83baa4b265772664a88dcfc8be0e24e1fe969a3c66f03851c6aa2f5da73cd7fd", // factory prod Feb-04-2019
];

async function main() {
  const { network, configurator, abiUploader } = await deployManager.getProps();
  const { config } = configurator;

  let BASEWALLET_IMPL;
  if (network === "test") {
    BASEWALLET_IMPL = [
      "0xA1832B5D79bdbbA645Fd6969275Ee1c6CF503E99",
      "0x1C26ef883464e265F3bcaE751Dab5D855F458b25",
      "0xB6E572129e4E749552dB93EB996BD9655fB758B1",
      "0xdC1378831cd5244FafcE5783187334122cFA7f35",
      "0xd35fB09F16Ad78f6238bF28D7ffCA1AC4b72Df69"
    ];
  } else {
    BASEWALLET_IMPL = [
      "0xb1dd690cc9af7bb1a906a9b5a94f94191cc553ce", // prod Feb-04-2019
      "0xb6d64221451edbac7736d4c3da7fc827457dec03", // prod Mar-30-2020
      "0x8cbe893fb3372e3ce1e63ad0262b2a544fa1fb9c", // staging Jan-24-2019
      "0x609282d2d8f9ba4bb87ac9c38de20ed5de86596b", // staging Dec-06-2019
      "0xb11da8fbd8126f4f66c093070ecb8316734a7130", // staging Mar-10-2020
    ]; // mainnet only used both for staging and prod
  }

  // Deploy ArgentWalletDetector contract
  console.log("Deploying ArgentWalletDetector...");
  const ArgentWalletDetectorWrapper = await ArgentWalletDetector.new(PROXYWALLET_CODEHASH, BASEWALLET_IMPL);

  // Transfer ownership to the multisig
  console.log("Transferring ownership to the Multisig...");
  await ArgentWalletDetectorWrapper.changeOwner(config.contracts.MultiSigWallet);

  // Update config
  configurator.updateInfrastructureAddresses({
    ArgentWalletDetector: ArgentWalletDetectorWrapper.contractAddress,
  });
  await configurator.save();

  // Upload ABI
  await Promise.all([
    abiUploader.upload(ArgentWalletDetectorWrapper, "contracts"),
  ]);
}

module.exports = (cb) => main().then(cb).catch(cb);

// contract deployed to prod at 0xeca4B0bDBf7c55E9b7925919d03CbF8Dc82537E8
