const TestManager = require("../utils/test-manager");
const DydxManager = require("../build/DydxManager");
const GuardianStorage = require("../build/GuardianStorage");
const Registry = require("../build/ModuleRegistry");
const Wallet = require("../build/BaseWallet");
const ERC20 = require("../build/TestERC20");

// Dydx
const AdminImpl = require("../build/AdminImpl");
const OperationImpl = require("../build/OperationImpl");
const SoloMargin = require("../build/TestSoloMargin");
const PriceOracle = require("../build/TestPriceOracle");
const InterestSetter = require("../build/PolynomialInterestSetter");
const {
    getPolynomialParams,
    getRiskLimits,
    getRiskParams
} = require("../utils/defi/dydx/helpers");

const { parseEther, bigNumberify } = require("ethers").utils;
const WAD = bigNumberify("1000000000000000000"); // 10**18
const ETH_EXCHANGE_RATE = WAD.mul("100");
const ZERO_BYTES32 = ethers.constants.HashZero;

describe("Borrow with Dydx", function () {
    this.timeout(1000000);

    const manager = new TestManager(accounts, "ganache");

    const infrastructure = accounts[0].signer;
    const owner = accounts[1].signer;
    const liquidityProvider = accounts[2].signer;

    let wallet, loanManager, dai, weth, solo, marketIds;

    before(async () => {
        deployer = manager.newDeployer();

        /* Deploy dYdX Architecture */

        // deploy tokens
        dai = await deployer.deploy(
            ERC20,
            {},
            [infrastructure.address, liquidityProvider.address],
            10000000,
            18
        );
        weth = await deployer.deploy(
            ERC20,
            {},
            [infrastructure.address, liquidityProvider.address],
            10000000,
            18
        );
        usdc = await deployer.deploy(
            ERC20,
            {},
            [infrastructure.address, liquidityProvider.address],
            10000000,
            18
        );

        // deploy and setup oracle
        const oracle = await deployer.deploy(PriceOracle);
        await oracle.setPrice(dai.contractAddress, WAD);
        await oracle.setPrice(weth.contractAddress, ETH_EXCHANGE_RATE);
        await oracle.setPrice(usdc.contractAddress, WAD);

        // deploy and setup interest setter
        const interestSetter = await deployer.deploy(
            InterestSetter,
            {},
            await getPolynomialParams("mainnet")
        );

        // deploy solo
        const adminImpl = await deployer.deploy(AdminImpl);
        const opImpl = await deployer.deploy(OperationImpl);
        solo = await deployer.deploy(
            SoloMargin,
            {
                AdminImpl: adminImpl.contractAddress,
                OperationImpl: opImpl.contractAddress
            },
            await getRiskParams("mainnet"),
            await getRiskLimits()
        );

        // add markets to solo
        marketIds = {};
        const tokens = [dai, weth, usdc];
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            marketIds[token.contractAddress] = i;
            await solo.ownerAddMarket(
                token.contractAddress,
                oracle.contractAddress,
                interestSetter.contractAddress,
                { value: "0" }, // marginPremium
                { value: "0" } // spreadPremium
            );
        }

        // add liquidity to solo
        async function deposit(depositer, token, amount) {
            await token.from(depositer).approve(solo.contractAddress, amount);
            await _operate(depositer, token, amount, 0 /* Deposit */);
        }
        async function _operate(account, token, amount, actionType) {
            await solo.from(account).operate(
                [{ owner: account.address, number: 0 }],
                [
                    {
                        accountId: 0,
                        otherAccountId: 0,
                        actionType: actionType,
                        primaryMarketId: marketIds[token.contractAddress],
                        secondaryMarketId: 0,
                        otherAddress: account.address,
                        data: "0x",
                        amount: {
                            sign: actionType === 0,
                            ref: 0 /* Delta */,
                            denomination: 0 /* Wei */,
                            value: amount
                        }
                    }
                ],
                { gasLimit: 2000000 }
            );
        }
        await deposit(liquidityProvider, dai, WAD.mul(1000000))
        await deposit(liquidityProvider, weth, WAD.mul(10000))
        await deposit(liquidityProvider, usdc, WAD.mul(10000))

        /* Deploy Argent Architecture */

        const registry = await deployer.deploy(Registry);
        const guardianStorage = await deployer.deploy(GuardianStorage);
        loanManager = await deployer.deploy(
            DydxManager,
            {},
            registry.contractAddress,
            guardianStorage.contractAddress,
            solo.contractAddress
        );
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [loanManager.contractAddress]);
    });

    describe("Loan", () => {

        async function testOpenLoan({ collateral, collateralAmount, debt, debtAmount, relayed }) {
            await collateral.from(infrastructure).transfer(wallet.contractAddress, collateralAmount);

            const collateralBefore = await collateral.balanceOf(wallet.contractAddress);
            const debtBefore = await debt.balanceOf(wallet.contractAddress);

            const params = [
                wallet.contractAddress,
                collateral.contractAddress,
                collateralAmount,
                debt.contractAddress,
                debtAmount];
            let txReceipt;
            if (relayed) {
                txReceipt = await manager.relay(loanManager, 'openLoan', params, wallet, [owner]);
            } else {
                const tx = await loanManager.from(owner).openLoan(...params, { gasLimit: 2000000 });
                txReceipt = await loanManager.verboseWaitForTransaction(tx);
            }
            assert.isTrue(await utils.hasEvent(txReceipt, loanManager, "LoanOpened"), "should have generated LoanOpened event");
            const loanId = txReceipt.events.find(e => e.event === 'LoanOpened').args._loanId;
            assert.isDefined(loanId, 'Loan ID should be defined')

            const collateralAfter = await collateral.balanceOf(wallet.contractAddress);
            const debtAfter = await debt.balanceOf(wallet.contractAddress);

            assert.isTrue(collateralBefore.sub(collateralAfter).eq(collateralAmount), `wallet should have ${collateralAmount} less ETH (relayed: ${relayed})`);
            assert.isTrue(debtAfter.sub(debtBefore).eq(debtAmount), `wallet should have ${debtAmount} more token (relayed: ${relayed})`);

            return loanId;
        }

        async function testChangeCollateral({ loanId, collateral, amount, add, relayed }) {
            add && await collateral.from(infrastructure).transfer(wallet.contractAddress, amount);
            const collateralBalanceBefore = await collateral.balanceOf(wallet.contractAddress);
            const method = add ? 'addCollateral' : 'removeCollateral';
            const params = [
                wallet.contractAddress,
                loanId,
                collateral.contractAddress,
                amount];
            let txReceipt;
            if (relayed) {
                txReceipt = await manager.relay(loanManager, method, params, wallet, [owner]);
            } else {
                let tx = await loanManager.from(owner)[method](...params, { gasLimit: 2000000 });
                txReceipt = await loanManager.verboseWaitForTransaction(tx);
            }
            const collateralBalanceAfter = await collateral.balanceOf(wallet.contractAddress);

            if (add) {
                assert.isTrue(await utils.hasEvent(txReceipt, loanManager, "CollateralAdded"), "should have generated CollateralAdded event");
                assert.isTrue(collateralBalanceAfter.eq(collateralBalanceBefore.sub(amount)), `wallet collateral should have decreased by ${amount} (relayed: ${relayed})`);
            }
            else {
                assert.isTrue(await utils.hasEvent(txReceipt, loanManager, "CollateralRemoved"), "should have generated CollateralRemoved event");
                assert.isTrue(collateralBalanceAfter.eq(collateralBalanceBefore.add(amount)), `wallet collateral should have invcreased by ${amount} (relayed: ${relayed})`);
            }
        }

        async function testChangeDebt({ loanId, debtToken, amount, add, relayed }) {
            let accountBalances = (await solo.getAccountBalances({ owner: wallet.contractAddress, number: 0 }))
            const owedBefore = accountBalances[2].find((bal, index) => accountBalances[0][index] === debtToken.contractAddress).value

            const debtTokenBalanceBefore = await debtToken.balanceOf(wallet.contractAddress);
            const method = add ? 'addDebt' : 'removeDebt';
            const params = [
                wallet.contractAddress,
                loanId,
                debtToken.contractAddress,
                amount];
            let txReceipt;
            if (relayed) {
                txReceipt = await manager.relay(loanManager, method, params, wallet, [owner]);
            } else {
                let tx = await loanManager.from(owner)[method](...params, { gasLimit: 2000000 });
                txReceipt = await loanManager.verboseWaitForTransaction(tx);
            }
            const debtTokenBalanceAfter = await debtToken.balanceOf(wallet.contractAddress);
            accountBalances = (await solo.getAccountBalances({ owner: wallet.contractAddress, number: 0 }))
            const owedAfter = accountBalances[2].find((bal, index) => accountBalances[0][index] === debtToken.contractAddress).value

            if (add) {
                assert.isTrue(await utils.hasEvent(txReceipt, loanManager, "DebtAdded"), "should have generated DebtAdded event");
                assert.isTrue(debtTokenBalanceAfter.eq(debtTokenBalanceBefore.add(amount)), `wallet debt should have increase by ${amount} (relayed: ${relayed})`);
                assert.isTrue(owedAfter.gt(owedBefore), "account debt should have increased");
            }
            else {
                assert.isTrue(owedAfter.lt(owedBefore), "account debt should have decreased");
                assert.isTrue(await utils.hasEvent(txReceipt, loanManager, "DebtRemoved"), "should have generated DebtRemoved event");
                assert.isTrue(debtTokenBalanceAfter.eq(debtTokenBalanceBefore.sub(amount)), `wallet debt should have decreased by ${amount} (relayed: ${relayed})`);
            }
        }

        describe("Open Loan", () => {
            it('should borrow dai with weth as collateral (blockchain tx)', async () => {
                let collateralAmount = parseEther('1');
                let debtAmount = parseEther('10');
                await testOpenLoan({ collateral: weth, collateralAmount, debt: dai, debtAmount, relayed: false });
            });

            it('should borrow weth with dai as collateral (relay tx)', async () => {
                let collateralAmount = parseEther('1000');
                let debtAmount = parseEther('0.2');
                await testOpenLoan({ collateral: dai, collateralAmount, debt: weth, debtAmount, relayed: true });
            });

            it('should get the info of a loan', async () => {
                let collateralAmount = parseEther('1');
                let debtAmount = parseEther('10');
                await testOpenLoan({ collateral: weth, collateralAmount, debt: dai, debtAmount, relayed: false });
                let loan = await loanManager.getLoan(wallet.contractAddress, ZERO_BYTES32);
                assert.isTrue(loan._status == 1 && loan._ethValue > 0, "should have obtained the info of the loan");
            });
        });

        describe("Add/Remove Collateral", () => {
            it('should add weth collateral to a loan (blockchain tx)', async () => {
                const loanId = await testOpenLoan({ collateral: weth, collateralAmount: parseEther('1'), debt: dai, debtAmount: parseEther('5'), relayed: false });
                await testChangeCollateral({ loanId: loanId, collateral: weth, amount: parseEther('0.1'), add: true, relayed: false });
            });

            it('should add dai collateral to a loan (relayed tx)', async () => {
                const loanId = await testOpenLoan({ collateral: dai, collateralAmount: parseEther('100'), debt: weth, debtAmount: parseEther('0.1'), relayed: false });
                await testChangeCollateral({ loanId: loanId, collateral: dai, amount: parseEther('10'), add: true, relayed: true });
            });

            it('should remove dai collateral from a loan (blockchain tx)', async () => {
                const loanId = await testOpenLoan({ collateral: dai, collateralAmount: parseEther('200'), debt: weth, debtAmount: parseEther('0.1'), relayed: false });
                await testChangeCollateral({ loanId: loanId, collateral: dai, amount: parseEther('100'), add: false, relayed: false });
            });

            it('should remove weth collateral from a loan (relayed tx)', async () => {
                const loanId = await testOpenLoan({ collateral: weth, collateralAmount: parseEther('1'), debt: dai, debtAmount: parseEther('10'), relayed: false });
                await testChangeCollateral({ loanId: loanId, collateral: weth, amount: parseEther('0.5'), add: false, relayed: true });
            });
        });

        describe("Increase/Decrease Debt", () => {
            it('should increase weth debt to a dai/weth loan (blockchain tx)', async () => {
                const loanId = await testOpenLoan({ collateral: dai, collateralAmount: parseEther('500'), debt: weth, debtAmount: parseEther('0.1'), relayed: false });
                await testChangeDebt({ loanId: loanId, debtToken: weth, amount: parseEther('0.1'), add: true, relayed: false });
            });

            it('should increase dai debt to a weth/dai loan (relayed tx)', async () => {
                const loanId = await testOpenLoan({ collateral: weth, collateralAmount: parseEther('0.5'), debt: dai, debtAmount: parseEther('10'), relayed: false });
                await testChangeDebt({ loanId: loanId, debtToken: dai, amount: parseEther('10'), add: true, relayed: true });
            });

            it('should repay dai debt to a weth/dai loan (blockchain tx)', async () => {
                const loanId = await testOpenLoan({ collateral: weth, collateralAmount: parseEther('0.5'), debt: dai, debtAmount: parseEther('20'), relayed: false });
                await testChangeDebt({ loanId: loanId, debtToken: dai, amount: parseEther('10'), add: false, relayed: false });
            });

            it('should repay weth debt to a dai/weth loan (relayed tx)', async () => {
                const loanId = await testOpenLoan({ collateral: dai, collateralAmount: parseEther('500'), debt: weth, debtAmount: parseEther('0.2'), relayed: false });
                await testChangeDebt({ loanId: loanId, debtToken: weth, amount: parseEther('0.1'), add: false, relayed: true });
            });
        });

        describe("Close Loan", () => {
            async function testCloseLoan({ loanId, relayed }) {
                let numMarket = (await solo.getAccountBalances({ owner: wallet.contractAddress, number: 0 }))[2]
                    .filter(bal => !bal.sign && bal.value.gt(0)).length
                assert.isTrue(numMarket > 0, `should have at least one debt position (relayed: ${relayed})`)

                const method = 'closeLoan'
                const params = [wallet.contractAddress, loanId];
                let txReceipt;
                if (relayed) {
                    txReceipt = await manager.relay(loanManager, method, params, wallet, [owner], accounts[9].signer, false, 2000000);
                } else {
                    let tx = await loanManager.from(owner)[method](...params, { gasLimit: 4000000 });
                    txReceipt = await loanManager.verboseWaitForTransaction(tx);
                }
                assert.isTrue(await utils.hasEvent(txReceipt, loanManager, "LoanClosed"), "should have generated LoanClosed event");

                numMarket = (await solo.getAccountBalances({ owner: wallet.contractAddress, number: 0 }))[2]
                    .filter(bal => !bal.sign && bal.value.gt(0)).length
                assert.isTrue(numMarket === 0, `should not have any more debt position (relayed: ${relayed})`);
            }

            it('should close a weth/dai loan (blockchain tx)', async () => {
                const debtAmount = parseEther('10')
                const loanId = await testOpenLoan({ collateral: weth, collateralAmount: parseEther('1'), debt: dai, debtAmount, relayed: false });
                await dai.from(infrastructure).transfer(wallet.contractAddress, debtAmount);
                await testCloseLoan({ loanId, relayed: false });
            });

            it('should close a dai/weth loan (relayed tx)', async () => {
                const debtAmount = parseEther('0.1')
                const loanId = await testOpenLoan({ collateral: dai, collateralAmount: parseEther('100'), debt: weth, debtAmount, relayed: true });
                await weth.from(infrastructure).transfer(wallet.contractAddress, debtAmount);
                await testCloseLoan({ loanId, relayed: true });
            });

            it('should close a dai/weth + a usdc/weth loan (blockchain tx)', async () => {
                const daiDebtAmount = parseEther('10')
                const usdcDebtAmount = parseEther('10')
                const loanId = await testOpenLoan({ collateral: weth, collateralAmount: parseEther('2'), debt: dai, debtAmount: daiDebtAmount, relayed: false });
                await testChangeDebt({ loanId: loanId, debtToken: usdc, amount: usdcDebtAmount, add: true, relayed: false });
                await usdc.from(infrastructure).transfer(wallet.contractAddress, usdcDebtAmount);
                await dai.from(infrastructure).transfer(wallet.contractAddress, daiDebtAmount);
                await testCloseLoan({ loanId, relayed: false });
            });

            it('should close a dai/weth + a usdc/weth loan (relayed tx)', async () => {
                const daiDebtAmount = parseEther('10')
                const usdcDebtAmount = parseEther('10')
                const loanId = await testOpenLoan({ collateral: weth, collateralAmount: parseEther('2'), debt: dai, debtAmount: daiDebtAmount, relayed: false });
                await testChangeDebt({ loanId: loanId, debtToken: usdc, amount: usdcDebtAmount, add: true, relayed: false });
                await usdc.from(infrastructure).transfer(wallet.contractAddress, usdcDebtAmount);
                await dai.from(infrastructure).transfer(wallet.contractAddress, daiDebtAmount);
                await testCloseLoan({ loanId, relayed: true });
            });
        });
    });
});
