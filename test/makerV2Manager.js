// How to run this test file:
// 1. add your private key (KOVAN_PRIV_KEY) and Kovan Infura API key (KOVAN_INFURA_KEY) to .env
// 2. ./deploy.sh kovan 1 2 3 4 5 6 7 8 9 10 11
// 3a. npx etherlime test test/makerV2Manager.js --skip-compilation [--ens someens]
// Alternatively, to use a given wallet:
// 3b. node scripts/createWallet.js --network kovan --ens yourens
// 3b. npx etherlime test test/makerV2Manager.js --skip-compilation --wallet 0xAB3f50Ff1e4a516ef494b9C226ef0a26065766df

const TestManager = require("../utils/test-manager");
const DeployManager = require('../utils/deploy-manager.js');

const WalletFactory = require('../build/WalletFactory');
const MultiSigWallet = require('../build/MultiSigWallet');
const MultisigExecutor = require('../utils/multisigexecutor.js');
const MakerV2Manager = require('../build/MakerV2Manager');
const DSToken = require('../build/DSToken');

const { parseEther, formatEther } = require('ethers').utils;

const DEFAULT_NETWORK = 'kovan';
const SENT_AMOUNT = parseEther('0.00000001');

describe("Test MakerV2 Module", function () {
    this.timeout(1000000);

    if (!process.argv.join(' ').includes(__filename.slice(__dirname.length + 1))) {
        // We do not want to run this file as part of the complete test suite.
        // This is because this test file can currently only be run on kovan
        // whereas other test files are run using ganache
        return;
    }

    let testManager, makerV2, saiToken, daiToken, walletAddress, owner;

    before(async () => {
        let idx = process.argv.indexOf("--network");
        const network = idx > -1 ? process.argv[idx + 1] : DEFAULT_NETWORK;

        const deployManager = new DeployManager(network);
        await deployManager.setup();
        const configurator = deployManager.configurator;
        const deployer = deployManager.deployer;
        testManager = new TestManager([...Array(10)].map(() => deployer.signer), network);
        owner = deployer.signer;
        const config = configurator.config;

        makerV2 = await deployer.wrapDeployedContract(MakerV2Manager, config.modules.MakerV2Manager);
        saiToken = await deployer.wrapDeployedContract(DSToken, await makerV2.saiToken());
        daiToken = await deployer.wrapDeployedContract(DSToken, await makerV2.daiToken());

        idx = process.argv.indexOf("--wallet");
        walletAddress = idx > -1 && process.argv[idx + 1];

        if (!walletAddress) { // we will create a new wallet
            const walletFactoryWrapper = await deployer.wrapDeployedContract(WalletFactory, config.contracts.WalletFactory);
            const multisigWrapper = await deployer.wrapDeployedContract(MultiSigWallet, config.contracts.MultiSigWallet);
            const multisigExecutor = new MultisigExecutor(multisigWrapper, owner, config.multisig.autosign);

            // Make owner a temporary manager of WalletFactory to facilitate wallet initialization
            let revokeManager = false;
            if (!await walletFactoryWrapper.managers(owner.address)) {
                console.log(`Adding ${owner.address} as Manager of WalletFactory...`)
                await multisigExecutor.executeCall(walletFactoryWrapper, "addManager", [owner.address]);
                revokeManager = true;
            }

            console.log("Creating new wallet...");
            idx = process.argv.indexOf("--ens");
            const walletEns = idx > -1 ? process.argv[idx + 1] : Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5);
            const tx = await walletFactoryWrapper.createWallet(owner.address, [config.modules.MakerV2Manager], walletEns);
            const txReceipt = await walletFactoryWrapper.verboseWaitForTransaction(tx);
            walletAddress = txReceipt.events.find(log => log.event === "WalletCreated").args["_wallet"];
            console.log(`New wallet ${walletEns}.${config.ENS.domain} created at address ${walletAddress} for owner ${owner.address}.`);

            // Remove temporary manager from WalletFactory
            if (revokeManager === true) {
                console.log(`Removing ${owner.address} as Manager of WalletFactory...`)
                await multisigExecutor.executeCall(walletFactoryWrapper, "revokeManager", [owner.address]);
            }
        }
    });

    async function topUpDai() {
        const walletDai = await daiToken.balanceOf(walletAddress);
        if (walletDai.lt(SENT_AMOUNT)) {
            // console.log("Topping up wallet DAI...");
            await daiToken.verboseWaitForTransaction(await daiToken.transfer(walletAddress, SENT_AMOUNT))
        }
    }

    async function topUpSai() {
        const walletSai = await saiToken.balanceOf(walletAddress);
        if (walletSai.lt(SENT_AMOUNT)) {
            // console.log("Topping up wallet SAI...");
            await saiToken.verboseWaitForTransaction(await saiToken.transfer(walletAddress, SENT_AMOUNT))
        }
    }

    async function topUpPot() {
        const invested = (await makerV2.getInvestment(walletAddress, daiToken.contractAddress))._tokenValue;
        if (invested.lt(SENT_AMOUNT)) {
            await topUpDai();
            // console.log("Topping up wallet Pot balance...");
            await daiToken.verboseWaitForTransaction(await daiToken.transfer(walletAddress, SENT_AMOUNT))
            await makerV2.verboseWaitForTransaction(await makerV2.joinDsr(walletAddress, SENT_AMOUNT, { gasLimit: 2000000 }));
        }
    }

    describe("DAI <> SAI", () => {
        async function swapDaiSai({ toDai, relayed }) {
            const originToken = toDai ? saiToken : daiToken;
            const destinationToken = toDai ? daiToken : saiToken;
            const originBefore = await originToken.balanceOf(walletAddress);
            const destinationBefore = await destinationToken.balanceOf(walletAddress);
            const method = toDai ? 'swapSaiToDai' : 'swapDaiToSai';
            const params = [walletAddress, SENT_AMOUNT];
            if (relayed) {
                await testManager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
            } else {
                await makerV2.verboseWaitForTransaction(await makerV2[method](...params, { gasLimit: 2000000 }));
            }
            const originAfter = await originToken.balanceOf(walletAddress);
            const destinationAfter = await destinationToken.balanceOf(walletAddress);
            assert.isTrue(destinationAfter.sub(destinationBefore).eq(SENT_AMOUNT), `wallet should have received ${toDai ? 'DAI' : 'SAI'}`);
            assert.isTrue(originBefore.sub(originAfter).eq(SENT_AMOUNT), `wallet should have sent ${toDai ? 'SAI' : 'DAI'}`);
        }
        it('swaps SAI to DAI (blockchain tx)', async () => {
            await topUpSai();
            await swapDaiSai({ toDai: true, relayed: false })
        });
        it('swaps SAI to DAI (relayed tx)', async () => {
            await topUpSai();
            await swapDaiSai({ toDai: true, relayed: true })
        });
        it('swaps DAI to SAI (blockchain tx)', async () => {
            await topUpDai();
            await swapDaiSai({ toDai: false, relayed: false })
        });
        it('swaps DAI to SAI (relayed tx)', async () => {
            await topUpDai();
            await swapDaiSai({ toDai: false, relayed: true })
        });
    })

    describe("DSR", () => {
        async function exchangeWithPot({ toPot, relayed, useInvestInterface = false }) {
            const walletBefore = (await daiToken.balanceOf(walletAddress)).add(await saiToken.balanceOf(walletAddress));
            const investedBefore = (await makerV2.getInvestment(walletAddress, daiToken.contractAddress))._tokenValue;
            const fraction = !toPot && useInvestInterface && SENT_AMOUNT.mul(10000).div(investedBefore);
            let method, params;
            if (useInvestInterface) {
                method = toPot ? 'addInvestment' : 'removeInvestment';
                params = [walletAddress, daiToken.contractAddress].concat(toPot ? [SENT_AMOUNT, 0] : [fraction]);
            } else {
                method = toPot ? 'joinDsr' : 'exitDsr';
                params = [walletAddress, SENT_AMOUNT];
            }
            if (relayed) {
                await testManager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
            } else {
                await makerV2.verboseWaitForTransaction(await makerV2[method](...params, { gasLimit: 2000000 }));
            }
            const walletAfter = (await daiToken.balanceOf(walletAddress)).add(await saiToken.balanceOf(walletAddress));
            const investedAfter = (await makerV2.getInvestment(walletAddress, daiToken.contractAddress))._tokenValue;
            const deltaInvested = toPot ? investedAfter.sub(investedBefore) : investedBefore.sub(investedAfter);
            const deltaWallet = toPot ? walletBefore.sub(walletAfter) : walletAfter.sub(walletBefore);
            // take into account the rounding error introduced when withdrawing via the Invest interface
            const expectedDeltaWallet = (useInvestInterface && !toPot) ? fraction.mul(investedBefore).div(10000) : SENT_AMOUNT;
            // take into account rounding error introduced by the pot when too little time has elapsed
            const expectedDeltaInvested = toPot ? SENT_AMOUNT.sub(1) : SENT_AMOUNT;
            assert.isTrue(deltaInvested[toPot ? 'gte' : 'lte'](expectedDeltaInvested), `DAI in DSR should have changed by at ${toPot ? 'least' : 'most'} ${formatEther(expectedDeltaInvested)} DAI`);
            assert.isTrue(deltaWallet.eq(expectedDeltaWallet), `DAI in wallet should have changed by ${formatEther(expectedDeltaWallet)} DAI`);
        }

        it('sends DAI to the pot (blockchain tx)', async () => {
            await topUpDai();
            await exchangeWithPot({ toPot: true, relayed: false })
        });

        it('sends DAI to the pot (relayed tx)', async () => {
            await topUpDai();
            await exchangeWithPot({ toPot: true, relayed: true })
        });

        it('sends DAI to the pot via the Invest interface (blockchain tx)', async () => {
            await topUpDai();
            await exchangeWithPot({ toPot: true, relayed: false, useInvestInterface: true })
        });

        it('sends DAI to the pot via the Invest interface (relayed tx)', async () => {
            await topUpDai();
            await exchangeWithPot({ toPot: true, relayed: true, useInvestInterface: true })
        });

        it('sends DAI to the pot when only having SAI (blockchain tx)', async () => {
            await topUpSai();
            await exchangeWithPot({ toPot: true, relayed: false })
        });

        it('sends DAI to the pot when only having SAI (relayed tx)', async () => {
            await topUpSai();
            await exchangeWithPot({ toPot: true, relayed: true })
        });

        it('withdraw DAI from the pot (blockchain tx)', async () => {
            await topUpPot();
            await exchangeWithPot({ toPot: false, relayed: false })
        });

        it('withdraw DAI from the pot (relayed tx)', async () => {
            await topUpPot();
            await exchangeWithPot({ toPot: false, relayed: true })
        });

        it('withdraw DAI from the pot via the Invest interface (blockchain tx)', async () => {
            await topUpPot();
            await exchangeWithPot({ toPot: false, relayed: false, useInvestInterface: true })
        });

        it('withdraw DAI from the pot via the Invest interface (relayed tx)', async () => {
            await topUpPot();
            await exchangeWithPot({ toPot: false, relayed: true, useInvestInterface: true })
        });

        async function removeAllFromPot({ relayed }) {
            const walletBefore = await daiToken.balanceOf(walletAddress);
            const method = 'exitAllDsr';
            const params = [walletAddress];
            if (relayed) {
                await testManager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
            } else {
                await makerV2.verboseWaitForTransaction(await makerV2[method](...params, { gasLimit: 2000000 }));
            }
            const walletAfter = await daiToken.balanceOf(walletAddress);
            const investedAfter = (await makerV2.getInvestment(walletAddress, daiToken.contractAddress))._tokenValue;
            assert.isTrue(investedAfter.eq(0), `Pot should be emptied`);
            assert.isTrue(walletAfter.gt(walletBefore), `DAI in wallet should have increased`);
        }

        it('removes all DAI from the pot (blockchain tx)', async () => {
            await topUpPot();
            await removeAllFromPot({ relayed: false })
        });

        it('removes all DAI from the pot (relayed tx)', async () => {
            await topUpPot();
            await removeAllFromPot({ relayed: true })
        });

    });
});