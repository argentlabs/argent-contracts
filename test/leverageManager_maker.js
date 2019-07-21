const etherlime = require('etherlime');

const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");

const GuardianStorage = require("../build/GuardianStorage");
const LeverageManager = require("../build/LeverageManager");

const UniswapFactory = require("../contracts/test/uniswap/UniswapFactory");
const UniswapExchange = require("../contracts/test/uniswap/UniswapExchange");
const MakerProvider = require("../build/MakerProvider");

const TestManager = require("../utils/test-manager");

const Vox = require("../build/SaiVox");
const Tub = require("../build/SaiTub");
const DSToken = require("../build/DSToken");
const WETH = require("../build/WETH9");
const DSValue = require("../build/DSValue");
const { parseEther, formatEther, formatBytes32String, bigNumberify } = require('ethers').utils;

const RAY = bigNumberify('1000000000000000000000000000') // 10**27
const WAD = bigNumberify('1000000000000000000') // 10**18
const ETH_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const USD_PER_DAI = RAY; // 1 DAI = 1 USD
const USD_PER_ETH = WAD.mul(100); // 1 ETH = 100 USD
const USD_PER_MKR = WAD.mul(400); // 1 MKR = 400 USD
const ETH_PER_MKR = WAD.mul(USD_PER_MKR).div(USD_PER_ETH); // 1 MKR = 4 ETH
const ETH_PER_DAI = WAD.mul(USD_PER_DAI).div(RAY).mul(WAD).div(USD_PER_ETH); // 1 DAI = 0.01 ETH

