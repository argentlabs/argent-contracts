const ethers = require("ethers");
const { AddressZero } = require("ethers").constants;

const Wallet = require("../build/BaseWallet");
const TestModule = require("../build/TestModule");
const TestModuleRelayerV2 = require("../build/TestModuleRelayerV2");
const Registry = require("../build/ModuleRegistry");
const GuardianStorage = require("../build/GuardianStorage");
const ApprovedTransfer = require("../build/ApprovedTransfer");
const RecoveryManager = require("../build/RecoveryManager");

const TestManager = require("../utils/test-manager");
const { getRandomAddress } = require("../utils/utilities.js");

const TARGET_OF_DATA_NOT_WALLET_REVERT_MSG = "RM: the wallet authorized is different then the target of the relayed data";
const TARGET_OF_DATA_NOT_WALLET_REVERT_MSG_V2 = "RM: Target of _data != _wallet";
const INVALID_DATA_REVERT_MSG = "RM: Invalid dataWallet";
const DUPLICATE_REQUEST_REVERT_MSG = "RM: Duplicate request";

describe("RelayerModule", function () {
  this.timeout(10000);

  const manager = new TestManager();
  const { deployer } = manager;
  let { getNonceForRelay } = manager;
  getNonceForRelay = getNonceForRelay.bind(manager);
  const owner = global.accounts[1].signer;
  let wallet;
  let relayerModule;
  let relayerModuleV2;

  beforeEach(async () => {
    relayerModule = await deployer.deploy(TestModule, {}, AddressZero, false, 0);
    relayerModuleV2 = await deployer.deploy(TestModuleRelayerV2, {}, AddressZero, false, 0);
    wallet = await deployer.deploy(Wallet);
    await wallet.init(owner.address, [relayerModule.contractAddress, relayerModuleV2.contractAddress]);
  });

  describe("RelayerModule", () => {
    it("should fail to relay when target of _data != _wallet", async () => {
      const params = [await getRandomAddress(), 4]; // the first argument is not the wallet address, which should make the relaying revert
      await assert.revertWith(
        manager.relay(relayerModule, "setIntOwnerOnly", params, wallet, [owner]), TARGET_OF_DATA_NOT_WALLET_REVERT_MSG,
      );
    });

    it("should fail to relay when _data is less than 36 bytes", async () => {
      const params = []; // the first argument is not the wallet address, which should make the relaying rever
      await assert.revertWith(
        manager.relay(relayerModule, "clearInt", params, wallet, [owner]), INVALID_DATA_REVERT_MSG,
      );
    });

    it("should fail to relay a duplicate transaction", async () => {
      const params = [wallet.contractAddress, 2];
      const nonce = await getNonceForRelay();
      const relayParams = [relayerModule, "setIntOwnerOnly", params, wallet, [owner],
        global.accounts[9].signer, false, 2000000, nonce];
      await manager.relay(...relayParams);
      await assert.revertWith(
        manager.relay(...relayParams), DUPLICATE_REQUEST_REVERT_MSG,
      );
    });

    it("should update the nonce after transaction", async () => {
      const nonce = await getNonceForRelay();
      await manager.relay(relayerModule, "setIntOwnerOnly", [wallet.contractAddress, 2], wallet, [owner],
        global.accounts[9].signer, false, 2000000, nonce);

      const updatedNonce = await relayerModule.getNonce(wallet.contractAddress);
      const updatedNonceHex = await ethers.utils.hexZeroPad(updatedNonce.toHexString(), 32);
      assert.equal(nonce, updatedNonceHex);
    });

    it("should not allow ApprovedTransfer and RecoveryManager module functions to be executed directly", async () => {
      const registry = await deployer.deploy(Registry);
      const guardianStorage = await deployer.deploy(GuardianStorage);
      const approvedTransfer = await deployer.deploy(ApprovedTransfer, {}, registry.contractAddress, guardianStorage.contractAddress);
      const recoveryManager = await deployer.deploy(RecoveryManager, {}, registry.contractAddress, guardianStorage.contractAddress, 36, 120, 24, 12);

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
  });

  describe("RelayerModuleV2", () => {
    it("should fail to relay when target of _data != _wallet", async () => {
      const params = [await getRandomAddress(), 4]; // the first argument is not the wallet address, which should make the relaying revert
      await assert.revertWith(
        manager.relay(relayerModuleV2, "setIntOwnerOnly", params, wallet, [owner]), TARGET_OF_DATA_NOT_WALLET_REVERT_MSG_V2,
      );
    });

    it("should fail to relay when _data is less than 36 bytes", async () => {
      const params = []; // the first argument is not the wallet address, which should make the relaying rever
      await assert.revertWith(
        manager.relay(relayerModuleV2, "clearInt", params, wallet, [owner]), INVALID_DATA_REVERT_MSG,
      );
    });

    it("should fail to relay a duplicate transaction", async () => {
      const params = [wallet.contractAddress, 2];
      const nonce = await getNonceForRelay();
      const relayParams = [relayerModule, "setIntOwnerOnly", params, wallet, [owner],
        global.accounts[9].signer, false, 2000000, nonce];
      await manager.relay(...relayParams);
      await assert.revertWith(
        manager.relay(...relayParams), DUPLICATE_REQUEST_REVERT_MSG,
      );
    });

    it("should update the nonce after transaction", async () => {
      const nonce = await getNonceForRelay();
      await manager.relay(relayerModuleV2, "setIntOwnerOnly", [wallet.contractAddress, 2], wallet, [owner],
        global.accounts[9].signer, false, 2000000, nonce);

      const updatedNonce = await relayerModuleV2.getNonce(wallet.contractAddress);
      const updatedNonceHex = await ethers.utils.hexZeroPad(updatedNonce.toHexString(), 32);
      assert.equal(nonce, updatedNonceHex);
    });
  });
});
