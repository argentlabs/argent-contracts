/* global accounts */
const ethers = require("ethers");

const Proxy = require("../build/Proxy");
const BaseWallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");
const VersionManager = require("../build/VersionManager");
const RelayerManager = require("../build/RelayerManager");
const LockStorage = require("../build/LockStorage");
const GuardianStorage = require("../build/GuardianStorage");
const NftTransfer = require("../build/NftTransfer");
const TokenPriceRegistry = require("../build/TokenPriceRegistry");

const ERC721 = require("../build/TestERC721");
const CK = require("../build/CryptoKittyTest");
const ERC20 = require("../build/TestERC20");
const ERC20Approver = require("../build/ERC20Approver");

const ZERO_BYTES32 = ethers.constants.HashZero;

const TestManager = require("../utils/test-manager");
const { parseRelayReceipt, callStatic } = require("../utils/utilities.js");

describe("Token Transfer", function () {
  this.timeout(100000);

  const manager = new TestManager();

  const infrastructure = accounts[0].signer;
  const owner1 = accounts[1].signer;
  const owner2 = accounts[2].signer;
  const eoaRecipient = accounts[3].signer;
  const tokenId = 1;

  let deployer;
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
    deployer = manager.newDeployer();
    const registry = await deployer.deploy(Registry);
    walletImplementation = await deployer.deploy(BaseWallet);

    const guardianStorage = await deployer.deploy(GuardianStorage);
    lockStorage = await deployer.deploy(LockStorage);
    versionManager = await deployer.deploy(VersionManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);

    relayerManager = await deployer.deploy(RelayerManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.contractAddress);
    manager.setRelayerManager(relayerManager);
    ck = await deployer.deploy(CK);
    tokenPriceRegistry = await deployer.deploy(TokenPriceRegistry);
    await tokenPriceRegistry.addManager(infrastructure.address);
    nftFeature = await deployer.deploy(NftTransfer, {},
      lockStorage.contractAddress,
      tokenPriceRegistry.contractAddress,
      versionManager.contractAddress,
      ck.contractAddress);
    erc20Approver = await deployer.deploy(ERC20Approver, {}, versionManager.contractAddress);

    await versionManager.addVersion([erc20Approver.contractAddress, nftFeature.contractAddress, relayerManager.contractAddress], []);
  });

  beforeEach(async () => {
    const proxy1 = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet1 = deployer.wrapDeployedContract(BaseWallet, proxy1.contractAddress);
    const proxy2 = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet2 = deployer.wrapDeployedContract(BaseWallet, proxy2.contractAddress);

    await wallet1.init(owner1.address, [versionManager.contractAddress]);
    await wallet2.init(owner2.address, [versionManager.contractAddress]);
    await versionManager.from(owner1).upgradeWallet(wallet1.contractAddress, await versionManager.lastVersion());
    await versionManager.from(owner2).upgradeWallet(wallet2.contractAddress, await versionManager.lastVersion());

    erc721 = await deployer.deploy(ERC721);
    await erc721.mint(wallet1.contractAddress, tokenId);
  });

  describe("NFT transfers", () => {
    async function testNftTransfer({
      safe = true, relayed, recipientAddress, nftContract = erc721, nftId = tokenId, shouldSucceed = true, expectedError,
    }) {
      const beforeWallet1 = await nftContract.balanceOf(wallet1.contractAddress);
      const beforeRecipient = await nftContract.balanceOf(recipientAddress);
      if (relayed) {
        const txReceipt = await manager.relay(nftFeature, "transferNFT",
          [wallet1.contractAddress, nftContract.contractAddress, recipientAddress, nftId, safe, ZERO_BYTES32], wallet1, [owner1]);
        const { success, error } = parseRelayReceipt(txReceipt);
        assert.equal(success, shouldSucceed);
        if (!shouldSucceed) {
          assert.equal(error, expectedError);
        }
      } else {
        const txPromise = nftFeature.from(owner1)
          .transferNFT(wallet1.contractAddress, nftContract.contractAddress, recipientAddress, nftId, safe, ZERO_BYTES32, { gasLimit: 300000 });
        if (shouldSucceed) {
          await txPromise;
        } else {
          assert.revertWith(txPromise, expectedError);
        }
      }
      if (shouldSucceed) {
        const afterWallet1 = await nftContract.balanceOf(wallet1.contractAddress);
        const afterRecipient = await nftContract.balanceOf(recipientAddress);
        assert.equal(beforeWallet1.sub(afterWallet1).toNumber(), 1, `wallet1 should have one less NFT (safe: ${safe}, relayed: ${relayed})`);
        assert.equal(afterRecipient.sub(beforeRecipient).toNumber(), 1, `recipient should have one more NFT (safe: ${safe}, relayed: ${relayed})`);
      }
    }

    describe("transfer to EOA account", () => {
      it("should allow unsafe NFT transfer from wallet1 to an EOA account", async () => {
        await testNftTransfer({ safe: false, relayed: false, recipientAddress: eoaRecipient.address });
      });

      it("should allow safe NFT transfer from wallet1 to an EOA account", async () => {
        await testNftTransfer({ safe: true, relayed: false, recipientAddress: eoaRecipient.address });
      });

      it("should allow unsafe NFT transfer from wallet1 to an EOA account (relayed)", async () => {
        await testNftTransfer({ safe: false, relayed: true, recipientAddress: eoaRecipient.address });
      });

      it("should allow safe NFT transfer from wallet1 to an EOA account (relayed)", async () => {
        await testNftTransfer({ safe: true, relayed: true, recipientAddress: eoaRecipient.address });
      });
    });

    describe("transfer to other wallet", () => {
      it("should allow unsafe NFT transfer from wallet1 to wallet2", async () => {
        await testNftTransfer({ safe: false, relayed: false, recipientAddress: wallet2.contractAddress });
      });

      it("should allow safe NFT transfer from wallet1 to wallet2", async () => {
        await testNftTransfer({ safe: true, relayed: false, recipientAddress: wallet2.contractAddress });
      });

      it("should allow unsafe NFT transfer from wallet1 to wallet2 (relayed)", async () => {
        await testNftTransfer({ safe: false, relayed: true, recipientAddress: wallet2.contractAddress });
      });

      it("should allow safe NFT transfer from wallet1 to wallet2 (relayed)", async () => {
        await testNftTransfer({ safe: true, relayed: true, recipientAddress: wallet2.contractAddress });
      });
    });

    describe("CK transfer", () => {
      beforeEach(async () => {
        await ck.createDumbKitty(wallet1.contractAddress);
        ckId = (ckId === undefined) ? 0 : ckId + 1; // update the id of the CryptoKitty that was just created
      });

      it("should allow CK transfer from wallet1 to wallet2", async () => {
        await testNftTransfer({
          relayed: false, nftId: ckId, nftContract: ck, recipientAddress: wallet2.contractAddress,
        });
      });

      it("should allow CK transfer from wallet1 to wallet2 (relayed)", async () => {
        await testNftTransfer({
          relayed: true, nftId: ckId, nftContract: ck, recipientAddress: wallet2.contractAddress,
        });
      });

      it("should allow CK transfer from wallet1 to EOA account", async () => {
        await testNftTransfer({
          relayed: false, nftId: ckId, nftContract: ck, recipientAddress: eoaRecipient.address,
        });
      });

      it("should allow CK transfer from wallet1 to EOA account (relayed)", async () => {
        await testNftTransfer({
          relayed: true, nftId: ckId, nftContract: ck, recipientAddress: eoaRecipient.address,
        });
      });
    });

    describe("Protecting from transferFrom hijacking", () => {
      beforeEach(async () => {
        erc20 = await deployer.deploy(ERC20, {}, [wallet1.contractAddress], 1000, 18);
        tokenPriceRegistry.setPriceForTokenList([erc20.contractAddress], [1]);
        await erc20Approver.from(owner1).approveERC20(
          wallet1.contractAddress,
          erc20.contractAddress,
          wallet1.contractAddress, // spender
          100,
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
          recipientAddress: wallet2.contractAddress,
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
          recipientAddress: wallet2.contractAddress,
        });
      });
    });

    describe("Static calls", () => {
      it("should delegate onERC721Received static calls to the NftTransfer feature", async () => {
        const ERC721_RECEIVED = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("onERC721Received(address,address,uint256,bytes)")).slice(0, 10);
        const erc721ReceivedDelegate = await wallet1.enabled(ERC721_RECEIVED);
        assert.equal(erc721ReceivedDelegate, versionManager.contractAddress);

        const walletAsTransferManager = deployer.wrapDeployedContract(NftTransfer, wallet1.contractAddress);
        const result = await callStatic(walletAsTransferManager, "onERC721Received", infrastructure.address, infrastructure.address, 0, "0x");
        assert.equal(result, ERC721_RECEIVED);
      });
    });
  });
});
