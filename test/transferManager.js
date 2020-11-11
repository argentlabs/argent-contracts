/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));

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
const LegacyTransferManager = artifacts.require("../build-legacy/v1.6.0/TransferManager");
const LegacyTokenPriceProvider = artifacts.require("../build-legacy/v1.6.0/TokenPriceProvider");
const ERC20 = artifacts.require("TestERC20");
const WETH = artifacts.require("WETH9");
const TestContract = artifacts.require("TestContract");

const { ETH_TOKEN, hasEvent, personalSign } = require("../utils/utilities.js");

const ETH_LIMIT = 1000000;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const ZERO_BYTES32 = ethers.constants.HashZero;

const ACTION_TRANSFER = 0;

const TestManager = require("../utils/test-manager");

describe("TransferManager", function () {
  this.timeout(100000);

  const manager = new TestManager();

  const infrastructure = accounts[0].signer;
  const owner = accounts[1].signer;
  const nonowner = accounts[2].signer;
  const recipient = accounts[3].signer;
  const spender = accounts[4].signer;

  let deployer;
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
    deployer = manager.newDeployer();
    weth = await deployer.deploy(WETH);
    const registry = await deployer.deploy(Registry);
    priceProvider = await deployer.deploy(LegacyTokenPriceProvider, {}, ethers.constants.AddressZero);
    await priceProvider.addManager(infrastructure.address);

    transferStorage = await deployer.deploy(TransferStorage);
    lockStorage = await deployer.deploy(LockStorage);
    guardianStorage = await deployer.deploy(GuardianStorage);
    limitStorage = await deployer.deploy(LimitStorage);
    tokenPriceRegistry = await deployer.deploy(TokenPriceRegistry);
    await tokenPriceRegistry.addManager(infrastructure.address);
    versionManager = await deployer.deploy(VersionManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      transferStorage.contractAddress,
      limitStorage.contractAddress);

    previousTransferManager = await deployer.deploy(LegacyTransferManager, {},
      registry.contractAddress,
      transferStorage.contractAddress,
      guardianStorage.contractAddress,
      priceProvider.contractAddress,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      ETH_LIMIT,
      ethers.constants.AddressZero);

    transferManager = await deployer.deploy(TransferManager, {},
      lockStorage.contractAddress,
      transferStorage.contractAddress,
      limitStorage.contractAddress,
      tokenPriceRegistry.contractAddress,
      versionManager.contractAddress,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      ETH_LIMIT,
      weth.contractAddress,
      previousTransferManager.contractAddress);

    await registry.registerModule(versionManager.contractAddress, ethers.utils.formatBytes32String("VersionManager"));

    walletImplementation = await deployer.deploy(BaseWallet);

    relayerManager = await deployer.deploy(RelayerManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      limitStorage.contractAddress,
      tokenPriceRegistry.contractAddress,
      versionManager.contractAddress);
    manager.setRelayerManager(relayerManager);

    await versionManager.addVersion([transferManager.contractAddress, relayerManager.contractAddress], [transferManager.contractAddress]);
  });

  beforeEach(async () => {
    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
    await wallet.init(owner.address, [versionManager.contractAddress]);
    await versionManager.from(owner).upgradeWallet(wallet.contractAddress, await versionManager.lastVersion());

    const decimals = 12; // number of decimal for TOKN contract
    const tokenRate = new BN(10).pow(new BN(19)).muln(51); // 1 TOKN = 0.00051 ETH = 0.00051*10^18 ETH wei => *10^(18-decimals) = 0.00051*10^18 * 10^6 = 0.00051*10^24 = 51*10^19

    erc20 = await deployer.deploy(ERC20, {}, [infrastructure.address, wallet.contractAddress], 10000000, decimals); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
    await tokenPriceRegistry.setPriceForTokenList([erc20.contractAddress], [tokenRate.toString()]);
    await infrastructure.sendTransaction({ to: wallet.contractAddress, value: ethers.BigNumber.from("1000000000000000000") });
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
      const transferManager1 = await deployer.deploy(TransferManager, {},
        lockStorage.contractAddress,
        transferStorage.contractAddress,
        limitStorage.contractAddress,
        tokenPriceRegistry.contractAddress,
        versionManager.contractAddress,
        SECURITY_PERIOD,
        SECURITY_WINDOW,
        10,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero);
      await versionManager.addVersion([transferManager1.contractAddress], [transferManager1.contractAddress]);
      const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
      const existingWallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
      await existingWallet.init(owner.address, [versionManager.contractAddress]);
      await versionManager.from(owner).upgradeWallet(existingWallet.contractAddress, await versionManager.lastVersion());

      const defautlimit = await transferManager1.defaultLimit();
      const limit = await transferManager1.getCurrentLimit(existingWallet.contractAddress);
      assert.equal(limit.toNumber(), defautlimit.toNumber());

      // reset the last version to the default bundle
      await versionManager.addVersion([transferManager.contractAddress, relayerManager.contractAddress], [transferManager.contractAddress]);
    });
  });

  describe("Managing the whitelist", () => {
    it("should add/remove an account to/from the whitelist", async () => {
      await transferManager.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
      let isTrusted = await transferManager.isWhitelisted(wallet.contractAddress, recipient.address);
      assert.equal(isTrusted, false, "should not be trusted during the security period");
      await manager.increaseTime(3);
      isTrusted = await transferManager.isWhitelisted(wallet.contractAddress, recipient.address);
      assert.equal(isTrusted, true, "should be trusted after the security period");
      await transferManager.from(owner).removeFromWhitelist(wallet.contractAddress, recipient.address);
      isTrusted = await transferManager.isWhitelisted(wallet.contractAddress, recipient.address);
      assert.equal(isTrusted, false, "should no removed from whitelist immediately");
    });

    it("should not be able to whitelist a token twice", async () => {
      await transferManager.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
      await manager.increaseTime(3);
      await assert.revertWith(
        transferManager.from(owner).addToWhitelist(wallet.contractAddress, recipient.address), "TT: target already whitelisted",
      );
    });

    it("should be able to remove a whitelisted token from the whitelist during the security period", async () => {
      await transferManager.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
      await transferManager.from(owner).removeFromWhitelist(wallet.contractAddress, recipient.address);

      await manager.increaseTime(3);
      const isTrusted = await transferManager.isWhitelisted(wallet.contractAddress, recipient.address);
      assert.equal(isTrusted, false);
    });
  });

  describe("Reading and writing token prices", () => {
    let erc20First;
    let erc20Second;
    let erc20ZeroDecimals;

    beforeEach(async () => {
      erc20First = await deployer.deploy(ERC20, {}, [infrastructure.address], 10000000, 18);
      erc20Second = await deployer.deploy(ERC20, {}, [infrastructure.address], 10000000, 18);
      erc20ZeroDecimals = await deployer.deploy(ERC20, {}, [infrastructure.address], 10000000, 0);
    });

    it("should get a token price correctly", async () => {
      const tokenPrice = new BN(10).pow(new BN(18)).muln(1800);
      await tokenPriceRegistry.from(infrastructure).setPriceForTokenList([erc20First.contractAddress], [tokenPrice.toString()]);
      const tokenPriceSet = await tokenPriceRegistry.getTokenPrice(erc20First.contractAddress);
      expect(tokenPrice).to.eq.BN(tokenPriceSet.toString());
    });

    it("should get multiple token prices correctly", async () => {
      await tokenPriceRegistry.from(infrastructure).setPriceForTokenList([erc20First.contractAddress, erc20Second.contractAddress], [1800, 1900]);
      const tokenPricesSet = await tokenPriceRegistry.getPriceForTokenList([erc20First.contractAddress, erc20Second.contractAddress]);
      expect(1800).to.eq.BN(tokenPricesSet[0].toString());
      expect(1900).to.eq.BN(tokenPricesSet[1].toString());
    });

    it("should set token price correctly", async () => {
      const tokenPrice = new BN(10).pow(new BN(18)).muln(1800);
      await tokenPriceRegistry.from(infrastructure).setPriceForTokenList([erc20First.contractAddress], [tokenPrice.toString()]);
      const tokenPriceSet = await tokenPriceRegistry.getTokenPrice(erc20First.contractAddress);
      expect(tokenPrice).to.eq.BN(tokenPriceSet.toString());
    });

    it("should set multiple token prices correctly", async () => {
      await tokenPriceRegistry.from(infrastructure).setPriceForTokenList([erc20First.contractAddress, erc20Second.contractAddress], [1800, 1900]);
      const tokenPrice1Set = await tokenPriceRegistry.getTokenPrice(erc20First.contractAddress);
      expect(1800).to.eq.BN(tokenPrice1Set.toString());
      const tokenPrice2Set = await tokenPriceRegistry.getTokenPrice(erc20Second.contractAddress);
      expect(1900).to.eq.BN(tokenPrice2Set.toString());
    });

    it("should be able to get the ether value of a given amount of tokens", async () => {
      const tokenPrice = new BN(10).pow(new BN(18)).muln(1800);
      await tokenPriceRegistry.from(infrastructure).setPriceForTokenList([erc20First.contractAddress], [tokenPrice.toString()]);
      const etherValue = await getEtherValue("15000000000000000000", erc20First.contractAddress);
      // expectedValue = 1800*10^18/10^18 (price for 1 token wei) * 15*10^18 (amount) = 1800 * 15*10^18 = 27,000 * 10^18
      const expectedValue = new BN(10).pow(new BN(18)).muln(27000);
      expect(expectedValue).to.eq.BN(etherValue);
    });

    it("should be able to get the ether value for a token with 0 decimals", async () => {
      const tokenPrice = new BN(10).pow(new BN(36)).muln(23000);
      await tokenPriceRegistry.from(infrastructure).setPriceForTokenList([erc20ZeroDecimals.contractAddress], [tokenPrice.toString()]);
      const etherValue = await getEtherValue(100, erc20ZeroDecimals.contractAddress);
      // expectedValue = 23000*10^36 * 100 / 10^18 = 2,300,000 * 10^18
      const expectedValue = new BN(10).pow(new BN(18)).muln(2300000);
      expect(expectedValue).to.eq.BN(etherValue);
    });

    it("should return 0 as the ether value for a low priced token", async () => {
      await tokenPriceRegistry.from(infrastructure).setPriceForTokenList([erc20First.contractAddress], [23000]);
      const etherValue = await getEtherValue(100, erc20First.contractAddress);
      assert.equal(etherValue.toString(), 0); // 2,300,000
    });
  });

  describe("Daily limit", () => {
    it("should migrate daily limit for existing wallets", async () => {
      // create wallet with previous module and funds
      const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
      const existingWallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);

      await existingWallet.init(owner.address, [previousTransferManager.contractAddress]);
      await infrastructure.sendTransaction({ to: existingWallet.contractAddress, value: ethers.BigNumber.from("100000000") });
      // change the limit
      await previousTransferManager.from(owner).changeLimit(existingWallet.contractAddress, 4000000);
      await manager.increaseTime(SECURITY_PERIOD + 1);
      let limit = await previousTransferManager.getCurrentLimit(existingWallet.contractAddress);
      assert.equal(limit.toNumber(), 4000000, "limit should be changed");
      // transfer some funds
      await previousTransferManager.from(owner).transferToken(existingWallet.contractAddress, ETH_TOKEN, recipient.address, 1000000, ZERO_BYTES32);
      // add new module
      await previousTransferManager.from(owner).addModule(existingWallet.contractAddress, versionManager.contractAddress);
      const tx = await versionManager.from(owner).upgradeWallet(existingWallet.contractAddress, await versionManager.lastVersion());
      const txReceipt = await previousTransferManager.verboseWaitForTransaction(tx);
      assert.isTrue(hasEvent(txReceipt, transferManager, "DailyLimitMigrated"));
      // check result
      limit = await transferManager.getCurrentLimit(existingWallet.contractAddress);
      assert.equal(limit.toNumber(), 4000000, "limit should have been migrated");
      const unspent = await transferManager.getDailyUnspent(existingWallet.contractAddress);
      assert.equal(unspent[0].toNumber(), 4000000 - 1000000, "unspent should have been migrated");
    });

    it("should set the default limit for new wallets", async () => {
      const limit = await transferManager.getCurrentLimit(wallet.contractAddress);
      assert.equal(limit.toNumber(), ETH_LIMIT, "limit should be ETH_LIMIT");
    });

    it("should only increase the limit after the security period", async () => {
      await transferManager.from(owner).changeLimit(wallet.contractAddress, 4000000);
      let limit = await transferManager.getCurrentLimit(wallet.contractAddress);
      assert.equal(limit.toNumber(), ETH_LIMIT, "limit should be ETH_LIMIT");
      await manager.increaseTime(SECURITY_PERIOD + 1);
      limit = await transferManager.getCurrentLimit(wallet.contractAddress);
      assert.equal(limit.toNumber(), 4000000, "limit should be changed");
    });

    it("should decrease the limit immediately", async () => {
      let limit = await transferManager.getCurrentLimit(wallet.contractAddress);
      assert.equal(limit.toNumber(), ETH_LIMIT, "limit should be ETH_LIMIT");
      await transferManager.from(owner).changeLimit(wallet.contractAddress, ETH_LIMIT / 2);
      limit = await transferManager.getCurrentLimit(wallet.contractAddress);
      assert.equal(limit.toNumber(), ETH_LIMIT / 2, "limit should be decreased immediately");
    });

    it("should change the limit via relayed transaction", async () => {
      await manager.relay(transferManager, "changeLimit", [wallet.contractAddress, 4000000], wallet, [owner]);
      await manager.increaseTime(SECURITY_PERIOD + 1);
      const limit = await transferManager.getCurrentLimit(wallet.contractAddress);
      assert.equal(limit.toNumber(), 4000000, "limit should be changed");
    });

    it("should correctly set the pending limit", async () => {
      const tx = await transferManager.from(owner).changeLimit(wallet.contractAddress, 4000000);
      const txReceipt = await transferManager.verboseWaitForTransaction(tx);
      const timestamp = await manager.getTimestamp(txReceipt.block);
      const { _pendingLimit, _changeAfter } = await transferManager.getPendingLimit(wallet.contractAddress);
      assert.equal(_pendingLimit.toNumber(), 4000000);
      assert.closeTo(_changeAfter.toNumber(), timestamp + SECURITY_PERIOD, 1); // timestamp is sometimes off by 1
    });

    it("should be able to disable the limit", async () => {
      const tx = await transferManager.from(owner).disableLimit(wallet.contractAddress);
      const txReceipt = await transferManager.verboseWaitForTransaction(tx);
      assert.isTrue(hasEvent(txReceipt, transferManager, "DailyLimitDisabled"));
      let limitDisabled = await transferManager.isLimitDisabled(wallet.contractAddress);
      assert.isFalse(limitDisabled);
      await manager.increaseTime(SECURITY_PERIOD + 1);
      limitDisabled = await transferManager.isLimitDisabled(wallet.contractAddress);
      assert.isTrue(limitDisabled);
    });

    it("should return the correct unspent daily limit amount", async () => {
      await infrastructure.sendTransaction({ to: wallet.contractAddress, value: ethers.BigNumber.from(ETH_LIMIT) });
      const transferAmount = ETH_LIMIT - 100;
      await transferManager.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, transferAmount, ZERO_BYTES32);
      const { _unspent } = await transferManager.getDailyUnspent(wallet.contractAddress);
      assert.equal(_unspent.toNumber(), 100);
    });

    it("should return the correct spent daily limit amount", async () => {
      await infrastructure.sendTransaction({ to: wallet.contractAddress, value: ethers.BigNumber.from(ETH_LIMIT) });
      // Transfer 100 wei
      const tx = await transferManager.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, 100, ZERO_BYTES32);
      const txReceipt = await transferManager.verboseWaitForTransaction(tx);
      const timestamp = await manager.getTimestamp(txReceipt.block);
      // Then transfer 200 wei more
      await transferManager.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, 200, ZERO_BYTES32);

      const dailySpent = await limitStorage.getDailySpent(wallet.contractAddress);
      assert.equal(dailySpent[0].toNumber(), 300);
      assert.closeTo(dailySpent[1].toNumber(), timestamp + (3600 * 24), 1); // timestamp is sometimes off by 1
    });

    it("should return 0 if the entire daily limit amount has been spent", async () => {
      await infrastructure.sendTransaction({ to: wallet.contractAddress, value: ethers.BigNumber.from(ETH_LIMIT) });
      await transferManager.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, ETH_LIMIT, ZERO_BYTES32);
      const { _unspent } = await transferManager.getDailyUnspent(wallet.contractAddress);
      assert.equal(_unspent.toNumber(), 0);
    });
  });

  describe("Token transfers", () => {
    async function doDirectTransfer({
      token, signer = owner, to, amount, relayed = false,
    }) {
      const fundsBefore = (token === ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
      const unspentBefore = await transferManager.getDailyUnspent(wallet.contractAddress);
      const params = [wallet.contractAddress, token === ETH_TOKEN ? ETH_TOKEN : token.contractAddress, to.address, amount, ZERO_BYTES32];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(transferManager, "transferToken", params, wallet, [signer]);
      } else {
        const tx = await transferManager.from(signer).transferToken(...params);
        txReceipt = await transferManager.verboseWaitForTransaction(tx);
      }
      assert.isTrue(await utils.hasEvent(txReceipt, transferManager, "Transfer"), "should have generated Transfer event");
      const fundsAfter = (token === ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
      const unspentAfter = await transferManager.getDailyUnspent(wallet.contractAddress);
      assert.equal(fundsAfter.sub(fundsBefore).toNumber(), amount, "should have transfered amount");
      const ethValue = (token === ETH_TOKEN ? amount : (await getEtherValue(amount, token.contractAddress)).toNumber());
      if (ethValue < ETH_LIMIT) {
        assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), ethValue, "should have updated the daily spent in ETH");
      }
      return txReceipt;
    }

    async function doPendingTransfer({
      token, to, amount, delay, relayed = false,
    }) {
      const tokenAddress = token === ETH_TOKEN ? ETH_TOKEN : token.contractAddress;
      const fundsBefore = (token === ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
      const params = [wallet.contractAddress, tokenAddress, to.address, amount, ZERO_BYTES32];
      let txReceipt; let
        tx;
      if (relayed) {
        txReceipt = await manager.relay(transferManager, "transferToken", params, wallet, [owner]);
      } else {
        tx = await transferManager.from(owner).transferToken(...params);
        txReceipt = await transferManager.verboseWaitForTransaction(tx);
      }
      assert.isTrue(await utils.hasEvent(txReceipt, transferManager, "PendingTransferCreated"), "should have generated PendingTransferCreated event");
      let fundsAfter = (token === ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
      assert.equal(fundsAfter.sub(fundsBefore).toNumber(), 0, "should not have transfered amount");
      if (delay === 0) {
        const id = ethers.utils.solidityKeccak256(["uint8", "address", "address", "uint256", "bytes", "uint256"],
          [ACTION_TRANSFER, tokenAddress, recipient.address, amount, ZERO_BYTES32, txReceipt.blockNumber]);
        return id;
      }
      await manager.increaseTime(delay);
      tx = await transferManager.executePendingTransfer(wallet.contractAddress,
        tokenAddress, recipient.address, amount, ZERO_BYTES32, txReceipt.blockNumber);
      txReceipt = await transferManager.verboseWaitForTransaction(tx);
      assert.isTrue(await utils.hasEvent(txReceipt, transferManager, "PendingTransferExecuted"),
        "should have generated PendingTransferExecuted event");
      fundsAfter = (token === ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
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
        try {
          await doDirectTransfer({
            token: ETH_TOKEN, signer: nonowner, to: recipient, amount: 10000,
          });
          assert.fail("transfer should have failed");
        } catch (error) {
          assert.ok(await manager.isRevertReason(error, "BF: must be owner or feature"));
        }
      });

      it("should calculate the daily unspent when the owner send ETH", async () => {
        let unspent = await transferManager.getDailyUnspent(wallet.contractAddress);
        assert.equal(unspent[0].toNumber(), ETH_LIMIT, "unspent should be the limit at the beginning of a period");
        await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: 10000 });
        unspent = await transferManager.getDailyUnspent(wallet.contractAddress);
        assert.equal(unspent[0].toNumber(), ETH_LIMIT - 10000, "should be the limit minus the transfer");
      });

      it("should calculate the daily unspent in ETH when the owner send ERC20", async () => {
        let unspent = await transferManager.getDailyUnspent(wallet.contractAddress);
        assert.equal(unspent[0].toNumber(), ETH_LIMIT, "unspent should be the limit at the beginning of a period");
        await doDirectTransfer({ token: erc20, to: recipient, amount: 10 });
        unspent = await transferManager.getDailyUnspent(wallet.contractAddress);
        const ethValue = await getEtherValue(10, erc20.contractAddress);
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
        try {
          await doPendingTransfer({
            token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT * 2, delay: 1, relayed: false,
          });
        } catch (error) {
          assert.isTrue(await manager.isRevertReason(error, "outside of the execution window"), "should throw ");
        }
      });

      it("should not execute a pending ETH transfer before the confirmation window (relayed)", async () => {
        try {
          await doPendingTransfer({
            token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT * 2, delay: 1, relayed: true,
          });
        } catch (error) {
          assert.isTrue(await manager.isRevertReason(error, "outside of the execution window"), "should throw ");
        }
      });

      it("should not execute a pending ETH transfer after the confirmation window", async () => {
        try {
          await doPendingTransfer({
            token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT * 2, delay: 10, relayed: false,
          });
        } catch (error) {
          assert.isTrue(await manager.isRevertReason(error, "outside of the execution window"), "should throw ");
        }
      });

      it("should not execute a pending ETH transfer after the confirmation window (relayed)", async () => {
        try {
          await doPendingTransfer({
            token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT * 2, delay: 10, relayed: true,
          });
        } catch (error) {
          assert.isTrue(await manager.isRevertReason(error, "outside of the execution window"), "should throw ");
        }
      });

      it("should cancel a pending ETH transfer", async () => {
        const id = await doPendingTransfer({
          token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT * 2, delay: 0,
        });
        await manager.increaseTime(1);
        const tx = await transferManager.from(owner).cancelPendingTransfer(wallet.contractAddress, id);
        const txReceipt = await transferManager.verboseWaitForTransaction(tx);
        assert.isTrue(await utils.hasEvent(txReceipt, transferManager, "PendingTransferCanceled"),
          "should have generated PendingTransferCanceled event");
        const executeAfter = await transferManager.getPendingTransfer(wallet.contractAddress, id);
        assert.equal(executeAfter, 0, "should have cancelled the pending transfer");
      });

      it("should cancel a pending ERC20 transfer", async () => {
        const id = await doPendingTransfer({
          token: erc20, to: recipient, amount: ETH_LIMIT * 2, delay: 0,
        });
        await manager.increaseTime(1);
        const tx = await transferManager.from(owner).cancelPendingTransfer(wallet.contractAddress, id);
        const txReceipt = await transferManager.verboseWaitForTransaction(tx);
        assert.isTrue(await utils.hasEvent(txReceipt, transferManager, "PendingTransferCanceled"),
          "should have generated PendingTransferCanceled event");
        const executeAfter = await transferManager.getPendingTransfer(wallet.contractAddress, id);
        assert.equal(executeAfter, 0, "should have cancelled the pending transfer");
      });

      it("should send immediately ETH to a whitelisted address", async () => {
        await transferManager.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
        await manager.increaseTime(3);
        await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT * 2 });
      });

      it("should send immediately ERC20 to a whitelisted address", async () => {
        await transferManager.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
        await manager.increaseTime(3);
        await doDirectTransfer({ token: erc20, to: recipient, amount: ETH_LIMIT * 2 });
      });
    });
  });

  describe("Token Approvals", () => {
    async function doDirectApprove({ signer = owner, amount, relayed = false }) {
      const unspentBefore = await transferManager.getDailyUnspent(wallet.contractAddress);
      const params = [wallet.contractAddress, erc20.contractAddress, spender.address, amount];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(transferManager, "approveToken", params, wallet, [signer]);
      } else {
        const tx = await transferManager.from(signer).approveToken(...params);
        txReceipt = await transferManager.verboseWaitForTransaction(tx);
      }
      assert.isTrue(await utils.hasEvent(txReceipt, transferManager, "Approved"), "should have generated Approved event");
      const unspentAfter = await transferManager.getDailyUnspent(wallet.contractAddress);

      const amountInEth = await getEtherValue(amount, erc20.contractAddress);
      if (amountInEth < ETH_LIMIT) {
        assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), amountInEth, "should have updated the daily limit");
      }
      const approval = await erc20.allowance(wallet.contractAddress, spender.address);

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
      await transferManager.from(owner).approveToken(wallet.contractAddress, erc20.contractAddress, spender.address, 10);
      const approval = await erc20.allowance(wallet.contractAddress, spender.address);
      assert.equal(approval.toNumber(), 10);
    });

    it("should not approve an ERC20 transfer when the signer is not the owner ", async () => {
      try {
        await doDirectApprove({ signer: nonowner, amount: 10 });
        assert.fail("approve should have failed");
      } catch (error) {
        assert.ok(await manager.isRevertReason(error, "BF: must be owner or feature"));
      }
    });

    it("should approve an ERC20 immediately when the spender is whitelisted ", async () => {
      await transferManager.from(owner).addToWhitelist(wallet.contractAddress, spender.address);
      await manager.increaseTime(3);
      await doDirectApprove({ amount: ETH_LIMIT + 10000 });
    });

    it("should fail to approve an ERC20 when the amount is above the daily limit ", async () => {
      try {
        await doDirectApprove({ amount: ETH_LIMIT + 10000 });
      } catch (error) {
        assert.ok(await manager.isRevertReason(error, "above daily limit"));
      }
    });
  });

  describe("Call contract", () => {
    let contract;

    beforeEach(async () => {
      contract = await deployer.deploy(TestContract);
      assert.equal(await contract.state(), 0, "initial contract state should be 0");
    });

    async function doCallContract({ value, state, relayed = false }) {
      const dataToTransfer = contract.contract.interface.functions.setState.encode([state]);
      const unspentBefore = await transferManager.getDailyUnspent(wallet.contractAddress);
      const params = [wallet.contractAddress, contract.contractAddress, value, dataToTransfer];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(transferManager, "callContract", params, wallet, [owner]);
      } else {
        const tx = await transferManager.from(owner).callContract(...params);
        txReceipt = await transferManager.verboseWaitForTransaction(tx);
      }
      assert.isTrue(await utils.hasEvent(txReceipt, transferManager, "CalledContract"), "should have generated CalledContract event");
      const unspentAfter = await transferManager.getDailyUnspent(wallet.contractAddress);
      if (value < ETH_LIMIT) {
        assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), value, "should have updated the daily limit");
      }
      assert.equal((await contract.state()).toNumber(), state, "the state of the external contract should have been changed");
      return txReceipt;
    }

    it("should not be able to call the wallet itselt", async () => {
      const dataToTransfer = contract.contract.interface.functions.setState.encode([4]);
      const params = [wallet.contractAddress, wallet.contractAddress, 10, dataToTransfer];
      await assert.revertWith(transferManager.from(owner).callContract(...params), "BT: Forbidden contract");
    });

    it("should not be able to call a feature of the wallet", async () => {
      const dataToTransfer = contract.contract.interface.functions.setState.encode([4]);
      const params = [wallet.contractAddress, transferManager.contractAddress, 10, dataToTransfer];
      await assert.revertWith(transferManager.from(owner).callContract(...params), "BT: Forbidden contract");
    });

    it("should not be able to call a supported ERC20 token contract", async () => {
      const dataToTransfer = contract.contract.interface.functions.setState.encode([4]);
      const params = [wallet.contractAddress, erc20.contractAddress, 10, dataToTransfer];
      await assert.revertWith(transferManager.from(owner).callContract(...params), "TM: Forbidden contract");
    });

    it("should be able to call a supported token contract which is whitelisted", async () => {
      await transferManager.from(owner).addToWhitelist(wallet.contractAddress, erc20.contractAddress);
      await manager.increaseTime(3);
      const dataToTransfer = erc20.contract.interface.functions.transfer.encode([infrastructure.address, 4]);
      const params = [wallet.contractAddress, erc20.contractAddress, 0, dataToTransfer];
      await transferManager.from(owner).callContract(...params);
    });

    it("should call a contract and transfer ETH value when under the daily limit", async () => {
      await doCallContract({ value: 10, state: 3 });
    });

    it("should call a contract and transfer ETH value when under the daily limit (relayed) ", async () => {
      await doCallContract({ value: 10, state: 3, relayed: true });
    });

    it("should call a contract and transfer ETH value above the daily limit when the contract is whitelisted", async () => {
      await transferManager.from(owner).addToWhitelist(wallet.contractAddress, contract.contractAddress);
      await manager.increaseTime(3);
      await doCallContract({ value: ETH_LIMIT + 10000, state: 6 });
    });

    it("should fail to call a contract and transfer ETH when the amount is above the daily limit ", async () => {
      await assert.revertWith(doCallContract({ value: ETH_LIMIT + 10000, state: 6 }, "above daily limit"));
    });
  });

  describe("Approve token and Call contract", () => {
    let contract;

    beforeEach(async () => {
      contract = await deployer.deploy(TestContract);
      assert.equal(await contract.state(), 0, "initial contract state should be 0");
    });

    async function doApproveTokenAndCallContract({
      signer = owner, consumer = contract.contractAddress, amount, state, relayed = false, wrapEth = false,
    }) {
      const fun = consumer === contract.contractAddress ? "setStateAndPayToken" : "setStateAndPayTokenWithConsumer";
      const token = wrapEth ? weth : erc20;
      const dataToTransfer = contract.contract.interface.functions[fun].encode([state, token.contractAddress, amount]);
      const unspentBefore = await transferManager.getDailyUnspent(wallet.contractAddress);
      const params = [wallet.contractAddress]
        .concat(wrapEth ? [] : [erc20.contractAddress])
        .concat([consumer, amount, contract.contractAddress, dataToTransfer]);
      const method = wrapEth ? "approveWethAndCallContract" : "approveTokenAndCallContract";
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(transferManager, method, params, wallet, [signer]);
      } else {
        const tx = await transferManager.from(signer)[method](...params);
        txReceipt = await transferManager.verboseWaitForTransaction(tx);
      }
      assert.isTrue(await utils.hasEvent(txReceipt, transferManager, "ApprovedAndCalledContract"), "should have generated CalledContract event");
      const unspentAfter = await transferManager.getDailyUnspent(wallet.contractAddress);
      const amountInEth = wrapEth ? amount : await getEtherValue(amount, erc20.contractAddress);

      if (amountInEth < ETH_LIMIT) {
        assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), amountInEth, "should have updated the daily limit");
      }
      assert.equal((await contract.state()).toNumber(), state, "the state of the external contract should have been changed");
      const tokenBalance = await token.balanceOf(contract.contractAddress);
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
      await transferManager.from(owner).approveToken(wallet.contractAddress, erc20.contractAddress, contract.contractAddress, 10);
      const dataToTransfer = contract.contract.interface.functions.setStateAndPayToken.encode([3, erc20.contractAddress, 5]);
      await transferManager.from(owner).approveTokenAndCallContract(
        wallet.contractAddress,
        erc20.contractAddress,
        contract.contractAddress,
        5,
        contract.contractAddress,
        dataToTransfer,
      );
      const approval = await erc20.allowance(wallet.contractAddress, contract.contractAddress);

      // Initial approval of 10 is restored, after approving and spending 5
      assert.equal(approval.toNumber(), 10);

      const erc20Balance = await erc20.balanceOf(contract.contractAddress);
      assert.equal(erc20Balance.toNumber(), 5, "the contract should have transfered the tokens");
    });

    it("should be able to spend less than approved in call", async () => {
      await transferManager.from(owner).approveToken(wallet.contractAddress, erc20.contractAddress, contract.contractAddress, 10);
      const dataToTransfer = contract.contract.interface.functions.setStateAndPayToken.encode([3, erc20.contractAddress, 4]);
      await transferManager.from(owner).approveTokenAndCallContract(
        wallet.contractAddress,
        erc20.contractAddress,
        contract.contractAddress,
        5,
        contract.contractAddress,
        dataToTransfer,
      );
      const approval = await erc20.allowance(wallet.contractAddress, contract.contractAddress);
      // Initial approval of 10 is restored, after approving and spending 4
      assert.equal(approval.toNumber(), 10);

      const erc20Balance = await erc20.balanceOf(contract.contractAddress);
      assert.equal(erc20Balance.toNumber(), 4, "the contract should have transfered the tokens");
    });

    it("should not be able to spend more than approved in call", async () => {
      await transferManager.from(owner).approveToken(wallet.contractAddress, erc20.contractAddress, contract.contractAddress, 10);
      const dataToTransfer = contract.contract.interface.functions.setStateAndPayToken.encode([3, erc20.contractAddress, 6]);
      await assert.revertWith(transferManager.from(owner).approveTokenAndCallContract(
        wallet.contractAddress,
        erc20.contractAddress,
        contract.contractAddress,
        5,
        contract.contractAddress,
        dataToTransfer,
      ), "BT: insufficient amount for call");
    });

    it("should approve the token and call the contract when the token is above the limit and the contract is whitelisted ", async () => {
      await transferManager.from(owner).addToWhitelist(wallet.contractAddress, contract.contractAddress);
      await manager.increaseTime(3);
      await doApproveTokenAndCallContract({ amount: ETH_LIMIT + 10000, state: 6 });
    });

    it("should approve the token and call the contract when contract to call is different to token spender", async () => {
      const consumer = await contract.tokenConsumer();
      await doApproveTokenAndCallContract({ amount: 10, state: 3, consumer });
    });

    it("should approve token and call contract when contract != spender, amount > limit and contract is whitelisted", async () => {
      const consumer = await contract.tokenConsumer();
      await transferManager.from(owner).addToWhitelist(wallet.contractAddress, contract.contractAddress);
      await manager.increaseTime(3);
      await doApproveTokenAndCallContract({ amount: ETH_LIMIT + 10000, state: 6, consumer });
    });

    it("should fail to approve token and call contract when contract != spender, amount > limit and spender is whitelisted", async () => {
      const amount = ETH_LIMIT + 10000;
      const consumer = await contract.tokenConsumer();
      await transferManager.from(owner).addToWhitelist(wallet.contractAddress, consumer);
      await manager.increaseTime(3);
      const dataToTransfer = contract.contract.interface.functions.setStateAndPayTokenWithConsumer.encode([6, erc20.contractAddress, amount]);
      await assert.revertWith(
        transferManager.from(owner).approveTokenAndCallContract(
          wallet.contractAddress, erc20.contractAddress, consumer, amount, contract.contractAddress, dataToTransfer,
        ),
        "TM: Approve above daily limit",
      );
    });

    it("should fail to approve the token and call the contract when the token is above the daily limit ", async () => {
      try {
        await doApproveTokenAndCallContract({ amount: ETH_LIMIT + 10000, state: 6 });
      } catch (error) {
        assert.ok(await manager.isRevertReason(error, "above daily limit"));
      }
    });

    it("should fail to approve token if the amount to be approved is greater than the current balance", async () => {
      const startingBalance = await erc20.balanceOf(wallet.contractAddress);
      await erc20.burn(wallet.contractAddress, startingBalance);
      const dataToTransfer = contract.contract.interface.functions.setStateAndPayToken.encode([3, erc20.contractAddress, 1]);
      await assert.revertWith(transferManager.from(owner).approveTokenAndCallContract(
        wallet.contractAddress,
        erc20.contractAddress,
        contract.contractAddress,
        1,
        contract.contractAddress,
        dataToTransfer,
      ), "BT: insufficient balance");
    });

    // approveWethAndCallContract

    it("should approve WETH and call the contract when under the limit", async () => {
      await doApproveTokenAndCallContract({ amount: 10, state: 3, wrapEth: true });
    });

    it("should approve WETH and call the contract under the limit when already holding the WETH", async () => {
      const amount = 10;
      await weth.from(infrastructure).deposit({ value: amount });
      await weth.from(infrastructure).transfer(wallet.contractAddress, amount);
      await doApproveTokenAndCallContract({ amount, state: 3, wrapEth: true });
    });
  });

  describe("Static calls", () => {
    it("should delegate isValidSignature static calls to the TransferManager", async () => {
      const ERC1271_ISVALIDSIGNATURE_BYTES32 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("isValidSignature(bytes32,bytes)")).slice(0, 10);
      const isValidSignatureDelegate = await wallet.enabled(ERC1271_ISVALIDSIGNATURE_BYTES32);
      assert.equal(isValidSignatureDelegate, versionManager.contractAddress);

      const walletAsTransferManager = deployer.wrapDeployedContract(TransferManager, wallet.contractAddress);
      const signHash = ethers.utils.keccak256("0x1234");
      const sig = await personalSign(signHash, owner);
      const valid = await walletAsTransferManager.isValidSignature(signHash, sig);
      assert.equal(valid, ERC1271_ISVALIDSIGNATURE_BYTES32);
    });
    it("should revert isValidSignature static call for invalid signature", async () => {
      const walletAsTransferManager = deployer.wrapDeployedContract(TransferManager, wallet.contractAddress);
      const signHash = ethers.utils.keccak256("0x1234");
      const sig = `${await personalSign(signHash, owner)}a1`;

      await assert.revertWith(
        walletAsTransferManager.isValidSignature(signHash, sig), "TM: invalid signature length",
      );
    });
    it("should revert isValidSignature static call for invalid signer", async () => {
      const walletAsTransferManager = deployer.wrapDeployedContract(TransferManager, wallet.contractAddress);
      const signHash = ethers.utils.keccak256("0x1234");
      const sig = await personalSign(signHash, nonowner);

      await assert.revertWith(
        walletAsTransferManager.isValidSignature(signHash, sig), "TM: Invalid signer",
      );
    });
  });
});
