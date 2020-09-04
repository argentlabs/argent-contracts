/* global accounts */
const ethers = require("ethers");
const BN = require("bn.js");
const { formatBytes32String } = require("ethers").utils;
const { parseRelayReceipt, hasEvent } = require("../utils/utilities.js");

const Proxy = require("../build/Proxy");
const BaseWallet = require("../build/BaseWallet");
const BadFeature = require("../build/BadFeature");
const RelayerManager = require("../build/RelayerManager");
const TestFeature = require("../build/TestFeature");
const TestLimitFeature = require("../build/TestLimitFeature");
const Registry = require("../build/ModuleRegistry");
const GuardianManager = require("../build/GuardianManager");
const GuardianStorage = require("../build/GuardianStorage");
const LockStorage = require("../build/LockStorage");
const LimitStorage = require("../build/LimitStorage");
const TokenPriceStorage = require("../build/TokenPriceStorage");
const ApprovedTransfer = require("../build/ApprovedTransfer");
const RecoveryManager = require("../build/RecoveryManager"); // non-owner only feature
const VersionManager = require("../build/VersionManager");
const ERC20 = require("../build/TestERC20");

const TestManager = require("../utils/test-manager");
const { ETH_TOKEN } = require("../utils/utilities.js");

const FEATURE_NOT_AUTHORISED_FOR_WALLET = "RM: feature not authorised";
const INVALID_DATA_REVERT_MSG = "RM: Invalid dataWallet";
const DUPLICATE_REQUEST_REVERT_MSG = "RM: Duplicate request";
const INVALID_WALLET_REVERT_MSG = "RM: Target of _data != _wallet";
const RELAYER_NOT_AUTHORISED_FOR_WALLET = "BF: must be owner or feature";
const GAS_LESS_THAN_GASLIMIT = "RM: not enough gas provided";
const WRONG_NUMBER_SIGNATURES = "RM: Wrong number of signatures";

