const ENSRegistry = require('../build/ENSRegistry');
const ENSRegistryWithFallback = require('../build/ENSRegistryWithFallback');
const ENSManager = require('../build/ArgentENSManager');
const ENSResolver = require('../build/ArgentENSResolver');
const ENSReverseRegistrar = require('../build/ReverseRegistrar');

const TestManager = require("../utils/test-manager");

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
            let ensName = label + '.' + subnameWallet + "." + root;
            await ensManager.from(infrastructure).register(label, owner.address);
            let resolved = await ensResolver.addr(ethers.utils.namehash(ensName));
            assert.equal(resolved, owner.address, "should resolve to owner");
        });
    });
});