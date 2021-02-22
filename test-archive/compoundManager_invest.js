/* global artifacts */
const truffleAssert = require("truffle-assertions");
const { formatBytes32String } = require("ethers").utils;
const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));
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
const CToken = artifacts.require("CToken");
const CompoundRegistry = artifacts.require("CompoundRegistry");

const WAD = new BN("1000000000000000000"); // 10**18
const ETH_EXCHANGE_RATE = new BN("200000000000000000000000000");

const ERC20 = artifacts.require("TestERC20");

const { ETH_TOKEN } = require("../utils/utilities.js");
const RelayManager = require("../utils/relay-manager");

contract("Invest Manager with Compound", (accounts) => {
  const manager = new RelayManager();

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const liquidityProvider = accounts[2];
  const borrower = accounts[3];

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
    /* Deploy Compound V2 Architecture */

    // deploy price oracle
    const oracle = await PriceOracle.new();

    // deploy comptroller
    const comptrollerProxy = await Unitroller.new();
    const comptrollerImpl = await Comptroller.new();
    await comptrollerProxy._setPendingImplementation(comptrollerImpl.address);
    await comptrollerImpl._become(comptrollerProxy.address, oracle.address, WAD.divn(10), 5, false);
    comptroller = await Comptroller.at(comptrollerProxy.address);
    // deploy Interest rate model
    const interestModel = await InterestModel.new(WAD.muln(250).divn(10000), WAD.muln(2000).divn(10000));
    // deploy CEther
    cEther = await CEther.new(
      comptrollerProxy.address,
      interestModel.address,
      ETH_EXCHANGE_RATE,
      formatBytes32String("Compound Ether"),
      formatBytes32String("cETH"),
      8,
    );

    // deploy token
    token = await ERC20.new([infrastructure, liquidityProvider, borrower], 10000000, 18);
    // deploy CToken
    cToken = await CErc20.new(
      token.address,
      comptroller.address,
      interestModel.address,
      ETH_EXCHANGE_RATE,
      "Compound Token",
      "cTOKEN",
      18,
    );
    // add price to Oracle
    await oracle.setUnderlyingPrice(cToken.address, WAD.divn(10));
    // list cToken in Comptroller
    await comptroller._supportMarket(cEther.address);
    await comptroller._supportMarket(cToken.address);
    // deploy Price Oracle proxy
    oracleProxy = await PriceOracleProxy.new(comptroller.address, oracle.address, cEther.address);
    await comptroller._setPriceOracle(oracleProxy.address);
    // set collateral factor
    await comptroller._setCollateralFactor(cToken.address, WAD.divn(10));
    await comptroller._setCollateralFactor(cEther.address, WAD.divn(10));

    // add liquidity to tokens
    const tenEther = await web3.utils.toWei("10");
    await cEther.mint({ value: tenEther, from: liquidityProvider });
    await token.approve(cToken.address, tenEther, { from: liquidityProvider });
    await cToken.mint(web3.utils.toWei("1"), { from: liquidityProvider });

    /* Deploy Argent Architecture */

    compoundRegistry = await CompoundRegistry.new();
    await compoundRegistry.addCToken(ETH_TOKEN, cEther.address);
    await compoundRegistry.addCToken(token.address, cToken.address);
    const registry = await Registry.new();
    const guardianStorage = await GuardianStorage.new();
    const lockStorage = await LockStorage.new();
    versionManager = await VersionManager.new(
      registry.address,
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);

    investManager = await CompoundManager.new(
      lockStorage.address,
      comptroller.address,
      compoundRegistry.address,
      versionManager.address,
    );

    walletImplementation = await BaseWallet.new();

    relayerManager = await RelayerManager.new(
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.address);
    await manager.setRelayerManager(relayerManager);

    await versionManager.addVersion([
      investManager.address,
      relayerManager.address,
    ], []);
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [versionManager.address]);
    await versionManager.upgradeWallet(wallet.address, await versionManager.lastVersion(), { from: owner });
  });

  describe("Environment", () => {
    it("should deploy the environment correctly", async () => {
      const getCToken = await compoundRegistry.getCToken(token.address);
      assert.isTrue(getCToken === cToken.address, "cToken should be registered");
      const getCEther = await compoundRegistry.getCToken(ETH_TOKEN);
      assert.isTrue(getCEther === cEther.address, "cEther should be registered");
      const cOracle = await comptroller.oracle();
      assert.isTrue(cOracle === oracleProxy.address, "oracle should be registered");
      const cTokenPrice = await oracleProxy.getUnderlyingPrice(cToken.address);
      expect(cTokenPrice).to.eq.BN(WAD.divn(10));
      const cEtherPrice = await oracleProxy.getUnderlyingPrice(cEther.address);
      expect(cEtherPrice).to.eq.BN(WAD);
    });
  });

  describe("Investment", () => {
    async function accrueInterests(days, investInEth) {
      let tx;
      // generate borrows to create interests
      await comptroller.enterMarkets([cEther.address, cToken.address], { from: borrower });

      if (investInEth) {
        await token.approve(cToken.address, web3.utils.toWei("20"), { from: borrower });
        await cToken.mint(web3.utils.toWei("20"), { from: borrower });
        tx = await cEther.borrow(web3.utils.toWei("0.1"), { from: borrower });
        await utils.hasEvent(tx.receipt, CToken, "Borrow");
      } else {
        await cEther.mint({ value: web3.utils.toWei("2"), from: borrower });
        tx = await cToken.borrow(web3.utils.toWei("0.1"), { from: borrower });
        await utils.hasEvent(tx.receipt, CToken, "Borrow");
      }
      // increase time to accumulate interests
      await utils.increaseTime(3600 * 24 * days);
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
        await token.transfer(wallet.address, amount);
      }
      const params = [wallet.address, tokenAddress, amount, 0];
      if (relay) {
        txReceipt = await manager.relay(investManager, "addInvestment", params, wallet, [owner]);
      } else {
        tx = await investManager.addInvestment(...params, { from: owner });
        txReceipt = tx.receipt;
      }

      await utils.hasEvent(txReceipt, investManager, "InvestmentAdded");

      await accrueInterests(days, investInEth);

      const output = await investManager.getInvestment(wallet.address, tokenAddress);
      assert.isTrue(output._tokenValue > amount, "investment should have gained value");

      return output._tokenValue;
    }

    async function removeInvestment(tokenAddress, fraction, relay = false) {
      let tx; let
        txReceipt;
      const investInEth = (tokenAddress === ETH_TOKEN);

      await addInvestment(tokenAddress, web3.utils.toWei("0.1"), 365, false);
      const before = investInEth ? await cEther.balanceOf(wallet.address) : await cToken.balanceOf(wallet.address);

      const params = [wallet.address, tokenAddress, fraction];
      if (relay) {
        txReceipt = await manager.relay(investManager, "removeInvestment", params, wallet, [owner]);
      } else {
        tx = await investManager.removeInvestment(...params, { from: owner });
        txReceipt = tx.receipt;
      }
      await utils.hasEvent(txReceipt, investManager, "InvestmentRemoved");

      // TODO: Manual division result rounding up until https://github.com/indutny/bn.js/issues/79 is added to BN.js
      const result = before.muln(10000 - fraction);
      const divisionRemainder = new BN(result.modn(10000));

      let divisionResult = result.divn(10000);
      if (!divisionRemainder.isZero()) {
        divisionResult = divisionResult.iaddn(1);
      }

      const after = investInEth ? await cEther.balanceOf(wallet.address) : await cToken.balanceOf(wallet.address);
      expect(after).to.eq.BN(divisionResult);
    }

    describe("Add Investment", () => {
      // Successes

      it("should invest in ERC20 for 1 year and gain interests (blockchain tx)", async () => {
        await addInvestment(token.address, web3.utils.toWei("1"), 365, false);
      });

      it("should invest in ERC20 for 1 year and gain interests (relay tx)", async () => {
        await addInvestment(token.address, web3.utils.toWei("1"), 365, true);
      });

      it("should invest in ETH for 1 year and gain interests (blockchain tx)", async () => {
        await addInvestment(ETH_TOKEN, web3.utils.toWei("1"), 365, false);
      });

      it("should invest in ETH for 1 year and gain interests (relay tx)", async () => {
        await addInvestment(ETH_TOKEN, web3.utils.toWei("1"), 365, true);
      });

      // Reverts

      it("should fail to invest in ERC20 with an unknown token", async () => {
        const params = [wallet.address, ethers.constants.AddressZero, web3.utils.toWei("1"), 0];
        await truffleAssert.reverts(investManager.addInvestment(...params, { from: owner }), "CM: No market for target token");
      });

      it("should fail to invest in ERC20 with an amount of zero", async () => {
        const params = [wallet.address, token.address, 0, 0];
        await truffleAssert.reverts(investManager.addInvestment(...params, { from: owner }), "CM: amount cannot be 0");
      });

      it("should fail to invest in ERC20 when not holding any ERC20", async () => {
        const params = [wallet.address, token.address, web3.utils.toWei("1"), 0];
        await truffleAssert.reverts(investManager.addInvestment(...params, { from: owner }), "CM: mint failed");
      });
    });

    describe("Remove Investment", () => {
      // Successes

      function testRemoveERC20Investment(fraction, relay) {
        it(`should remove ${fraction / 100}% of an ERC20 investment (${relay ? "relay" : "blockchain"} tx)`, async () => {
          await removeInvestment(token.address, fraction, relay);
        });
      }
      function testRemoveETHInvestment(fraction, relay) {
        it(`should remove ${fraction / 100}% of an ETH investment (${relay ? "relay" : "blockchain"} tx)`, async () => {
          await removeInvestment(token.address, fraction, relay);
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
        const params = [wallet.address, token.address, 50000];
        await truffleAssert.reverts(investManager.removeInvestment(...params, { from: owner }), "CM: invalid fraction value");
      });

      it("should fail to remove an ERC20 investment when not holding any of the corresponding cToken", async () => {
        const params = [wallet.address, token.address, 5000];
        await truffleAssert.reverts(investManager.removeInvestment(...params, { from: owner }), "CM: amount cannot be 0");
      });

      it("should fail to remove all of an ERC20 investment when it collateralizes a loan", async () => {
        const collateralAmount = await web3.utils.toWei("1");
        const debtAmount = await web3.utils.toWei("0.001");
        await token.transfer(wallet.address, collateralAmount);
        const openLoanParams = [
          wallet.address,
          token.address,
          collateralAmount,
          ETH_TOKEN,
          debtAmount];
        await investManager.openLoan(...openLoanParams, { from: owner });
        const removeInvestmentParams = [wallet.address, token.address, 10000];
        await truffleAssert.reverts(investManager.removeInvestment(...removeInvestmentParams, { from: owner }), "CM: redeem failed");
      });
    });
  });
});
