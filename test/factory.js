const Wallet = require("../build/BaseWallet");
const Module = require("../build/BaseModule");
const ModuleRegistry = require("../build/ModuleRegistry");
const ENSRegistry = require('../build/ENSRegistry');
const ENSRegistryWithFallback = require('../build/ENSRegistryWithFallback');
const ENSManager = require('../build/ArgentENSManager');
const ENSResolver = require('../build/ArgentENSResolver');
const ENSReverseRegistrar = require('../build/ReverseRegistrar');
const Factory = require('../build/WalletFactory');

const TestManager = require("../utils/test-manager");

const ZERO_BYTES32 = ethers.constants.HashZero;

describe("Test Wallet Factory", function () {
    this.timeout(10000);

    const manager = new TestManager();

    let infrastructure = accounts[0].signer;
    let owner = accounts[1].signer;
    let amanager = accounts[2].signer;
    let anonmanager = accounts[3].signer;

    let root = "xyz";
    let subnameWallet = "argent";
    let walletNode = ethers.utils.namehash(subnameWallet + '.' + root);

    let ensRegistry,
        ensResolver,
        ensReverse,
        ensManager,
        implementation,
        moduleRegistry,
        factory;

    before(async () => {
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

        implementation = await deployer.deploy(Wallet);

        moduleRegistry = await deployer.deploy(ModuleRegistry);

        factory = await deployer.deploy(Factory, {},
            ensRegistry.contractAddress,
            moduleRegistry.contractAddress,
            implementation.contractAddress,
            ensManager.contractAddress,
            ensResolver.contractAddress);
        await factory.addManager(infrastructure.address);
        await ensManager.addManager(factory.contractAddress);
    });

    describe("Create wallets", () => {

        let module1, module2;

        beforeEach(async () => {
            module1 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, ethers.constants.AddressZero, ZERO_BYTES32);
            module2 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, ethers.constants.AddressZero, ZERO_BYTES32);
            await moduleRegistry.registerModule(module1.contractAddress, ethers.utils.formatBytes32String("module1"));
            await moduleRegistry.registerModule(module2.contractAddress, ethers.utils.formatBytes32String("module2"));
        });

        it("should create with the correct owner", async () => {
            // we create the wallet
            let modules = [module1.contractAddress];
            let tx = await factory.from(infrastructure).createWallet(owner.address, modules, "", { gasLimit: 300000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet has the correct owner
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, 'should have the correct owner');
        });

        it("should create with the correct modules", async () => {
            let modules = [module1.contractAddress, module2.contractAddress];
            // we create the wallet
            let tx = await factory.from(infrastructure).createWallet(owner.address, modules, "", { gasLimit: 300000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet has the correct modules
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let isAuthorised = await wallet.authorised(module1.contractAddress);
            assert.equal(isAuthorised, true, 'module1 should be authorised');
            isAuthorised = await wallet.authorised(module2.contractAddress);
            assert.equal(isAuthorised, true, 'module2 should be authorised');
        });

        it("should fail to create when there is no modules", async () => {
            let modules = [];
            await assert.revert(factory.from(deployer).createWallet(owner.address, modules, "", { gasLimit: 200000 }), "should fail when modules is empty");
        });

        it("should create with the correct ENS name", async () => {
            let label = "wallet";
            let labelNode = ethers.utils.namehash(label + '.' + subnameWallet + "." + root);
            let modules = [module1.contractAddress, module2.contractAddress];
            // we create the wallet
            let tx = await factory.from(infrastructure).createWallet(owner.address, modules, label, { gasLimit: 550000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet has the correct ENS
            let nodeOwner = await ensRegistry.owner(labelNode);
            assert.equal(nodeOwner, walletAddr);
            let res = await ensRegistry.resolver(labelNode);
            assert.equal(res, ensResolver.contractAddress);
        });
    });


});