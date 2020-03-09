const Wallet = require("../build/BaseWallet");
const Module = require("../build/BaseModule");
const ModuleRegistry = require("../build/ModuleRegistry");
const ENSRegistry = require('../build/ENSRegistry');
const ENSRegistryWithFallback = require('../build/ENSRegistryWithFallback');
const ENSManager = require('../build/ArgentENSManager');
const ENSResolver = require('../build/ArgentENSResolver');
const ENSReverseRegistrar = require('../build/ReverseRegistrar');
const Factory = require('../build/WalletFactory');
const GuardianStorage = require("../build/GuardianStorage");

const ethers = require('ethers');
const TestManager = require("../utils/test-manager");
const { bigNumberify } = require('ethers').utils;
const utilities = require('../utils/utilities.js');
const ZERO_BYTES32 = ethers.constants.HashZero;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const NO_ENS = "";

describe("Test Wallet Factory", function () {
    this.timeout(10000);

    const manager = new TestManager();

    let infrastructure = accounts[0].signer;
    let owner = accounts[1].signer;
    let guardian = accounts[4].signer;
    let other = accounts[6].signer;

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
        guardianStorage,
        factory,
        factoryWithoutGuardianStorage;

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

        guardianStorage = await deployer.deploy(GuardianStorage);

        factory = await deployer.deploy(Factory, {},
            moduleRegistry.contractAddress,
            implementation.contractAddress,
            ensManager.contractAddress);
        await factory.addManager(infrastructure.address);
        await factory.changeGuardianStorage(guardianStorage.contractAddress);
        await ensManager.addManager(factory.contractAddress);

        factoryWithoutGuardianStorage = await deployer.deploy(Factory, {},
            moduleRegistry.contractAddress,
            implementation.contractAddress,
            ensManager.contractAddress);
        await factoryWithoutGuardianStorage.addManager(infrastructure.address);
        await ensManager.addManager(factoryWithoutGuardianStorage.contractAddress);
    });

    let module1, module2;

    beforeEach(async () => {
        // Restore the good state of factory (we set these to bad addresses in some tests)
        await factory.changeModuleRegistry(moduleRegistry.contractAddress);
        await factory.changeENSManager(ensManager.contractAddress);

        module1 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, guardianStorage.contractAddress, ZERO_BYTES32);
        module2 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, guardianStorage.contractAddress, ZERO_BYTES32);
        await moduleRegistry.registerModule(module1.contractAddress, ethers.utils.formatBytes32String("module1"));
        await moduleRegistry.registerModule(module2.contractAddress, ethers.utils.formatBytes32String("module2"));
        
        index++;
    });

    describe("Configure the factory", () => {
        it("should allow owner to change the module registry", async () => {
            const randomAddress = utilities.getRandomAddress();
            await factory.changeModuleRegistry(randomAddress);
            const updatedModuleRegistry = await factory.moduleRegistry();
            assert.equal(updatedModuleRegistry, randomAddress);
        });

        it("should not allow owner to change the module registry to zero address", async () => {
            await assert.revertWith(factory.changeModuleRegistry(ethers.constants.AddressZero), "WF: address cannot be null");
        });

        it("should not allow non-owner to change the module registry", async () => {
            const randomAddress = utilities.getRandomAddress();
            await assert.revertWith(factory.from(other).changeModuleRegistry(randomAddress), "Must be owner");
        });

        it("should allow owner to change the ens manager", async () => {
            const randomAddress = utilities.getRandomAddress();
            await factory.changeENSManager(randomAddress);
            const updatedEnsManager = await factory.ensManager();
            assert.equal(updatedEnsManager, randomAddress);
        });

        it("should not allow owner to change the ens manager to a zero address", async () => {
            await assert.revertWith(factory.changeENSManager(ethers.constants.AddressZero), "WF: address cannot be null");
        });

        it("should not allow non-owner to change the ens manager", async () => {
            const randomAddress = utilities.getRandomAddress();
            await assert.revertWith(factory.from(other).changeENSManager(randomAddress), "Must be owner");
        });

        it("should not allow guardian storage address to be set to zero", async () => {
            await assert.revertWith(factory.changeGuardianStorage(ethers.constants.AddressZero), "WF: address cannot be null");          
        });
    });

    describe("Create wallets with CREATE", () => { 

        it("should create with the correct owner", async () => {
            // we create the wallet
            let label = "wallet" + index;
            let modules = [module1.contractAddress];
            let tx = await factory.from(infrastructure).createWallet(owner.address, modules, label);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
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
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
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
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet has the correct ENS
            let nodeOwner = await ensRegistry.owner(labelNode);
            assert.equal(nodeOwner, walletAddr);
            let res = await ensRegistry.resolver(labelNode);
            assert.equal(res, ensResolver.contractAddress);
        });

        it("should fail to create when there is no modules", async () => {
            let label = "wallet" + index; 
            let modules = [];
            await assert.revertWith(factory.from(deployer).createWallet(owner.address, modules, label), "WF: cannot assign with less than 1 module");
        });

        it("should fail to create when there is no ENS", async () => {
            let modules = [module1.contractAddress, module2.contractAddress];
            await assert.revertWith(factory.from(infrastructure).createWallet(owner.address, modules, NO_ENS), "WF: ENS lable must be defined");
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

        it("should fail to create with empty label", async () => {
            let label = "";
            let modules = [module1.contractAddress];
            await assert.revertWith(factory.from(infrastructure).createWallet(owner.address, modules, label), "WF: ENS lable must be defined");     
        });
    });

    describe("Create wallets with CREATE and default guardian", () => {

        it("should create with the correct owner", async () => {
            // we create the wallet
            let label = "wallet" + index;
            let modules = [module1.contractAddress];
            let tx = await factory.from(infrastructure).createWalletWithGuardian(owner.address, modules, label, guardian.address);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet has the correct owner
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, 'should have the correct owner');
        });

        it("should create with the correct modules", async () => {
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress];
            // we create the wallet
            let tx = await factory.from(infrastructure).createWalletWithGuardian(owner.address, modules, label, guardian.address);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet has the correct modules
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let isAuthorised = await wallet.authorised(module1.contractAddress);
            assert.equal(isAuthorised, true, 'module1 should be authorised');
            isAuthorised = await wallet.authorised(module2.contractAddress);
            assert.equal(isAuthorised, true, 'module2 should be authorised');
        });

        it("should create with the correct guardian", async () => {
            // we create the wallet
            let label = "wallet" + index; 
            let modules = [module1.contractAddress];
            let tx = await factory.from(infrastructure).createWalletWithGuardian(owner.address, modules, label, guardian.address);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet has the correct guardian
            let success = await guardianStorage.isGuardian(walletAddr, guardian.address);
            assert.equal(success, true, 'should have the correct guardian');
        });

        it("should create with the correct ENS name", async () => {
            let label = "wallet" + index; 
            let labelNode = ethers.utils.namehash(label + '.' + subnameWallet + "." + root);
            let modules = [module1.contractAddress, module2.contractAddress];
            // we create the wallet
            let tx = await factory.from(infrastructure).createWalletWithGuardian(owner.address, modules, label, guardian.address);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet has the correct ENS
            let nodeOwner = await ensRegistry.owner(labelNode);
            assert.equal(nodeOwner, walletAddr);
            let res = await ensRegistry.resolver(labelNode);
            assert.equal(res, ensResolver.contractAddress);
        });

        it("should fail to create with a guardian when the guardian storage is not defined", async () => {
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress];
            await assert.revertWith(factoryWithoutGuardianStorage.from(infrastructure).createWalletWithGuardian(owner.address, modules, label, guardian.address), "GuardianStorage address not defined");
        });

        it("should fail to create when the guardian is empty", async () => {
            // we create the wallet
            let label = "wallet" + index; 
            let modules = [module1.contractAddress];
            await assert.revertWith(factory.from(infrastructure).createWalletWithGuardian(owner.address, modules, label, ZERO_ADDRESS), "WF: guardian cannot be null");
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
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress]; 
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt); 
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
        }); 

        it("should create with the correct owner", async () => {
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we test that the wallet has the correct owner
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, 'should have the correct owner');
        });

        it("should create with the correct modules", async () => {
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
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
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let labelNode = ethers.utils.namehash(label + '.' + subnameWallet + "." + root);
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we test that the wallet has the correct ENS
            let nodeOwner = await ensRegistry.owner(labelNode);
            assert.equal(nodeOwner, walletAddr);
            let res = await ensRegistry.resolver(labelNode);
            assert.equal(res, ensResolver.contractAddress);
        });

        it("should fail to create a wallet at an existing address", async () => {
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWallet(owner.address, modules, salt);
            // we create the first wallet
            let tx = await factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we create the second wallet
            await assert.revert(factory.from(infrastructure).createCounterfactualWallet(owner.address, modules, label, salt), "should fail when address is in use");
        });

        it("should fail to create when there is no modules", async () => {
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let modules = [];
            await assert.revertWith(factory.from(deployer).createCounterfactualWallet(owner.address, modules, label, salt), "WF: cannot assign with less than 1 module");
        });

        it("should fail to create when there is no ENS", async () => {
            let salt = utilities.generateSaltValue();
            let label = ""; 
            let modules = [module1.contractAddress, module2.contractAddress];
            await assert.revertWith(factory.from(deployer).createCounterfactualWallet(owner.address, modules, label, salt), "WF: ENS lable must be defined");
        });

        it("should emit and event when the balance is non zero at creation", async () => {
            let salt = utilities.generateSaltValue(); 
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

    describe("Create wallets with CREATE2 and default guardian", () => {

        let module1, module2;

        beforeEach(async () => {
            module1 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, guardianStorage.contractAddress, ZERO_BYTES32);
            module2 = await deployer.deploy(Module, {}, moduleRegistry.contractAddress, guardianStorage.contractAddress, ZERO_BYTES32);
            await moduleRegistry.registerModule(module1.contractAddress, ethers.utils.formatBytes32String("module1"));
            await moduleRegistry.registerModule(module2.contractAddress, ethers.utils.formatBytes32String("module2"));
        });

        it("should create a wallet at the correct address", async () => {
            let salt = utilities.generateSaltValue(); 
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress]; 
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWalletWithGuardian(owner.address, modules, guardian.address, salt); 
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, label, guardian.address, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
        }); 

        it("should create with the correct owner", async () => {
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWalletWithGuardian(owner.address, modules, guardian.address, salt); 
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, label, guardian.address, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we test that the wallet has the correct owner
            let wallet = await deployer.wrapDeployedContract(Wallet, walletAddr);
            let walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, 'should have the correct owner');
        });

        it("should create with the correct guardian", async () => {
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWalletWithGuardian(owner.address, modules, guardian.address, salt); 
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, label, guardian.address, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we test that the wallet has the correct guardian
            let success = await guardianStorage.isGuardian(walletAddr, guardian.address);
            assert.equal(success, true, 'should have the correct guardian');
        });

        it("should create with the correct modules", async () => {
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWalletWithGuardian(owner.address, modules, guardian.address, salt); 
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, label, guardian.address, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
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
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let labelNode = ethers.utils.namehash(label + '.' + subnameWallet + "." + root);
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWalletWithGuardian(owner.address, modules, guardian.address, salt); 
            // we create the wallet
            let tx = await factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, label, guardian.address, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we test that the wallet has the correct ENS
            let nodeOwner = await ensRegistry.owner(labelNode);
            assert.equal(nodeOwner, walletAddr);
            let res = await ensRegistry.resolver(labelNode);
            assert.equal(res, ensResolver.contractAddress);
        });

        it("should fail to create a wallet at an existing address", async () => {
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress];
            // we get the future address
            let futureAddr = await factory.getAddressForCounterfactualWalletWithGuardian(owner.address, modules, guardian.address, salt); 
            // we create the first wallet
            let tx = await factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, label, guardian.address, salt);
            let txReceipt = await factory.verboseWaitForTransaction(tx);
            let walletAddr = txReceipt.events.filter(event => event.event == 'WalletCreated')[0].args.wallet;
            // we test that the wallet is at the correct address
            assert.equal(futureAddr, walletAddr, 'should have the correct address');
            // we create the second wallet
            await assert.revert(factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, label, guardian.address, salt), "should fail when address is in use");
        });

        it("should fail to create when there is no modules", async () => {
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let modules = [];
            await assert.revertWith(factory.from(deployer).createCounterfactualWalletWithGuardian(owner.address, modules, label, guardian.address, salt), "WF: cannot assign with less than 1 module");
        });

        it("should return the correct ENSManager", async () => {
            const ensManagerOnFactory = await factory.ensManager();
            assert.equal(ensManagerOnFactory, ensManager.contractAddress, 'should have the correct ENSManager addrress');
        });


        it("should fail to create with a guardian when the guardian storage is not defined", async () => {
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress];
            await assert.revertWith(factoryWithoutGuardianStorage.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, label, guardian.address, salt), "GuardianStorage address not defined");
        });

        it("should fail to get an address when the guardian is empty", async () => {
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress];
            await assert.revertWith(factory.from(infrastructure).getAddressForCounterfactualWalletWithGuardian(owner.address, modules, ZERO_ADDRESS, salt), "WF: guardian cannot be null");
        });

        it("should fail to create when the guardian is empty", async () => {
            let salt = utilities.generateSaltValue();
            let label = "wallet" + index; 
            let modules = [module1.contractAddress, module2.contractAddress];
            await assert.revertWith(factory.from(infrastructure).createCounterfactualWalletWithGuardian(owner.address, modules, label, ZERO_ADDRESS, salt), "WF: guardian cannot be null");
        });
    });
});