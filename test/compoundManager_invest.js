/* global artefacts */
const { parseEther, formatBytes32String } = require("ethers").utils;
const ethers = require("ethers");
const utils = require("../utils/utilities.js");

const GuardianStorage = artifacts.require("GuardianStorage");
const LockStorage = artifacts.require("LockStorage");
const Registry = artifacts.require("ModuleRegistry");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const RelayerManager = artifacts.require("RelayerManager");
const CompoundManager = artifacts.require("CompoundManager");
const VersionManager = artifacts.require("VersionManager");

// Compound
const Unitroller = artifacts.require("Unitroller");
const PriceOracle = artifacts.require("SimplePriceOracle");
const PriceOracleProxy = artifacts.require("PriceOracleProxy");
const Comptroller = artifacts.require("Comptroller");
const InterestModel = artifacts.require("WhitePaperInterestRateModel");
const CEther = artifacts.require("CEther");
const CErc20 = artifacts.require("CErc20");
const CompoundRegistry = artifacts.require("CompoundRegistry");

const WAD = ethers.BigNumber.from("1000000000000000000"); // 10**18
const ETH_EXCHANGE_RATE = ethers.BigNumber.from("200000000000000000000000000");

const ERC20 = artifacts.require("TestERC20");

const { ETH_TOKEN } = require("../utils/utilities.js");
const TestManager = require("../utils/test-manager");

