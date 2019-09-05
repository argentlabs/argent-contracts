const etherlime = require('etherlime-lib');
const Wallet = require("../build/BaseWallet");
const Module = require("../build/BaseModule");
const ModuleManager = require("../build/ModuleManager");
const Registry = require("../build/ModuleRegistry");
const Upgrader = require("../build/SimpleUpgrader");

describe("Test ModuleManager", function () {
    this.timeout(10000);

    let owner = accounts[1].signer;

    let registry;

    beforeEach(async () => {
        deployer = new etherlime.EtherlimeGanacheDeployer(accounts[0].secretKey);
        registry = await deployer.deploy(Registry);
    });

    describe("Registering modules", () => {

        it("should register modules in the registry", async () => {
            let name = "test_1.1";
            let module = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.HashZero);
            await registry.registerModule(module.contractAddress, ethers.utils.formatBytes32String(name));
            let isRegistered = await registry.isRegisteredModule(module.contractAddress);
            assert.equal(isRegistered, true, "module1 should be registered");
            let info = await registry.moduleInfo(module.contractAddress);
            assert.equal(ethers.utils.parseBytes32String(info), name, "module1 should be registered with the correct name");
        });

        it("should add registered modules to a wallet", async () => {
            // create manager module and add to registry (optional)
            let moduleManager = await deployer.deploy(ModuleManager, {}, registry.contractAddress);
            await registry.registerModule(moduleManager.contractAddress, ethers.utils.formatBytes32String("manager"));
            // create base module
            let moduleToAdd = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.HashZero);
            // register module
            await registry.registerModule(moduleToAdd.contractAddress, ethers.utils.formatBytes32String("test"));
            // create wallet with module manager
            let wallet = await deployer.deploy(Wallet);
            await wallet.init(owner.address, [moduleManager.contractAddress]);
            // add module to wallet
            await moduleManager.from(owner).addModule(wallet.contractAddress, moduleToAdd.contractAddress, { gasLimit: 1000000 });
            let isAuthorised = await wallet.authorised(moduleToAdd.contractAddress);
            assert.equal(isAuthorised, true, "module should be authorised");
        });

        it("should block addition of unregistered modules to a wallet", async () => {
            // create manager module and add to registry (optional)
            let moduleManager = await deployer.deploy(ModuleManager, {}, registry.contractAddress);
            await registry.registerModule(moduleManager.contractAddress, ethers.utils.formatBytes32String("manager"));
            // create base module
            let moduleToAdd = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.HashZero);
            // create wallet with module manager
            let wallet = await deployer.deploy(Wallet);
            await wallet.init(owner.address, [moduleManager.contractAddress]);
            // add module to wallet
            await assert.revert(moduleManager.from(owner).addModule(wallet.contractAddress, moduleToAdd.contractAddress, { gasLimit: 1000000 }));
        });
    });

    describe("Upgrading modules", () => {

        it("should upgrade modules", async () => {
            // create module manager and add to registry (optional)
            let moduleManager = await deployer.deploy(ModuleManager, {}, registry.contractAddress);
            await registry.registerModule(moduleManager.contractAddress, ethers.utils.formatBytes32String("manager"));
            // create module V1
            let moduleV1 = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.HashZero);
            // register module V1
            await registry.registerModule(moduleV1.contractAddress, ethers.utils.formatBytes32String("V1"));
            // create wallet with module manager and module V1
            let wallet = await deployer.deploy(Wallet);
            await wallet.init(owner.address, [moduleManager.contractAddress, moduleV1.contractAddress]);
            // create module V2
            let moduleV2 = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.HashZero);
            // register module V2
            await registry.registerModule(moduleV2.contractAddress, ethers.utils.formatBytes32String("V2"));
            // create upgrader
            let upgrader = await deployer.deploy(Upgrader, {}, [moduleV1.contractAddress], [moduleV2.contractAddress]);
            await registry.registerUpgrader(upgrader.contractAddress, ethers.utils.formatBytes32String("V1toV2"));
            // upgrade from V1 to V2
            await moduleManager.from(owner).upgrade(wallet.contractAddress, upgrader.contractAddress, { gasLimit: 1000000 });
            //test if upgrade worked
            let isV1Authorised = await wallet.authorised(moduleV1.contractAddress);
            let isV2Authorised = await wallet.authorised(moduleV2.contractAddress);
            assert.equal(isV1Authorised, false, "moduleV1 should not be authorised");
            assert.equal(isV2Authorised, true, "module2 should be authorised");
        });
    });
})