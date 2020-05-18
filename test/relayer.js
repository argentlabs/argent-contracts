/* global accounts */
const ethers = require("ethers");
const { formatBytes32String } = require("ethers").utils;
const { parseRelayReceipt } = require("../utils/utilities.js");

const Wallet = require("../build/BaseWallet");
const TestModule = require("../build/TestModuleRelayer");
const Registry = require("../build/ModuleRegistry");
const GuardianManager = require("../build/GuardianManager");
const GuardianStorage = require("../build/GuardianStorage");
const ApprovedTransfer = require("../build/ApprovedTransfer");
const RecoveryManager = require("../build/RecoveryManager"); // non-owner only module
const NftTransfer = require("../build/NftTransfer"); // owner only module
const CryptoKittyTest = require("../build/CryptoKittyTest");

const TestManager = require("../utils/test-manager");
const { getRandomAddress } = require("../utils/utilities.js");

const TARGET_OF_DATA_NOT_WALLET_REVERT_MSG = "RM: Target of _data != _wallet";
const INVALID_DATA_REVERT_MSG = "RM: Invalid dataWallet";
const DUPLICATE_REQUEST_REVERT_MSG = "RM: Duplicate request";

describe("RelayerModule", function () {
  this.timeout(10000);

  const manager = new TestManager();
  const { deployer } = manager;
  let { getNonceForRelay } = manager;
  getNonceForRelay = getNonceForRelay.bind(manager);
  const owner = accounts[1].signer;

  let registry;
  let guardianStorage;
  let guardianManager;
  let recoveryManager;
  let wallet;
  let approvedTransfer;
  let nftTransferModule;
  let testModule;
  let testModuleNew;

  beforeEach(async () => {
    registry = await deployer.deploy(Registry);
    guardianStorage = await deployer.deploy(GuardianStorage);
    // ApprovedTransfer is a sample non-OnlyOwner module
    approvedTransfer = await deployer.deploy(ApprovedTransfer, {}, registry.contractAddress, guardianStorage.contractAddress);
    const cryptoKittyTest = await deployer.deploy(CryptoKittyTest);
    // NFTTransferModule is a sample OnlyOwner module
    nftTransferModule = await deployer.deploy(NftTransfer, {},
      registry.contractAddress,
      guardianStorage.contractAddress,
      cryptoKittyTest.contractAddress);
    guardianManager = await deployer.deploy(GuardianManager, {}, registry.contractAddress, guardianStorage.contractAddress, 24, 12);
    recoveryManager = await deployer.deploy(RecoveryManager, {}, registry.contractAddress, guardianStorage.contractAddress, 36, 120, 24, 12);

    testModule = await deployer.deploy(TestModule, {}, registry.contractAddress, false, 0);
    testModuleNew = await deployer.deploy(TestModule, {}, registry.contractAddress, false, 0);

    wallet = await deployer.deploy(Wallet);
    await wallet.init(owner.address,
      [approvedTransfer.contractAddress,
        nftTransferModule.contractAddress,
        guardianManager.contractAddress,
        recoveryManager.contractAddress,
        testModule.contractAddress]);
  });

  describe("relaying module transactions", () => {
    it("should fail when target of _data != _wallet", async () => {
      const params = [await getRandomAddress(), 4]; // the first argument is not the wallet address, which should make the relaying revert
      await assert.revertWith(
        manager.relay(testModule, "setIntOwnerOnly", params, wallet, [owner]), TARGET_OF_DATA_NOT_WALLET_REVERT_MSG,
      );
    });

    it("should fail when _data is less than 36 bytes", async () => {
      const params = []; // the first argument is not the wallet address, which should make the relaying rever
      await assert.revertWith(
        manager.relay(testModule, "clearInt", params, wallet, [owner]), INVALID_DATA_REVERT_MSG,
      );
    });

    it("should fail a duplicate transaction", async () => {
      const params = [wallet.contractAddress, 2];
      const nonce = await getNonceForRelay();
      const relayParams = [testModule, "setIntOwnerOnly", params, wallet, [owner],
        accounts[9].signer, false, 2000000, nonce];
      await manager.relay(...relayParams);
      await assert.revertWith(
        manager.relay(...relayParams), DUPLICATE_REQUEST_REVERT_MSG,
      );
    });

    it("should update the nonce after transaction", async () => {
      const nonce = await getNonceForRelay();
      await manager.relay(testModule, "setIntOwnerOnly", [wallet.contractAddress, 2], wallet, [owner],
        accounts[9].signer, false, 2000000, nonce);

      const updatedNonce = await testModule.getNonce(wallet.contractAddress);
      const updatedNonceHex = await ethers.utils.hexZeroPad(updatedNonce.toHexString(), 32);
      assert.equal(nonce, updatedNonceHex);
    });

    it("should not allow ApprovedTransfer and RecoveryManager module functions to be executed directly", async () => {
      const randomAddress = await getRandomAddress();

      await assert.revertWith(
        approvedTransfer.transferToken(wallet.contractAddress, randomAddress, randomAddress, 1, ethers.constants.HashZero),
        "RM: must be called via execute()",
      );

      await assert.revertWith(
        approvedTransfer.callContract(wallet.contractAddress, randomAddress, 1, ethers.constants.HashZero),
        "RM: must be called via execute()",
      );

      await assert.revertWith(
        approvedTransfer.approveTokenAndCallContract(
          wallet.contractAddress,
          randomAddress,
          randomAddress,
          1,
          randomAddress,
          ethers.constants.HashZero,
        ),
        "RM: must be called via execute()",
      );

      await assert.revertWith(recoveryManager.executeRecovery(wallet.contractAddress, randomAddress), "RM: must be called via execute()");
      await assert.revertWith(recoveryManager.cancelRecovery(wallet.contractAddress), "RM: must be called via execute()");
      await assert.revertWith(recoveryManager.transferOwnership(wallet.contractAddress, randomAddress), "RM: must be called via execute()");
    });

    it("should fail to refund ", async () => {
      const nonce = await getNonceForRelay();

      const newowner = accounts[5].signer;
      const guardian = accounts[6].signer;
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian.address);

      const txReceipt = await manager.relay(
        recoveryManager,
        "transferOwnership",
        [wallet.contractAddress, newowner.address],
        wallet,
        [owner, guardian],
        accounts[9].signer,
        false,
        2000000,
        nonce,
        1,
      );

      const { error } = parseRelayReceipt(txReceipt);
      assert.equal(error, "RM: refund failed");
    });
  });

  describe("addModule transactions", () => {
    it("should succeed when relayed on OnlyOwnerModule modules", async () => {
      await registry.registerModule(testModuleNew.contractAddress, formatBytes32String("testModuleNew"));
      const params = [wallet.contractAddress, testModuleNew.contractAddress];
      await manager.relay(nftTransferModule, "addModule", params, wallet, [owner]);

      const isModuleAuthorised = await wallet.authorised(testModuleNew.contractAddress);
      assert.isTrue(isModuleAuthorised);
    });

    it("should succeed when called directly on OnlyOwnerModule modules", async () => {
      await registry.registerModule(testModuleNew.contractAddress, formatBytes32String("testModuleNew"));
      await nftTransferModule.from(owner).addModule(wallet.contractAddress, testModuleNew.contractAddress);

      const isModuleAuthorised = await wallet.authorised(testModuleNew.contractAddress);
      assert.isTrue(isModuleAuthorised);
    });

    it("should fail when relayed on non-OnlyOwnerModule modules", async () => {
      await registry.registerModule(testModuleNew.contractAddress, formatBytes32String("testModuleNew"));
      const params = [wallet.contractAddress, testModuleNew.contractAddress];
      const txReceipt = await manager.relay(approvedTransfer, "addModule", params, wallet, [owner]);
      const { success, error } = parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, "BM: msg.sender must be an owner for the wallet");

      const isModuleAuthorised = await wallet.authorised(testModuleNew.contractAddress);
      assert.isFalse(isModuleAuthorised);
    });

    it("should succeed when called directly on non-OnlyOwnerModule modules", async () => {
      await registry.registerModule(testModuleNew.contractAddress, formatBytes32String("testModuleNew"));
      await approvedTransfer.from(owner).addModule(wallet.contractAddress, testModuleNew.contractAddress);
      const isModuleAuthorised = await wallet.authorised(testModuleNew.contractAddress);
      assert.isTrue(isModuleAuthorised);
    });

    it("should fail to add module which is not registered", async () => {
      await assert.revertWith(approvedTransfer.from(owner).addModule(wallet.contractAddress, testModuleNew.contractAddress),
        "BM: module is not registered");
    });
  });
});
