/* global artifacts */
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");
const utils = require("../utils/utilities.js");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const VersionManager = artifacts.require("VersionManager");
const RelayerManager = artifacts.require("RelayerManager");
const LockStorage = artifacts.require("LockStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const NftTransfer = artifacts.require("NftTransfer");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
const ERC721 = artifacts.require("TestERC721");
const CK = artifacts.require("CryptoKittyTest");
const ERC20 = artifacts.require("TestERC20");
const ERC20Approver = artifacts.require("ERC20Approver");

const ZERO_BYTES32 = ethers.constants.HashZero;

const RelayManager = require("../utils/relay-manager");

contract("NftTransfer", (accounts) => {
  const manager = new RelayManager();

  const infrastructure = accounts[0];
  const owner1 = accounts[1];
  const owner2 = accounts[2];
  const eoaRecipient = accounts[3];
  const tokenId = 1;

  let nftFeature;
  let walletImplementation;
  let relayerManager;
  let wallet1;
  let wallet2;
  let erc721;
  let ck;
  let ckId;
  let erc20;
  let erc20Approver;
  let tokenPriceRegistry;
  let lockStorage;
  let versionManager;

  before(async () => {
    const registry = await Registry.new();
    walletImplementation = await BaseWallet.new();

    const guardianStorage = await GuardianStorage.new();
    lockStorage = await LockStorage.new();
    versionManager = await VersionManager.new(
      registry.address,
      lockStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);

    relayerManager = await RelayerManager.new(
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.address);
    manager.setRelayerManager(relayerManager);
    ck = await CK.new();
    tokenPriceRegistry = await TokenPriceRegistry.new();
    await tokenPriceRegistry.addManager(infrastructure);
    nftFeature = await NftTransfer.new(
      lockStorage.address,
      tokenPriceRegistry.address,
      versionManager.address,
      ck.address);
    erc20Approver = await ERC20Approver.new(versionManager.address);

    await versionManager.addVersion([erc20Approver.address, nftFeature.address, relayerManager.address], []);
  });

  beforeEach(async () => {
    const proxy1 = await Proxy.new(walletImplementation.address);
    wallet1 = await BaseWallet.at(proxy1.address);
    const proxy2 = await Proxy.new(walletImplementation.address);
    wallet2 = await BaseWallet.at(proxy2.address);

    await wallet1.init(owner1, [versionManager.address]);
    await wallet2.init(owner2, [versionManager.address]);
    await versionManager.upgradeWallet(wallet1.address, await versionManager.lastVersion(), { from: owner1 });
    await versionManager.upgradeWallet(wallet2.address, await versionManager.lastVersion(), { from: owner2 });

    erc721 = await ERC721.new();
    await erc721.mint(wallet1.address, tokenId);
  });

  describe("NFT transfers", () => {
    async function testNftTransfer({
      safe = true, relayed, recipientAddress, nftContract = erc721, nftId = tokenId, shouldSucceed = true, expectedError,
    }) {
      const beforeWallet1 = await nftContract.balanceOf(wallet1.address);
      const beforeRecipient = await nftContract.balanceOf(recipientAddress);
      if (relayed) {
        const txReceipt = await manager.relay(nftFeature, "transferNFT",
          [wallet1.address, nftContract.address, recipientAddress, nftId, safe, ZERO_BYTES32], wallet1, [owner1]);
        const { success, error } = utils.parseRelayReceipt(txReceipt);
        assert.equal(success, shouldSucceed);
        if (!shouldSucceed) {
          assert.equal(error, expectedError);
        }
      } else {
        const txPromise = nftFeature
          .transferNFT(wallet1.address, nftContract.address, recipientAddress, nftId, safe, ZERO_BYTES32, { from: owner1, gasLimit: 300000 });
        if (shouldSucceed) {
          await txPromise;
        } else {
          await truffleAssert.reverts(txPromise, expectedError);
        }
      }
      if (shouldSucceed) {
        const afterWallet1 = await nftContract.balanceOf(wallet1.address);
        const afterRecipient = await nftContract.balanceOf(recipientAddress);
        assert.equal(beforeWallet1.sub(afterWallet1).toNumber(), 1, `wallet1 should have one less NFT (safe: ${safe}, relayed: ${relayed})`);
        assert.equal(afterRecipient.sub(beforeRecipient).toNumber(), 1, `recipient should have one more NFT (safe: ${safe}, relayed: ${relayed})`);
      }
    }

    describe("transfer to EOA account", () => {
      it("should allow unsafe NFT transfer from wallet1 to an EOA account", async () => {
        await testNftTransfer({ safe: false, relayed: false, recipientAddress: eoaRecipient });
      });

      it("should allow safe NFT transfer from wallet1 to an EOA account", async () => {
        await testNftTransfer({ safe: true, relayed: false, recipientAddress: eoaRecipient });
      });

      it("should allow unsafe NFT transfer from wallet1 to an EOA account (relayed)", async () => {
        await testNftTransfer({ safe: false, relayed: true, recipientAddress: eoaRecipient });
      });

      it("should allow safe NFT transfer from wallet1 to an EOA account (relayed)", async () => {
        await testNftTransfer({ safe: true, relayed: true, recipientAddress: eoaRecipient });
      });
    });

    describe("transfer to other wallet", () => {
      it("should allow unsafe NFT transfer from wallet1 to wallet2", async () => {
        await testNftTransfer({ safe: false, relayed: false, recipientAddress: wallet2.address });
      });

      it("should allow safe NFT transfer from wallet1 to wallet2", async () => {
        await testNftTransfer({ safe: true, relayed: false, recipientAddress: wallet2.address });
      });

      it("should allow unsafe NFT transfer from wallet1 to wallet2 (relayed)", async () => {
        await testNftTransfer({ safe: false, relayed: true, recipientAddress: wallet2.address });
      });

      it("should allow safe NFT transfer from wallet1 to wallet2 (relayed)", async () => {
        await testNftTransfer({ safe: true, relayed: true, recipientAddress: wallet2.address });
      });
    });

    describe("CK transfer", () => {
      beforeEach(async () => {
        await ck.createDumbKitty(wallet1.address);
        ckId = (ckId === undefined) ? 0 : ckId + 1; // update the id of the CryptoKitty that was just created
      });

      it("should allow CK transfer from wallet1 to wallet2", async () => {
        await testNftTransfer({
          relayed: false, nftId: ckId, nftContract: ck, recipientAddress: wallet2.address,
        });
      });

      it("should allow CK transfer from wallet1 to wallet2 (relayed)", async () => {
        await testNftTransfer({
          relayed: true, nftId: ckId, nftContract: ck, recipientAddress: wallet2.address,
        });
      });

      it("should allow CK transfer from wallet1 to EOA account", async () => {
        await testNftTransfer({
          relayed: false, nftId: ckId, nftContract: ck, recipientAddress: eoaRecipient,
        });
      });

      it("should allow CK transfer from wallet1 to EOA account (relayed)", async () => {
        await testNftTransfer({
          relayed: true, nftId: ckId, nftContract: ck, recipientAddress: eoaRecipient,
        });
      });
    });

    describe("Protecting from transferFrom hijacking", () => {
      beforeEach(async () => {
        erc20 = await ERC20.new([wallet1.address], 1000, 18);
        tokenPriceRegistry.setPriceForTokenList([erc20.address], [1]);
        await erc20Approver.approveERC20(
          wallet1.address,
          erc20.address,
          wallet1.address, // spender
          100,
          { from: owner1 }
        ); // amount
      });

      it("should NOT allow ERC20 transfer from wallet1 to wallet2", async () => {
        await testNftTransfer({
          shouldSucceed: false,
          expectedError: "NT: Forbidden ERC20 contract",
          safe: false,
          relayed: false,
          nftId: 100,
          nftContract: erc20,
          recipientAddress: wallet2.address,
        });
      });

      it("should NOT allow ERC20 transfer from wallet1 to wallet2 (relayed)", async () => {
        await testNftTransfer({
          shouldSucceed: false,
          expectedError: "NT: Forbidden ERC20 contract",
          safe: false,
          relayed: true,
          nftId: 100,
          nftContract: erc20,
          recipientAddress: wallet2.address,
        });
      });
    });

    describe("Static calls", () => {
      it("should delegate onERC721Received static calls to the NftTransfer feature", async () => {
        const ERC721_RECEIVED = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("onERC721Received(address,address,uint256,bytes)")).slice(0, 10);
        const erc721ReceivedDelegate = await wallet1.enabled(ERC721_RECEIVED);
        assert.equal(erc721ReceivedDelegate, versionManager.address);

        const walletAsTransferManager = await NftTransfer.at(wallet1.address);
        const result = await walletAsTransferManager.onERC721Received.call(infrastructure, infrastructure, 0, "0x");
        assert.equal(result, ERC721_RECEIVED);
      });
    });
  });
});
