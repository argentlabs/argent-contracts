const Wallet = require("../build/BaseWallet");
const Module = require("../build/BaseModule");
const ModuleRegistry = require("../build/ModuleRegistry");
const ENS = require('../build/TestENSRegistry');
const ENSManager = require('../build/ArgentENSManager');
const ENSResolver = require('../build/ArgentENSResolver');
const ENSReverseRegistrar = require('../build/TestReverseRegistrar');
const Factory = require('../build/WalletFactory');

const TestManager = require("../utils/test-manager");
const { randomBytes, bigNumberify } = require('ethers').utils;
const utilities = require('../utils/utilities.js');

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

    let index = 0;

    let ensRegistry,
        ensResolver,
        ensReverse,
        ensManager,
        implementation,
        moduleRegistry,
        factory;

    before(async () => {
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

    describe("Create wallets with CREATE", () => {

        let module1, module2;

        beforeEach(async () => {
            module1 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, ZERO_BYTES32);
            module2 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, ZERO_BYTES32);
            await moduleRegistry.registerModule(module1.contractAddress, ethers.utils.formatBytes32String("module1"));
            await moduleRegistry.registerModule(module2.contractAddress, ethers.utils.formatBytes32String("module2"));
            index++;
        });

        it("should create with the correct owner", async () => {
            // we create the wallet
            let label = "wallet" + index;
            let modules = [module1.contractAddress];
            let tx = await factory.from(infrastructure).createWallet(owner.address, modules, label);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet has the correct owner
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, 'should have the correct owner');
        });

        it("should create with the correct modules", async () => {
            let label = "wallet" + index;
            let modules = [module1.contractAddress, module2.contractAddress];
            // we create the wallet
            let tx = await factory.from(infrastructure).createWallet(owner.address, modules, label);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet has the correct modules
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let isAuthorised = await wallet.authorised(module1.contractAddress);
            assert.equal(isAuthorised, true, 'module1 should be authorised');
            isAuthorised = await wallet.authorised(module2.contractAddress);
            assert.equal(isAuthorised, true, 'module2 should be authorised');
        });

        it("should create with the correct ENS name", async () => {
            let label = "wallet" + index;
            let labelNode = ethers.utils.namehash(label + '.' + subnameWallet + "." + root);
            let modules = [module1.contractAddress, module2.contractAddress];
            // we create the wallet
            let tx = await factory.from(infrastructure).createWallet(owner.address, modules, label);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet has the correct ENS
            let nodeOwner = await ensRegistry.owner(labelNode);
            assert.equal(nodeOwner, walletAddr);
            let res = await ensRegistry.resolver(labelNode);
            assert.equal(res, ensResolver.contractAddress);
        });

        it("should create with the correct owner with an empty ENS", async () => {
            // we create the wallet
            let label = "";
            let modules = [module1.contractAddress];
            let tx = await factory.from(infrastructure).createWallet(owner.address, modules, label, { gasLimit: 300000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet has the correct owner
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, 'should have the correct owner');
        });

        it("should create with the correct modules with an empty ENS", async () => {
            let label = "";
            let modules = [module1.contractAddress, module2.contractAddress];
            // we create the wallet
            let tx = await factory.from(infrastructure).createWallet(owner.address, modules, label, { gasLimit: 300000 });
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
            let label = "wallet" + index;
            let modules = [];
            await assert.revertWith(factory.from(deployer).createWallet(owner.address, modules, label), "WF: cannot assign with less than 1 module");
        });

        it("should fail to create with an existing ENS", async () => {
            let label = "wallet" + index;
            let modules = [module1.contractAddress, module2.contractAddress];
            await factory.from(infrastructure).createWallet(owner.address, modules, label);
            await assert.revertWith(factory.from(infrastructure).createWallet(owner.address, modules, label), "AEM: _label is alrealdy owned");
        });

        it("should fail to create with zero address as owner", async () => {
            let label = "wallet" + index;
            let modules = [module1.contractAddress];
            await assert.revertWith(factory.from(infrastructure).createWallet(ethers.constants.AddressZero, modules, label), "WF: owner cannot be null");
        });

        it("should fail to create with no modules", async () => {
            let label = "wallet" + index;
            let modules = [];
            await assert.revertWith(factory.from(infrastructure).createWallet(owner.address, modules, label), "WF: cannot assign with less than 1 module");
        });

        it("should fail to create with unregistered module", async () => {
            let label = "wallet" + index;
            const randomAddress = utilities.getRandomAddress();
            let modules = [randomAddress];
            await assert.revertWith(factory.from(infrastructure).createWallet(owner.address, modules, label), "WF: one or more modules are not registered");
        });
    });

    describe("Create wallets with CREATE2", () => {

        let module1, module2;

        beforeEach(async () => {
            module1 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, ZERO_BYTES32);
            module2 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, ZERO_BYTES32);
            await moduleRegistry.registerModule(module1.contractAddress, ethers.utils.formatBytes32String("module1"));
            await moduleRegistry.registerModule(module2.contractAddress, ethers.utils.formatBytes32String("module2"));
            index++;
        });

        it("should create a wallet at the correct address", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let label = "wallet" + index;
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
        });

        it("should create with the correct owner", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let label = "wallet" + index;
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we test that the wallet has the correct owner
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, 'should have the correct owner');
        });

        it("should create with the correct modules", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let label = "wallet" + index;
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we test that the wallet has the correct modules
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let isAuthorised = await wallet.authorised(module1.contractAddress);
            assert.equal(isAuthorised, true, 'module1 should be authorised');
            isAuthorised = await wallet.authorised(module2.contractAddress);
            assert.equal(isAuthorised, true, 'module2 should be authorised');
        });

        it("should create with the correct ENS name", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let label = "wallet" + index;
            let labelNode = ethers.utils.namehash(label + '.' + subnameWallet + "." + root);
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we test that the wallet has the correct ENS
            let nodeOwner = await ensRegistry.owner(labelNode);
            assert.equal(nodeOwner, walletAddr);
            let res = await ensRegistry.resolver(labelNode);
            assert.equal(res, ensResolver.contractAddress);
        });

        it("should create a wallet at the correct address with an empty ENS", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let label = "";
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt, { gasLimit: 300000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
        });

        it("should create with the correct owner with an empty ENS", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let label = "";
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt, { gasLimit: 300000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we test that the wallet has the correct owner
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, 'should have the correct owner');
        });

        it("should create with the correct modules with an empty ENS", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let label = "";
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt, { gasLimit: 300000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we test that the wallet has the correct modules
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let isAuthorised = await wallet.authorised(module1.contractAddress);
            assert.equal(isAuthorised, true, 'module1 should be authorised');
            isAuthorised = await wallet.authorised(module2.contractAddress);
            assert.equal(isAuthorised, true, 'module2 should be authorised');
        });

        it("should fail to create a wallet at an existing address", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let label = "wallet" + index;
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the first wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we create the second wallet
            await assert.revert(factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt), "should fail when address is in use");
        });

        it("should fail to create when there is no modules", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let label = "wallet" + index;
            let modules = [];
            await assert.revertWith(factory.from(deployer).createCounterfactualWallet(owner.address, modules, label, salt), "WF: cannot assign with less than 1 module");
        });

        it("should emit an event when the balance is non zero at creation", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let label = "wallet" + index;
            let modules = [module1.contractAddress, module2.contractAddress];
            let amount = bigNumberify('10000000000000');
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // We send ETH to the address
            await infrastructure.sendTransaction({ to: futureAddr, value: amount });
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let wallet = deployer.wrapDeployedContract(Wallet, futureAddr);
            assert.isTrue(await utils.hasEvent(txReceipt, wallet, "Received"), "should have generated Received event");
            let log = await utils.parseLogs(txReceipt, wallet, "Received");
            assert.equal(log[0].value.toNumber(), amount, "should log the correct amount");
            assert.equal(log[0].sender, '0x0000000000000000000000000000000000000000', "sender should be address(0)");
        });
    });
});