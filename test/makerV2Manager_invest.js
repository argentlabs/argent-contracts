// How to run this test file:
// 1. add your private key (KOVAN_PRIV_KEY) and Kovan Infura API key (KOVAN_INFURA_KEY) to .env
// --- TO TEST ON KOVAN: ----
// 2. npx etherlime test test/makerV2Manager_invest.js --skip-compilation --network kovan
// --- TO TEST ON KOVAN-FORK: ----
// 2. npm run kovan-fork
// 3. npx etherlime test test/makerV2Manager_invest.js --skip-compilation --network kovan-fork

const TestManager = require("../utils/test-manager");
const DeployManager = require('../utils/deploy-manager.js');

const UniswapFactory = require("../contracts/test/uniswap/UniswapFactory");
const UniswapExchange = require("../contracts/test/uniswap/UniswapExchange");
const ScdMcdMigration = require('../build/ScdMcdMigration');
const Join = require("../build/JoinLike");
const MakerV2Manager = require('../build/MakerV2Manager');
const MakerRegistry = require('../build/MakerRegistry');
const Wallet = require("../build/BaseWallet");
const DSToken = require('../build/DSToken');

const { parseEther } = require('ethers').utils;

const DEFAULT_NETWORK = 'kovan'; // a bug in kovan-fork makes some tests fail => use kovan
const SENT_AMOUNT = parseEther('0.00000001');

