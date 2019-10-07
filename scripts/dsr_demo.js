// Example Usage:
// node scripts/dsr_demo.js [--to-dai 1.0] [--stake 10.0] [--unstake 5.0] [--unstake-all] [--to-sai 0.5] [--network kovan] [--wallet 0x62Da0Aca40650CB06361288FD0248Ad4eaB1d652]

const DeployManager = require('../utils/deploy-manager.js');
const DsrManager = require('../build/DsrManager');
const DSToken = require('../build/DSToken');

const { parseEther, formatEther } = require('ethers').utils;

const defaultWalletAddress = '0x779B2D281238993fD7276F2E13fA82db27AE72d9';
const defaultNetwork = 'kovan';

async function main() {

    // Read Command Line Arguments
    let idx = process.argv.indexOf("--network");
    const network = idx > -1 ? process.argv[idx + 1] : defaultNetwork;

    const deployManager = new DeployManager(network);
    await deployManager.setup();
    const configurator = deployManager.configurator;
    const deployer = deployManager.deployer;
    const config = configurator.config;

    idx = process.argv.indexOf("--wallet");
    const walletAddress = idx > -1 ? process.argv[idx + 1] : defaultWalletAddress;

    idx = process.argv.indexOf("--stake");
    const staked = parseEther(idx > -1 ? process.argv[idx + 1] : '0');

    idx = process.argv.indexOf("--unstake");
    const unstaked = parseEther(idx > -1 ? process.argv[idx + 1] : '0');

    idx = process.argv.indexOf("--unstake-all");
    const unstakeAll = idx > -1;

    idx = process.argv.indexOf("--to-dai");
    const toDai = parseEther(idx > -1 ? process.argv[idx + 1] : '0');

    idx = process.argv.indexOf("--to-sai");
    const toSai = parseEther(idx > -1 ? process.argv[idx + 1] : '0');

    const dsrManager = await deployer.wrapDeployedContract(DsrManager, config.modules.DsrManager);
    const saiToken = await deployer.wrapDeployedContract(DSToken, await dsrManager.saiToken());
    const daiToken = await deployer.wrapDeployedContract(DSToken, await dsrManager.daiToken());

    async function printBalances() {
        let walletSai = await saiToken.balanceOf(walletAddress);
        let walletDai = await daiToken.balanceOf(walletAddress);
        let invested = (await dsrManager.getInvestment(walletAddress, daiToken.contractAddress))._tokenValue;
        console.log('Balances:')
        console.log('SAI in the wallet:', formatEther(walletSai));
        console.log('DAI in the wallet:', formatEther(walletDai));
        console.log('DAI in the Pot:', formatEther(invested), '\n');
    }

    // Print initial balances
    await printBalances()

    // Swap SAI to DAI
    if (toDai.gt(0)) {
        await dsrManager.verboseWaitForTransaction(
            await dsrManager.swapSaiToDai(walletAddress, toDai)
        );
        console.log(`Converted ${formatEther(toDai)} SAI to DAI.`)
        await printBalances()
    }

    // Send DAI to the Pot
    if (staked.gt(0)) {
        await dsrManager.verboseWaitForTransaction(
            await dsrManager.joinDsr(walletAddress, staked, { 'gasLimit': 1000000 })
        );
        console.log(`Sent ${formatEther(staked)} DAI to the Pot.`)
        await printBalances()
    }

    // Remove DAI from the Pot
    if (unstaked.gt(0)) {
        await dsrManager.verboseWaitForTransaction(
            await dsrManager.exitDsr(walletAddress, unstaked, { 'gasLimit': 1000000 })
        );
        console.log(`Removed ${formatEther(unstaked)} DAI from the Pot.`)
        await printBalances()
    }

    // Remove DAI from the Pot
    if (unstakeAll) {
        await dsrManager.verboseWaitForTransaction(
            await dsrManager.exitAllDsr(walletAddress, { 'gasLimit': 1000000 })
        );
        console.log(`Removed all DAI from the Pot.`)
        await printBalances()
    }

    // Swap DAI to SAI
    if (toSai.gt(0)) {
        await dsrManager.verboseWaitForTransaction(
            await dsrManager.swapDaiToSai(walletAddress, toSai)
        );
        console.log(`Converted ${formatEther(toSai)} DAI to SAI.`)
        await printBalances()
    }
}

main().catch(err => {
    throw err;
});
