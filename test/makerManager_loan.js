const etherlime = require('etherlime-lib');

const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");

const GuardianStorage = require("../build/GuardianStorage");
const MakerManager = require("../build/MakerManager");

const UniswapFactory = require("../contracts/test/uniswap/UniswapFactory");
const UniswapExchange = require("../contracts/test/uniswap/UniswapExchange");

const TestManager = require("../utils/test-manager");

const Vox = require("../build/SaiVox");
const Tub = require("../build/SaiTub");
const DSToken = require("../build/DSToken");
const WETH = require("../build/WETH9");
const DSValue = require("../build/DSValue");
const { parseEther, formatBytes32String, bigNumberify } = require('ethers').utils;
const { bigNumToBytes32 } = require('../utils/utilities.js');

const RAY = bigNumberify('1000000000000000000000000000') // 10**27
const WAD = bigNumberify('1000000000000000000') // 10**18
const ETH_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const USD_PER_DAI = RAY; // 1 DAI = 1 USD
const USD_PER_ETH = WAD.mul(100); // 1 ETH = 100 USD
const USD_PER_MKR = WAD.mul(400); // 1 MKR = 400 USD
const ETH_PER_MKR = WAD.mul(USD_PER_MKR).div(USD_PER_ETH); // 1 MKR = 4 ETH
const ETH_PER_DAI = WAD.mul(USD_PER_DAI).div(RAY).mul(WAD).div(USD_PER_ETH); // 1 DAI = 0.01 ETH

