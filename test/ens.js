const ENS = require('../build/TestENSRegistry');
const ENSManager = require('../build/ArgentENSManager');
const ENSResolver = require('../build/ArgentENSResolver');
const ENSReverseRegistrar = require('../build/TestReverseRegistrar');
const ENSConsumer = require('../build/ENSConsumer');

const TestManager = require("../utils/test-manager");

const ZERO_BYTES32 = ethers.constants.HashZero;

describe("Test ENS contracts", function () {
    this.timeout(10000);

    const manager = new TestManager(accounts);

    let infrastructure = accounts[0].wallet;
    let owner = accounts[1].wallet;
    let amanager = accounts[2].wallet;
    let anonmanager = accounts[3].wallet;

    let root = "xyz";
    let subnameWallet = "argent";
    let walletNode = ethers.utils.namehash(subnameWallet + '.' + root);

    let ensRegistry, ensResolver, ensReverse, ensManager;

    beforeEach(async () => {
        deployer = manager.newDeployer();
        ensRegistry = await deployer.deploy(ENS);
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
            let nodeOwner = await ensRegistry.owner(labelNode);
            assert.equal(nodeOwner, owner.address);
            let res = await ensRegistry.resolver(labelNode);
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

    describe("ENS Consumer", () => {

        it("ENSUser should resolve a name", async () => {
            let label = "wallet";
            let ensName = label + '.' + subnameWallet + "." + root;
            await ensManager.from(infrastructure).register(label, owner.address);
            let ensConsumer = await deployer.deploy(ENSConsumer, {}, ensRegistry.contractAddress);
            let resolved =  await ensConsumer.resolveEns(ethers.utils.namehash(ensName));
            assert.equal(resolved, owner.address, "should resolve to owner");
        });
    });
});