describe("RelayerManager", function () {
  this.timeout(10000);

  const manager = new TestManager();
  const { deployer } = manager;
  let { getNonceForRelay } = manager;
  getNonceForRelay = getNonceForRelay.bind(manager);

  const infrastructure = accounts[0].signer;
  const owner = accounts[1].signer;
  const recipient = accounts[3].signer;
  const guardian = accounts[4].signer;

  let registry;
  let guardianStorage;
  let lockStorage;
  let limitStorage;
  let guardianManager;
  let recoveryManager;
  let wallet;
  let approvedTransfer;
  let testFeature;
  let testFeatureNew;
  let relayerManager;
  let tokenPriceStorage;
  let limitFeature;
  let badFeature;
  let versionManager;
  let versionManagerV2;

  before(async () => {
    registry = await deployer.deploy(Registry);
    guardianStorage = await deployer.deploy(GuardianStorage);
    lockStorage = await deployer.deploy(LockStorage);
    limitStorage = await deployer.deploy(LimitStorage);
    versionManager = await deployer.deploy(VersionManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      limitStorage.contractAddress);
    versionManagerV2 = await deployer.deploy(VersionManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      limitStorage.contractAddress);

    tokenPriceStorage = await deployer.deploy(TokenPriceStorage);
    await tokenPriceStorage.addManager(infrastructure.address);
    relayerManager = await deployer.deploy(RelayerManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      limitStorage.contractAddress,
      tokenPriceStorage.contractAddress,
      versionManager.contractAddress);
    manager.setRelayerManager(relayerManager);
  });

  beforeEach(async () => {
    approvedTransfer = await deployer.deploy(ApprovedTransfer, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      limitStorage.contractAddress,
      versionManager.contractAddress,
      ethers.constants.AddressZero);
    guardianManager = await deployer.deploy(GuardianManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      versionManager.contractAddress,
      24,
      12);
    recoveryManager = await deployer.deploy(RecoveryManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      versionManager.contractAddress,
      36, 24 * 5);

    testFeature = await deployer.deploy(TestFeature, {}, lockStorage.contractAddress, versionManager.contractAddress, false, 0);
    testFeatureNew = await deployer.deploy(TestFeature, {}, lockStorage.contractAddress, versionManager.contractAddress, false, 0);

    limitFeature = await deployer.deploy(TestLimitFeature, {},
      lockStorage.contractAddress, limitStorage.contractAddress, versionManager.contractAddress);
    badFeature = await deployer.deploy(BadFeature, {}, lockStorage.contractAddress, versionManager.contractAddress);

    const walletImplementation = await deployer.deploy(BaseWallet);
    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);

    for (const vm of [versionManager, versionManagerV2]) {
      await vm.addVersion([
        relayerManager.contractAddress,
        approvedTransfer.contractAddress,
        guardianManager.contractAddress,
        recoveryManager.contractAddress,
        testFeature.contractAddress,
        limitFeature.contractAddress,
        badFeature.contractAddress,
      ], []);
    }

    await wallet.init(owner.address, [versionManager.contractAddress]);
  });

  describe("relaying feature transactions", () => {
    it("should fail when _data is less than 36 bytes", async () => {
      const params = []; // the first argument is not the wallet address, which should make the relaying revert
      await assert.revertWith(
        manager.relay(testFeature, "clearInt", params, wallet, [owner]), INVALID_DATA_REVERT_MSG,
      );
    });

    it("should fail when feature is not authorised", async () => {
      const params = [wallet.contractAddress, 2];
      await assert.revertWith(
        manager.relay(testFeatureNew, "setIntOwnerOnly", params, wallet, [owner]), FEATURE_NOT_AUTHORISED_FOR_WALLET,
      );
    });

    it("should fail when the RelayerManager is not authorised", async () => {
      await versionManager.addVersion([testFeature.contractAddress], []);
      const wrongWallet = await deployer.deploy(BaseWallet);
      await wrongWallet.init(owner.address, [versionManager.contractAddress]);
      const params = [wrongWallet.contractAddress, 2];
      const txReceipt = await manager.relay(testFeature, "setIntOwnerOnly", params, wrongWallet, [owner]);
      const { success, error } = parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, RELAYER_NOT_AUTHORISED_FOR_WALLET);
      // reset last version to default bundle
      await versionManager.addVersion([
        relayerManager.contractAddress,
        approvedTransfer.contractAddress,
        guardianManager.contractAddress,
        recoveryManager.contractAddress,
        testFeature.contractAddress,
        limitFeature.contractAddress,
        badFeature.contractAddress,
      ], []);
    });

    it("should fail when the first param is not the wallet ", async () => {
      const params = [owner.address, 4];
      await assert.revertWith(
        manager.relay(testFeature, "setIntOwnerOnly", params, wallet, [owner]), INVALID_WALLET_REVERT_MSG,
      );
    });

    it("should fail when the gas of the transaction is less then the gasLimit ", async () => {
      const params = [wallet.contractAddress, 2];
      const nonce = await getNonceForRelay();
      const gasLimit = 2000000;
      const relayParams = [
        testFeature,
        "setIntOwnerOnly",
        params,
        wallet,
        [owner],
        accounts[9].signer,
        false,
        gasLimit,
        nonce,
        0,
        ETH_TOKEN,
        ethers.constants.AddressZero,
        gasLimit * 0.9];
      await assert.revertWith(manager.relay(...relayParams), GAS_LESS_THAN_GASLIMIT);
    });

    it("should fail when a wrong number of signatures is provided", async () => {
      const params = [wallet.contractAddress, 2];
      const relayParams = [testFeature, "setIntOwnerOnly", params, wallet, [owner, recipient]];
      await assert.revertWith(manager.relay(...relayParams), WRONG_NUMBER_SIGNATURES);
    });

    it("should fail a duplicate transaction", async () => {
      const params = [wallet.contractAddress, 2];
      const nonce = await getNonceForRelay();
      const relayParams = [testFeature, "setIntOwnerOnly", params, wallet, [owner],
        accounts[9].signer, false, 2000000, nonce];
      await manager.relay(...relayParams);
      await assert.revertWith(
        manager.relay(...relayParams), DUPLICATE_REQUEST_REVERT_MSG,
      );
    });

    it("should fail when relaying to itself", async () => {
      const dataMethod = "setIntOwnerOnly";
      const dataParam = [wallet.contractAddress, 2];
      const methodData = testFeature.contract.interface.functions[dataMethod].encode(dataParam);
      const params = [
        wallet.contractAddress,
        testFeature.contractAddress,
        methodData,
        0,
        ethers.constants.HashZero,
        0,
        200000,
        ETH_TOKEN,
        ethers.constants.AddressZero,
      ];
      await assert.revertWith(
        manager.relay(relayerManager, "execute", params, wallet, [owner]), "BF: disabled method",
      );
    });

    it("should update the nonce after the transaction", async () => {
      const nonce = await getNonceForRelay();
      await manager.relay(testFeature, "setIntOwnerOnly", [wallet.contractAddress, 2], wallet, [owner],
        accounts[9].signer, false, 2000000, nonce);

      const updatedNonce = await relayerManager.getNonce(wallet.contractAddress);
      const updatedNonceHex = await ethers.utils.hexZeroPad(updatedNonce.toHexString(), 32);
      assert.equal(nonce, updatedNonceHex);
    });
  });

  describe("refund", () => {
    let erc20;
    beforeEach(async () => {
      const decimals = 12; // number of decimal for TOKN contract
      const tokenRate = new BN(10).pow(new BN(19)).muln(51); // 1 TOKN = 0.00051 ETH = 0.00051*10^18 ETH wei => *10^(18-decimals) = 0.00051*10^18 * 10^6 = 0.00051*10^24 = 51*10^19
      erc20 = await deployer.deploy(ERC20, {}, [infrastructure.address], 10000000, decimals); // TOKN contract with 10M tokens (10M TOKN for account[0])
      await tokenPriceStorage.setPriceForTokenList([erc20.contractAddress], [tokenRate.toString()]);
      await limitFeature.setLimitAndDailySpent(wallet.contractAddress, 10000000000, 0);
    });

    async function provisionFunds(ethAmount, erc20Amount) {
      if (ethAmount) {
        await infrastructure.sendTransaction({ to: wallet.contractAddress, value: ethAmount });
      }
      if (erc20Amount) {
        await erc20.transfer(wallet.contractAddress, erc20Amount);
      }
    }

    async function callAndRefund({ refundToken }) {
      const nonce = await getNonceForRelay();
      const relayParams = [
        testFeature,
        "setIntOwnerOnly",
        [wallet.contractAddress, 2],
        wallet,
        [owner],
        accounts[9].signer,
        false,
        2000000,
        nonce,
        10,
        refundToken,
        recipient.address];
      const txReceipt = await manager.relay(...relayParams);
      return txReceipt;
    }

    async function setLimitAndDailySpent({ limit, alreadySpent }) {
      await limitFeature.setLimitAndDailySpent(wallet.contractAddress, limit, alreadySpent);
    }

    it("should refund in ETH", async () => {
      await provisionFunds(ethers.BigNumber.from("100000000000000"), 0);
      const wBalanceStart = await deployer.provider.getBalance(wallet.contractAddress);
      const rBalanceStart = await deployer.provider.getBalance(recipient.address);
      await callAndRefund({ refundToken: ETH_TOKEN });
      const wBalanceEnd = await deployer.provider.getBalance(wallet.contractAddress);
      const rBalanceEnd = await deployer.provider.getBalance(recipient.address);
      const refund = wBalanceStart.sub(wBalanceEnd);
      assert.isTrue(refund.gt(0), "should have refunded ETH");
      assert.isTrue(refund.eq(rBalanceEnd.sub(rBalanceStart)), "should have refunded the recipient");
    });

    it("should refund in ERC20", async () => {
      await provisionFunds(0, ethers.BigNumber.from("100000000000000"));
      const wBalanceStart = await erc20.balanceOf(wallet.contractAddress);
      const rBalanceStart = await erc20.balanceOf(recipient.address);
      await callAndRefund({ refundToken: erc20.contractAddress });
      const wBalanceEnd = await erc20.balanceOf(wallet.contractAddress);
      const rBalanceEnd = await erc20.balanceOf(recipient.address);
      const refund = wBalanceStart.sub(wBalanceEnd);
      assert.isTrue(refund.gt(0), "should have refunded ERC20");
      assert.isTrue(refund.eq(rBalanceEnd.sub(rBalanceStart)), "should have refunded the recipient");
    });

    it("should emit the Refund event", async () => {
      await provisionFunds(ethers.BigNumber.from("100000000000"), 0);
      const txReceipt = await callAndRefund({ refundToken: ETH_TOKEN });
      assert.isTrue(await hasEvent(txReceipt, relayerManager, "Refund"), "should have generated Refund event");
    });

    it("should fail the transaction when when there is not enough ETH for the refund", async () => {
      await provisionFunds(ethers.BigNumber.from("10"), 0);
      await assert.revertWith(callAndRefund({ refundToken: ETH_TOKEN }), "VM: wallet invoke reverted");
    });

    it("should fail the transaction when when there is not enough ERC20 for the refund", async () => {
      await provisionFunds(0, ethers.BigNumber.from("10"));
      await assert.revertWith(callAndRefund({ refundToken: erc20.contractAddress }), "ERC20: transfer amount exceeds balance");
    });

    it("should include the refund in the daily limit", async () => {
      await provisionFunds(ethers.BigNumber.from("100000000000"), 0);
      await setLimitAndDailySpent({ limit: 1000000000, alreadySpent: 10 });
      let dailySpent = await limitFeature.getDailySpent(wallet.contractAddress);
      assert.isTrue(dailySpent.toNumber() === 10, "initial daily spent should be 10");
      await callAndRefund({ refundToken: ETH_TOKEN });
      dailySpent = await limitFeature.getDailySpent(wallet.contractAddress);
      assert.isTrue(dailySpent > 10, "Daily spent should be greater then 10");
    });

    it("should refund and reset the daily limit when approved by guardians", async () => {
      // set funds and limit/daily spent
      await provisionFunds(ethers.BigNumber.from("100000000000"), 0);
      await setLimitAndDailySpent({ limit: 1000000000, alreadySpent: 10 });
      let dailySpent = await limitFeature.getDailySpent(wallet.contractAddress);
      assert.isTrue(dailySpent.toNumber() === 10, "initial daily spent should be 10");
      const rBalanceStart = await deployer.provider.getBalance(recipient.address);
      // add a guardian
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian.address);
      // call approvedTransfer
      const params = [wallet.contractAddress, ETH_TOKEN, recipient.address, 1000, ethers.constants.HashZero];
      const nonce = await getNonceForRelay();
      const gasLimit = 2000000;
      const relayParams = [
        approvedTransfer,
        "transferToken",
        params,
        wallet,
        [owner, guardian],
        accounts[9].signer,
        false,
        gasLimit,
        nonce,
        0,
        ETH_TOKEN,
        ethers.constants.AddressZero,
        gasLimit * 1.1];
      await manager.relay(...relayParams);
      dailySpent = await limitFeature.getDailySpent(wallet.contractAddress);
      assert.isTrue(dailySpent.toNumber() === 0, "daily spent should be reset");
      const rBalanceEnd = await deployer.provider.getBalance(recipient.address);
      assert.isTrue(rBalanceEnd.gt(rBalanceStart), "should have refunded the recipient");
    });

    it("should fail if required signatures is 0 and OwnerRequirement is not Anyone", async () => {
      await assert.revertWith(
        manager.relay(badFeature, "setIntOwnerOnly", [wallet.contractAddress, 2], wallet, [owner]), "RM: Wrong signature requirement",
      );
    });

    it("should fail the transaction when the refund is over the daily limit", async () => {
      await provisionFunds(ethers.BigNumber.from("100000000000"), 0);
      await setLimitAndDailySpent({ limit: 1000000000, alreadySpent: 999999990 });
      const dailySpent = await limitFeature.getDailySpent(wallet.contractAddress);
      assert.isTrue(dailySpent.toNumber() === 999999990, "initial daily spent should be 999999990");
      await assert.revertWith(callAndRefund({ refundToken: ETH_TOKEN }), "RM: refund is above daily limit");
    });
  });

  describe("addModule transactions", () => {
    it("should succeed when relayed on VersionManager", async () => {
      await registry.registerModule(versionManagerV2.contractAddress, formatBytes32String("versionManagerV2"));
      const params = [wallet.contractAddress, versionManagerV2.contractAddress];
      await manager.relay(versionManager, "addModule", params, wallet, [owner]);

      const isModuleAuthorised = await wallet.authorised(versionManagerV2.contractAddress);
      assert.isTrue(isModuleAuthorised);
      await registry.deregisterModule(versionManagerV2.contractAddress);
    });

    it("should succeed when called directly on VersionManager", async () => {
      await registry.registerModule(versionManagerV2.contractAddress, formatBytes32String("versionManagerV2"));
      await versionManager.from(owner).addModule(wallet.contractAddress, versionManagerV2.contractAddress);

      const isModuleAuthorised = await wallet.authorised(versionManagerV2.contractAddress);
      assert.isTrue(isModuleAuthorised);
      await registry.deregisterModule(versionManagerV2.contractAddress);
    });

    it("should fail to add module which is not registered", async () => {
      await assert.revertWith(versionManager.from(owner).addModule(wallet.contractAddress, versionManagerV2.contractAddress),
        "VM: module is not registered");
    });
  });
});
