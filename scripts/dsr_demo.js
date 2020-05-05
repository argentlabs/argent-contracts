// Example Usage:
// node scripts/dsr_demo.js [--stake 10.0] [--unstake 5.0] [--unstake-all] [--network kovan] [--wallet 0x62Da0Aca40650CB06361288FD0248Ad4eaB1d652]
const { parseEther, formatEther } = require("ethers").utils;

const DeployManager = require("../utils/deploy-manager.js");
const MakerV2Manager = require("../build/MakerV2Manager");
const DSToken = require("../build/DSToken");

const defaultWalletAddress = "0x779B2D281238993fD7276F2E13fA82db27AE72d9";
const defaultNetwork = "kovan";

async function main() {
  // Read Command Line Arguments
  let idx = process.argv.indexOf("--network");
  const network = idx > -1 ? process.argv[idx + 1] : defaultNetwork;

  const deployManager = new DeployManager(network);
  await deployManager.setup();
  const { configurator } = deployManager;
  const { deployer } = deployManager;
  const { config } = configurator;

  idx = process.argv.indexOf("--wallet");
  const walletAddress = idx > -1 ? process.argv[idx + 1] : defaultWalletAddress;

  idx = process.argv.indexOf("--stake");
  const staked = parseEther(idx > -1 ? process.argv[idx + 1] : "0");

  idx = process.argv.indexOf("--unstake");
  const unstaked = parseEther(idx > -1 ? process.argv[idx + 1] : "0");

  idx = process.argv.indexOf("--unstake-all");
  const unstakeAll = idx > -1;

  const makerV2 = await deployer.wrapDeployedContract(MakerV2Manager, config.modules.MakerV2Manager);
  const saiToken = await deployer.wrapDeployedContract(DSToken, await makerV2.saiToken());
  const daiToken = await deployer.wrapDeployedContract(DSToken, await makerV2.daiToken());

  async function printBalances() {
    const walletSai = await saiToken.balanceOf(walletAddress);
    const walletDai = await daiToken.balanceOf(walletAddress);
    const invested = (await makerV2.getInvestment(walletAddress, daiToken.contractAddress))._tokenValue;
    console.log("Balances:");
    console.log("SAI in the wallet:", formatEther(walletSai));
    console.log("DAI in the wallet:", formatEther(walletDai));
    console.log("DAI in the Pot:", formatEther(invested), "\n");
  }

  // Print initial balances
  await printBalances();

  // Send DAI to the Pot
  if (staked.gt(0)) {
    await makerV2.verboseWaitForTransaction(
      await makerV2.joinDsr(walletAddress, staked, { gasLimit: 1000000 }),
    );
    console.log(`Sent ${formatEther(staked)} DAI to the Pot.`);
    await printBalances();
  }

  // Remove DAI from the Pot
  if (unstaked.gt(0)) {
    await makerV2.verboseWaitForTransaction(
      await makerV2.exitDsr(walletAddress, unstaked, { gasLimit: 1000000 }),
    );
    console.log(`Removed ${formatEther(unstaked)} DAI from the Pot.`);
    await printBalances();
  }

  // Remove DAI from the Pot
  if (unstakeAll) {
    await makerV2.verboseWaitForTransaction(
      await makerV2.exitAllDsr(walletAddress, { gasLimit: 1000000 }),
    );
    console.log("Removed all DAI from the Pot.");
    await printBalances();
  }
}

main().catch((err) => {
  throw err;
});
