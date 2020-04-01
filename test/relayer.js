const { AddressZero } = require("ethers").constants;

const Wallet = require("../build/BaseWallet");
const TestModule = require("../build/TestModule");
const TestModuleRelayerV2 = require("../build/TestModuleRelayerV2");

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

    it.only("should fail to relay a duplicate transaction", async () => {
      const params = [wallet.contractAddress, 2];
      const nonce = await getNonceForRelay();
      const relayParams = [relayerModule, "setIntOwnerOnly", params, wallet, [owner],
        global.accounts[9].signer, false, 2000000, nonce];
      await manager.relay(...relayParams);
      await assert.revertWith(
        manager.relay(...relayParams), DUPLICATE_REQUEST_REVERT_MSG,
      );
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
  });
});
