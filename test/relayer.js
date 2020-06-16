/* global accounts */
const ethers = require("ethers");
const { formatBytes32String } = require("ethers").utils;
const { parseRelayReceipt } = require("../utils/utilities.js");

const Proxy = require("../build/Proxy");
const BaseWallet = require("../build/BaseWallet");
const BadModuleRelayer = require("../build/BadModuleRelayer");
const RelayerModule = require("../build/RelayerModule");
const TestModule = require("../build/TestModule");
const Registry = require("../build/ModuleRegistry");
const GuardianManager = require("../build/GuardianManager");
const GuardianStorage = require("../build/GuardianStorage");
const LimitStorage = require("../build/LimitStorage");
const ApprovedTransfer = require("../build/ApprovedTransfer");
const RecoveryManager = require("../build/RecoveryManager"); // non-owner only module
const NftTransfer = require("../build/NftTransfer"); // owner only module
const CryptoKittyTest = require("../build/CryptoKittyTest");
const ERC721 = require("../build/TestERC721");

const TestManager = require("../utils/test-manager");
const { getRandomAddress } = require("../utils/utilities.js");

const MODULE_NOT_AUTHORISED_FOR_WALLET = "RM: module not authorised";
const INVALID_DATA_REVERT_MSG = "RM: Invalid dataWallet";
const DUPLICATE_REQUEST_REVERT_MSG = "RM: Duplicate request";
const INVALID_WALLET_REVERT_MSG = "RM: Target of _data != _wallet"; 
const RELAYER_NOT_AUTHORISED_FOR_WALLET = "BM: must be owner or module";
const ZERO_BYTES32 = ethers.constants.HashZero;

