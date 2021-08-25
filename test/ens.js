/* global artifacts */
const ethers = require("ethers");
const TruffleContract = require("@truffle/contract");

const ENSRegistry = artifacts.require("ENSRegistry");
const ENSRegistryWithFallback = artifacts.require("ENSRegistryWithFallback");
const ENSManager = artifacts.require("ArgentENSManager");
const ENSResolver = artifacts.require("ArgentENSResolver");
const ENSReverseRegistrar = artifacts.require("ReverseRegistrar");

const truffleAssert = require("truffle-assertions");
const utils = require("../utils/utilities.js");

const WalletFactoryV16Contract = require("../build-legacy/v1.6.0/WalletFactory");
const BaseWalletV16Contract = require("../build-legacy/v1.6.0/BaseWallet");

const WalletFactoryV16 = TruffleContract(WalletFactoryV16Contract);
const BaseWalletV16 = TruffleContract(BaseWalletV16Contract);

const ZERO_BYTES32 = ethers.constants.HashZero;

contract("ENS contracts", (accounts) => {
  const infrastructure = accounts[0];
  const owner = accounts[1];
  const amanager = accounts[3];
  const anonmanager = accounts[4];

  const root = "xyz";
  const subnameWallet = "argent";
  const walletNode = ethers.utils.namehash(`${subnameWallet}.${root}`);

  let ensRegistry;
  let ensResolver;
  let ensReverse;
  let ensManager;

  before(async () => {
    WalletFactoryV16.defaults({ from: accounts[0] });
    WalletFactoryV16.setProvider(web3.currentProvider);
    BaseWalletV16.defaults({ from: accounts[0] });
    BaseWalletV16.setProvider(web3.currentProvider);
  });

  beforeEach(async () => {
    const ensRegistryWithoutFallback = await ENSRegistry.new();
    ensRegistry = await ENSRegistryWithFallback.new(ensRegistryWithoutFallback.address);
    ensResolver = await ENSResolver.new();
    ensReverse = await ENSReverseRegistrar.new(ensRegistry.address, ensResolver.address);
    ensManager = await ENSManager.new(`${subnameWallet}.${root}`, walletNode, ensRegistry.address, ensResolver.address);
    await ensResolver.addManager(ensManager.address);
    await ensResolver.addManager(infrastructure);
    await ensManager.addManager(infrastructure);

    await ensRegistry.setSubnodeOwner(ZERO_BYTES32, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(root)), infrastructure);
    await ensRegistry.setSubnodeOwner(
      ethers.utils.namehash(root), ethers.utils.keccak256(ethers.utils.toUtf8Bytes(subnameWallet)), ensManager.address,
    );
    await ensRegistry.setSubnodeOwner(ZERO_BYTES32, ethers.utils.keccak256(ethers.utils.toUtf8Bytes("reverse")), infrastructure);
    await ensRegistry.setSubnodeOwner(
      ethers.utils.namehash("reverse"), ethers.utils.keccak256(ethers.utils.toUtf8Bytes("addr")), ensReverse.address,
    );
  });

  describe("ENS Manager", () => {
    it("should be the owner of the wallet root", async () => {
      const nodeOwner = await ensRegistry.owner(walletNode);
      assert.equal(nodeOwner, ensManager.address, "ens manager should be the owner of the wallet root node");
    });

    it("should return correct ENSResolver", async () => {
      const ensResolverOnManager = await ensManager.ensResolver();
      assert.equal(ensResolverOnManager, ensResolver.address, "should have the correct ENSResolver addrress");
    });

    it("should return correct ENSReeverseRegistrar", async () => {
      const reverseRegistrar = await ensManager.getENSReverseRegistrar();
      assert.equal(reverseRegistrar, ensReverse.address);
    });

    it("should register an ENS name", async () => {
      const label = "wallet";
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);
      await ensManager.register(label, owner, "0x");

      const recordExists = await ensRegistry.recordExists(labelNode);
      assert.isTrue(recordExists);
      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, owner);
      const res = await ensRegistry.resolver(labelNode);
      assert.equal(res, ensResolver.address);
    });

    it("should not be able to register an ENS name twice", async () => {
      const label = "wallet";
      await ensManager.register(label, owner, "0x");

      await truffleAssert.reverts(ensManager.register(label, owner, "0x"), "AEM: label is already owned");
    });

    it("should not be able to register an empty ENS label", async () => {
      const label = "";
      await truffleAssert.reverts(ensManager.register(label, owner, "0x"), "AEM: ENS label must be defined");
    });

    it("should register an ENS name with manager signature", async () => {
      const label = "walletа";
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);

      const message = `0x${[
        owner,
        ethers.utils.hexlify(ethers.utils.toUtf8Bytes(label)),
      ].map((hex) => hex.slice(2)).join("")}`;
      const managerSig = await utils.signMessage(ethers.utils.keccak256(message), infrastructure);

      const data = await ensManager.contract.methods["register(string,address,bytes)"](label, owner, managerSig).encodeABI();
      await ensManager.sendTransaction({ data, from: anonmanager });

      const recordExists = await ensRegistry.recordExists(labelNode);
      assert.isTrue(recordExists);
      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, owner);

      const ensRecord = await ensResolver.addr(labelNode);
      assert.equal(ensRecord, owner);

      // check ens reverse record in not set
      const node = await ensReverse.node(owner);
      const name = await ensResolver.name(node);
      assert.equal(name, "");
    });

    it("should register wallet with reverse registrar when required", async () => {
      // Register with ENSReverse registrar first
      await ensReverse.claimWithResolver(ensManager.address, ensResolver.address, { from: owner });

      const label = "wallet";
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);

      const message = `0x${[
        owner,
        ethers.utils.hexlify(ethers.utils.toUtf8Bytes(label)),
      ].map((hex) => hex.slice(2)).join("")}`;
      const managerSig = await utils.signMessage(ethers.utils.keccak256(message), infrastructure);

      const data = await ensManager.contract.methods["register(string,address,bytes)"](label, owner, managerSig).encodeABI();
      await ensManager.sendTransaction({ data, from: anonmanager });

      // check ens record
      const recordExists = await ensRegistry.recordExists(labelNode);
      assert.isTrue(recordExists);
      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, owner);
      const ensRecord = await ensResolver.addr(labelNode);
      assert.equal(ensRecord, owner);

      // check ens reverse record
      const reverseNode = await ensReverse.node(owner);
      const name = await ensResolver.name(reverseNode);
      assert.equal(name, "wallet.argent.xyz");
    });

    it("should return the correct availability for a subnode", async () => {
      const label = "wallet";
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);
      const labelNode1 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(label));
      // Node is initially available
      let available = await ensManager.isAvailable(labelNode1);
      assert.isTrue(available);

      // then we register it
      await ensManager.register(label, owner, "0x");

      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, owner);

      // then the node is unavailable
      available = await ensManager.isAvailable(labelNode1);
      assert.isFalse(available);
    });

    it("should add a new manager and register an ENS name", async () => {
      const label = "wallet";
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);
      await ensManager.addManager(amanager);
      const data = await ensManager.contract.methods["register(string,address,bytes)"](label, owner, "0x").encodeABI();
      await ensManager.sendTransaction({ data, from: amanager });

      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, owner, "new manager should have registered the ens name");
    });

    it("should fail to register an ENS name when the caller is not a manager", async () => {
      const label = "wallet";
      const data = await ensManager.contract.methods["register(string,address,bytes)"](label, owner, "0x").encodeABI();
      await truffleAssert.reverts(ensManager.sendTransaction({ data, from: anonmanager }), "AEM: user is not manager");
    });

    it("should be able to change the root node owner", async () => {
      const randomAddress = await utils.getRandomAddress();
      await ensManager.changeRootnodeOwner(randomAddress);
      const rootNodeOwner = await ensRegistry.owner(walletNode);
      assert.equal(rootNodeOwner, randomAddress);
    });

    it("should not be able to change the root node owner if not the owner", async () => {
      const randomAddress = await utils.getRandomAddress();
      await truffleAssert.reverts(ensManager.changeRootnodeOwner(randomAddress, { from: amanager }), "Must be owner");
    });

    it("should be able to change the ens resolver", async () => {
      const randomAddress = await utils.getRandomAddress();
      await ensManager.changeENSResolver(randomAddress);
      const resolver = await ensManager.ensResolver();
      assert.equal(resolver, randomAddress);
    });

    it("should not be able to change the ens resolver if not owner", async () => {
      const randomAddress = await utils.getRandomAddress();
      await truffleAssert.reverts(ensManager.changeENSResolver(randomAddress, { from: amanager }), "Must be owner");
    });

    it("should not be able to change the ens resolver to an empty address", async () => {
      await truffleAssert.reverts(ensManager.changeENSResolver(ethers.constants.AddressZero), "AEM: cannot set empty resolver");
    });
  });

  describe("ENS Resolver", () => {
    it("should return correct ENS interface support responses", async () => {
      const SUPPORT_INTERFACE_ID = "0x01ffc9a7"; // EIP 165
      const ADDR_INTERFACE_ID = "0x3b3b57de"; // EIP 137
      const NAME_INTERFACE_ID = "0x691f3431"; // EIP 181

      let support = await ensResolver.supportsInterface(SUPPORT_INTERFACE_ID);
      assert.isTrue(support);
      support = await ensResolver.supportsInterface(ADDR_INTERFACE_ID);
      assert.isTrue(support);
      support = await ensResolver.supportsInterface(NAME_INTERFACE_ID);
      assert.isTrue(support);
    });

    it("should return 0 address for a non-existent record", async () => {
      const labelNode = ethers.utils.namehash(`${"missingnode"}.${subnameWallet}.${root}`);
      const nonExistentRecord = await ensResolver.addr(labelNode);
      assert.equal(nonExistentRecord, ethers.constants.AddressZero);
    });

    it("should resolve a name", async () => {
      const label = "wallet";
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);

      await ensManager.register(label, owner, "0x");

      const ensRecord = await ensResolver.addr(labelNode);
      assert.equal(ensRecord, owner);
    });
  });
});
