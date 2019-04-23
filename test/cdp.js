const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");

const GuardianStorage = require("../build/GuardianStorage");
const CdpManager = require("../build/CdpManager");

const KyberNetwork = require("../build/KyberNetworkTest");
const TokenExchanger = require("../build/TokenExchanger");

const TestManager = require("../utils/test-manager");

const Vox = require("../build/SaiVox");
const Tub = require("../build/SaiTub");
const DSToken = require("../build/DSToken");
const WETH = require("../build/WETH9");
const DSValue = require("../build/DSValue");
const { parseEther, formatBytes32String, bigNumberify } = require('ethers').utils;

const RAY = bigNumberify('1000000000000000000000000000') // 10**27
const WAD = bigNumberify('1000000000000000000') // 10**18
const ETH_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const KYBER_FEE_RATIO = 30;
const MKR_DECIMALS = 18;
const DAI_DECIMALS = 18;
const USD_PER_DAI = RAY; // 1 DAI = 1 USD
const USD_PER_ETH = WAD.mul(100); // 1 ETH = 100 USD
const USD_PER_MKR = WAD.mul(400); // 1 MKR = 400 USD
const ETH_PER_MKR = WAD.mul(USD_PER_MKR).div(USD_PER_ETH); // 1 MKR = 4 ETH
const ETH_PER_DAI = WAD.mul(USD_PER_DAI).div(RAY).mul(WAD).div(USD_PER_ETH); // 1 DAI = 0.01 ETH