contract("Invest Manager with Compound", (accounts) => {
  const manager = new TestManager();

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const liquidityProvider = accounts[2];
  const borrower = accounts[3];

  let deployer;
  let wallet;
  let walletImplementation;
  let investManager;
  let relayerManager;
  let compoundRegistry;
  let token;
  let cToken;
  let cEther;
  let comptroller;
  let oracleProxy;
  let versionManager;

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
      formatBytes32String("Compound Ether"),
      formatBytes32String("cETH"),
      8,
    );

    // deploy token
    token = await deployer.deploy(ERC20, {}, [infrastructure, liquidityProvider, borrower], 10000000, 18);
    // deploy CToken
    cToken = await deployer.deploy(
      CErc20,
      {},
      token.contractAddress,
      comptroller.contractAddress,
      interestModel.contractAddress,
      ETH_EXCHANGE_RATE,
      "Compound Token",
      "cTOKEN",
      18,
    );
    // add price to Oracle
    await oracle.setUnderlyingPrice(cToken.contractAddress, WAD.div(10));
    // list cToken in Comptroller
    await comptroller._supportMarket(cEther.contractAddress);
    await comptroller._supportMarket(cToken.contractAddress);
    // deploy Price Oracle proxy
    oracleProxy = await deployer.deploy(PriceOracleProxy, {}, comptroller.contractAddress, oracle.contractAddress, cEther.contractAddress);
    await comptroller._setPriceOracle(oracleProxy.contractAddress);
    // set collateral factor
    await comptroller._setCollateralFactor(cToken.contractAddress, WAD.div(10));
    await comptroller._setCollateralFactor(cEther.contractAddress, WAD.div(10));

    // add liquidity to tokens
    await cEther.from(liquidityProvider).mint({ value: parseEther("100") });
    await token.from(liquidityProvider).approve(cToken.contractAddress, parseEther("100"));
    await cToken.from(liquidityProvider).mint(parseEther("10"));

    /* Deploy Argent Architecture */

    compoundRegistry = await deployer.deploy(CompoundRegistry);
    await compoundRegistry.addCToken(ETH_TOKEN, cEther.contractAddress);
    await compoundRegistry.addCToken(token.contractAddress, cToken.contractAddress);
    const registry = await deployer.deploy(Registry);
    const guardianStorage = await deployer.deploy(GuardianStorage);
    const lockStorage = await deployer.deploy(LockStorage);
    versionManager = await deployer.deploy(VersionManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);

    investManager = await deployer.deploy(
      CompoundManager,
      {},
      lockStorage.contractAddress,
      comptroller.contractAddress,
      compoundRegistry.contractAddress,
      versionManager.contractAddress,
    );

    walletImplementation = await deployer.deploy(BaseWallet);

    relayerManager = await deployer.deploy(RelayerManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.contractAddress);
    manager.setRelayerManager(relayerManager);

    await versionManager.addVersion([
      investManager.contractAddress,
      relayerManager.contractAddress,
    ], []);
  });

  beforeEach(async () => {
    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
    await wallet.init(owner, [versionManager.contractAddress]);
    await versionManager.from(owner).upgradeWallet(wallet.contractAddress, await versionManager.lastVersion());
  });

  describe("Environment", () => {
    it("should deploy the environment correctly", async () => {
      const getCToken = await compoundRegistry.getCToken(token.contractAddress);
      assert.isTrue(getCToken === cToken.contractAddress, "cToken should be registered");
      const getCEther = await compoundRegistry.getCToken(ETH_TOKEN);
      assert.isTrue(getCEther === cEther.contractAddress, "cEther should be registered");
      const cOracle = await comptroller.oracle();
      assert.isTrue(cOracle === oracleProxy.contractAddress, "oracle should be registered");
      const cTokenPrice = await oracleProxy.getUnderlyingPrice(cToken.contractAddress);
      assert.isTrue(cTokenPrice.eq(WAD.div(10)), "cToken price should be 1e17");
      const cEtherPrice = await oracleProxy.getUnderlyingPrice(cEther.contractAddress);
      assert.isTrue(cEtherPrice.eq(WAD), "cEther price should be 1e18");
    });
  });

  describe("Investment", () => {
    async function accrueInterests(days, investInEth) {
      let tx; let
        txReceipt;
      // genrate borrows to create interests
      await comptroller.from(borrower).enterMarkets([cEther.contractAddress, cToken.contractAddress]);
      if (investInEth) {
        await token.from(borrower).approve(cToken.contractAddress, parseEther("20"));
        await cToken.from(borrower).mint(parseEther("20"));
        tx = await cEther.from(borrower).borrow(parseEther("0.1"));
        txReceipt = await cEther.verboseWaitForTransaction(tx);
        assert.isTrue(await utils.hasEvent(txReceipt, cEther, "Borrow"), "should have generated Borrow event");
      } else {
        await cEther.from(borrower).mint({ value: parseEther("2") });
        tx = await cToken.from(borrower).borrow(parseEther("0.1"));
        txReceipt = await cToken.verboseWaitForTransaction(tx);
        assert.isTrue(await utils.hasEvent(txReceipt, cToken, "Borrow"), "should have generated Borrow event");
      }
      // increase time to accumulate interests
      await manager.increaseTime(3600 * 24 * days);
      await cToken.accrueInterest();
      await cEther.accrueInterest();
    }

    async function addInvestment(tokenAddress, amount, days, relay = false) {
      let tx;
      let txReceipt;
      const investInEth = (tokenAddress === ETH_TOKEN);

      if (investInEth) {
        tx = await wallet.send(amount);
      } else {
        await token.from(infrastructure).transfer(wallet.contractAddress, amount);
      }
      const params = [wallet.contractAddress, tokenAddress, amount, 0];
      if (relay) {
        txReceipt = await manager.relay(investManager, "addInvestment", params, wallet, [owner]);
      } else {
        tx = await investManager.from(owner).addInvestment(...params);
        txReceipt = await investManager.verboseWaitForTransaction(tx);
      }

      assert.isTrue(await utils.hasEvent(txReceipt, investManager, "InvestmentAdded"), "should have generated InvestmentAdded event");

      await accrueInterests(days, investInEth);

      const output = await investManager.getInvestment(wallet.contractAddress, tokenAddress);
      assert.isTrue(output._tokenValue > amount, "investment should have gained value");

      return output._tokenValue;
    }

    async function removeInvestment(tokenAddress, fraction, relay = false) {
      let tx; let
        txReceipt;
      const investInEth = (tokenAddress === ETH_TOKEN);

      await addInvestment(tokenAddress, parseEther("0.1"), 365, false);
      const before = investInEth ? await cEther.balanceOf(wallet.contractAddress) : await cToken.balanceOf(wallet.contractAddress);

      const params = [wallet.contractAddress, tokenAddress, fraction];
      if (relay) {
        txReceipt = await manager.relay(investManager, "removeInvestment", params, wallet, [owner]);
      } else {
        tx = await investManager.from(owner).removeInvestment(...params);
        txReceipt = await investManager.verboseWaitForTransaction(tx);
      }
      assert.isTrue(await utils.hasEvent(txReceipt, investManager, "InvestmentRemoved"), "should have generated InvestmentRemoved event");

      const after = investInEth ? await cEther.balanceOf(wallet.contractAddress) : await cToken.balanceOf(wallet.contractAddress);
      assert.isTrue(after.eq(Math.ceil((before * (10000 - fraction)) / 10000)), "should have removed the correct fraction");
    }

    describe("Add Investment", () => {
      // Successes

      it("should invest in ERC20 for 1 year and gain interests (blockchain tx)", async () => {
        await addInvestment(token.contractAddress, parseEther("1"), 365, false);
      });

      it("should invest in ERC20 for 1 year and gain interests (relay tx)", async () => {
        await addInvestment(token.contractAddress, parseEther("1"), 365, true);
      });

      it("should invest in ETH for 1 year and gain interests (blockchain tx)", async () => {
        await addInvestment(ETH_TOKEN, parseEther("1"), 365, false);
      });

      it("should invest in ETH for 1 year and gain interests (relay tx)", async () => {
        await addInvestment(ETH_TOKEN, parseEther("1"), 365, true);
      });

      // Reverts

      it("should fail to invest in ERC20 with an unknown token", async () => {
        const params = [wallet.contractAddress, ethers.constants.AddressZero, parseEther("1"), 0];
        await assert.revertWith(investManager.from(owner).addInvestment(...params), "CM: No market for target token");
      });

      it("should fail to invest in ERC20 with an amount of zero", async () => {
        const params = [wallet.contractAddress, token.contractAddress, 0, 0];
        await assert.revertWith(investManager.from(owner).addInvestment(...params), "CM: amount cannot be 0");
      });

      it("should fail to invest in ERC20 when not holding any ERC20", async () => {
        const params = [wallet.contractAddress, token.contractAddress, parseEther("1"), 0];
        await assert.revertWith(investManager.from(owner).addInvestment(...params), "CM: mint failed");
      });
    });

    describe("Remove Investment", () => {
      // Successes

      function testRemoveERC20Investment(fraction, relay) {
        it(`should remove ${fraction / 100}% of an ERC20 investment (${relay ? "relay" : "blockchain"} tx)`, async () => {
          await removeInvestment(token.contractAddress, fraction, relay);
        });
      }
      function testRemoveETHInvestment(fraction, relay) {
        it(`should remove ${fraction / 100}% of an ETH investment (${relay ? "relay" : "blockchain"} tx)`, async () => {
          await removeInvestment(token.contractAddress, fraction, relay);
        });
      }

      for (let i = 1; i < 6; i += 1) {
        testRemoveERC20Investment(i * 2000, true);
        testRemoveERC20Investment(i * 2000, false);
        testRemoveETHInvestment(i * 2000, true);
        testRemoveETHInvestment(i * 2000, false);
      }

      // Reverts

      it("should fail to remove an ERC20 investment when passing an invalid fraction value", async () => {
        const params = [wallet.contractAddress, token.contractAddress, 50000];
        await assert.revertWith(investManager.from(owner).removeInvestment(...params), "CM: invalid fraction value");
      });

      it("should fail to remove an ERC20 investment when not holding any of the corresponding cToken", async () => {
        const params = [wallet.contractAddress, token.contractAddress, 5000];
        await assert.revertWith(investManager.from(owner).removeInvestment(...params), "CM: amount cannot be 0");
      });

      it("should fail to remove all of an ERC20 investment when it collateralizes a loan", async () => {
        const collateralAmount = parseEther("1");
        const debtAmount = parseEther("0.001");
        await token.from(infrastructure).transfer(wallet.contractAddress, collateralAmount);
        const openLoanParams = [
          wallet.contractAddress,
          token.contractAddress,
          collateralAmount,
          ETH_TOKEN,
          debtAmount];
        await investManager.from(owner).openLoan(...openLoanParams);
        const removeInvestmentParams = [wallet.contractAddress, token.contractAddress, 10000];
        await assert.revertWith(investManager.from(owner).removeInvestment(...removeInvestmentParams), "CM: redeem failed");
      });
    });
  });
});
