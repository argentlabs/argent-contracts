/* global artifacts */

const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));

const TruffleContract = require("@truffle/contract");

const LegacyTransferManagerContract = require("../build-legacy/v1.6.0/TransferManager");
const LegacyTokenPriceProviderContract = require("../build-legacy/v1.6.0/TokenPriceProvider");

const LegacyTransferManager = TruffleContract(LegacyTransferManagerContract);
const LegacyTokenPriceProvider = TruffleContract(LegacyTokenPriceProviderContract);

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const VersionManager = artifacts.require("VersionManager");
const TransferStorage = artifacts.require("TransferStorage");
const LockStorage = artifacts.require("LockStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const LimitStorage = artifacts.require("LimitStorage");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
const RelayerManager = artifacts.require("RelayerManager");
const TransferManager = artifacts.require("TransferManager");

const ERC20 = artifacts.require("TestERC20");
const WETH = artifacts.require("WETH9");
const TestContract = artifacts.require("TestContract");

const utils = require("../utils/utilities.js");
const { ETH_TOKEN } = require("../utils/utilities.js");

const ETH_LIMIT = 1000000;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const ZERO_BYTES32 = ethers.constants.HashZero;

const ACTION_TRANSFER = 0;

const RelayManager = require("../utils/relay-manager");

contract("TransferManager", (accounts) => {
  const manager = new RelayManager();

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const nonowner = accounts[2];
  const recipient = accounts[3];
  const spender = accounts[4];

  let registry;
  let priceProvider;
  let transferStorage;
  let lockStorage;
  let guardianStorage;
  let limitStorage;
  let tokenPriceRegistry;
  let transferManager;
  let previousTransferManager;
  let wallet;
  let walletImplementation;
  let erc20;
  let weth;
  let relayerManager;
  let versionManager;

  before(async () => {
    LegacyTransferManager.defaults({ from: accounts[0] });
    LegacyTransferManager.setProvider(web3.currentProvider);
    LegacyTokenPriceProvider.defaults({ from: accounts[0] });
    LegacyTokenPriceProvider.setProvider(web3.currentProvider);

    weth = await WETH.new();
    registry = await Registry.new();

    priceProvider = await LegacyTokenPriceProvider.new(ethers.constants.AddressZero);
    await priceProvider.addManager(infrastructure);

    transferStorage = await TransferStorage.new();
    lockStorage = await LockStorage.new();
    guardianStorage = await GuardianStorage.new();
    limitStorage = await LimitStorage.new();
    tokenPriceRegistry = await TokenPriceRegistry.new();
    await tokenPriceRegistry.addManager(infrastructure);
    versionManager = await VersionManager.new(
      registry.address,
      lockStorage.address,
      guardianStorage.address,
      transferStorage.address,
      limitStorage.address);

    previousTransferManager = await LegacyTransferManager.new(
      registry.address,
      transferStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      ETH_LIMIT,
      ethers.constants.AddressZero,
    );

    transferManager = await TransferManager.new(
      lockStorage.address,
      transferStorage.address,
      limitStorage.address,
      tokenPriceRegistry.address,
      versionManager.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      ETH_LIMIT,
      weth.address,
      previousTransferManager.address);

    await registry.registerModule(versionManager.address, ethers.utils.formatBytes32String("VersionManager"));

    walletImplementation = await BaseWallet.new();

    relayerManager = await RelayerManager.new(
      lockStorage.address,
      guardianStorage.address,
      limitStorage.address,
      tokenPriceRegistry.address,
      versionManager.address);
    await manager.setRelayerManager(relayerManager);

    await versionManager.addVersion([transferManager.address, relayerManager.address], [transferManager.address]);
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [versionManager.address]);
    await versionManager.upgradeWallet(wallet.address, await versionManager.lastVersion(), { from: owner });

    const decimals = 12; // number of decimal for TOKN contract
    const tokenRate = new BN(10).pow(new BN(19)).muln(51); // 1 TOKN = 0.00051 ETH = 0.00051*10^18 ETH wei => *10^(18-decimals) = 0.00051*10^18 * 10^6 = 0.00051*10^24 = 51*10^19

    erc20 = await ERC20.new([infrastructure, wallet.address], 10000000, decimals); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
    await tokenPriceRegistry.setPriceForTokenList([erc20.address], [tokenRate.toString()]);
    await wallet.send(new BN("1000000000000000000"));
  });

  async function getEtherValue(amount, token) {
    if (token === ETH_TOKEN) {
      return amount;
    }
    const price = await tokenPriceRegistry.getTokenPrice(token);
    const ethPrice = new BN(price.toString()).mul(new BN(amount)).div(new BN(10).pow(new BN(18)));
    return ethPrice;
  }

  describe("Initialising the module", () => {
    it("when no previous transfer manager is passed, should initialise with default limit", async () => {
      const transferManager1 = await TransferManager.new(
        lockStorage.address,
        transferStorage.address,
        limitStorage.address,
        tokenPriceRegistry.address,
        versionManager.address,
        SECURITY_PERIOD,
        SECURITY_WINDOW,
        10,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero);
      await versionManager.addVersion([transferManager1.address], [transferManager1.address]);
      const proxy = await Proxy.new(walletImplementation.address);
      const existingWallet = await BaseWallet.at(proxy.address);
      await existingWallet.init(owner, [versionManager.address]);
      await versionManager.upgradeWallet(existingWallet.address, await versionManager.lastVersion(), { from: owner });

      const defaultLimit = await transferManager1.defaultLimit();
      const limit = await transferManager1.getCurrentLimit(existingWallet.address);
      expect(limit).to.eq.BN(defaultLimit);

      // reset the last version to the default bundle
      await versionManager.addVersion([transferManager.address, relayerManager.address], [transferManager.address]);
    });
  });

  describe("Managing the whitelist", () => {
    it("should add/remove an account to/from the whitelist", async () => {
      await transferManager.addToWhitelist(wallet.address, recipient, { from: owner });
      let isTrusted = await transferManager.isWhitelisted(wallet.address, recipient);
      assert.isFalse(isTrusted, "should not be trusted during the security period");
      await utils.increaseTime(3);
      isTrusted = await transferManager.isWhitelisted(wallet.address, recipient);
      assert.isTrue(isTrusted, "should be trusted after the security period");
      await transferManager.removeFromWhitelist(wallet.address, recipient, { from: owner });
      isTrusted = await transferManager.isWhitelisted(wallet.address, recipient);
      assert.isFalse(isTrusted, "should no removed from whitelist immediately");
    });

    it("should not be able to whitelist a token twice", async () => {
      await transferManager.addToWhitelist(wallet.address, recipient, { from: owner });
      await utils.increaseTime(3);
      await truffleAssert.reverts(
        transferManager.addToWhitelist(wallet.address, recipient, { from: owner }), "TT: target already whitelisted",
      );
    });

    it("should be able to remove a whitelisted token from the whitelist during the security period", async () => {
      await transferManager.addToWhitelist(wallet.address, recipient, { from: owner });
      await transferManager.removeFromWhitelist(wallet.address, recipient, { from: owner });

      await utils.increaseTime(3);
      const isTrusted = await transferManager.isWhitelisted(wallet.address, recipient);
      assert.isFalse(isTrusted);
    });
  });

  describe("Reading and writing token prices", () => {
    let erc20First;
    let erc20Second;
    let erc20ZeroDecimals;

    beforeEach(async () => {
      erc20First = await ERC20.new([infrastructure], 10000000, 18);
      erc20Second = await ERC20.new([infrastructure], 10000000, 18);
      erc20ZeroDecimals = await ERC20.new([infrastructure], 10000000, 0);
    });

    it("should get a token price correctly", async () => {
      const tokenPrice = new BN(10).pow(new BN(18)).muln(1800);
      await tokenPriceRegistry.setPriceForTokenList([erc20First.address], [tokenPrice]);
      const tokenPriceSet = await tokenPriceRegistry.getTokenPrice(erc20First.address);
      expect(tokenPrice).to.eq.BN(tokenPriceSet);
    });

    it("should get multiple token prices correctly", async () => {
      await tokenPriceRegistry.setPriceForTokenList([erc20First.address, erc20Second.address], [1800, 1900]);
      const tokenPricesSet = await tokenPriceRegistry.getPriceForTokenList([erc20First.address, erc20Second.address]);
      expect(1800).to.eq.BN(tokenPricesSet[0]);
      expect(1900).to.eq.BN(tokenPricesSet[1]);
    });

    it("should set token price correctly", async () => {
      const tokenPrice = new BN(10).pow(new BN(18)).muln(1800);
      await tokenPriceRegistry.setPriceForTokenList([erc20First.address], [tokenPrice]);
      const tokenPriceSet = await tokenPriceRegistry.getTokenPrice(erc20First.address);
      expect(tokenPrice).to.eq.BN(tokenPriceSet);
    });

    it("should set multiple token prices correctly", async () => {
      await tokenPriceRegistry.setPriceForTokenList([erc20First.address, erc20Second.address], [1800, 1900]);
      const tokenPrice1Set = await tokenPriceRegistry.getTokenPrice(erc20First.address);
      expect(1800).to.eq.BN(tokenPrice1Set);
      const tokenPrice2Set = await tokenPriceRegistry.getTokenPrice(erc20Second.address);
      expect(1900).to.eq.BN(tokenPrice2Set);
    });

    it("should be able to get the ether value of a given amount of tokens", async () => {
      const tokenPrice = new BN(10).pow(new BN(18)).muln(1800);
      await tokenPriceRegistry.setPriceForTokenList([erc20First.address], [tokenPrice]);
      const etherValue = await getEtherValue("15000000000000000000", erc20First.address);
      // expectedValue = 1800*10^18/10^18 (price for 1 token wei) * 15*10^18 (amount) = 1800 * 15*10^18 = 27,000 * 10^18
      const expectedValue = new BN(10).pow(new BN(18)).muln(27000);
      expect(expectedValue).to.eq.BN(etherValue);
    });

    it("should be able to get the ether value for a token with 0 decimals", async () => {
      const tokenPrice = new BN(10).pow(new BN(36)).muln(23000);
      await tokenPriceRegistry.setPriceForTokenList([erc20ZeroDecimals.address], [tokenPrice]);
      const etherValue = await getEtherValue(100, erc20ZeroDecimals.address);
      // expectedValue = 23000*10^36 * 100 / 10^18 = 2,300,000 * 10^18
      const expectedValue = new BN(10).pow(new BN(18)).muln(2300000);
      expect(expectedValue).to.eq.BN(etherValue);
    });

    it("should return 0 as the ether value for a low priced token", async () => {
      await tokenPriceRegistry.setPriceForTokenList([erc20First.address], [23000]);
      const etherValue = await getEtherValue(100, erc20First.address);
      assert.equal(etherValue, 0); // 2,300,000
    });
  });

  describe("Daily limit", () => {
    it("should migrate daily limit for existing wallets", async () => {
      // create wallet with previous module and funds
      const proxy = await Proxy.new(walletImplementation.address);
      const existingWallet = await BaseWallet.at(proxy.address);

      await existingWallet.init(owner, [previousTransferManager.address]);
      await existingWallet.send(100000000);

      // change the limit
      await previousTransferManager.changeLimit(existingWallet.address, 4000000, { from: owner });
      await utils.increaseTime(SECURITY_PERIOD + 1);
      let limit = await previousTransferManager.getCurrentLimit(existingWallet.address);
      expect(limit).to.eq.BN(4000000);
      // transfer some funds
      await previousTransferManager.transferToken(existingWallet.address, ETH_TOKEN, recipient, 1000000, ZERO_BYTES32, { from: owner });
      // add new module
      await previousTransferManager.addModule(existingWallet.address, versionManager.address, { from: owner });
      const tx = await versionManager.upgradeWallet(existingWallet.address, await versionManager.lastVersion(), { from: owner });
      const txReceipt = tx.receipt;
      await utils.hasEvent(txReceipt, transferManager, "DailyLimitMigrated");
      // check result
      limit = await transferManager.getCurrentLimit(existingWallet.address);
      expect(limit).to.eq.BN(4000000);
      const unspent = await transferManager.getDailyUnspent(existingWallet.address);
      // unspent should have been migrated
      expect(unspent[0]).to.eq.BN(4000000 - 1000000);
    });

    it("should set the default limit for new wallets", async () => {
      const limit = await transferManager.getCurrentLimit(wallet.address);
      expect(limit).to.eq.BN(ETH_LIMIT);
    });

    it("should only increase the limit after the security period", async () => {
      await transferManager.changeLimit(wallet.address, 4000000, { from: owner });
      let limit = await transferManager.getCurrentLimit(wallet.address);
      expect(limit).to.eq.BN(ETH_LIMIT);
      await utils.increaseTime(SECURITY_PERIOD + 1);
      limit = await transferManager.getCurrentLimit(wallet.address);
      expect(limit).to.eq.BN(4000000);
    });

    it("should decrease the limit immediately", async () => {
      let limit = await transferManager.getCurrentLimit(wallet.address);
      assert.equal(limit.toNumber(), ETH_LIMIT, "limit should be ETH_LIMIT");
      await transferManager.changeLimit(wallet.address, ETH_LIMIT / 2, { from: owner });
      limit = await transferManager.getCurrentLimit(wallet.address);
      assert.equal(limit.toNumber(), ETH_LIMIT / 2, "limit should be decreased immediately");
    });

    it("should change the limit via relayed transaction", async () => {
      await manager.relay(transferManager, "changeLimit", [wallet.address, 4000000], wallet, [owner]);
      await utils.increaseTime(SECURITY_PERIOD + 1);
      const limit = await transferManager.getCurrentLimit(wallet.address);
      assert.equal(limit.toNumber(), 4000000, "limit should be changed");
    });

    it("should correctly set the pending limit", async () => {
      const tx = await transferManager.changeLimit(wallet.address, 4000000, { from: owner });
      const timestamp = await utils.getTimestamp(tx.receipt.block);
      const { _pendingLimit, _changeAfter } = await transferManager.getPendingLimit(wallet.address);
      assert.equal(_pendingLimit.toNumber(), 4000000);
      assert.closeTo(_changeAfter.toNumber(), timestamp + SECURITY_PERIOD, 1); // timestamp is sometimes off by 1
    });

    it("should be able to disable the limit", async () => {
      const tx = await transferManager.disableLimit(wallet.address, { from: owner });
      const txReceipt = tx.receipt;
      await utils.hasEvent(txReceipt, transferManager, "DailyLimitDisabled");
      let limitDisabled = await transferManager.isLimitDisabled(wallet.address);
      assert.isFalse(limitDisabled);
      await utils.increaseTime(SECURITY_PERIOD + 1);
      limitDisabled = await transferManager.isLimitDisabled(wallet.address);
      assert.isTrue(limitDisabled);
    });

    it("should return the correct unspent daily limit amount", async () => {
      await wallet.send(new BN(ETH_LIMIT));
      const transferAmount = ETH_LIMIT - 100;
      await transferManager.transferToken(wallet.address, ETH_TOKEN, recipient, transferAmount, ZERO_BYTES32, { from: owner });
      const { _unspent } = await transferManager.getDailyUnspent(wallet.address);
      assert.equal(_unspent.toNumber(), 100);
    });

    it("should return the correct spent daily limit amount", async () => {
      await wallet.send(new BN(ETH_LIMIT));
      // Transfer 100 wei
      const tx = await transferManager.transferToken(wallet.address, ETH_TOKEN, recipient, 100, ZERO_BYTES32, { from: owner });
      const timestamp = await utils.getTimestamp(tx.receipt.block);
      // Then transfer 200 wei more
      await transferManager.transferToken(wallet.address, ETH_TOKEN, recipient, 200, ZERO_BYTES32, { from: owner });

      const dailySpent = await limitStorage.getDailySpent(wallet.address);
      assert.equal(dailySpent[0], 300);
      assert.closeTo(new BN(dailySpent[1]).toNumber(), timestamp + (3600 * 24), 1); // timestamp is sometimes off by 1
    });

    it("should return 0 if the entire daily limit amount has been spent", async () => {
      await wallet.send(new BN(ETH_LIMIT));
      await transferManager.transferToken(wallet.address, ETH_TOKEN, recipient, ETH_LIMIT, ZERO_BYTES32, { from: owner });
      const { _unspent } = await transferManager.getDailyUnspent(wallet.address);
      assert.equal(_unspent.toNumber(), 0);
    });
  });

  describe("Token transfers", () => {
    async function doDirectTransfer({
      token, signer = owner, to, amount, relayed = false,
    }) {
      const fundsBefore = (token === ETH_TOKEN ? await utils.getBalance(to) : await token.balanceOf(to));
      const unspentBefore = await transferManager.getDailyUnspent(wallet.address);
      const params = [wallet.address, token === ETH_TOKEN ? ETH_TOKEN : token.address, to, amount, ZERO_BYTES32];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(transferManager, "transferToken", params, wallet, [signer]);
      } else {
        const tx = await transferManager.transferToken(...params, { from: signer });
        txReceipt = tx.receipt;
      }
      await utils.hasEvent(txReceipt, transferManager, "Transfer");
      const fundsAfter = (token === ETH_TOKEN ? await utils.getBalance(to) : await token.balanceOf(to));
      const unspentAfter = await transferManager.getDailyUnspent(wallet.address);
      assert.equal(fundsAfter.sub(fundsBefore).toNumber(), amount, "should have transfered amount");
      const ethValue = (token === ETH_TOKEN ? amount : (await getEtherValue(amount, token.address)).toNumber());
      if (ethValue < ETH_LIMIT) {
        assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), ethValue, "should have updated the daily spent in ETH");
      }
      return txReceipt;
    }

    async function doPendingTransfer({
      token, to, amount, delay, relayed = false,
    }) {
      const tokenAddress = token === ETH_TOKEN ? ETH_TOKEN : token.address;
      const fundsBefore = (token === ETH_TOKEN ? await utils.getBalance(to) : await token.balanceOf(to));
      const params = [wallet.address, tokenAddress, to, amount, ZERO_BYTES32];
      let txReceipt; let
        tx;
      if (relayed) {
        txReceipt = await manager.relay(transferManager, "transferToken", params, wallet, [owner]);
      } else {
        tx = await transferManager.transferToken(...params, { from: owner });
        txReceipt = tx.receipt;
      }
      await utils.hasEvent(txReceipt, transferManager, "PendingTransferCreated");
      let fundsAfter = (token === ETH_TOKEN ? await utils.getBalance(to) : await token.balanceOf(to));
      assert.equal(fundsAfter.sub(fundsBefore).toNumber(), 0, "should not have transfered amount");
      if (delay === 0) {
        const id = ethers.utils.solidityKeccak256(["uint8", "address", "address", "uint256", "bytes", "uint256"],
          [ACTION_TRANSFER, tokenAddress, recipient, amount, ZERO_BYTES32, txReceipt.blockNumber]);
        return id;
      }
      await utils.increaseTime(delay);
      tx = await transferManager.executePendingTransfer(wallet.address,
        tokenAddress, recipient, amount, ZERO_BYTES32, txReceipt.blockNumber);
      txReceipt = tx.receipt;
      await utils.hasEvent(txReceipt, transferManager, "PendingTransferExecuted");
      fundsAfter = (token === ETH_TOKEN ? await utils.getBalance(to) : await token.balanceOf(to));
      return assert.equal(fundsAfter.sub(fundsBefore).toNumber(), amount, "should have transfered amount");
    }

    describe("Small token transfers", () => {
      it("should let the owner send ETH", async () => {
        await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: 10000 });
      });

      it("should let the owner send ETH (relayed)", async () => {
        await doDirectTransfer({
          token: ETH_TOKEN, to: recipient, amount: 10000, relayed: true,
        });
      });

      it("should let the owner send ERC20", async () => {
        await doDirectTransfer({ token: erc20, to: recipient, amount: 10 });
      });

      it("should let the owner send ERC20 (relayed)", async () => {
        await doDirectTransfer({
          token: erc20, to: recipient, amount: 10, relayed: true,
        });
      });

      it("should only let the owner send ETH", async () => {
        const params = [wallet.address, ETH_TOKEN, recipient, 10000, ZERO_BYTES32];
        await truffleAssert.reverts(
          transferManager.transferToken(...params, { from: nonowner }),
          "BF: must be owner or feature");
      });

      it("should calculate the daily unspent when the owner send ETH", async () => {
        let unspent = await transferManager.getDailyUnspent(wallet.address);
        assert.equal(unspent[0].toNumber(), ETH_LIMIT, "unspent should be the limit at the beginning of a period");
        await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: 10000 });
        unspent = await transferManager.getDailyUnspent(wallet.address);
        assert.equal(unspent[0].toNumber(), ETH_LIMIT - 10000, "should be the limit minus the transfer");
      });

      it("should calculate the daily unspent in ETH when the owner send ERC20", async () => {
        let unspent = await transferManager.getDailyUnspent(wallet.address);
        assert.equal(unspent[0].toNumber(), ETH_LIMIT, "unspent should be the limit at the beginning of a period");
        await doDirectTransfer({ token: erc20, to: recipient, amount: 10 });
        unspent = await transferManager.getDailyUnspent(wallet.address);
        const ethValue = await getEtherValue(10, erc20.address);
        assert.equal(unspent[0].toNumber(), ETH_LIMIT - ethValue.toNumber(), "should be the limit minus the transfer");
      });
    });

    describe("Large token transfers ", () => {
      it("should create and execute a pending ETH transfer", async () => {
        await doPendingTransfer({
          token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT * 2, delay: 3, relayed: false,
        });
      });

      it("should create and execute a pending ETH transfer (relayed)", async () => {
        await doPendingTransfer({
          token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT * 2, delay: 3, relayed: true,
        });
      });

      it("should create and execute a pending ERC20 transfer", async () => {
        await doPendingTransfer({
          token: erc20, to: recipient, amount: ETH_LIMIT * 2, delay: 3, relayed: false,
        });
      });

      it("should create and execute a pending ERC20 transfer (relayed)", async () => {
        await doPendingTransfer({
          token: erc20, to: recipient, amount: ETH_LIMIT * 2, delay: 3, relayed: true,
        });
      });

      it("should not execute a pending ETH transfer before the confirmation window", async () => {
        const params = [wallet.address, ETH_TOKEN, recipient, ETH_LIMIT * 2, ZERO_BYTES32];
        const tx = await transferManager.transferToken(...params, { from: owner });

        await truffleAssert.reverts(
          transferManager.executePendingTransfer(wallet.address, ETH_TOKEN, recipient, ETH_LIMIT * 2, ZERO_BYTES32, tx.receipt.blockNumber),
          "TT: transfer outside of the execution window");
      });

      it("should not execute a pending ETH transfer before the confirmation window (relayed)", async () => {
        const params = [wallet.address, ETH_TOKEN, recipient, ETH_LIMIT * 2, ZERO_BYTES32];
        const txReceipt = await manager.relay(transferManager, "transferToken", params, wallet, [owner]);

        await truffleAssert.reverts(
          transferManager.executePendingTransfer(wallet.address, ETH_TOKEN, recipient, ETH_LIMIT * 2, ZERO_BYTES32, txReceipt.blockNumber),
          "TT: transfer outside of the execution window");
      });

      it("should not execute a pending ETH transfer after the confirmation window", async () => {
        const params = [wallet.address, ETH_TOKEN, recipient, ETH_LIMIT * 2, ZERO_BYTES32];
        const tx = await transferManager.transferToken(...params, { from: owner });

        await utils.increaseTime(10);
        await truffleAssert.reverts(
          transferManager.executePendingTransfer(wallet.address, ETH_TOKEN, recipient, ETH_LIMIT * 2, ZERO_BYTES32, tx.receipt.blockNumber),
          "TT: transfer outside of the execution window");
      });

      it("should not execute a pending ETH transfer after the confirmation window (relayed)", async () => {
        const params = [wallet.address, ETH_TOKEN, recipient, ETH_LIMIT * 2, ZERO_BYTES32];
        const txReceipt = await manager.relay(transferManager, "transferToken", params, wallet, [owner]);

        await utils.increaseTime(10);
        await truffleAssert.reverts(
          transferManager.executePendingTransfer(wallet.address, ETH_TOKEN, recipient, ETH_LIMIT * 2, ZERO_BYTES32, txReceipt.blockNumber),
          "TT: transfer outside of the execution window");
      });

      it("should cancel a pending ETH transfer", async () => {
        const id = await doPendingTransfer({
          token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT * 2, delay: 0,
        });
        await utils.increaseTime(1);
        const tx = await transferManager.cancelPendingTransfer(wallet.address, id, { from: owner });
        const txReceipt = tx.receipt;
        await utils.hasEvent(txReceipt, transferManager, "PendingTransferCanceled");
        const executeAfter = await transferManager.getPendingTransfer(wallet.address, id);
        assert.equal(executeAfter, 0, "should have cancelled the pending transfer");
      });

      it("should cancel a pending ERC20 transfer", async () => {
        const id = await doPendingTransfer({
          token: erc20, to: recipient, amount: ETH_LIMIT * 2, delay: 0,
        });
        await utils.increaseTime(1);
        const tx = await transferManager.cancelPendingTransfer(wallet.address, id, { from: owner });
        const txReceipt = tx.receipt;
        await utils.hasEvent(txReceipt, transferManager, "PendingTransferCanceled");
        const executeAfter = await transferManager.getPendingTransfer(wallet.address, id);
        assert.equal(executeAfter, 0, "should have cancelled the pending transfer");
      });

      it("should send immediately ETH to a whitelisted address", async () => {
        await transferManager.addToWhitelist(wallet.address, recipient, { from: owner });
        await utils.increaseTime(3);
        await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT * 2 });
      });

      it("should send immediately ERC20 to a whitelisted address", async () => {
        await transferManager.addToWhitelist(wallet.address, recipient, { from: owner });
        await utils.increaseTime(3);
        await doDirectTransfer({ token: erc20, to: recipient, amount: ETH_LIMIT * 2 });
      });
    });
  });

  describe("Token Approvals", () => {
    async function doDirectApprove({ signer = owner, amount, relayed = false }) {
      const unspentBefore = await transferManager.getDailyUnspent(wallet.address);
      const params = [wallet.address, erc20.address, spender, amount];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(transferManager, "approveToken", params, wallet, [signer]);
      } else {
        const tx = await transferManager.approveToken(...params, { from: signer });
        txReceipt = tx.receipt;
      }
      await utils.hasEvent(txReceipt, transferManager, "Approved");
      const unspentAfter = await transferManager.getDailyUnspent(wallet.address);

      const amountInEth = await getEtherValue(amount, erc20.address);
      if (amountInEth < ETH_LIMIT) {
        assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), amountInEth, "should have updated the daily limit");
      }
      const approval = await erc20.allowance(wallet.address, spender);

      assert.equal(approval.toNumber(), amount, "should have approved the amount");
      return txReceipt;
    }

    it("should approve an ERC20 immediately when the amount is under the limit", async () => {
      await doDirectApprove({ amount: 10 });
    });

    it("should approve an ERC20 immediately when the amount is under the limit (relayed) ", async () => {
      await doDirectApprove({ amount: 10, relayed: true });
    });

    it("should approve an ERC20 immediately when the amount is under the existing approved amount", async () => {
      await doDirectApprove({ amount: 100 });
      await transferManager.approveToken(wallet.address, erc20.address, spender, 10, { from: owner });
      const approval = await erc20.allowance(wallet.address, spender);
      assert.equal(approval.toNumber(), 10);
    });

    it("should not approve an ERC20 transfer when the signer is not the owner ", async () => {
      const params = [wallet.address, erc20.address, spender, 10];
      truffleAssert.reverts(
        transferManager.approveToken(...params, { from: nonowner }),
        "BF: must be owner or feature");
    });

    it("should approve an ERC20 immediately when the spender is whitelisted ", async () => {
      await transferManager.addToWhitelist(wallet.address, spender, { from: owner });
      await utils.increaseTime(3);
      await doDirectApprove({ amount: ETH_LIMIT + 10000 });
    });

    it("should fail to approve an ERC20 when the amount is above the daily limit ", async () => {
      const params = [wallet.address, erc20.address, spender, ETH_LIMIT + 10000];
      truffleAssert.reverts(
        transferManager.approveToken(...params, { from: owner }),
        "above daily limit");
    });
  });

  describe("Call contract", () => {
    let contract;

    beforeEach(async () => {
      contract = await TestContract.new();
      assert.equal(await contract.state(), 0, "initial contract state should be 0");
    });

    async function doCallContract({ value, state, relayed = false }) {
      const dataToTransfer = contract.contract.methods.setState(state).encodeABI();
      const unspentBefore = await transferManager.getDailyUnspent(wallet.address);
      const params = [wallet.address, contract.address, value, dataToTransfer];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(transferManager, "callContract", params, wallet, [owner]);
      } else {
        const tx = await transferManager.callContract(...params, { from: owner });
        txReceipt = tx.receipt;
      }
      await utils.hasEvent(txReceipt, transferManager, "CalledContract");
      const unspentAfter = await transferManager.getDailyUnspent(wallet.address);
      if (value < ETH_LIMIT) {
        assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), value, "should have updated the daily limit");
      }
      assert.equal((await contract.state()).toNumber(), state, "the state of the external contract should have been changed");
      return txReceipt;
    }

    it("should not be able to call the wallet itselt", async () => {
      const dataToTransfer = contract.contract.methods.setState(4).encodeABI();
      const params = [wallet.address, wallet.address, 10, dataToTransfer];
      await truffleAssert.reverts(transferManager.callContract(...params, { from: owner }), "BT: Forbidden contract");
    });

    it("should not be able to call a feature of the wallet", async () => {
      const dataToTransfer = contract.contract.methods.setState(4).encodeABI();
      const params = [wallet.address, transferManager.address, 10, dataToTransfer];
      await truffleAssert.reverts(transferManager.callContract(...params, { from: owner }), "BT: Forbidden contract");
    });

    it("should not be able to call a supported ERC20 token contract", async () => {
      const dataToTransfer = contract.contract.methods.setState(4).encodeABI();
      const params = [wallet.address, erc20.address, 10, dataToTransfer];
      await truffleAssert.reverts(transferManager.callContract(...params, { from: owner }), "TM: Forbidden contract");
    });

    it("should be able to call a supported token contract which is whitelisted", async () => {
      await transferManager.addToWhitelist(wallet.address, erc20.address, { from: owner });
      await utils.increaseTime(3);
      const dataToTransfer = erc20.contract.methods.transfer(infrastructure, 4).encodeABI();
      const params = [wallet.address, erc20.address, 0, dataToTransfer];
      await transferManager.callContract(...params, { from: owner });
    });

    it("should call a contract and transfer ETH value when under the daily limit", async () => {
      await doCallContract({ value: 10, state: 3 });
    });

    it("should call a contract and transfer ETH value when under the daily limit (relayed) ", async () => {
      await doCallContract({ value: 10, state: 3, relayed: true });
    });

    it("should call a contract and transfer ETH value above the daily limit when the contract is whitelisted", async () => {
      await transferManager.addToWhitelist(wallet.address, contract.address, { from: owner });
      await utils.increaseTime(3);
      await doCallContract({ value: ETH_LIMIT + 10000, state: 6 });
    });

    it("should fail to call a contract and transfer ETH when the amount is above the daily limit ", async () => {
      await truffleAssert.reverts(doCallContract({ value: ETH_LIMIT + 10000, state: 6 }, "above daily limit"));
    });
  });

  describe("Approve token and Call contract", () => {
    let contract;

    beforeEach(async () => {
      contract = await TestContract.new();
      assert.equal(await contract.state(), 0, "initial contract state should be 0");
    });

    async function doApproveTokenAndCallContract({
      signer = owner, consumer = contract.address, amount, state, relayed = false, wrapEth = false,
    }) {
      const fun = consumer === contract.address ? "setStateAndPayToken" : "setStateAndPayTokenWithConsumer";
      const token = wrapEth ? weth : erc20;
      const dataToTransfer = contract.contract.methods[fun](state, token.address, amount).encodeABI();
      const unspentBefore = await transferManager.getDailyUnspent(wallet.address);
      const params = [wallet.address]
        .concat(wrapEth ? [] : [erc20.address])
        .concat([consumer, amount, contract.address, dataToTransfer]);
      const method = wrapEth ? "approveWethAndCallContract" : "approveTokenAndCallContract";
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(transferManager, method, params, wallet, [signer]);
      } else {
        const tx = await transferManager[method](...params, { from: signer });
        txReceipt = tx.receipt;
      }
      await utils.hasEvent(txReceipt, transferManager, "ApprovedAndCalledContract");
      const unspentAfter = await transferManager.getDailyUnspent(wallet.address);
      const amountInEth = wrapEth ? amount : await getEtherValue(amount, erc20.address);

      if (amountInEth < ETH_LIMIT) {
        assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), amountInEth, "should have updated the daily limit");
      }
      assert.equal((await contract.state()).toNumber(), state, "the state of the external contract should have been changed");
      const tokenBalance = await token.balanceOf(contract.address);
      assert.equal(tokenBalance.toNumber(), amount, "the contract should have transfered the tokens");
      return txReceipt;
    }

    // approveTokenAndCallContract

    it("should approve the token and call the contract when under the limit", async () => {
      await doApproveTokenAndCallContract({ amount: 10, state: 3 });
    });

    it("should approve the token and call the contract when under the limit (relayed) ", async () => {
      await doApproveTokenAndCallContract({ amount: 10, state: 3, relayed: true });
    });

    it("should restore existing approved amount after call", async () => {
      await transferManager.approveToken(wallet.address, erc20.address, contract.address, 10, { from: owner });
      const dataToTransfer = contract.contract.methods.setStateAndPayToken(3, erc20.address, 5).encodeABI();
      await transferManager.approveTokenAndCallContract(
        wallet.address,
        erc20.address,
        contract.address,
        5,
        contract.address,
        dataToTransfer,
        { from: owner }
      );
      const approval = await erc20.allowance(wallet.address, contract.address);

      // Initial approval of 10 is restored, after approving and spending 5
      assert.equal(approval.toNumber(), 10);

      const erc20Balance = await erc20.balanceOf(contract.address);
      assert.equal(erc20Balance.toNumber(), 5, "the contract should have transfered the tokens");
    });

    it("should be able to spend less than approved in call", async () => {
      await transferManager.approveToken(wallet.address, erc20.address, contract.address, 10, { from: owner });
      const dataToTransfer = contract.contract.methods.setStateAndPayToken(3, erc20.address, 4).encodeABI();
      await transferManager.approveTokenAndCallContract(
        wallet.address,
        erc20.address,
        contract.address,
        5,
        contract.address,
        dataToTransfer,
        { from: owner }
      );
      const approval = await erc20.allowance(wallet.address, contract.address);
      // Initial approval of 10 is restored, after approving and spending 4
      assert.equal(approval.toNumber(), 10);

      const erc20Balance = await erc20.balanceOf(contract.address);
      assert.equal(erc20Balance.toNumber(), 4, "the contract should have transfered the tokens");
    });

    it("should not be able to spend more than approved in call", async () => {
      await transferManager.approveToken(wallet.address, erc20.address, contract.address, 10, { from: owner });
      const dataToTransfer = contract.contract.methods.setStateAndPayToken(3, erc20.address, 6).encodeABI();
      await truffleAssert.reverts(transferManager.approveTokenAndCallContract(
        wallet.address,
        erc20.address,
        contract.address,
        5,
        contract.address,
        dataToTransfer,
        { from: owner }
      ), "BT: insufficient amount for call");
    });

    it("should approve the token and call the contract when the token is above the limit and the contract is whitelisted ", async () => {
      await transferManager.addToWhitelist(wallet.address, contract.address, { from: owner });
      await utils.increaseTime(3);
      await doApproveTokenAndCallContract({ amount: ETH_LIMIT + 10000, state: 6 });
    });

    it("should approve the token and call the contract when contract to call is different to token spender", async () => {
      const consumer = await contract.tokenConsumer();
      await doApproveTokenAndCallContract({ amount: 10, state: 3, consumer });
    });

    it("should approve token and call contract when contract != spender, amount > limit and contract is whitelisted", async () => {
      const consumer = await contract.tokenConsumer();
      await transferManager.addToWhitelist(wallet.address, contract.address, { from: owner });
      await utils.increaseTime(3);
      await doApproveTokenAndCallContract({ amount: ETH_LIMIT + 10000, state: 6, consumer });
    });

    it("should fail to approve token and call contract when contract != spender, amount > limit and spender is whitelisted", async () => {
      const amount = ETH_LIMIT + 10000;
      const consumer = await contract.tokenConsumer();
      await transferManager.addToWhitelist(wallet.address, consumer, { from: owner });
      await utils.increaseTime(3);
      const dataToTransfer = contract.contract.methods.setStateAndPayTokenWithConsumer(6, erc20.address, amount).encodeABI();
      await truffleAssert.reverts(
        transferManager.approveTokenAndCallContract(
          wallet.address, erc20.address, consumer, amount, contract.address, dataToTransfer, { from: owner }
        ),
        "TM: Approve above daily limit",
      );
    });

    it("should fail to approve the token and call the contract when the token is above the daily limit ", async () => {
      const dataToTransfer = contract.contract.methods.setStateAndPayToken(6, erc20.address, ETH_LIMIT + 10000).encodeABI();
      const params = [wallet.address, erc20.address, contract.address, ETH_LIMIT + 10000, contract.address, dataToTransfer];

      await truffleAssert.reverts(
        transferManager.approveTokenAndCallContract(...params, { from: owner }),
        "TM: Approve above daily limit");
    });

    it("should fail to approve token if the amount to be approved is greater than the current balance", async () => {
      const startingBalance = await erc20.balanceOf(wallet.address);
      await erc20.burn(wallet.address, startingBalance);
      const dataToTransfer = contract.contract.methods.setStateAndPayToken(3, erc20.address, 1).encodeABI();
      await truffleAssert.reverts(transferManager.approveTokenAndCallContract(
        wallet.address,
        erc20.address,
        contract.address,
        1,
        contract.address,
        dataToTransfer,
        { from: owner }), "BT: insufficient balance");
    });

    // approveWethAndCallContract

    it("should approve WETH and call the contract when under the limit", async () => {
      await doApproveTokenAndCallContract({ amount: 10, state: 3, wrapEth: true });
    });

    it("should approve WETH and call the contract under the limit when already holding the WETH", async () => {
      const amount = 10;
      await weth.deposit({ value: amount });
      await weth.transfer(wallet.address, amount);
      await doApproveTokenAndCallContract({ amount, state: 3, wrapEth: true });
    });
  });

  describe("Static calls", () => {
    it("should delegate isValidSignature static calls to the TransferManager", async () => {
      const ERC1271_ISVALIDSIGNATURE_BYTES32 = utils.sha3("isValidSignature(bytes32,bytes)").slice(0, 10);
      const isValidSignatureDelegate = await wallet.enabled(ERC1271_ISVALIDSIGNATURE_BYTES32);
      assert.equal(isValidSignatureDelegate, versionManager.address);

      const walletAsTransferManager = await TransferManager.at(wallet.address);
      const msg = "0x1234";
      const messageHash = web3.eth.accounts.hashMessage(msg);
      const signature = await utils.signMessage(msg, owner);

      const valid = await walletAsTransferManager.isValidSignature(messageHash, signature);
      assert.equal(valid, ERC1271_ISVALIDSIGNATURE_BYTES32);
    });

    it("should revert isValidSignature static call for invalid signature", async () => {
      const walletAsTransferManager = await TransferManager.at(wallet.address);
      const msg = "0x1234";
      const messageHash = web3.eth.accounts.hashMessage(msg);
      const signature = await utils.signMessage(messageHash, owner);

      await truffleAssert.reverts(
        walletAsTransferManager.isValidSignature(messageHash, `${signature}a1`), "TM: invalid signature length",
      );
    });

    it("should revert isValidSignature static call for invalid signer", async () => {
      const walletAsTransferManager = await TransferManager.at(wallet.address);
      const msg = "0x1234";
      const messageHash = web3.eth.accounts.hashMessage(msg);
      const signature = await utils.signMessage(messageHash, owner);

      await truffleAssert.reverts(
        walletAsTransferManager.isValidSignature(messageHash, signature), "TM: Invalid signer",
      );
    });
  });
});
