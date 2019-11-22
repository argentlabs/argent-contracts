const Wallet = require("../build/BaseWallet");
const Module = require("../build/BaseModule");
const ModuleRegistry = require("../build/ModuleRegistry");
const ENS = require('../build/TestENSRegistry');
const ENSManager = require('../build/ArgentENSManager');
const ENSResolver = require('../build/ArgentENSResolver');
const ENSReverseRegistrar = require('../build/TestReverseRegistrar');
const Factory = require('../build/WalletFactory');
const GuardianStorage = require("../build/GuardianStorage");

const TestManager = require("../utils/test-manager");
const { randomBytes, formatBytes32String, bigNumberify } = require('ethers').utils;
const ZERO_BYTES32 = ethers.constants.HashZero;
const NO_ENS = "";

describe("Test Wallet Factory", function () {
    this.timeout(10000);

    const manager = new TestManager();

    let infrastructure = accounts[0].signer;
    let owner = accounts[1].signer;
    let amanager = accounts[2].signer;
    let anonmanager = accounts[3].signer;
    let guardian = accounts[4].signer;

    let root = "xyz";
    let subnameWallet = "argent";
    let walletNode = ethers.utils.namehash(subnameWallet + '.' + root);

    let ensRegistry,
        ensResolver,
        ensReverse,
        ensManager,
        implementation,
        moduleRegistry,
        guardianStorage,
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

        guardianStorage = await deployer.deploy(GuardianStorage);

        factory = await deployer.deploy(Factory, {},
            ensRegistry.contractAddress,
            moduleRegistry.contractAddress,
            implementation.contractAddress,
            ensManager.contractAddress,
            ensResolver.contractAddress, 
            guardianStorage.contractAddress);
        await factory.addManager(infrastructure.address);
        await ensManager.addManager(factory.contractAddress);
    });

    let module1, module2;

    beforeEach(async () => {
        module1 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, guardianStorage.contractAddress, ZERO_BYTES32);
        module2 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, guardianStorage.contractAddress, ZERO_BYTES32);
        await moduleRegistry.registerModule(module1.contractAddress, ethers.utils.formatBytes32String("module1"));
        await moduleRegistry.registerModule(module2.contractAddress, ethers.utils.formatBytes32String("module2"));
    });

    describe("Create wallets with CREATE", () => { 

        it("should create with the correct owner", async () => {
            // we create the wallet
            let modules = [module1.contractAddress];
            let tx = await factory.from(infrastructure).createWallet(owner.address, modules, NO_ENS, { gasLimit: 300000 });
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
            let tx = await factory.from(infrastructure).createWallet(owner.address, modules, NO_ENS, { gasLimit: 300000 });
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

        it("should fail to create when there is no modules", async () => {
            let modules = [];
            await assert.revert(factory.from(deployer).createWallet(owner.address, modules, NO_ENS, { gasLimit: 200000 }), "should fail when modules is empty");
        });

        it("should fail to create with an existing ENS", async () => {
            let label = "wallet";
            let labelNode = ethers.utils.namehash(label + '.' + subnameWallet + "." + root);
            let modules = [module1.contractAddress, module2.contractAddress];
            await assert.revert(factory.from(infrastructure).createWallet(owner.address, modules, label, { gasLimit: 550000 }), "should fail when ENS is already used");
        });
    });

    describe("Create wallets with CREATE and default guardian", () => { 

        it("should create with the correct owner", async () => {
            // we create the wallet
            let modules = [module1.contractAddress];
            let tx = await factory.from(infrastructure).createWalletWithGuardian(owner.address, modules, NO_ENS, guardian.address, { gasLimit: 500000 });
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
            let tx = await factory.from(infrastructure).createWalletWithGuardian(owner.address, modules, NO_ENS, guardian.address, { gasLimit: 500000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet has the correct modules
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let isAuthorised = await wallet.authorised(module1.contractAddress);
            assert.equal(isAuthorised, true, 'module1 should be authorised');
            isAuthorised = await wallet.authorised(module2.contractAddress);
            assert.equal(isAuthorised, true, 'module2 should be authorised');
        });

        it("should create with the correct guardian", async () => {
            // we create the wallet
            let modules = [module1.contractAddress];
            let tx = await factory.from(infrastructure).createWalletWithGuardian(owner.address, modules, NO_ENS, guardian.address, { gasLimit: 500000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet has the correct guardian
            let success = await guardianStorage.isGuardian(walletAddr, guardian.address);
            assert.equal(success, true, 'should have the correct guardian');
        });

        it("should create with the correct ENS name", async () => {
            let label = "wallet2";
            let labelNode = ethers.utils.namehash(label + '.' + subnameWallet + "." + root);
            let modules = [module1.contractAddress, module2.contractAddress];
            // we create the wallet
            let tx = await factory.from(infrastructure).createWalletWithGuardian(owner.address, modules, label, guardian.address, { gasLimit: 650000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet has the correct ENS
            let nodeOwner = await ensRegistry.owner(labelNode);
            assert.equal(nodeOwner, walletAddr);
            let res = await ensRegistry.resolver(labelNode);
            assert.equal(res, ensResolver.contractAddress);
        });
    });


    describe("Create wallets with CREATE2", () => {

        let module1, module2;

        beforeEach(async () => {
            module1 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, guardianStorage.contractAddress, ZERO_BYTES32);
            module2 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, guardianStorage.contractAddress, ZERO_BYTES32);
            await moduleRegistry.registerModule(module1.contractAddress, ethers.utils.formatBytes32String("module1"));
            await moduleRegistry.registerModule(module2.contractAddress, ethers.utils.formatBytes32String("module2"));
        });

        it("should create a wallet at the correct address", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString (); 
            let modules = [module1.contractAddress, module2.contractAddress]; 
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt); 
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, NO_ENS, salt, { gasLimit: 500000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
        }); 

        it("should create with the correct owner", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, NO_ENS, salt, { gasLimit: 500000 });
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
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, NO_ENS, salt, { gasLimit: 500000 });
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
            let label = "wallet3";
            let labelNode = ethers.utils.namehash(label + '.' + subnameWallet + "." + root);
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt, { gasLimit: 500000 });
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

        it("should fail to create a wallet at an existing address", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the first wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, NO_ENS, salt, { gasLimit: 500000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we create the second wallet
            await assert.revert(factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, NO_ENS, salt, { gasLimit: 500000 }), "should fail when address is in use");
        });

        it("should fail to create when there is no modules", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let modules = [];
            await assert.revert(factory.from(deployer).createCounterfactualWallet(owner.address, modules, NO_ENS, salt, { gasLimit: 500000 }), "should fail when modules is empty");
        });
    });

    describe("Create wallets with CREATE2 and default guardian", () => {

        let module1, module2;

        beforeEach(async () => {
            module1 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, guardianStorage.contractAddress, ZERO_BYTES32);
            module2 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, guardianStorage.contractAddress, ZERO_BYTES32);
            await moduleRegistry.registerModule(module1.contractAddress, ethers.utils.formatBytes32String("module1"));
            await moduleRegistry.registerModule(module2.contractAddress, ethers.utils.formatBytes32String("module2"));
        });

        it("should create a wallet at the correct address", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString (); 
            let modules = [module1.contractAddress, module2.contractAddress]; 
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt); 
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, NO_ENS, guardian.address, salt, { gasLimit: 500000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
        }); 

        it("should create with the correct owner", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, NO_ENS, guardian.address, salt, { gasLimit: 500000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we test that the wallet has the correct owner
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, 'should have the correct owner');
        });

        it("should create with the correct guardian", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, NO_ENS, guardian.address, salt, { gasLimit: 500000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we test that the wallet has the correct guardian
            let success = await guardianStorage.isGuardian(walletAddr, guardian.address);
            assert.equal(success, true, 'should have the correct guardian');
        });

        it("should create with the correct modules", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, NO_ENS, guardian.address, salt, { gasLimit: 500000 });
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
            let label = "wallet4";
            let labelNode = ethers.utils.namehash(label + '.' + subnameWallet + "." + root);
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, label, guardian.address, salt, { gasLimit: 600000 });
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

        it("should fail to create a wallet at an existing address", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the first wallet
            let tx = await factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, NO_ENS, guardian.address, salt, { gasLimit: 500000 });
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args._wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we create the second wallet
            await assert.revert(factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, NO_ENS, guardian.address, salt, { gasLimit: 500000 }), "should fail when address is in use");
        });

        it("should fail to create when there is no modules", async () => {
            let salt = bigNumberify(randomBytes(32)).toHexString ();
            let modules = [];
            await assert.revert(factory.from(deployer).createCounterfactualWalletWithGuardian(owner.address, modules, NO_ENS, guardian.address, salt, { gasLimit: 500000 }), "should fail when modules is empty");
        });
    });

});