describe("Test CDP Module", function () {
    this.timeout(10000);

    const manager = new TestManager(accounts);

    const infrastructure = accounts[0].signer;
    const owner = accounts[1].signer;
    const pit = accounts[2].signer;

    let deployer, cdpManager, wallet, sai, gov, tub, kyber, exchanger;

    before(async () => {
        deployer = manager.newDeployer();
        const registry = await deployer.deploy(Registry);

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
        // set the liquidity ratio to 150%
        await tub.mold(formatBytes32String('mat'), RAY.mul(3).div(2));
        // set the governance fee to 7.5% APR
        await tub.mold(formatBytes32String('fee'), '1000000002293273137447730714');

        const guardianStorage = await deployer.deploy(GuardianStorage);

        // setup Kyber & Token Exchanger module for purchase of MKR tokens
        kyber = await deployer.deploy(KyberNetwork);
        await kyber.addToken(gov.contractAddress, ETH_PER_MKR, MKR_DECIMALS);
        await kyber.addToken(sai.contractAddress, ETH_PER_DAI, DAI_DECIMALS);
        await gov['mint(address,uint256)'](kyber.contractAddress, parseEther('1000'));
        await sai['mint(address,uint256)'](kyber.contractAddress, parseEther('1000'));
        await infrastructure.sendTransaction({ to: kyber.contractAddress, value: parseEther('5') });
        exchanger = await deployer.deploy(TokenExchanger, {},
            registry.contractAddress,
            guardianStorage.contractAddress,
            kyber.contractAddress,
            infrastructure.address,
            KYBER_FEE_RATIO
        );

        // setup CDP Manager Module
        cdpManager = await deployer.deploy(CdpManager, {},
            registry.contractAddress,
            guardianStorage.contractAddress,
            exchanger.contractAddress,
            tub.contractAddress,
            gem.contractAddress,
            skr.contractAddress,
            sai.contractAddress,
            gov.contractAddress
        );
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [cdpManager.contractAddress, exchanger.contractAddress]);
        await infrastructure.sendTransaction({ to: wallet.contractAddress, value: parseEther('5') });
    });


    describe("CDP", () => {
        async function testOpenCdp({ ethAmount, daiAmount, relayed }) {
            const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
            const beforeDAI = await sai.balanceOf(wallet.contractAddress);
            const beforeDAISupply = await sai.totalSupply();

            const params = [wallet.contractAddress, ethAmount, daiAmount];
            let txReceipt;
            if (relayed) {
                txReceipt = await manager.relay(cdpManager, 'openCdp', params, wallet, [owner]);
            } else {
                const tx = await cdpManager.from(owner).openCdp(...params, { gasLimit: 2000000 });
                txReceipt = await cdpManager.verboseWaitForTransaction(tx);
            }

            const cup = txReceipt.events.find(e => e.event === 'CdpOpened').args.cup;
            assert.isDefined(cup, 'cup id should be defined')

            const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
            const afterDAI = await sai.balanceOf(wallet.contractAddress);
            const afterDAISupply = await sai.totalSupply();

            assert.equal(beforeETH.sub(afterETH).toString(), ethAmount.toString(), `wallet should have ${ethAmount} less ETH (relayed: ${relayed})`);
            assert.equal(afterDAI.sub(beforeDAI).toString(), daiAmount.toString(), `wallet should have ${daiAmount} more DAI (relayed: ${relayed})`);
            assert.equal(afterDAISupply.sub(beforeDAISupply).toString(), daiAmount.toString(), `${daiAmount} DAI should have been minted (relayed: ${relayed})`);

            return cup;
        }

        describe("Open CDP", () => {
            it('should open a CDP (blockchain tx)', async () => {
                await testOpenCdp({ ethAmount: parseEther('0.100'), daiAmount: parseEther('6.6'), relayed: false })
            });
            it('should open a CDP (relayed tx)', async () => {
                await testOpenCdp({ ethAmount: parseEther('0.100'), daiAmount: parseEther('6.6'), relayed: true })
            });
        });

        async function testChangeCollateral({ cup, ethAmount, add, relayed }) {
            const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
            const method = add ? 'addCollateral' : 'removeCollateral';
            const params = [wallet.contractAddress, cup, ethAmount];
            if (relayed) {
                await manager.relay(cdpManager, method, params, wallet, [owner]);
            } else {
                await cdpManager.from(owner)[method](...params, { gasLimit: 2000000 });
            }
            const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
            const expectedETHChange = ethAmount.mul(add ? -1 : 1).toString()
            assert.equal(afterETH.sub(beforeETH).toString(), expectedETHChange, `wallet ETH should have changed by ${expectedETHChange} (relayed: ${relayed})`);
        }

        describe("Add/Remove Collateral", () => {
            it('should add collateral (blockchain tx)', async () => {
                const cup = await testOpenCdp({ ethAmount: parseEther('0.100'), daiAmount: parseEther('2'), relayed: false })
                await testChangeCollateral({ cup: cup, ethAmount: parseEther('0.010'), add: true, relayed: false })
            });
            it('should add collateral (relayed tx)', async () => {
                const cup = await testOpenCdp({ ethAmount: parseEther('0.100'), daiAmount: parseEther('2'), relayed: true })
                await testChangeCollateral({ cup: cup, ethAmount: parseEther('0.010'), add: true, relayed: true })
            });
            it('should remove collateral (blockchain tx)', async () => {
                const cup = await testOpenCdp({ ethAmount: parseEther('0.100'), daiAmount: parseEther('2'), relayed: false })
                await testChangeCollateral({ cup: cup, ethAmount: parseEther('0.010'), add: false, relayed: false })
            });
            it('should remove collateral (relayed tx)', async () => {
                const cup = await testOpenCdp({ ethAmount: parseEther('0.100'), daiAmount: parseEther('2'), relayed: true })
                await testChangeCollateral({ cup: cup, ethAmount: parseEther('0.010'), add: false, relayed: true })
            });
        });

        async function testChangeDebt({ cup, daiAmount, add, relayed }) {
            const beforeDAI = await sai.balanceOf(wallet.contractAddress);
            const beforeDAISupply = await sai.totalSupply();
            const method = add ? 'addDebt' : 'removeDebt';
            const params = [wallet.contractAddress, cup, daiAmount].concat(add ? [] : [0, 0]);
            if (relayed) {
                await manager.relay(cdpManager, method, params, wallet, [owner]);
            } else {
                await cdpManager.from(owner)[method](...params, { gasLimit: 2000000 });
            }
            const afterDAI = await sai.balanceOf(wallet.contractAddress);
            const afterDAISupply = await sai.totalSupply();
            const expectedDAIChange = daiAmount.mul(add ? 1 : -1).toString()
            assert.equal(afterDAI.sub(beforeDAI).toString(), expectedDAIChange, `wallet DAI should have changed by ${expectedDAIChange} (relayed: ${relayed})`);
            assert.equal(afterDAISupply.sub(beforeDAISupply).toString(), expectedDAIChange, `total DAI supply should have changed by ${expectedDAIChange} (relayed: ${relayed})`);
        }

        describe("Increase Debt", () => {
            it('should increase debt (blockchain tx)', async () => {
                const cup = await testOpenCdp({ ethAmount: parseEther('0.100'), daiAmount: parseEther('2'), relayed: false })
                await testChangeDebt({ cup: cup, daiAmount: parseEther('1'), add: true, relayed: false })
            });
            it('should increase debt (relayed tx)', async () => {
                const cup = await testOpenCdp({ ethAmount: parseEther('0.100'), daiAmount: parseEther('2'), relayed: true })
                await testChangeDebt({ cup: cup, daiAmount: parseEther('1'), add: true, relayed: true })
            });
        });

        async function testRepayDebt({ useOwnMKR, relayed }) {
            if (useOwnMKR) {
                // Buy MKR
                await exchanger.from(owner).trade(
                    wallet.contractAddress,
                    ETH_TOKEN,
                    parseEther('0.1'),
                    gov.contractAddress,
                    parseEther('1000'),
                    0,
                    { gasLimit: 200000 }
                );
            }
            const cup = await testOpenCdp({ ethAmount: parseEther('0.100'), daiAmount: parseEther('2'), relayed: relayed })
            await manager.increaseTime(3600 * 24 * 365); // wait one year

            const beforeMKR = await gov.balanceOf(wallet.contractAddress);
            const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
            await testChangeDebt({ cup: cup, daiAmount: parseEther('1'), add: false, relayed: relayed })
            const afterMKR = await gov.balanceOf(wallet.contractAddress);
            const afterETH = await deployer.provider.getBalance(wallet.contractAddress);

            if (useOwnMKR)
                assert.isTrue(afterMKR.lt(beforeMKR) && afterETH.eq(beforeETH), 'governance fee should have been paid in MKR')
            else
                assert.isTrue(afterMKR.eq(beforeMKR) && afterETH.lt(beforeETH), 'governance fee should have been paid in ETH')
        }

        describe("Repay Debt", () => {
            it('should close CDP debt when paying fee in MKR (blockchain tx)', async () => {
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

        async function testCloseCdp({ useOwnMKR, relayed }) {
            if (useOwnMKR) {
                // Buy MKR
                await exchanger.from(owner).trade(
                    wallet.contractAddress,
                    ETH_TOKEN,
                    parseEther('0.1'),
                    gov.contractAddress,
                    parseEther('1000'),
                    0,
                    { gasLimit: 200000 }
                );
            }

            const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
            const beforeMKR = await gov.balanceOf(wallet.contractAddress);
            const beforeDAI = await sai.balanceOf(wallet.contractAddress);
            const beforeDAISupply = await sai.totalSupply();

            const cup = await testOpenCdp({ ethAmount: parseEther('0.100'), daiAmount: parseEther('2'), relayed: relayed });
            await manager.increaseTime(3600 * 24 * 365); // wait one year

            const method = 'closeCdp'
            const params = [wallet.contractAddress, cup, 0, 0];
            if (relayed) {
                await manager.relay(cdpManager, method, params, wallet, [owner]);
            } else {
                await cdpManager.from(owner)[method](...params, { gasLimit: 2000000 });
            }

            const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
            const afterMKR = await gov.balanceOf(wallet.contractAddress);
            const afterDAI = await sai.balanceOf(wallet.contractAddress);
            const afterDAISupply = await sai.totalSupply();

            assert.isTrue(afterDAI.eq(beforeDAI), `wallet DAI should not have changed (relayed: ${relayed})`);
            assert.isTrue(afterDAISupply.eq(beforeDAISupply), `total DAI supply should not have changed (relayed: ${relayed})`);

            if (useOwnMKR)
                assert.isTrue(afterMKR.lt(beforeMKR) && afterETH.eq(beforeETH), 'governance fee should have been paid in MKR')
            else
                assert.isTrue(afterMKR.eq(beforeMKR) && afterETH.lt(beforeETH), 'governance fee should have been paid in ETH')
            assert.equal(await tub.lad(cup), '0x0000000000000000000000000000000000000000', 'CDP should have been wiped');
        }

        describe("Close CDP", () => {
            it('should close CDP when paying fee in MKR (blockchain tx)', async () => {
                await testCloseCdp({ useOwnMKR: true, relayed: false });
            });
            it('should close CDP when paying fee in MKR (relayed tx)', async () => {
                await testCloseCdp({ useOwnMKR: true, relayed: true });
            });
            it('should close CDP when paying fee in ETH (blockchain tx)', async () => {
                await testCloseCdp({ useOwnMKR: false, relayed: false });
            });
            it('should close CDP when paying fee in ETH (relayed tx)', async () => {
                await testCloseCdp({ useOwnMKR: false, relayed: true });
            });
        });

    });

});