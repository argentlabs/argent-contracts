/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");
const { formatBytes32String } = require("ethers").utils;

const { expect, assert } = chai;
chai.use(bnChai(BN));

const WalletFactory = artifacts.require("WalletFactory");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const UniswapV2Router01 = artifacts.require("DummyUniV2Router");
const CompoundCTokenFilter = artifacts.require("CompoundCTokenFilter");

// Compound
const Unitroller = artifacts.require("Unitroller");
const PriceOracle = artifacts.require("SimplePriceOracle");
const PriceOracleProxy = artifacts.require("PriceOracleProxy");
const Comptroller = artifacts.require("Comptroller");
const InterestModel = artifacts.require("WhitePaperInterestRateModel");
const CEther = artifacts.require("CEther");
const CErc20 = artifacts.require("CErc20");

const ERC20 = artifacts.require("TestERC20");
const utils = require("../utils/utilities.js");
const { ETH_TOKEN, encodeTransaction, initNonce, assertFailedWithError } = require("../utils/utilities.js");

const WAD = new BN("1000000000000000000"); // 10**18
const ETH_EXCHANGE_RATE = new BN("200000000000000000000000000");

const ZERO_BYTES = "0x";
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const RelayManager = require("../utils/relay-manager");

contract("Compound V2", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian1 = accounts[2];
  const liquidityProvider = accounts[3];
  const borrower = accounts[4];
  const relayer = accounts[5];
  const refundAddress = accounts[7];

  let wallet;
  let factory;
  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let dappRegistry;
  let token;
  let cToken;
  let cEther;
  let comptroller;
  let oracleProxy;

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

    registry = await Registry.new();

    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();

    dappRegistry = await DappRegistry.new(0);

    const uniswapRouter = await UniswapV2Router01.new();

    module = await ArgentModule.new(
      registry.address,
      guardianStorage.address,
      transferStorage.address,
      dappRegistry.address,
      uniswapRouter.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      RECOVERY_PERIOD,
      LOCK_PERIOD);

    await registry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentModule"));

    const cEtherFilter = await CompoundCTokenFilter.new(ZERO_ADDRESS);
    const cErc20Filter = await CompoundCTokenFilter.new(token.address);
    await dappRegistry.addDapp(0, relayer, ZERO_ADDRESS);
    await dappRegistry.addDapp(0, cEther.address, cEtherFilter.address);
    await dappRegistry.addDapp(0, cToken.address, cErc20Filter.address);

    const walletImplementation = await BaseWallet.new();
    factory = await WalletFactory.new(
      walletImplementation.address,
      guardianStorage.address,
      refundAddress);
    await factory.addManager(infrastructure);

    manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);
  });

  beforeEach(async () => {
    // create wallet
    const walletAddress = await utils.createWallet(factory.address, owner, [module.address], guardian1);
    wallet = await BaseWallet.at(walletAddress);

    await wallet.send(web3.utils.toWei("1"));
    await token.transfer(wallet.address, web3.utils.toWei("1"));
  });

  describe("Environment", () => {
    it("should deploy the environment correctly", async () => {
      const cOracle = await comptroller.oracle();
      assert.isTrue(cOracle === oracleProxy.address, "oracle should be registered");
      const cTokenPrice = await oracleProxy.getUnderlyingPrice(cToken.address);
      expect(cTokenPrice).to.eq.BN(WAD.divn(10));
      const cEtherPrice = await oracleProxy.getUnderlyingPrice(cEther.address);
      expect(cEtherPrice).to.eq.BN(WAD);
    });
  });

  describe("Mint and redeem", () => {
    async function addInvestment(tokenAddress, amount, useFallback = false) {
      const transactions = [];
      let tokenBefore;
      let tokenAfter;
      let cTokenBefore;
      let cTokenAfter;

      if (tokenAddress === ETH_TOKEN) {
        tokenBefore = await utils.getBalance(wallet.address);
        cTokenBefore = await cEther.balanceOf(wallet.address);
        if (useFallback) {
          transactions.push(encodeTransaction(cEther.address, amount, ZERO_BYTES));
        } else {
          const data = cEther.contract.methods.mint().encodeABI();
          transactions.push(encodeTransaction(cEther.address, amount, data));
        }
      } else {
        tokenBefore = await token.balanceOf(wallet.address);
        cTokenBefore = await cToken.balanceOf(wallet.address);
        let data = token.contract.methods.approve(cToken.address, amount).encodeABI();
        let transaction = encodeTransaction(token.address, 0, data);
        transactions.push(transaction);

        data = cToken.contract.methods.mint(amount).encodeABI();
        transaction = encodeTransaction(cToken.address, 0, data);
        transactions.push(transaction);
      }

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner]);
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      if (!success) {
        console.log(error);
      }
      assert.isTrue(success, "mint failed");

      if (tokenAddress === ETH_TOKEN) {
        await utils.hasEvent(txReceipt, cEther, "Mint");
        tokenAfter = await utils.getBalance(wallet.address);
        cTokenAfter = await cEther.balanceOf(wallet.address);
      } else {
        await utils.hasEvent(txReceipt, cToken, "Mint");
        tokenAfter = await token.balanceOf(wallet.address);
        cTokenAfter = await cToken.balanceOf(wallet.address);
      }

      expect(tokenBefore.sub(tokenAfter)).to.gt.BN(0);
      expect(cTokenAfter.sub(cTokenBefore)).to.gt.BN(0);

      return txReceipt;
    }

    async function removeInvestment(tokenAddress, amount) {
      const transactions = [];
      let tokenBefore;
      let tokenAfter;
      let cTokenBefore;
      let cTokenAfter;

      if (tokenAddress === ETH_TOKEN) {
        tokenBefore = await utils.getBalance(wallet.address);
        cTokenBefore = await cEther.balanceOf(wallet.address);
        const data = cEther.contract.methods.redeem(amount).encodeABI();
        const transaction = await encodeTransaction(cEther.address, 0, data);
        transactions.push(transaction);
      } else {
        tokenBefore = await token.balanceOf(wallet.address);
        cTokenBefore = await cToken.balanceOf(wallet.address);
        const data = cToken.contract.methods.redeem(amount).encodeABI();
        const transaction = await encodeTransaction(cToken.address, 0, data);
        transactions.push(transaction);
      }

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner]);
      const { success, error } = await utils.parseRelayReceipt(txReceipt);
      if (!success) {
        console.log(error);
      }
      assert.isTrue(success, "redeem failed");

      if (tokenAddress === ETH_TOKEN) {
        await utils.hasEvent(txReceipt, cEther, "Redeem");
        tokenAfter = await utils.getBalance(wallet.address);
        cTokenAfter = await cEther.balanceOf(wallet.address);
      } else {
        await utils.hasEvent(txReceipt, cToken, "Redeem");
        tokenAfter = await token.balanceOf(wallet.address);
        cTokenAfter = await cToken.balanceOf(wallet.address);
      }

      expect(tokenAfter.sub(tokenBefore)).to.gt.BN(0);
      expect(cTokenBefore.sub(cTokenAfter)).to.gt.BN(0);

      return txReceipt;
    }

    beforeEach(async () => {
      await initNonce(wallet, module, manager, SECURITY_PERIOD);
    });

    it("should mint cETH", async () => {
      const txReceipt = await addInvestment(ETH_TOKEN, web3.utils.toWei("1", "finney"));
      console.log("Gas to mint cETH: ", txReceipt.gasUsed);
    });

    it("should mint cETH with the fallback", async () => {
      const txReceipt = await addInvestment(ETH_TOKEN, web3.utils.toWei("1", "finney"), true);
      console.log("Gas to mint cETH: ", txReceipt.gasUsed);
    });

    it("should mint cErc20", async () => {
      const txReceipt = await addInvestment(token.address, web3.utils.toWei("1", "finney"));
      console.log("Gas to mint cErc20: ", txReceipt.gasUsed);
    });

    it("should redeem cETH", async () => {
      const amount = web3.utils.toWei("1", "finney");
      await addInvestment(ETH_TOKEN, amount);
      const cTokenBalance = await cEther.balanceOf(wallet.address);
      const txReceipt = await removeInvestment(ETH_TOKEN, cTokenBalance.divn(2).toNumber());
      console.log("Gas to redeem cETH: ", txReceipt.gasUsed);
    });

    it("should redeem cErc20", async () => {
      const amount = web3.utils.toWei("1", "finney");
      await addInvestment(token.address, amount);
      const cTokenBalance = await cToken.balanceOf(wallet.address);
      const txReceipt = await removeInvestment(token.address, cTokenBalance.divn(2).toNumber());
      console.log("Gas to redeem cErc20: ", txReceipt.gasUsed);
    });

    it("should fail to send ETH to a cErc20", async () => {
      const transaction = await encodeTransaction(cToken.address, web3.utils.toWei("1", "finney"), ZERO_BYTES);
      const txReceipt = await manager.relay(module, "multiCall", [wallet.address, [transaction]], wallet, [owner]);
      assertFailedWithError(txReceipt, "TM: call not authorised");
    });

    it("should fail to call an unauthorised method", async () => {
      const data = await cToken.contract.methods.repayBorrowBehalf(borrower, 10000).encodeABI();
      const transaction = await encodeTransaction(cToken.address, 0, data);
      const txReceipt = await manager.relay(module, "multiCall", [wallet.address, [transaction]], wallet, [owner]);
      assertFailedWithError(txReceipt, "TM: call not authorised");
    });

    it("should fail to approve a token for cEther", async () => {
      const amount = web3.utils.toWei("1", "finney");
      const data = token.contract.methods.approve(cEther.address, amount).encodeABI();
      const transaction = encodeTransaction(token.address, 0, data, true);
      const txReceipt = await manager.relay(module, "multiCall", [wallet.address, [transaction]], wallet, [owner]);
      assertFailedWithError(txReceipt, "TM: call not authorised");
    });

    it("should fail to approve a token not the underlying of a cToken", async () => {
      const amount = web3.utils.toWei("1", "finney");
      const notUnderlying = await ERC20.new([infrastructure, wallet.address], 10000000, 18);
      const data = notUnderlying.contract.methods.approve(cToken.address, amount).encodeABI();
      const transaction = encodeTransaction(notUnderlying.address, 0, data, true);
      const txReceipt = await manager.relay(module, "multiCall", [wallet.address, [transaction]], wallet, [owner]);
      assertFailedWithError(txReceipt, "TM: call not authorised");
    });
  });
});