describe("RelayManager", function () {
  this.timeout(10000);

  const manager = new TestManager();
  const { deployer } = manager;
  let { getNonceForRelay } = manager;
  getNonceForRelay = getNonceForRelay.bind(manager);

  const infrastructure = accounts[0].signer;
  const owner = accounts[1].signer;
  const recipient = accounts[3].signer;

  let registry;
  let guardianStorage;
  let limitStorage;
  let guardianManager;
  let recoveryManager;
  let wallet;
  let approvedTransfer;
  let nftTransferModule;
  let testModule;
  let testModuleNew;
  let relayerModule;

  before(async () => {
    registry = await deployer.deploy(Registry);
    guardianStorage = await deployer.deploy(GuardianStorage);
    limitStorage = await deployer.deploy(LimitStorage);
    relayerModule = await deployer.deploy(RelayerModule, {}, registry.contractAddress, guardianStorage.contractAddress, limitStorage.contractAddress );
    manager.setRelayerModule(relayerModule);
  })

  beforeEach(async () => {
    // ApprovedTransfer is a sample non-OnlyOwner module
    approvedTransfer = await deployer.deploy(ApprovedTransfer, {}, registry.contractAddress, guardianStorage.contractAddress);
    const cryptoKittyTest = await deployer.deploy(CryptoKittyTest);
    // NFTTransferModule is a sample OnlyOwner module
    nftTransferModule = await deployer.deploy(NftTransfer, {},
      registry.contractAddress,
      guardianStorage.contractAddress,
      cryptoKittyTest.contractAddress);
    guardianManager = await deployer.deploy(GuardianManager, {}, registry.contractAddress, guardianStorage.contractAddress, 24, 12);
    recoveryManager = await deployer.deploy(RecoveryManager, {}, registry.contractAddress, guardianStorage.contractAddress, 36, 120);

    testModule = await deployer.deploy(TestModule, {}, registry.contractAddress, guardianStorage.contractAddress, false, 0);
    testModuleNew = await deployer.deploy(TestModule, {}, registry.contractAddress, guardianStorage.contractAddress, false, 0);

    const walletImplementation = await deployer.deploy(BaseWallet);
    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);

    await wallet.init(owner.address,
      [relayerModule.contractAddress,
        approvedTransfer.contractAddress,
        nftTransferModule.contractAddress,
        guardianManager.contractAddress,
        recoveryManager.contractAddress,
        testModule.contractAddress]);
  });

  describe("relaying module transactions", () => {

    it("should fail when _data is less than 36 bytes", async () => {
      const params = []; // the first argument is not the wallet address, which should make the relaying rever
      await assert.revertWith(
        manager.relay(testModule, "clearInt", params, wallet, [owner]), INVALID_DATA_REVERT_MSG,
      );
    });

    it("should fail when module is not authorised", async () => {
      const params = [wallet.contractAddress, 2];
      await assert.revertWith(
        manager.relay(testModuleNew, "setIntOwnerOnly", params, wallet, [owner]), MODULE_NOT_AUTHORISED_FOR_WALLET,
      );
    });

    it("should fail when the RelayerModule is not authorised", async () => {
      let wrongWallet = await deployer.deploy(Wallet);
      await wrongWallet.init(owner.address, [testModule.contractAddress]);
      const params = [wrongWallet.contractAddress, 2];
      const txReceipt = await manager.relay(testModule, "setIntOwnerOnly", params, wrongWallet, [owner]);
      const { success, error } = parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, RELAYER_NOT_AUTHORISED_FOR_WALLET);
    });

    it("should fail when the first param is not the wallet ", async () => {
      const params = [owner.address, 4];
      await assert.revertWith(
        manager.relay(testModule, "setIntOwnerOnly", params, wallet, [owner]), INVALID_WALLET_REVERT_MSG,
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

      const updatedNonce = await relayerModule.getNonce(wallet.contractAddress);
      const updatedNonceHex = await ethers.utils.hexZeroPad(updatedNonce.toHexString(), 32);
      assert.equal(nonce, updatedNonceHex);
    });

    it("should only allow ApprovedTransfer and RecoveryManager module functions to be called by the RelayerModule", async () => {
      const randomAddress = await getRandomAddress();

      await assert.revertWith(
        approvedTransfer.transferToken(wallet.contractAddress, randomAddress, randomAddress, 1, ethers.constants.HashZero),
        "BM: must be a module",
      );

      await assert.revertWith(
        approvedTransfer.callContract(wallet.contractAddress, randomAddress, 1, ethers.constants.HashZero),
        "BM: must be a module",
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
        "BM: must be a module",
      );

      await assert.revertWith(recoveryManager.executeRecovery(wallet.contractAddress, randomAddress), "BM: must be a module");
      await assert.revertWith(recoveryManager.cancelRecovery(wallet.contractAddress), "BM: must be a module");
      await assert.revertWith(recoveryManager.transferOwnership(wallet.contractAddress, randomAddress), "BM: must be a module");
    });

    it("should refund when there is enough ETH", async () => {

      // make sure the wallet has some ETH for the refund
      await infrastructure.sendTransaction({ to: wallet.contractAddress, value: ethers.utils.bigNumberify("10000000000000000") });

      let erc721 = await deployer.deploy(ERC721);
      let tokenId = 1;
      await erc721.mint(wallet.contractAddress, tokenId);
      const nonce = await getNonceForRelay();

      let before = await deployer.provider.getBalance(wallet.contractAddress);
      const txReceipt = await manager.relay(
        nftTransferModule,
        "transferNFT",
        [wallet.contractAddress, erc721.contractAddress, recipient.address, tokenId, false, ZERO_BYTES32],
        wallet,
        [owner],
        accounts[9].signer,
        false,
        2000000,
        nonce,
        100,
      );
      let after = await deployer.provider.getBalance(wallet.contractAddress);

      await assert.isTrue(after.lt(before), "should have refunded");
    });

    it("should fail when there is not enough ETH for the refund", async () => {

      let erc721 = await deployer.deploy(ERC721);
      let tokenId = 1;
      await erc721.mint(wallet.contractAddress, tokenId);
      const nonce = await getNonceForRelay();

      await assert.revertWith(manager.relay(
        nftTransferModule,
        "transferNFT",
        [wallet.contractAddress, erc721.contractAddress, recipient.address, tokenId, false, ZERO_BYTES32],
        wallet,
        [owner],
        accounts[9].signer,
        false,
        2000000,
        nonce,
        100
      ), "BM: wallet invoke reverted");
    });

    it("should fail if required signatures is 0 and OwnerRequirement is not Anyone", async () => {
      const badRelayerModule = await deployer.deploy(BadModuleRelayer, {}, registry.contractAddress, guardianStorage.contractAddress);
      await assert.revertWith(
        manager.relay(badRelayerModule, "setIntOwnerOnly", [wallet.contractAddress, 2], wallet, [owner]), "RM: Wrong number of required signatures",
      );
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
      assert.equal(error, "BM: must be owner");

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
