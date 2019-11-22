const etherlime = require('etherlime-lib');
const Wallet = require("../build/BaseWallet");
const OnlyOwnerModule = require("../build/TestOnlyOwnerModule");
const Module = require("../build/TestModule");
const SimpleUpgrader = require("../build/SimpleUpgrader");
const Registry = require("../build/ModuleRegistry");

const TestManager = require("../utils/test-manager");

const { keccak256, toUtf8Bytes } = require('ethers').utils
const IS_ONLY_OWNER_MODULE = keccak256(toUtf8Bytes("isOnlyOwnerModule()")).slice(0, 10)

describe("Test SimpleUpgrader", function () {
    this.timeout(10000);

    const manager = new TestManager();

    let owner = accounts[1].signer;
    let registry;

    beforeEach(async () => {
        deployer = new etherlime.EtherlimeGanacheDeployer(accounts[0].secretKey);
        registry = await deployer.deploy(Registry);
    });

    describe("Registering modules", () => {

        it("should register modules in the registry", async () => {
            let name = "test_1.1";
            let module = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
            await registry.registerModule(module.contractAddress, ethers.utils.formatBytes32String(name));
            let isRegistered = await registry.isRegisteredModule(module.contractAddress);
            assert.equal(isRegistered, true, "module1 should be registered");
            let info = await registry.moduleInfo(module.contractAddress);
            assert.equal(ethers.utils.parseBytes32String(info), name, "module1 should be registered with the correct name");
        });

        it("should add registered modules to a wallet", async () => {
            // create modules
            let initialModule = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
            let moduleToAdd = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
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
            let initialModule = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
            let moduleToAdd = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
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
        async function testUpgradeModule({ relayed, useOnlyOwnerModule }) {
            // create module V1
            let moduleV1;
            if (useOnlyOwnerModule) {
                moduleV1 = await deployer.deploy(OnlyOwnerModule, {}, registry.contractAddress);
            } else {
                moduleV1 = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
            }
            // register module V1
            await registry.registerModule(moduleV1.contractAddress, ethers.utils.formatBytes32String("V1"));
            // create wallet with module V1
            let wallet = await deployer.deploy(Wallet);
            await wallet.init(owner.address, [moduleV1.contractAddress]);
            // create module V2
            let moduleV2 = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
            // register module V2
            await registry.registerModule(moduleV2.contractAddress, ethers.utils.formatBytes32String("V2"));
            // create upgrader
            let upgrader = await deployer.deploy(SimpleUpgrader, {}, registry.contractAddress, [moduleV1.contractAddress], [moduleV2.contractAddress]);
            await registry.registerModule(upgrader.contractAddress, ethers.utils.formatBytes32String("V1toV2"));
            // check that module V1 can be used to add the upgrader module
            useOnlyOwnerModule && assert.equal(await moduleV1.isOnlyOwnerModule(), IS_ONLY_OWNER_MODULE);

            // upgrade from V1 to V2
            let txReceipt;
            const params = [wallet.contractAddress, upgrader.contractAddress]
            if (relayed) {
                txReceipt = await manager.relay(moduleV1, 'addModule', params, wallet, [owner]);
                assert.equal(txReceipt.events.find(e => e.event === 'TransactionExecuted').args.success, useOnlyOwnerModule, "Relayed tx should only have succeeded if an OnlyOwnerModule was used");
            } else {
                const tx = await moduleV1.from(owner).addModule(...params, { gasLimit: 1000000 });
                txReceipt = await moduleV1.verboseWaitForTransaction(tx);
            }

            // test event ordering
            const logs = utils.parseLogs(txReceipt, wallet, 'AuthorisedModule');
            const upgraderAuthorisedLogIndex = logs.findIndex(e => e.module === upgrader.contractAddress && e.value === true);
            const upgraderUnauthorisedLogIndex = logs.findIndex(e => e.module === upgrader.contractAddress && e.value === false);
            if (!relayed || useOnlyOwnerModule) {
                assert.isBelow(upgraderAuthorisedLogIndex, upgraderUnauthorisedLogIndex, "AuthorisedModule(upgrader, false) should come after AuthorisedModule(upgrader, true)");
            } else {
                assert.equal(upgraderUnauthorisedLogIndex, -1, "AuthorisedModule(upgrader, false) should not have been emitted");
                assert.equal(upgraderAuthorisedLogIndex, -1, "AuthorisedModule(upgrader, true) should not have been emitted");
            }

            // test if the upgrade worked
            let isV1Authorised = await wallet.authorised(moduleV1.contractAddress);
            let isV2Authorised = await wallet.authorised(moduleV2.contractAddress);
            let isUpgraderAuthorised = await wallet.authorised(upgrader.contractAddress);
            assert.equal(isV1Authorised, relayed && !useOnlyOwnerModule, "moduleV1 should only be unauthorised if the upgrade went through");
            assert.equal(isV2Authorised, !relayed || useOnlyOwnerModule, "module2 should only be authorised if the upgrade went through");
            assert.equal(isUpgraderAuthorised, false, "upgrader should not be authorised");
        }

        it("should upgrade modules (blockchain tx)", async () => {
            await testUpgradeModule({ relayed: false, useOnlyOwnerModule: false })
        });

        it("should upgrade modules (not using OnlyOwnerModule, relayed tx)", async () => {
            await testUpgradeModule({ relayed: true, useOnlyOwnerModule: false })
        });

        it("should upgrade modules (using OnlyOwnerModule, relayed tx)", async () => {
            await testUpgradeModule({ relayed: true, useOnlyOwnerModule: true })
        });
    });
})