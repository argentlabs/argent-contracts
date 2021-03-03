/* global artifacts */
const ethers = require("ethers");

const ENSRegistry = artifacts.require("ENSRegistry");
const ENSRegistryWithFallback = artifacts.require("ENSRegistryWithFallback");
const ENSManager = artifacts.require("ArgentENSManager");
const ENSResolver = artifacts.require("ArgentENSResolver");
const ENSReverseRegistrar = artifacts.require("ReverseRegistrar");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const UniswapV2Router01 = artifacts.require("DummyUniV2Router");
const Filter = artifacts.require("TestFilter");

const truffleAssert = require("truffle-assertions");
const utilities = require("../utils/utilities.js");
const { ETH_TOKEN, encodeTransaction } = require("../utils/utilities.js");
const RelayManager = require("../utils/relay-manager");

const ZERO_BYTES32 = ethers.constants.HashZero;
const ZERO_ADDRESS = ethers.constants.AddressZero;

contract("ENS contracts", (accounts) => {
  const infrastructure = accounts[0];
  const owner = accounts[1];
  const amanager = accounts[2];
  const anonmanager = accounts[3];
  const recipient = accounts[3];

  const root = "xyz";
  const subnameWallet = "argent";
  const walletNode = ethers.utils.namehash(`${subnameWallet}.${root}`);

  let ensRegistry;
  let ensResolver;
  let ensReverse;
  let ensManager;

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

    it("should register an ENS name with manager signature", async () => {
      const label = "walletа";
      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);

      const message = `0x${[
        owner,
        ethers.utils.hexlify(ethers.utils.toUtf8Bytes(label)),
      ].map((hex) => hex.slice(2)).join("")}`;
      const managerSig = await utilities.signMessage(ethers.utils.keccak256(message), infrastructure);

      await ensManager.register(label, owner, managerSig, { from: anonmanager });

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
      const managerSig = await utilities.signMessage(ethers.utils.keccak256(message), infrastructure);

      await ensManager.register(label, owner, managerSig, { from: anonmanager });

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
      await ensManager.register(label, owner, "0x", { from: amanager });
      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, owner, "new manager should have registered the ens name");
    });

    it("should fail to register an ENS name when the caller is not a manager", async () => {
      const label = "wallet";
      await truffleAssert.reverts(ensManager.register(label, owner, "0x", { from: anonmanager }), "AEM: user is not manager");
    });

    it("should be able to change the root node owner", async () => {
      const randomAddress = await utilities.getRandomAddress();
      await ensManager.changeRootnodeOwner(randomAddress);
      const rootNodeOwner = await ensRegistry.owner(walletNode);
      assert.equal(rootNodeOwner, randomAddress);
    });

    it("should not be able to change the root node owner if not the owner", async () => {
      const randomAddress = await utilities.getRandomAddress();
      await truffleAssert.reverts(ensManager.changeRootnodeOwner(randomAddress, { from: amanager }), "Must be owner");
    });

    it("should be able to change the ens resolver", async () => {
      const randomAddress = await utilities.getRandomAddress();
      await ensManager.changeENSResolver(randomAddress);
      const resolver = await ensManager.ensResolver();
      assert.equal(resolver, randomAddress);
    });

    it("should not be able to change the ens resolver if not owner", async () => {
      const randomAddress = await utilities.getRandomAddress();
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

  describe("Relayed ENS registration", () => {
    it("should be able to register label for wallet", async () => {
      const registry = await Registry.new();
      const guardianStorage = await GuardianStorage.new();
      const transferStorage = await TransferStorage.new();
      const dappRegistry = await DappRegistry.new(0);
      const filter = await Filter.new();

      await dappRegistry.addDapp(0, ensReverse.address, filter.address);
      await dappRegistry.addDapp(0, ensManager.address, filter.address);
      await dappRegistry.addDapp(0, recipient, ZERO_ADDRESS);

      const uniswapRouter = await UniswapV2Router01.new();
      const SECURITY_PERIOD = 2;
      const SECURITY_WINDOW = 2;
      const LOCK_PERIOD = 4;
      const RECOVERY_PERIOD = 4;

      const module = await ArgentModule.new(
        registry.address,
        guardianStorage.address,
        transferStorage.address,
        dappRegistry.address,
        uniswapRouter.address,
        SECURITY_PERIOD,
        SECURITY_WINDOW,
        LOCK_PERIOD,
        RECOVERY_PERIOD);

      const manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);

      await registry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentModule"));

      const walletImplementation = await BaseWallet.new();
      const proxy = await Proxy.new(walletImplementation.address);
      const wallet = await BaseWallet.at(proxy.address);
      await wallet.init(owner, [module.address]);
      await wallet.send(web3.utils.toWei("1"));

      const transactions = [];
      // build the claimWithResolver call
      let data = ensReverse.contract.methods.claimWithResolver(ensManager.address, ensResolver.address).encodeABI();
      let transaction = encodeTransaction(ensReverse.address, 0, data, false);
      transactions.push(transaction);

      // build the ens register call
      const label = "wallet";
      const message = `0x${[
        wallet.address,
        ethers.utils.hexlify(ethers.utils.toUtf8Bytes(label)),
      ].map((hex) => hex.slice(2)).join("")}`;
      const managerSig = await utilities.signMessage(ethers.utils.keccak256(message), infrastructure);
      data = ensManager.contract.methods.register(label, wallet.address, managerSig).encodeABI();
      transaction = encodeTransaction(ensManager.address, 0, data, false);
      transactions.push(transaction);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        recipient);
      const success = await utilities.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "call failed");

      const labelNode = ethers.utils.namehash(`${label}.${subnameWallet}.${root}`);
      const recordExists = await ensRegistry.recordExists(labelNode);
      assert.isTrue(recordExists);
      const nodeOwner = await ensRegistry.owner(labelNode);
      assert.equal(nodeOwner, wallet.address);
      const res = await ensRegistry.resolver(labelNode);
      assert.equal(res, ensResolver.address);

      // check ens reverse record
      const reverseNode = await ensReverse.node(wallet.address);
      const name = await ensResolver.name(reverseNode);
      assert.equal(name, "wallet.argent.xyz");

      console.log("Gas to register ENS label: ", txReceipt.gasUsed);
    });
  });
});
