// Usage: ./execute.sh --no-compile deploy_wallet_detector.js staging
const ethers = require("ethers");
const ArgentWalletDetector = require("../build/ArgentWalletDetector");
const DeployManager = require("../utils/deploy-manager.js");

const defaultNetwork = "test";

const MULTISIG = "0xa5c603e1C27a96171487aea0649b01c56248d2e8";

const PROXYWALLET_CODEHASH = [
  '0x0b44c9be520023d9f6091278e7e5a8853257eb9fb3d78e6951315df59679e3b2', // factory prod Mar-30-2020
  '0x83baa4b265772664a88dcfc8be0e24e1fe969a3c66f03851c6aa2f5da73cd7fd', // factory prod Feb-04-2019
];

const BASEWALLET_IMPL = [
  '0xb1dd690cc9af7bb1a906a9b5a94f94191cc553ce', // prod Feb-04-2019
  '0xb6d64221451edbac7736d4c3da7fc827457dec03', // prod Mar-30-2020
  '0x8cbe893fb3372e3ce1e63ad0262b2a544fa1fb9c', // staging Jan-24-2019
  '0x609282d2d8f9ba4bb87ac9c38de20ed5de86596b', // staging Dec-06-2019
  '0xb11da8fbd8126f4f66c093070ecb8316734a7130', // staging Mar-10-2020
]; // mainnet only

async function main() {
  // Read Command Line Arguments
  const idx = process.argv.indexOf("--network");
  const network = idx > -1 ? process.argv[idx + 1] : defaultNetwork;

  const deployManager = new DeployManager(network);
  await deployManager.setup();
  const { deployer } = deployManager;

  // Deploy ArgentWalletDetector contract
  console.log("Deploying ArgentWalletDetector...");
  const ArgentWalletDetectortWrapper = await deployer.deploy(ArgentWalletDetector, {}, PROXYWALLET_CODEHASH, BASEWALLET_IMPL);

  // Transfer ownership to the multisig
  console.log("Transferring ownership to the Multisig...");
  await ArgentWalletDetectortWrapper.changeOwner(MULTISIG);
}

main().catch((err) => {
  throw err;
});

// contract deployed to prod at 0xeca4B0bDBf7c55E9b7925919d03CbF8Dc82537E8
