// ///////////////////////////////////////////////////////////////////
// Script to deploy a new ArgentWalletDectector.
//
// To deploy a new ArgentWalletDectector:
// ./execute_script.sh deploy_wallet_detector.js <network>
//
// where:
//    - network = [test, staging, prod]
// ////////////////////////////////////////////////////////////////////

/* global artifacts */
const ArgentWalletDetector = artifacts.require("ArgentWalletDetector");

const { configurator, abiUploader } = require("deploy-manager.js");

const PROXYWALLET_CODEHASH = [
  "0x0b44c9be520023d9f6091278e7e5a8853257eb9fb3d78e6951315df59679e3b2", // factory prod Mar-30-2020
  "0x83baa4b265772664a88dcfc8be0e24e1fe969a3c66f03851c6aa2f5da73cd7fd", // factory prod Feb-04-2019
];

const BASEWALLET_IMPL = [
  "0xb1dd690cc9af7bb1a906a9b5a94f94191cc553ce", // prod Feb-04-2019
  "0xb6d64221451edbac7736d4c3da7fc827457dec03", // prod Mar-30-2020
  "0x8cbe893fb3372e3ce1e63ad0262b2a544fa1fb9c", // staging Jan-24-2019
  "0x609282d2d8f9ba4bb87ac9c38de20ed5de86596b", // staging Dec-06-2019
  "0xb11da8fbd8126f4f66c093070ecb8316734a7130", // staging Mar-10-2020
]; // mainnet only

async function main() {
  const { config } = configurator;

  // Deploy ArgentWalletDetector contract
  console.log("Deploying ArgentWalletDetector...");
  const ArgentWalletDetectortWrapper = await ArgentWalletDetector.new(PROXYWALLET_CODEHASH, BASEWALLET_IMPL);

  // Transfer ownership to the multisig
  console.log("Transferring ownership to the Multisig...");
  await ArgentWalletDetectortWrapper.changeOwner(config.contracts.MultiSigWallet);

  // Update config
  configurator.updateInfrastructureAddresses({
    ArgentWalletDetector: ArgentWalletDetectortWrapper.contractAddress,
  });
  await configurator.save();

  // Upload ABI
  await Promise.all([
    abiUploader.upload(ArgentWalletDetectortWrapper, "contracts"),
  ]);
}

main().catch((err) => {
  throw err;
});

// contract deployed to prod at 0xeca4B0bDBf7c55E9b7925919d03CbF8Dc82537E8
