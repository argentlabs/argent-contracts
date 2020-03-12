const ENSRegistry = require('../build/ENSRegistry');
const ENSRegistryWithFallback = require('../build/ENSRegistryWithFallback');
const ENSManager = require('../build/ArgentENSManager');
const ENSResolver = require('../build/ArgentENSResolver');
const ENSReverseRegistrar = require('../build/ReverseRegistrar');

const TestManager = require("../utils/test-manager");
const utilities = require('../utils/utilities.js');

const ZERO_BYTES32 = ethers.constants.HashZero;

describe("Test ENS contracts", function () {
    this.timeout(10000);

    const manager = new TestManager();

    let infrastructure = accounts[0].signer;
    let owner = accounts[1].signer;
    let amanager = accounts[2].signer;
    let anonmanager = accounts[3].signer;

    let root = "xyz";
    let subnameWallet = "argent";
    let walletNode = ethers.utils.namehash(subnameWallet + '.' + root);

    let ensRegistry, ensResolver, ensReverse, ensManager;

    beforeEach(async () => {
        deployer = manager.newDeployer();
        const ensRegistryWithoutFallback = await deployer.deploy(ENSRegistry);
        ensRegistry = await deployer.deploy(ENSRegistryWithFallback, {}, ensRegistryWithoutFallback.contractAddress);
        ensResolver = await deployer.deploy(ENSResolver);
        ensReverse = await deployer.deploy(ENSReverseRegistrar, {}, ensRegistry.contractAddress, ensResolver.contractAddress);
        ensManager = await deployer.deploy(ENSManager, {}, subnameWallet + '.' + root, walletNode, ensRegistry.contractAddress, ensResolver.contractAddress);
        await ensResolver.addManager(ensManager.contractAddress);
        await ensResolver.addManager(infrastructure.address);
        await ensManager.addManager(infrastructure.address);

        await ensRegistry.setSubnodeOwner(ZERO_BYTES32, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(root)), infrastructure.address);
        await ensRegistry.setSubnodeOwner(ethers.utils.namehash(root), ethers.utils.keccak256(ethers.utils.toUtf8Bytes(subnameWallet)), ensManager.contractAddress);
        await ensRegistry.setSubnodeOwner(ZERO_BYTES32, ethers.utils.keccak256(ethers.utils.toUtf8Bytes('reverse')), infrastructure.address);
        await ensRegistry.setSubnodeOwner(ethers.utils.namehash('reverse'), ethers.utils.keccak256(ethers.utils.toUtf8Bytes('addr')), ensReverse.contractAddress);
    });

    describe("ENS Manager", () => {
        it("should be the owner of the wallet root", async () => {
            var owner = await ensRegistry.owner(walletNode);
            assert.equal(owner, ensManager.contractAddress, "ens manager should be the owner of the wallet root node");
        });

        it("should return correct ENSResolver", async () => {
            const ensResolverOnManager = await ensManager.ensResolver();
            assert.equal(ensResolverOnManager, ensResolver.contractAddress, 'should have the correct ENSResolver addrress');
        });

        it("should register an ENS name", async () => {
            let label = "wallet";
            let labelNode = ethers.utils.namehash(label + '.' + subnameWallet + "." + root);
            await ensManager.from(infrastructure).register(label, owner.address);

            const recordExists = await ensRegistry.recordExists(labelNode);
            assert.isTrue(recordExists);
            const nodeOwner = await ensRegistry.owner(labelNode);
            assert.equal(nodeOwner, owner.address);
            const res = await ensRegistry.resolver(labelNode);
            assert.equal(res, ensResolver.contractAddress);
        });

        it("should return the correct availability for a subnode", async () => {
            let label = "wallet";
            let labelNode = ethers.utils.namehash(label + '.' + subnameWallet + "." + root);
            let labelNode1 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(label));
            // Node is initially available
            let available = await ensManager.isAvailable(labelNode1);
            assert.isTrue(available);

            // then we register it
            await ensManager.from(infrastructure).register(label, owner.address);

            const nodeOwner = await ensRegistry.owner(labelNode);
            assert.equal(nodeOwner, owner.address);

            // then the node is unavailable
            available = await ensManager.isAvailable(labelNode1);
            assert.isFalse(available);
        });

        it("should add a new manager and register an ENS name", async () => {
            let label = "wallet";
            let labelNode = ethers.utils.namehash(label + '.' + subnameWallet + "." + root);
            await ensManager.addManager(amanager.address);
            await ensManager.from(amanager).register(label, owner.address);
            let nodeOwner = await ensRegistry.owner(labelNode);
            assert.equal(nodeOwner, owner.address, "new manager should have registered the ens name");
        });

        it("should fail to register an ENS name when the caller is not a manager", async () => {
            let label = "wallet";
            await assert.revert(ensManager.from(anonmanager).register(label, owner.address), "registering should throw");
        });

        it("should be able to change the root node owner", async () => {
            const randomAddress = await utilities.getRandomAddress();
            await ensManager.changeRootnodeOwner(randomAddress);
            const rootNodeOwner = await ensRegistry.owner(walletNode);
            assert.equal(rootNodeOwner, randomAddress);
        });

        it("should not be able to change the root node owner if not the owner", async () => {
            const randomAddress = await utilities.getRandomAddress();
            await assert.revertWith(ensManager.from(amanager).changeRootnodeOwner(randomAddress), "Must be owner");
        });

        it("should be able to change the ens resolver", async () => {
            const randomAddress = await utilities.getRandomAddress();
            await ensManager.changeENSResolver(randomAddress);
            const resolver = await ensManager.ensResolver()
            assert.equal(resolver, randomAddress);
        });

        it("should not be able to change the ens resolver if not owner", async () => {
            const randomAddress = await utilities.getRandomAddress();
            await assert.revertWith(ensManager.from(amanager).changeENSResolver(randomAddress), "Must be owner");
        });

        it("should not be able to change the ens resolver to an empty address", async () => {
            await assert.revertWith(ensManager.changeENSResolver(ethers.constants.AddressZero), "WF: address cannot be null");            
        });
    });

    describe("ENS Resolver", () => {
        it("should return correct ENS interface support responses", async () => {
            const SUPPORT_INTERFACE_ID = "0x01ffc9a7"; // EIP 165
            const ADDR_INTERFACE_ID = "0x3b3b57de";    // EIP 137
            const NAME_INTERFACE_ID = "0x691f3431";    // EIP 181

            let support = await ensResolver.supportsInterface(SUPPORT_INTERFACE_ID);
            assert.isTrue(support);
            support = await ensResolver.supportsInterface(ADDR_INTERFACE_ID);
            assert.isTrue(support);
            support = await ensResolver.supportsInterface(NAME_INTERFACE_ID);
            assert.isTrue(support);
        });

        it("should return 0 address for a non-existent record", async () => {
            const labelNode = ethers.utils.namehash('missingnode' + '.' + subnameWallet + "." + root);
            const nonExistentRecord = await ensResolver.addr(labelNode);
            assert.equal(nonExistentRecord, ethers.constants.AddressZero);
        });

        it("should resolve a name", async () => {
            let label = "wallet";
            await ensManager.from(infrastructure).register(label, owner.address);

            const node = await ensReverse.node(owner.address);
            const name = await ensResolver.name(node);
            assert.equal(name, "wallet.argent.xyz");
        });
    });
});