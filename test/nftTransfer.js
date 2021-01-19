/* global artifacts */
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");
const utils = require("../utils/utilities.js");

const IWallet = artifacts.require("IWallet");
const DelegateProxy = artifacts.require("DelegateProxy");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
const ERC721 = artifacts.require("TestERC721");
const CK = artifacts.require("CryptoKittyTest");
const ERC20 = artifacts.require("TestERC20");
const ERC20Approver = artifacts.require("ERC20Approver");

const ZERO_BYTES32 = ethers.constants.HashZero;

const RelayManager = require("../utils/relay-manager");

contract.skip("NftTransfer", (accounts) => {
  const manager = new RelayManager();

  const infrastructure = accounts[0];
  const owner1 = accounts[1];
  const owner2 = accounts[2];
  const eoaRecipient = accounts[3];
  const tokenId = 1;

  let nftFeature;
  let registry;
  let relayerManager;
  let wallet1;
  let wallet2;
  let erc721;
  let ck;
  let ckId;
  let erc20;
  let erc20Approver;
  let tokenPriceRegistry;
  let versionManager;

  before(async () => {
    ck = await CK.new();
    tokenPriceRegistry = await TokenPriceRegistry.new();
    await tokenPriceRegistry.addManager(infrastructure);
    const modules = await setupWalletVersion({ tokenPriceRegistry: tokenPriceRegistry.address, ckAddress: ck.address });
    registry = modules.registry;
    relayerManager = modules.relayerManager;
    await manager.setRelayerManager(relayerManager);

    erc20Approver = await ERC20Approver.new();
  });

  beforeEach(async () => {
    const proxy1 = await DelegateProxy.new({ from: owner1 });
    await proxy1.setRegistry(registry.address, { from: owner1 });
    wallet1 = await IWallet.at(proxy1.address);

    const proxy2 = await DelegateProxy.new({ from: owner2 });
    await proxy2.setRegistry(registry.address, { from: owner2 });
    wallet1 = await IWallet.at(proxy2.address);

    erc721 = await ERC721.new();
    await erc721.mint(wallet1.address, tokenId);
  });

  describe("NFT transfers", () => {
    async function testNftTransfer({ safe = true, relayed, recipientAddress, nftContract = erc721, nftId = tokenId }) {
      const beforeWallet1 = await nftContract.balanceOf(wallet1.address);
      const beforeRecipient = await nftContract.balanceOf(recipientAddress);
      if (relayed) {
        const txReceipt = await manager.relay(wallet1, "transferNFT",
          [nftContract.address, recipientAddress, nftId, safe, ZERO_BYTES32], [owner1]);
        const { success } = utils.parseRelayReceipt(txReceipt);
        assert.isTrue(success);
      } else {
        await wallet.transferNFT(nftContract.address, recipientAddress, nftId, safe, ZERO_BYTES32, { from: owner1 });
      }

      const afterWallet1 = await nftContract.balanceOf(wallet1.address);
      const afterRecipient = await nftContract.balanceOf(recipientAddress);
      assert.equal(beforeWallet1.sub(afterWallet1).toNumber(), 1, `wallet1 should have one less NFT (safe: ${safe}, relayed: ${relayed})`);
      assert.equal(afterRecipient.sub(beforeRecipient).toNumber(), 1, `recipient should have one more NFT (safe: ${safe}, relayed: ${relayed})`);
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
        await truffleAssert.reverts(wallet1.transferNFT(erc20.address, wallet2.address, 100, false, ZERO_BYTES32,
          { from: owner1, gasLimit: 300000 }),
        "NT: Forbidden ERC20 contract");
      });

      it("should NOT allow ERC20 transfer from wallet1 to wallet2 (relayed)", async () => {
        const txReceipt = await manager.relay(wallet1, "transferNFT",
          [erc20.address, wallet2.address, 100, false, ZERO_BYTES32], [owner1]);

        const { success, error } = utils.parseRelayReceipt(txReceipt);
        assert.isFalse(success);
        assert.equal(error, "NT: Forbidden ERC20 contract");
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