describe("Test Leverage Module", function () {
    this.timeout(30000);

    const manager = new TestManager(accounts);

    const infrastructure = accounts[0].signer;
    const owner = accounts[1].signer;
    const pit = accounts[2].signer;

    let deployer, leverageManager, makerProvider, wallet, sai, gov, tub, uniswapFactory;

    before(async () => {
        deployer = manager.newDeployer();

        const registry = await deployer.deploy(Registry);
        const guardianStorage = await deployer.deploy(GuardianStorage);

        // deploy MakerDAO infrastructure
        const vox = await deployer.deploy(Vox, {}, USD_PER_DAI);
        sai = await deployer.deploy(DSToken, {}, formatBytes32String("DAI"));
        gov = await deployer.deploy(DSToken, {}, formatBytes32String("MKR"));
        const sin = await deployer.deploy(DSToken, {}, formatBytes32String("SIN"));
        const skr = await deployer.deploy(DSToken, {}, formatBytes32String("PETH"));
        const gem = await deployer.deploy(WETH);
        const pip = await deployer.deploy(DSValue);
        const pep = await deployer.deploy(DSValue);
        tub = await deployer.deploy(Tub, {},
            sai.contractAddress,
            sin.contractAddress,
            skr.contractAddress,
            gem.contractAddress,
            gov.contractAddress,
            pip.contractAddress,
            pep.contractAddress,
            vox.contractAddress,
            pit.address);

        // let the Tub mint PETH and DAI
        await skr.setOwner(tub.contractAddress);
        await sai.setOwner(tub.contractAddress);
        // setup USD/ETH oracle with a convertion rate of 100 USD/ETH
        await pip.poke('0x' + USD_PER_ETH.toHexString().slice(2).padStart(64, '0'));
        // setup USD/MKR oracle with a convertion rate of 400 USD/MKR
        await pep.poke('0x' + USD_PER_MKR.toHexString().slice(2).padStart(64, '0'));
        // set the total DAI debt ceiling to 50,000 DAI
        await tub.mold(formatBytes32String('cap'), parseEther('50000'));
        // set the liquidation ratio to 150%
        await tub.mold(formatBytes32String('mat'), RAY.mul(3).div(2));
        // set the governance fee to about 10% APR
        await tub.mold(formatBytes32String('fee'), '1000000003022266100000000000');

        // setup Uniswap for purchase of MKR and DAI
        uniswapFactory = await deployer.deploy(UniswapFactory);
        const uniswapTemplateExchange = await deployer.deploy(UniswapExchange);
        await uniswapFactory.initializeFactory(uniswapTemplateExchange.contractAddress);
        // Note that the uniswap liquidity pools must be large enough
        // so that price remains more or less equal throughout the tests.
        let ethLiquidity = parseEther('100');
        // MKR
        await uniswapFactory.from(infrastructure).createExchange(gov.contractAddress);
        const mkrExchange = await etherlime.ContractAt(UniswapExchange, await uniswapFactory.getExchange(gov.contractAddress));
        let mkrLiquidity = ethLiquidity.mul(WAD).div(ETH_PER_MKR);
        await gov['mint(address,uint256)'](infrastructure.address, mkrLiquidity);
        await gov.from(infrastructure).approve(mkrExchange.contractAddress, mkrLiquidity);
        let currentBlock = await manager.getCurrentBlock();
        let timestamp = await manager.getTimestamp(currentBlock);
        await mkrExchange.from(infrastructure).addLiquidity(1, mkrLiquidity, timestamp + 300, { value: ethLiquidity, gasLimit: 150000 });
        // DAI
        await uniswapFactory.from(infrastructure).createExchange(sai.contractAddress);
        const saiExchange = await etherlime.ContractAt(UniswapExchange, await uniswapFactory.getExchange(sai.contractAddress));
        let saiLiquidity = ethLiquidity.mul(WAD).div(ETH_PER_DAI);
        await sai['mint(address,uint256)'](infrastructure.address, saiLiquidity);
        await sai.from(infrastructure).approve(saiExchange.contractAddress, saiLiquidity);
        currentBlock = await manager.getCurrentBlock();
        timestamp = await manager.getTimestamp(currentBlock);
        await saiExchange.from(infrastructure).addLiquidity(1, saiLiquidity, timestamp + 300, { value: ethLiquidity, gasLimit: 150000 });

        makerProvider = await deployer.deploy(MakerProvider);
        leverageManager = await deployer.deploy(LeverageManager, {}, registry.contractAddress, guardianStorage.contractAddress);
        await leverageManager.addDefaultProvider(makerProvider.contractAddress, [tub.contractAddress, uniswapFactory.contractAddress]);
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [leverageManager.contractAddress]);
        await infrastructure.sendTransaction({ to: wallet.contractAddress, value: parseEther('5') });
    });


    describe("Leverage Positions", () => {

        async function openLeveragedPosition({ collateral, conversionRatio, iterations, relayed }) {
            const method = 'openLeveragedPosition';
            const params = [wallet.contractAddress, makerProvider.contractAddress, ETH_TOKEN, collateral, conversionRatio, iterations];
            let txReceipt;
            if (relayed) {
                txReceipt = await manager.relay(leverageManager, method, params, wallet, [owner], undefined, false, 4700000);
            } else {
                const tx = await leverageManager.from(owner)[method](...params, { gasLimit: 4700000 });
                txReceipt = await leverageManager.verboseWaitForTransaction(tx);
            }

            const log = txReceipt.events.find(e => e.event === 'LeverageOpened').args
            return {
                ethCollateral: formatEther(collateral),
                ethExposure: formatEther(log._totalCollateral),
                leverage: formatEther(log._totalCollateral.mul(WAD).div(collateral)),
                daiDebt: formatEther(log._totalDebt),
                liquidationRatio: log._totalDebt.gt(0) && formatEther(log._totalCollateral.mul(WAD).mul(WAD).div(ETH_PER_DAI).div(log._totalDebt)),
                gasUsed: txReceipt.gasUsed,
                cup: log._leverageId
            };
        }

        // test relationship between leverage and liq. ratio with nb of iterations
        function testIncreasingIterations({ relayed }) {
            const collateral = parseEther('0.01');
            let prevLeverage, prevLiquidationRatio;
            const convRatio = RAY.mul(30000).div(15000);
            for (let iter = 1; iter < 8; iter++) {
                it(`should open a Leveraged Position (iter=${iter}, convRatio=2, relayed=${relayed})`, async () => {
                    const { leverage, liquidationRatio } = await openLeveragedPosition({ collateral: collateral, conversionRatio: convRatio, iterations: iter })
                    assert.isDefined(leverage, 'leverage should have been returned');
                    assert.isDefined(liquidationRatio, 'liquidationRatio should have been returned');
                    if (prevLeverage && prevLiquidationRatio) {
                        assert.isTrue(parseFloat(leverage) > parseFloat(prevLeverage), 'leverage should grow with nb of iterations')
                        assert.isTrue(parseFloat(liquidationRatio) < parseFloat(prevLiquidationRatio), 'liquidationRatio should shrink with nb of iterations')
                    }
                    prevLeverage = leverage;
                    prevLiquidationRatio = liquidationRatio;
                });
            }
        }

        // test relationship between leverage and liq. ratio with convertion ratio
        function testDecreasingConvertionRatio({ relayed }) {
            const collateral = parseEther('0.1');
            const iter = 3;
            let prevLeverage, prevLiquidationRatio;
            const denoms = [10000, 12500, 15000, 17500, 19999];
            for (let denom of denoms) {
                const convRatio = RAY.mul(30000).div(denom);
                it(`should open a Leveraged Position (iter=${iter}, convRatio=30000/${denom}, relayed=${relayed})`, async () => {
                    const { leverage, liquidationRatio } = await openLeveragedPosition({ collateral: collateral, conversionRatio: convRatio, iterations: iter })
                    assert.isDefined(leverage, 'leverage should have been returned');
                    assert.isDefined(liquidationRatio, 'liquidationRatio should have been returned');
                    if (prevLeverage && prevLiquidationRatio) {
                        assert.isTrue(parseFloat(leverage) > parseFloat(prevLeverage), 'leverage should increase when conv. ratio decreases')
                        assert.isTrue(parseFloat(liquidationRatio) < parseFloat(prevLiquidationRatio), 'liquidationRatio should decrease when conv. ratio decreases')
                    }
                    prevLeverage = leverage;
                    prevLiquidationRatio = liquidationRatio;
                });
            }
        }

        describe("Open Leveraged Position", () => {
            describe("With decreasing convertion ratios (blockchain tx)", () => {
                testDecreasingConvertionRatio({ relayed: false });
            });
            describe("With decreasing convertion ratios (relayed tx)", () => {
                testDecreasingConvertionRatio({ relayed: true });
            });
            describe("With increasing iterations (blockchain tx)", () => {
                testIncreasingIterations({ relayed: false });
            });
            describe("With increasing iterations (relayed tx)", () => {
                testIncreasingIterations({ relayed: true });
            });
        });

        async function closeLeveragedPosition({ cup, daiRepaid, relayed }) {
            const method = 'closeLeveragedPosition';
            const params = [wallet.contractAddress, makerProvider.contractAddress, cup, daiRepaid];
            let txReceipt;
            if (relayed) {
                txReceipt = await manager.relay(leverageManager, method, params, wallet, [owner], undefined, false, 4700000);
            } else {
                const tx = await leverageManager.from(owner)[method](...params, { gasLimit: 4700000 });
                txReceipt = await leverageManager.verboseWaitForTransaction(tx);
            }
            return txReceipt;
        }

        function testCloseLeveragedPosition() {
            const defaultParams = { collateral: parseEther('0.1'), convRatio: RAY.mul(30).div(15), iter: 2, term: 3600 * 24 * 365, daiRepaid: parseEther('0'), relayed: false }
            const testCases = [
                { relayed: true },
                { collateral: parseEther('0.1'), daiRepaid: parseEther('2000') }, // todo: add test to cdp.js for when repaying (more than) full tab
                { collateral: parseEther('0.4'), daiRepaid: parseEther('7.5') },
                { collateral: parseEther('0.4'), convRatio: RAY.mul(3000).div(1999) },
                { collateral: parseEther('0.5') },
                { collateral: parseEther('0.5'), convRatio: RAY.mul(3000).div(1999) },
                { term: 1 },
                { term: 5 * 3600 * 24 * 365, daiRepaid: parseEther('0.06') },
                { iter: 0 },
                { iter: 1 },
                { iter: 4 },
            ];

            for (const [i, testCase] of testCases.entries()) {
                const { collateral, convRatio, iter, term, daiRepaid, relayed } = { ...defaultParams, ...testCase };
                it(`should close a Leveraged Position (testCase #${i})`, async () => {
                    const { cup } = await openLeveragedPosition({ collateral: collateral, conversionRatio: convRatio, iterations: iter })
                    if (term > 0) await manager.increaseTime(term);
                    const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
                    const beforeDAISupply = await sai.totalSupply();
                    const txReceipt = await closeLeveragedPosition({ cup: cup, daiRepaid: daiRepaid, relayed: relayed })
                    const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
                    const afterDAISupply = await sai.totalSupply();
                    assert.isDefined(txReceipt.events.find(e => e.event === 'LeverageClosed'), `LeverageClosed should have been emitted (test case #${i})`);
                    assert.isTrue(afterETH.gt(beforeETH), `wallet should have received some ETH (test case #${i})`);
                    assert.isTrue(iter == 0 || beforeDAISupply.gt(afterDAISupply), `total DAI supply should have decreased (test case #${i})`);
                });
            }
        }

        describe("Close Leveraged Position", () => {
            testCloseLeveragedPosition()
        });

    });

});