describe("Test MakerV2 DSR & SAI<>DAI", function () {
    this.timeout(1000000);

    if (!process.argv.join(' ').includes(__filename.slice(__dirname.length + 1))) {
        // We do not want to run this file as part of the complete test suite.
        // This is because this test file can currently only be run on kovan or kovan-fork 
        // (using the --fork option of ganache-cli) whereas other test files are run using ganache
        return;
    }

    let testManager, makerV2, saiToken, daiToken, walletAddress, owner, deployer;

    before(async () => {
        let idx = process.argv.indexOf("--network");
        const network = idx > -1 ? process.argv[idx + 1] : DEFAULT_NETWORK;
        if (!network.includes("kovan")) throw new Error("--network must be 'kovan' or 'kovan-fork'")

        const deployManager = new DeployManager(network);
        await deployManager.setup();
        const configurator = deployManager.configurator;
        deployer = deployManager.deployer;
        testManager = new TestManager([...Array(10)].map(() => deployer), network);
        owner = deployer.signer;
        const config = configurator.config;

        const makerRegistry = await deployer.deploy(MakerRegistry);
        makerV2 = await deployer.deploy(
            MakerV2Manager,
            {},
            config.contracts.ModuleRegistry,
            config.modules.GuardianStorage,
            config.defi.maker.migration,
            config.defi.maker.pot,
            config.defi.maker.jug,
            makerRegistry.contractAddress,
            config.defi.uniswap.factory,
            { gasLimit: 8000000 }
        );

        const migration = await deployer.wrapDeployedContract(ScdMcdMigration, config.defi.maker.migration);
        const daiJoin = await deployer.wrapDeployedContract(Join, await migration.daiJoin());
        const saiJoin = await deployer.wrapDeployedContract(Join, await migration.saiJoin());
        daiToken = await deployer.wrapDeployedContract(DSToken, await daiJoin.dai());
        saiToken = await deployer.wrapDeployedContract(DSToken, await saiJoin.gem());

        const daiBalance = await daiToken.balanceOf(owner.address);
        if (daiBalance.lt(parseEther('1'))) {
            const uniswapFactory = await deployer.wrapDeployedContract(UniswapFactory, config.defi.uniswap.factory);
            const daiExchange = await deployer.wrapDeployedContract(UniswapExchange, await uniswapFactory.getExchange(daiToken.contractAddress));
            await (await owner.sendTransaction({ to: daiExchange.contractAddress, value: parseEther('0.02'), gasLimit: 3000000 })).wait();
        }

        const saiBalance = await saiToken.balanceOf(owner.address);
        if (saiBalance.lt(parseEther('1'))) {
            const convertedToSai = (await daiToken.balanceOf(owner.address)).div(2);
            await (await daiToken.approve(migration.contractAddress, convertedToSai)).wait();
            await (await migration.swapDaiToSai(convertedToSai)).wait();
        }

        wallet = await deployer.deploy(Wallet);
        await (await wallet.init(owner.address, [makerV2.contractAddress])).wait();
        walletAddress = wallet.contractAddress;
    });

    async function topUpDai() {
        const walletDai = await daiToken.balanceOf(walletAddress);
        if (walletDai.lt(SENT_AMOUNT)) {
            await (await daiToken.transfer(walletAddress, SENT_AMOUNT)).wait()
        }
    }

    async function topUpSai() {
        const walletSai = await saiToken.balanceOf(walletAddress);
        if (walletSai.lt(SENT_AMOUNT)) {
            await (await saiToken.transfer(walletAddress, SENT_AMOUNT)).wait()
        }
    }

    async function topUpPot() {
        const invested = (await makerV2.getInvestment(walletAddress, daiToken.contractAddress))._tokenValue;
        if (invested.lt(SENT_AMOUNT)) {
            await topUpDai();
            await (await daiToken.transfer(walletAddress, SENT_AMOUNT)).wait();
            await (await makerV2.addInvestment(walletAddress, daiToken.contractAddress, SENT_AMOUNT, 0, { gasLimit: 2000000 })).wait();
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
                await (await makerV2[method](...params, { gasLimit: 2000000 })).wait();
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
        async function exchangeWithPot({ toPot, relayed, all = false }) {
            const walletBefore = (await daiToken.balanceOf(walletAddress)).add(await saiToken.balanceOf(walletAddress));
            const investedBefore = (await makerV2.getInvestment(walletAddress, daiToken.contractAddress))._tokenValue;
            const fraction = !toPot && (all ? 10000 : SENT_AMOUNT.mul(10000).div(investedBefore));
            const method = toPot ? 'addInvestment' : 'removeInvestment';
            const params = [walletAddress, daiToken.contractAddress].concat(toPot ? [SENT_AMOUNT, 0] : [fraction]);
            if (relayed) {
                await testManager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
            } else {
                await (await makerV2[method](...params, { gasLimit: 2000000 })).wait();
            }
            const walletAfter = (await daiToken.balanceOf(walletAddress)).add(await saiToken.balanceOf(walletAddress));
            const investedAfter = (await makerV2.getInvestment(walletAddress, daiToken.contractAddress))._tokenValue;
            const deltaInvested = toPot ? investedAfter.sub(investedBefore) : investedBefore.sub(investedAfter);
            const deltaWallet = toPot ? walletBefore.sub(walletAfter) : walletAfter.sub(walletBefore);
            assert.isTrue(deltaInvested.gt(0), `DAI in DSR should have changed.`);
            assert.isTrue(deltaWallet.gt(0), `DAI in wallet should have changed.`);

            if (all) {
                assert.isTrue(investedAfter.eq(0), `Pot should be emptied`);
                assert.isTrue(walletAfter.gt(walletBefore), `DAI in wallet should have increased`);
            }
        }

        it('sends DAI to the pot (blockchain tx)', async () => {
            await topUpDai();
            await exchangeWithPot({ toPot: true, relayed: false })
        });

        it('sends DAI to the pot (relayed tx)', async () => {
            await topUpDai();
            await exchangeWithPot({ toPot: true, relayed: true })
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

        it('withdraw ALL DAI from the pot (blockchain tx)', async () => {
            await topUpPot();
            await exchangeWithPot({ toPot: false, relayed: false, all: true })
        });

        it('withdraw ALL DAI from the pot (relayed tx)', async () => {
            await topUpPot();
            await exchangeWithPot({ toPot: false, relayed: true, all: true })
        });
    });
});