describe("Test CDP Module", function () {
    this.timeout(10000);

    const manager = new TestManager();

    const infrastructure = accounts[0].signer;
    const owner = accounts[1].signer;
    const pit = accounts[2].signer;

    let deployer, loanManager, wallet, sai, gov, tub, uniswapFactory, pip;

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
        pip = await deployer.deploy(DSValue);
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
        // set the liquidity ratio to 150%
        await tub.mold(formatBytes32String('mat'), RAY.mul(3).div(2));
        // set the governance fee to 7.5% APR
        await tub.mold(formatBytes32String('fee'), '1000000002293273137447730714');

        // setup Uniswap for purchase of MKR and DAI
        uniswapFactory = await deployer.deploy(UniswapFactory);
        const uniswapTemplateExchange = await deployer.deploy(UniswapExchange);
        await uniswapFactory.initializeFactory(uniswapTemplateExchange.contractAddress);
        let ethLiquidity = parseEther('10');
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

        loanManager = await deployer.deploy(
            MakerManager,
            {},
            registry.contractAddress,
            guardianStorage.contractAddress,
            tub.contractAddress,
            uniswapFactory.contractAddress
        );
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [loanManager.contractAddress]);
        await infrastructure.sendTransaction({ to: wallet.contractAddress, value: parseEther('5') });
    });

    describe("Loan", () => {
        async function testOpenLoan({ ethAmount, daiAmount, relayed }) {
            const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
            const beforeDAI = await sai.balanceOf(wallet.contractAddress);
            const beforeDAISupply = await sai.totalSupply();

            const params = [wallet.contractAddress, ETH_TOKEN, ethAmount, sai.contractAddress, daiAmount];
            let txReceipt;
            if (relayed) {
                txReceipt = await manager.relay(loanManager, 'openLoan', params, wallet, [owner]);
            } else {
                const tx = await loanManager.from(owner).openLoan(...params, { gasLimit: 2000000 });
                txReceipt = await loanManager.verboseWaitForTransaction(tx);
            }
            const loanId = txReceipt.events.find(e => e.event === 'LoanOpened').args._loanId;
            assert.isDefined(loanId, 'Loan ID should be defined')

            const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
            const afterDAI = await sai.balanceOf(wallet.contractAddress);
            const afterDAISupply = await sai.totalSupply();

            assert.equal(beforeETH.sub(afterETH).toString(), ethAmount.toString(), `wallet should have ${ethAmount} less ETH (relayed: ${relayed})`);
            assert.equal(afterDAI.sub(beforeDAI).toString(), daiAmount.toString(), `wallet should have ${daiAmount} more DAI (relayed: ${relayed})`);
            assert.equal(afterDAISupply.sub(beforeDAISupply).toString(), daiAmount.toString(), `${daiAmount} DAI should have been minted (relayed: ${relayed})`);

            return loanId;
        }

        describe("Open Loan", () => {
            it('should open a Loan (blockchain tx)', async () => {
                await testOpenLoan({ ethAmount: parseEther('0.100'), daiAmount: parseEther('6.6'), relayed: false })
            });
            it('should open a Loan (relayed tx)', async () => {
                await testOpenLoan({ ethAmount: parseEther('0.100'), daiAmount: parseEther('6.6'), relayed: true })
            });
        });

        async function testChangeCollateral({ loanId, ethAmount, add, relayed }) {
            const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
            const method = add ? 'addCollateral' : 'removeCollateral';
            const params = [wallet.contractAddress, loanId, ETH_TOKEN, ethAmount];
            if (relayed) {
                await manager.relay(loanManager, method, params, wallet, [owner]);
            } else {
                await loanManager.from(owner)[method](...params, { gasLimit: 2000000 });
            }
            const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
            const expectedETHChange = ethAmount.mul(add ? -1 : 1).toString()
            assert.equal(afterETH.sub(beforeETH).toString(), expectedETHChange, `wallet ETH should have changed by ${expectedETHChange} (relayed: ${relayed})`);
        }

        describe("Add/Remove Collateral", () => {
            it('should add collateral (blockchain tx)', async () => {
                const loanId = await testOpenLoan({ ethAmount: parseEther('0.100'), daiAmount: parseEther('2'), relayed: false })
                await testChangeCollateral({ loanId: loanId, ethAmount: parseEther('0.010'), add: true, relayed: false })
            });
            it('should add collateral (relayed tx)', async () => {
                const loanId = await testOpenLoan({ ethAmount: parseEther('0.100'), daiAmount: parseEther('2'), relayed: true })
                await testChangeCollateral({ loanId: loanId, ethAmount: parseEther('0.010'), add: true, relayed: true })
            });
            it('should remove collateral (blockchain tx)', async () => {
                const loanId = await testOpenLoan({ ethAmount: parseEther('0.100'), daiAmount: parseEther('2'), relayed: false })
                await testChangeCollateral({ loanId: loanId, ethAmount: parseEther('0.010'), add: false, relayed: false })
            });
            it('should remove collateral (relayed tx)', async () => {
                const loanId = await testOpenLoan({ ethAmount: parseEther('0.100'), daiAmount: parseEther('2'), relayed: true })
                await testChangeCollateral({ loanId: loanId, ethAmount: parseEther('0.010'), add: false, relayed: true })
            });
        });

        async function testChangeDebt({ loanId, daiAmount, add, relayed }) {
            const beforeDAI = await sai.balanceOf(wallet.contractAddress);
            const beforeDAISupply = await sai.totalSupply();
            const method = add ? 'addDebt' : 'removeDebt';
            const params = [wallet.contractAddress, loanId, sai.contractAddress, daiAmount];
            if (relayed) {
                await manager.relay(loanManager, method, params, wallet, [owner]);
            } else {
                await loanManager.from(owner)[method](...params, { gasLimit: 2000000 });
            }
            const afterDAI = await sai.balanceOf(wallet.contractAddress);
            const afterDAISupply = await sai.totalSupply();
            const expectedDAIChange = daiAmount.mul(add ? 1 : -1).toString()
            assert.equal(afterDAI.sub(beforeDAI).toString(), expectedDAIChange, `wallet DAI should have changed by ${expectedDAIChange} (relayed: ${relayed})`);
            assert.equal(afterDAISupply.sub(beforeDAISupply).toString(), expectedDAIChange, `total DAI supply should have changed by ${expectedDAIChange} (relayed: ${relayed})`);
        }

        describe("Increase Debt", () => {
            it('should increase debt (blockchain tx)', async () => {
                const loanId = await testOpenLoan({ ethAmount: parseEther('0.100'), daiAmount: parseEther('1'), relayed: false })
                await testChangeDebt({ loanId: loanId, daiAmount: parseEther('0.5'), add: true, relayed: false })
            });
            it('should increase debt (relayed tx)', async () => {
                const loanId = await testOpenLoan({ ethAmount: parseEther('0.100'), daiAmount: parseEther('1'), relayed: true })
                await testChangeDebt({ loanId: loanId, daiAmount: parseEther('0.5'), add: true, relayed: true })
            });
        });

        async function testRepayDebt({ useOwnMKR, relayed }) {
            if (useOwnMKR) {
                await gov['mint(address,uint256)'](wallet.contractAddress, parseEther('0.1'));
            }
            const loanId = await testOpenLoan({ ethAmount: parseEther('0.0100'), daiAmount: parseEther('0.1'), relayed: relayed })
            await manager.increaseTime(3600 * 24 * 365); // wait one year
            const beforeMKR = await gov.balanceOf(wallet.contractAddress);
            const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
            await testChangeDebt({ loanId: loanId, daiAmount: parseEther('0.00000005'), add: false, relayed: relayed })
            const afterMKR = await gov.balanceOf(wallet.contractAddress);
            const afterETH = await deployer.provider.getBalance(wallet.contractAddress);

            if (useOwnMKR)
                assert.isTrue(afterMKR.lt(beforeMKR) && afterETH.eq(beforeETH), 'governance fee should have been paid in MKR')
            else
                assert.isTrue(afterMKR.eq(beforeMKR) && afterETH.lt(beforeETH), 'governance fee should have been paid in ETH')
        }

        describe("Repay Debt", () => {
            it('should repay debt when paying fee in MKR (blockchain tx)', async () => {
                await testRepayDebt({ useOwnMKR: true, relayed: false });
            });
            it('should repay debt when paying fee in MKR (relayed tx)', async () => {
                await testRepayDebt({ useOwnMKR: true, relayed: true });
            });
            it('should repay debt when paying fee in ETH (blockchain tx)', async () => {
                await testRepayDebt({ useOwnMKR: false, relayed: false });
            });
            it('should repay debt when paying fee in ETH (relayed tx)', async () => {
                await testRepayDebt({ useOwnMKR: false, relayed: true });
            });
        });

        async function testCloseLoan({ useOwnMKR, relayed, biteBeforeClose = false }) {
            if (useOwnMKR) {
                await gov['mint(address,uint256)'](wallet.contractAddress, parseEther('0.1'));
            }

            const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
            const beforeMKR = await gov.balanceOf(wallet.contractAddress);
            const beforeDAI = await sai.balanceOf(wallet.contractAddress);
            const beforeDAISupply = await sai.totalSupply();

            const loanId = await testOpenLoan({ ethAmount: parseEther('0.100'), daiAmount: parseEther('1'), relayed: relayed });
            await manager.increaseTime(3600 * 24 * 365); // wait one year

            if (biteBeforeClose) {
                const feed = bigNumberify(await pip.read())
                const newFeed = bigNumToBytes32(feed.div(10))
                await pip.poke(newFeed, { gasLimit: 500000 });
                await tub.bite(loanId);
                await pip.poke(feed, { gasLimit: 500000 });
            }
            const method = 'closeLoan'
            const params = [wallet.contractAddress, loanId];
            if (relayed) {
                await manager.relay(loanManager, method, params, wallet, [owner]);
            } else {
                await loanManager.from(owner)[method](...params, { gasLimit: 2000000 });
            }

            const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
            const afterMKR = await gov.balanceOf(wallet.contractAddress);
            const afterDAI = await sai.balanceOf(wallet.contractAddress);
            const afterDAISupply = await sai.totalSupply();

            if (!biteBeforeClose) { // Note that the DAI will still be in the wallet if the wallet was bitten before the closing of the cdp
                assert.isTrue(afterDAI.eq(beforeDAI), `wallet DAI should not have changed (relayed: ${relayed})`);
                assert.isTrue(afterDAISupply.eq(beforeDAISupply), `total DAI supply should not have changed (relayed: ${relayed})`);
            }

            if (useOwnMKR)
                assert.isTrue(afterMKR.lt(beforeMKR) && afterETH.eq(beforeETH), 'governance fee should have been paid in MKR')
            else
                assert.isTrue(afterMKR.eq(beforeMKR) && afterETH.lt(beforeETH), 'governance fee should have been paid in ETH')
            assert.equal(await tub.lad(loanId), '0x0000000000000000000000000000000000000000', 'CDP should have been wiped');
        }

        describe("Close CDP", () => {
            it('should close CDP when paying fee in MKR (blockchain tx)', async () => {
                await testCloseLoan({ useOwnMKR: true, relayed: false });
            });
            it('should close CDP when paying fee in MKR (relayed tx)', async () => {
                await testCloseLoan({ useOwnMKR: true, relayed: true });
            });
            it('should close CDP when paying fee in ETH (blockchain tx)', async () => {
                await testCloseLoan({ useOwnMKR: false, relayed: false });
            });
            it('should close CDP when paying fee in ETH (relayed tx)', async () => {
                await testCloseLoan({ useOwnMKR: false, relayed: true });
            });
            it('should close CDP after it got liquidated (blockchain tx)', async () => {
                await testCloseLoan({ useOwnMKR: false, relayed: false, biteBeforeClose: true });
            })
            it('should close CDP after it got liquidated (relayed tx)', async () => {
                await testCloseLoan({ useOwnMKR: false, relayed: true, biteBeforeClose: true });
            })
        });

    });

});