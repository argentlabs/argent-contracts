const etherlime = require('etherlime');
const Wallet = require("../build/BaseWallet");
const Module = require("../build/BaseModule");
const SimpleUpgrader = require("../build/SimpleUpgrader");
const Registry = require("../build/ModuleRegistry");

describe("Test SimpleUpgrader", function () {
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
            // create modules
            let initialModule = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.HashZero);
            let moduleToAdd = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.HashZero);
            // register module
            await registry.registerModule(initialModule.contractAddress, ethers.utils.formatBytes32String("initial"));
            await registry.registerModule(moduleToAdd.contractAddress, ethers.utils.formatBytes32String("added"));
            // create wallet with initial module
            let wallet = await deployer.deploy(Wallet);
            await wallet.init(owner.address, [initialModule.contractAddress]);
            let isAuthorised = await wallet.authorised(initialModule.contractAddress);
            assert.equal(isAuthorised, true, "initial module should be authorised");
            // add module to wallet
            await initialModule.from(owner).addModule(wallet.contractAddress, moduleToAdd.contractAddress, { gasLimit: 1000000 });
            isAuthorised = await wallet.authorised(moduleToAdd.contractAddress);
            assert.equal(isAuthorised, true, "added module should be authorised");
        });

        it("should block addition of unregistered modules to a wallet", async () => {
            // create modules
            let initialModule = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.HashZero);
            let moduleToAdd = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.HashZero);
            // register initial module only
            await registry.registerModule(initialModule.contractAddress, ethers.utils.formatBytes32String("initial"));
            // create wallet with initial module
            let wallet = await deployer.deploy(Wallet);
            await wallet.init(owner.address, [initialModule.contractAddress]);
            let isAuthorised = await wallet.authorised(initialModule.contractAddress);
            assert.equal(isAuthorised, true, "initial module should be authorised");
            // try (and fail) to add moduleToAdd to wallet
            await assert.revert(initialModule.from(owner).addModule(wallet.contractAddress, moduleToAdd.contractAddress, { gasLimit: 1000000 }));
            isAuthorised = await wallet.authorised(moduleToAdd.contractAddress);
            assert.equal(isAuthorised, false, "unregistered module should not be authorised");
        });
    });

    describe("Upgrading modules", () => {

        it("should upgrade modules", async () => {
            // create module V1
            let moduleV1 = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.HashZero);
            // register module V1
            await registry.registerModule(moduleV1.contractAddress, ethers.utils.formatBytes32String("V1"));
            // create wallet with module V1
            let wallet = await deployer.deploy(Wallet);
            await wallet.init(owner.address, [moduleV1.contractAddress]);
            // create module V2
            let moduleV2 = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.HashZero);
            // register module V2
            await registry.registerModule(moduleV2.contractAddress, ethers.utils.formatBytes32String("V2"));
            // create upgrader
            let upgrader = await deployer.deploy(SimpleUpgrader, {}, registry.contractAddress, [moduleV1.contractAddress], [moduleV2.contractAddress]);
            await registry.registerModule(upgrader.contractAddress, ethers.utils.formatBytes32String("V1toV2"));
            // upgrade from V1 to V2
            await moduleV1.from(owner).addModule(wallet.contractAddress, upgrader.contractAddress, { gasLimit: 1000000 });
            //test if upgrade worked
            let isV1Authorised = await wallet.authorised(moduleV1.contractAddress);
            let isV2Authorised = await wallet.authorised(moduleV2.contractAddress);
            let isUpgraderAuthorised = await wallet.authorised(upgrader.contractAddress);
            assert.equal(isV1Authorised, false, "moduleV1 should not be authorised");
            assert.equal(isV2Authorised, true, "module2 should be authorised");
            assert.equal(isUpgraderAuthorised, false, "upgrader should not be authorised");
            console.log('ok!')
        });
    });
})