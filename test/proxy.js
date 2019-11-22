const etherlime = require('etherlime-lib');
const Proxy = require('../build/Proxy');
const Wallet = require('../build/BaseWallet');
const Module = require('../build/BaseModule');
const Registry = require('../build/ModuleRegistry');

describe("Test Proxy", function () {
    this.timeout(10000);

    let owner = accounts[1].signer;
    let nonowner = accounts[2].signer;

    let walletImplementation, wallet, proxy, module1, module2, module3;

    before(async () => {
        deployer = new etherlime.EtherlimeGanacheDeployer(accounts[0].secretKey);
        const registry = await deployer.deploy(Registry);
        walletImplementation = await deployer.deploy(Wallet);
        module1 = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.AddressZero, ethers.constants.HashZero);
        module2 = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.AddressZero, ethers.constants.HashZero);
        module3 = await deployer.deploy(Module, {}, registry.contractAddress, ethers.constants.AddressZero, ethers.constants.HashZero);
    });

    beforeEach(async () => {
        proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
        wallet = deployer.wrapDeployedContract(Wallet, proxy.contractAddress);
    });

    it("should init the wallet with the correct owner", async () => {
        let walletOwner = await wallet.owner();
        assert.equal(walletOwner, ethers.constants.AddressZero, "owner should be null before init");
        await wallet.init(owner.address, [module1.contractAddress], { gasLimit: 1000000 });
        walletOwner = await wallet.owner();
        assert.equal(walletOwner, owner.address, "owner should be the owner after init");
    });

    it("should init a wallet with the correct modules", async () => {
        await wallet.init(owner.address, [module1.contractAddress, module2.contractAddress], { gasLimit: 1000000 });
        let module1IsAuthorised = await wallet.authorised(module1.contractAddress);
        let module2IsAuthorised = await wallet.authorised(module2.contractAddress);
        let module3IsAuthorised = await wallet.authorised(module3.contractAddress);
        assert.equal(module1IsAuthorised, true, "module1 should be authorised");
        assert.equal(module2IsAuthorised, true, "module2 should be authorised");
        assert.equal(module3IsAuthorised, false, "module3 should not be authorised");
    });

    it("should accept ETH", async () => {
        let before = await deployer.provider.getBalance(wallet.contractAddress);
        await nonowner.sendTransaction({ to: wallet.contractAddress, value: 50000000 });
        let after = await deployer.provider.getBalance(wallet.contractAddress);
        assert.equal(after.sub(before).toNumber(), 50000000, "should have received ETH");
    });
})