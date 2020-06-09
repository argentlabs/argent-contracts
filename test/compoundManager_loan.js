/* global accounts, utils */
const ethers = require("ethers");
const { parseEther, bigNumberify } = require("ethers").utils;

const GuardianStorage = require("../build/GuardianStorage");
const Registry = require("../build/ModuleRegistry");

const Wallet = require("../build/BaseWallet");
const CompoundManager = require("../build/CompoundManager");

// Compound
const Unitroller = require("../build/Unitroller");
const PriceOracle = require("../build/SimplePriceOracle");
const PriceOracleProxy = require("../build/PriceOracleProxy");
const Comptroller = require("../build/Comptroller");
const InterestModel = require("../build/WhitePaperInterestRateModel");
const CEther = require("../build/CEther");
const CErc20 = require("../build/CErc20");
const CompoundRegistry = require("../build/CompoundRegistry");

const WAD = bigNumberify("1000000000000000000"); // 10**18
const ETH_EXCHANGE_RATE = bigNumberify("200000000000000000000000000");


const ERC20 = require("../build/TestERC20");

const { ETH_TOKEN } = require("../utils/utilities.js");
const TestManager = require("../utils/test-manager");

const ZERO_BYTES32 = ethers.constants.HashZero;

describe("Loan Module", function () {
  this.timeout(1000000);

  const manager = new TestManager();

  const infrastructure = accounts[0].signer;
  const owner = accounts[1].signer;
  const liquidityProvider = accounts[2].signer;
  const borrower = accounts[3].signer;

  let deployer;
  let wallet;
  let loanManager;
  let compoundRegistry;
  let token1;
  let token2;
  let cToken1;
  let cToken2;
  let cEther;
  let comptroller;
  let oracleProxy;

  before(async () => {
    deployer = manager.newDeployer();

    /* Deploy Compound V2 Architecture */

    // deploy price oracle
    const oracle = await deployer.deploy(PriceOracle);
    // deploy comptroller
    const comptrollerProxy = await deployer.deploy(Unitroller);
    const comptrollerImpl = await deployer.deploy(Comptroller);
    await comptrollerProxy._setPendingImplementation(comptrollerImpl.contractAddress);
    await comptrollerImpl._become(comptrollerProxy.contractAddress, oracle.contractAddress, WAD.div(10), 5, false);
    comptroller = deployer.wrapDeployedContract(Comptroller, comptrollerProxy.contractAddress);
    // deploy Interest rate model
    const interestModel = await deployer.deploy(InterestModel, {}, WAD.mul(250).div(10000), WAD.mul(2000).div(10000));
    // deploy CEther
    cEther = await deployer.deploy(
      CEther,
      {},
      comptroller.contractAddress,
      interestModel.contractAddress,
      ETH_EXCHANGE_RATE,
      "Compound Ether",
      "cETH",
      8,
    );

    // deploy token
    token1 = await deployer.deploy(ERC20, {}, [infrastructure.address, liquidityProvider.address, borrower.address], 10000000, 18);
    token2 = await deployer.deploy(ERC20, {}, [infrastructure.address, liquidityProvider.address, borrower.address], 10000000, 18);
    // deploy CToken
    cToken1 = await deployer.deploy(
      CErc20,
      {},
      token1.contractAddress,
      comptroller.contractAddress,
      interestModel.contractAddress,
      ETH_EXCHANGE_RATE,
      "Compound Token 1",
      "cTOKEN1",
      18,
    );
    cToken2 = await deployer.deploy(
      CErc20,
      {},
      token2.contractAddress,
      comptroller.contractAddress,
      interestModel.contractAddress,
      ETH_EXCHANGE_RATE,
      "Compound Token 2",
      "cTOKEN2",
      18,
    );

    // add price to Oracle
    await oracle.setUnderlyingPrice(cToken1.contractAddress, WAD.div(10));
    await oracle.setUnderlyingPrice(cToken2.contractAddress, WAD.div(10));
    // list cToken in Comptroller
    await comptroller._supportMarket(cEther.contractAddress);
    await comptroller._supportMarket(cToken1.contractAddress);
    await comptroller._supportMarket(cToken2.contractAddress);
    // deploy Price Oracle proxy
    oracleProxy = await deployer.deploy(PriceOracleProxy, {}, comptroller.contractAddress, oracle.contractAddress, cEther.contractAddress);
    await comptroller._setPriceOracle(oracleProxy.contractAddress);
    // set collateral factor
    await comptroller._setCollateralFactor(cToken1.contractAddress, WAD.div(10));
    await comptroller._setCollateralFactor(cToken2.contractAddress, WAD.div(10));
    await comptroller._setCollateralFactor(cEther.contractAddress, WAD.div(10));

    // add liquidity to tokens
    await cEther.from(liquidityProvider).mint({ value: parseEther("100") });
    await token1.from(liquidityProvider).approve(cToken1.contractAddress, parseEther("10"));
    await cToken1.from(liquidityProvider).mint(parseEther("10"));
    await token2.from(liquidityProvider).approve(cToken2.contractAddress, parseEther("10"));
    await cToken2.from(liquidityProvider).mint(parseEther("10"));

    /* Deploy Argent Architecture */

    compoundRegistry = await deployer.deploy(CompoundRegistry);
    await compoundRegistry.addCToken(ETH_TOKEN, cEther.contractAddress);
    await compoundRegistry.addCToken(token1.contractAddress, cToken1.contractAddress);
    await compoundRegistry.addCToken(token2.contractAddress, cToken2.contractAddress);
    const registry = await deployer.deploy(Registry);
    const guardianStorage = await deployer.deploy(GuardianStorage);

    loanManager = await deployer.deploy(
      CompoundManager,
      {},
      registry.contractAddress,
      guardianStorage.contractAddress,
      comptroller.contractAddress,
      compoundRegistry.contractAddress,
    );
  });

  beforeEach(async () => {
    wallet = await deployer.deploy(Wallet);
    await wallet.init(owner.address, [loanManager.contractAddress]);
  });

  async function fundWallet({ ethAmount, token1Amount, token2Amount = 0 }) {
    if (ethAmount > 0) await infrastructure.sendTransaction({ to: wallet.contractAddress, value: ethAmount });
    if (token1Amount > 0) await token1.from(infrastructure).transfer(wallet.contractAddress, token1Amount);
    if (token2Amount > 0) await token2.from(infrastructure).transfer(wallet.contractAddress, token2Amount);
  }

  describe("Loan", () => {
    async function testOpenLoan({
      collateral, collateralAmount, debt, debtAmount, relayed,
    }) {
      const collateralBefore = (collateral === ETH_TOKEN) ? await deployer.provider.getBalance(wallet.contractAddress)
        : await collateral.balanceOf(wallet.contractAddress);
      const debtBefore = (debt === ETH_TOKEN) ? await deployer.provider.getBalance(wallet.contractAddress)
        : await debt.balanceOf(wallet.contractAddress);

      const params = [
        wallet.contractAddress,
        (collateral === ETH_TOKEN) ? ETH_TOKEN : collateral.contractAddress,
        collateralAmount,
        (debt === ETH_TOKEN) ? ETH_TOKEN : debt.contractAddress,
        debtAmount];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(loanManager, "openLoan", params, wallet, [owner]);
      } else {
        const tx = await loanManager.from(owner).openLoan(...params);
        txReceipt = await loanManager.verboseWaitForTransaction(tx);
      }
      assert.isTrue(await utils.hasEvent(txReceipt, loanManager, "LoanOpened"), "should have generated LoanOpened event");
      const loanId = txReceipt.events.find((e) => e.event === "LoanOpened").args._loanId;
      assert.isDefined(loanId, "Loan ID should be defined");

      const collateralAfter = (collateral === ETH_TOKEN) ? await deployer.provider.getBalance(wallet.contractAddress)
        : await collateral.balanceOf(wallet.contractAddress);
      const debtAfter = (debt === ETH_TOKEN) ? await deployer.provider.getBalance(wallet.contractAddress)
        : await debt.balanceOf(wallet.contractAddress);

      assert.isTrue(collateralBefore.sub(collateralAfter).eq(collateralAmount),
        `wallet should have ${collateralAmount} less ETH (relayed: ${relayed})`);
      assert.isTrue(debtAfter.sub(debtBefore).eq(debtAmount), `wallet should have ${debtAmount} more token (relayed: ${relayed})`);

      return loanId;
    }

    async function testChangeCollateral({
      loanId, collateral, amount, add, relayed,
    }) {
      const collateralBalanceBefore = (collateral === ETH_TOKEN) ? await deployer.provider.getBalance(wallet.contractAddress)
        : await collateral.balanceOf(wallet.contractAddress);

      const method = add ? "addCollateral" : "removeCollateral";
      const params = [
        wallet.contractAddress,
        loanId,
        (collateral === ETH_TOKEN) ? ETH_TOKEN : collateral.contractAddress,
        amount];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(loanManager, method, params, wallet, [owner]);
      } else {
        const tx = await loanManager.from(owner)[method](...params);
        txReceipt = await loanManager.verboseWaitForTransaction(tx);
      }
      const collateralBalanceAfter = (collateral === ETH_TOKEN) ? await deployer.provider.getBalance(wallet.contractAddress)
        : await collateral.balanceOf(wallet.contractAddress);
      if (add) {
        assert.isTrue(await utils.hasEvent(txReceipt, loanManager, "CollateralAdded"), "should have generated CollateralAdded event");
        assert.isTrue(collateralBalanceAfter.eq(collateralBalanceBefore.sub(amount)),
          `wallet collateral should have decreased by ${amount} (relayed: ${relayed})`);
      } else {
        assert.isTrue(await utils.hasEvent(txReceipt, loanManager, "CollateralRemoved"), "should have generated CollateralRemoved event");
        assert.isTrue(collateralBalanceAfter.eq(collateralBalanceBefore.add(amount)),
          `wallet collateral should have invcreased by ${amount} (relayed: ${relayed})`);
      }
    }

    async function testChangeDebt({
      loanId, debtToken, amount, add, relayed,
    }) {
      const debtBalanceBefore = (debtToken === ETH_TOKEN) ? await deployer.provider.getBalance(wallet.contractAddress)
        : await debtToken.balanceOf(wallet.contractAddress);

      const method = add ? "addDebt" : "removeDebt";
      const params = [
        wallet.contractAddress,
        loanId,
        (debtToken === ETH_TOKEN) ? ETH_TOKEN : debtToken.contractAddress,
        amount];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(loanManager, method, params, wallet, [owner]);
      } else {
        const tx = await loanManager.from(owner)[method](...params);
        txReceipt = await loanManager.verboseWaitForTransaction(tx);
      }
      const debtBalanceAfter = (debtToken === ETH_TOKEN) ? await deployer.provider.getBalance(wallet.contractAddress)
        : await debtToken.balanceOf(wallet.contractAddress);
      if (add) {
        assert.isTrue(await utils.hasEvent(txReceipt, loanManager, "DebtAdded"), "should have generated DebtAdded event");
        assert.isTrue(debtBalanceAfter.eq(debtBalanceBefore.add(amount)), `wallet debt should have increase by ${amount} (relayed: ${relayed})`);
      } else {
        assert.isTrue(await utils.hasEvent(txReceipt, loanManager, "DebtRemoved"), "should have generated DebtRemoved event");
        assert.isTrue(debtBalanceAfter.eq(debtBalanceBefore.sub(amount)), `wallet debt should have decreased by ${amount} (relayed: ${relayed})`);
      }
    }

    describe("Open Loan", () => {
      it("should borrow token with ETH as collateral (blockchain tx)", async () => {
        const collateralAmount = parseEther("0.1");
        const debtAmount = parseEther("0.05");
        await fundWallet({ ethAmount: collateralAmount, token1Amount: 0 });
        await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount, debt: token1, debtAmount, relayed: false,
        });
      });

      it("should borrow ETH with token as collateral (blockchain tx)", async () => {
        const collateralAmount = parseEther("0.5");
        const debtAmount = parseEther("0.001");
        await fundWallet({ ethAmount: 0, token1Amount: collateralAmount });
        await testOpenLoan({
          collateral: token1, collateralAmount, debt: ETH_TOKEN, debtAmount, relayed: false,
        });
      });

      it("should borrow token with ETH as collateral (relay tx)", async () => {
        const collateralAmount = parseEther("0.1");
        const debtAmount = parseEther("0.05");
        await fundWallet({ ethAmount: collateralAmount, token1Amount: 0 });
        await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount, debt: token1, debtAmount, relayed: true,
        });
      });

      it("should borrow ETH with token as collateral (relay tx)", async () => {
        const collateralAmount = parseEther("0.5");
        const debtAmount = parseEther("0.001");
        await fundWallet({ ethAmount: 0, token1Amount: collateralAmount });
        await testOpenLoan({
          collateral: token1, collateralAmount, debt: ETH_TOKEN, debtAmount, relayed: true,
        });
      });

      it("should get the info of a loan", async () => {
        const collateralAmount = parseEther("0.1");
        const debtAmount = parseEther("0.01");
        await fundWallet({ ethAmount: collateralAmount, token1Amount: 0 });
        await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount, debt: token1, debtAmount, relayed: false,
        });
        const loan = await loanManager.getLoan(wallet.contractAddress, ZERO_BYTES32);
        assert.isTrue(loan._status === 1 && loan._ethValue > 0, "should have obtained the info of the loan");
      });
    });

    describe("Add/Remove Collateral", () => {
      it("should add ETH collateral to a loan (blockchain tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.2"), token1Amount: 0 });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.1"), debt: token1, debtAmount: parseEther("0.05"), relayed: false,
        });
        await testChangeCollateral({
          loanId, collateral: ETH_TOKEN, amount: parseEther("0.1"), add: true, relayed: false,
        });
      });

      it("should add ETH collateral to a loan (relayed tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.2"), token1Amount: 0 });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.1"), debt: token1, debtAmount: parseEther("0.01"), relayed: false,
        });
        await testChangeCollateral({
          loanId, collateral: ETH_TOKEN, amount: parseEther("0.1"), add: true, relayed: true,
        });
      });

      it("should remove ETH collateral from a loan (blockchain tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.2"), token1Amount: 0 });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.2"), debt: token1, debtAmount: parseEther("0.01"), relayed: false,
        });
        await testChangeCollateral({
          loanId, collateral: ETH_TOKEN, amount: parseEther("0.001"), add: false, relayed: false,
        });
      });

      it("should remove ETH collateral from a loan (relayed tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.2"), token1Amount: 0 });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.1"), debt: token1, debtAmount: parseEther("0.01"), relayed: false,
        });
        await testChangeCollateral({
          loanId, collateral: ETH_TOKEN, amount: parseEther("0.001"), add: false, relayed: true,
        });
      });

      it("should add token collateral to a loan (blockchain tx)", async () => {
        await fundWallet({ ethAmount: 0, token1Amount: parseEther("0.6") });
        const loanId = await testOpenLoan({
          collateral: token1, collateralAmount: parseEther("0.5"), debt: ETH_TOKEN, debtAmount: parseEther("0.001"), relayed: false,
        });
        await testChangeCollateral({
          loanId, collateral: token1, amount: parseEther("0.1"), add: true, relayed: false,
        });
      });

      it("should add token collateral to a loan (relayed tx)", async () => {
        await fundWallet({ ethAmount: 0, token1Amount: parseEther("0.6") });
        const loanId = await testOpenLoan({
          collateral: token1, collateralAmount: parseEther("0.5"), debt: ETH_TOKEN, debtAmount: parseEther("0.001"), relayed: false,
        });
        await testChangeCollateral({
          loanId, collateral: token1, amount: parseEther("0.1"), add: true, relayed: true,
        });
      });

      it("should remove token collateral from a loan (blockchain tx)", async () => {
        await fundWallet({ ethAmount: 0, token1Amount: parseEther("0.5") });
        const loanId = await testOpenLoan({
          collateral: token1, collateralAmount: parseEther("0.5"), debt: ETH_TOKEN, debtAmount: parseEther("0.001"), relayed: false,
        });
        await testChangeCollateral({
          loanId, collateral: token1, amount: parseEther("0.1"), add: false, relayed: false,
        });
      });

      it("should remove token collateral from a loan (relayed tx)", async () => {
        await fundWallet({ ethAmount: 0, token1Amount: parseEther("0.5") });
        const loanId = await testOpenLoan({
          collateral: token1, collateralAmount: parseEther("0.5"), debt: ETH_TOKEN, debtAmount: parseEther("0.001"), relayed: false,
        });
        await testChangeCollateral({
          loanId, collateral: token1, amount: parseEther("0.1"), add: false, relayed: true,
        });
      });
    });

    describe("Increase/Decrease Debt", () => {
      it("should increase ETH debt to a token1/ETH loan (blockchain tx)", async () => {
        await fundWallet({ ethAmount: 0, token1Amount: parseEther("0.5") });
        const loanId = await testOpenLoan({
          collateral: token1, collateralAmount: parseEther("0.5"), debt: ETH_TOKEN, debtAmount: parseEther("0.001"), relayed: false,
        });
        await testChangeDebt({
          loanId, debtToken: ETH_TOKEN, amount: parseEther("0.001"), add: true, relayed: false,
        });
      });

      it("should increase ETH debt to a token1/ETH loan (relayed tx)", async () => {
        await fundWallet({ ethAmount: 0, token1Amount: parseEther("0.5") });
        const loanId = await testOpenLoan({
          collateral: token1, collateralAmount: parseEther("0.5"), debt: ETH_TOKEN, debtAmount: parseEther("0.001"), relayed: false,
        });
        await testChangeDebt({
          loanId, debtToken: ETH_TOKEN, amount: parseEther("0.001"), add: true, relayed: true,
        });
      });

      it("should increase token1 debt to a ETH/token1 loan (blockchain tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.5"), token1Amount: 0 });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.5"), debt: token1, debtAmount: parseEther("0.01"), relayed: false,
        });
        await testChangeDebt({
          loanId, debtToken: token1, amount: parseEther("0.01"), add: true, relayed: false,
        });
      });

      it("should increase token1 debt to a ETH/token1 loan (relayed tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.5"), token1Amount: 0 });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.5"), debt: token1, debtAmount: parseEther("0.01"), relayed: false,
        });
        await testChangeDebt({
          loanId, debtToken: token1, amount: parseEther("0.01"), add: true, relayed: true,
        });
      });

      it("should increase token2 debt to a ETH/token1 loan (blockchain tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.5"), token1Amount: 0 });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.5"), debt: token1, debtAmount: parseEther("0.01"), relayed: false,
        });
        await testChangeDebt({
          loanId, debtToken: token2, amount: parseEther("0.01"), add: true, relayed: false,
        });
      });

      it("should increase token2 debt to a ETH/token1 loan (relayed tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.5"), token1Amount: 0 });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.5"), debt: token1, debtAmount: parseEther("0.01"), relayed: false,
        });
        await testChangeDebt({
          loanId, debtToken: token2, amount: parseEther("0.01"), add: true, relayed: true,
        });
      });

      it("should repay ETH debt to a token1/ETH loan (blockchain tx)", async () => {
        await fundWallet({ ethAmount: 0, token1Amount: parseEther("0.5") });
        const loanId = await testOpenLoan({
          collateral: token1, collateralAmount: parseEther("0.5"), debt: ETH_TOKEN, debtAmount: parseEther("0.001"), relayed: false,
        });
        await testChangeDebt({
          loanId, debtToken: ETH_TOKEN, amount: parseEther("0.0005"), add: false, relayed: false,
        });
      });

      it("should repay ETH debt to a token1/ETH loan (relay tx)", async () => {
        await fundWallet({ ethAmount: 0, token1Amount: parseEther("0.5") });
        const loanId = await testOpenLoan({
          collateral: token1, collateralAmount: parseEther("0.5"), debt: ETH_TOKEN, debtAmount: parseEther("0.001"), relayed: false,
        });
        await testChangeDebt({
          loanId, debtToken: ETH_TOKEN, amount: parseEther("0.0005"), add: false, relayed: true,
        });
      });

      it("should repay token1 debt to a ETH/token1 loan (blockchain tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.5"), token1Amount: 0 });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.5"), debt: token1, debtAmount: parseEther("0.01"), relayed: false,
        });
        await testChangeDebt({
          loanId, debtToken: token1, amount: parseEther("0.005"), add: true, relayed: false,
        });
      });

      it("should repay token1 debt to a ETH/token1 loan (relayed tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.5"), token1Amount: 0 });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.5"), debt: token1, debtAmount: parseEther("0.01"), relayed: false,
        });
        await testChangeDebt({
          loanId, debtToken: token1, amount: parseEther("0.005"), add: true, relayed: true,
        });
      });
    });

    describe("Close Loan", () => {
      async function testCloseLoan({ loanId, relayed, debtMarkets = 1 }) {
        const marketsBefore = await comptroller.getAssetsIn(wallet.contractAddress);
        const method = "closeLoan";
        const params = [wallet.contractAddress, loanId];
        let txReceipt;
        if (relayed) {
          txReceipt = await manager.relay(loanManager, method, params, wallet, [owner], accounts[9].signer, false, 2000000);
        } else {
          const tx = await loanManager.from(owner)[method](...params);
          txReceipt = await loanManager.verboseWaitForTransaction(tx);
        }
        assert.isTrue(await utils.hasEvent(txReceipt, loanManager, "LoanClosed"), "should have generated LoanClosed event");

        const marketsAfter = await comptroller.getAssetsIn(wallet.contractAddress);
        assert.isTrue(marketsAfter.length === marketsBefore.length - debtMarkets, `should have exited ${debtMarkets} market (relayed: ${relayed})`);
      }

      it("should close an ETH/token1 loan (blockchain tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.5"), token1Amount: parseEther("0.5") });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.1"), debt: token1, debtAmount: parseEther("0.01"), relayed: false,
        });
        await testCloseLoan({ loanId, relayed: false });
      });

      it("should close an ETH/token1 loan (relayed tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.5"), token1Amount: parseEther("0.5") });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.1"), debt: token1, debtAmount: parseEther("0.01"), relayed: false,
        });
        await testCloseLoan({ loanId, relayed: true });
      });

      it("should close an token1/ETH loan (blockchain tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.1"), token1Amount: parseEther("0.5") });
        const loanId = await testOpenLoan({
          collateral: token1, collateralAmount: parseEther("0.5"), debt: ETH_TOKEN, debtAmount: parseEther("0.001"), relayed: false,
        });
        await testCloseLoan({ loanId, relayed: false });
      });

      it("should close an token1/ETH loan (relayed tx)", async () => {
        await fundWallet({ ethAmount: parseEther("0.1"), token1Amount: parseEther("0.5") });
        const loanId = await testOpenLoan({
          collateral: token1, collateralAmount: parseEther("0.5"), debt: ETH_TOKEN, debtAmount: parseEther("0.001"), relayed: false,
        });
        await testCloseLoan({ loanId, relayed: true });
      });

      it("should close an ETH/token1+token2 loan (blockchain tx)", async () => {
        await fundWallet({ ethAmount: parseEther("1"), token1Amount: parseEther("0.5"), token2Amount: parseEther("0.5") });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.2"), debt: token1, debtAmount: parseEther("0.01"), relayed: false,
        });
        await testChangeDebt({
          loanId, debtToken: token2, amount: parseEther("0.001"), add: true, relayed: false,
        });
        await testCloseLoan({ loanId, relayed: false, debtMarkets: 2 });
      });

      it("should close an ETH/token1+token2 loan (relayed tx)", async () => {
        await fundWallet({ ethAmount: parseEther("1"), token1Amount: parseEther("0.5"), token2Amount: parseEther("0.5") });
        const loanId = await testOpenLoan({
          collateral: ETH_TOKEN, collateralAmount: parseEther("0.2"), debt: token1, debtAmount: parseEther("0.01"), relayed: false,
        });
        await testChangeDebt({
          loanId, debtToken: token2, amount: parseEther("0.001"), add: true, relayed: false,
        });
        await testCloseLoan({ loanId, relayed: true, debtMarkets: 2 });
      });
    });
  });
});
