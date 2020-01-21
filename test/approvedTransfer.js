const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");
const GuardianStorage = require("../build/GuardianStorage");
const GuardianManager = require("../build/GuardianManager");
const TransferModule = require("../build/ApprovedTransfer");
const KyberNetwork = require("../build/KyberNetworkTest");
const TokenPriceProvider = require("../build/TokenPriceProvider");
const ERC20 = require("../build/TestERC20");
const TestContract = require('../build/TestContract');

const TestManager = require("../utils/test-manager");
const { sortWalletByAddress, parseRelayReceipt } = require("../utils/utilities.js");

const ETH_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const DECIMALS = 12; // number of decimal for TOKN contract
const KYBER_RATE = 51 * 10 ** 13; // 1 TOKN = 0.00051 ETH

const ZERO_BYTES32 = ethers.constants.HashZero;

describe("Test Approved Transfer", function () {
    this.timeout(10000);

    const manager = new TestManager();

    let infrastructure = accounts[0].signer;
    let owner = accounts[1].signer;
    let nonowner = accounts[2].signer;
    let guardian1 = accounts[3].signer;
    let guardian2 = accounts[4].signer;
    let guardian3 = accounts[5].signer;
    let recipient = accounts[6].signer;

    let wallet, guardianManager, transferModule, priceProvider, kyber, erc20;

    before(async () => {
        deployer = manager.newDeployer();
        const registry = await deployer.deploy(Registry);
        const guardianStorage = await deployer.deploy(GuardianStorage);
        kyber = await deployer.deploy(KyberNetwork);
        priceProvider = await deployer.deploy(TokenPriceProvider, {}, kyber.contractAddress);
        await priceProvider.addManager(infrastructure.address);
        guardianManager = await deployer.deploy(GuardianManager, {}, registry.contractAddress, guardianStorage.contractAddress, 24, 12);
        transferModule = await deployer.deploy(TransferModule, {}, registry.contractAddress, guardianStorage.contractAddress);
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [transferModule.contractAddress, guardianManager.contractAddress]);
        erc20 = await deployer.deploy(ERC20, {}, [infrastructure.address, wallet.contractAddress], 10000000, DECIMALS); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
        await kyber.addToken(erc20.contractAddress, KYBER_RATE, DECIMALS);
        await priceProvider.syncPrice(erc20.contractAddress);
        await infrastructure.sendTransaction({ to: wallet.contractAddress, value: 50000000 });
    });

    async function addGuardians(guardians) {
        // guardians can be Wallet or ContractWrapper objects
        let guardianAddresses = guardians.map(guardian => {
            if (guardian.address)
                return guardian.address;
            return guardian.contractAddress;
        });

        for (const address of guardianAddresses) {
            await guardianManager.from(owner).addGuardian(wallet.contractAddress, address, { gasLimit: 500000 });
        }

        await manager.increaseTime(30);
        for (let i = 1; i < guardianAddresses.length; i++) {
            await guardianManager.confirmGuardianAddition(wallet.contractAddress, guardianAddresses[i]);
        }
        const count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
        assert.equal(count, guardians.length, `${guardians.length} guardians should be added`);
    }

    async function createSmartContractGuardians(guardians) {
        const wallets = []
        for (g of guardians) {
            const wallet = await deployer.deploy(Wallet);
            await wallet.init(g.address, [guardianManager.contractAddress]);
            wallets.push(wallet)
        }
        return wallets
    }

    describe("Transfer approved by EOA guardians", () => {
        it('should transfer ETH with 1 confirmations for 1 guardians', async () => {
            let amountToTransfer = 10000;
            await addGuardians([guardian1])
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 1, '1 guardians should be active');
            let before = await deployer.provider.getBalance(recipient.address);
            // should succeed with one confirmation
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, guardian1]);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
        });
        it('should transfer ETH with 1 confirmations for 2 guardians', async () => {
            let amountToTransfer = 10000;
            await addGuardians([guardian1, guardian2])
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 2, '2 guardians should be active');
            let before = await deployer.provider.getBalance(recipient.address);
            // should succeed with one confirmation
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, guardian1]);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
        });
        it('should only transfer ETH with 2 confirmations for 3 guardians', async () => {
            let amountToTransfer = 10000;
            await addGuardians([guardian1, guardian2, guardian3])
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 3, '3 guardians should be active');
            let before = await deployer.provider.getBalance(recipient.address);
            // should fail with one confirmation
            let txReceipt = await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, guardian1]);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, "transfer should fail with 1 guardian confirmation");
            // should succeed with 2 confirmations
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
        });
        it('should fail to transfer ETH when signer is not a guardians', async () => {
            let amountToTransfer = 10000;
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 0, '0 guardians should be active');
            // should fail
            let txReceipt = await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, guardian1]);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, "transfer should fail when signer is not a guardian");
        });
        it('should transfer ERC20 with 1 confirmations for 1 guardians', async () => {
            let amountToTransfer = 10000;
            await addGuardians([guardian1])
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 1, '1 guardians should be active');
            let before = await erc20.balanceOf(recipient.address);
            // should succeed with one confirmation
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, guardian1]);
            let after = await erc20.balanceOf(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ERC20 amount');
        });
        it('should only transfer ERC20 with 2 confirmations for 3 guardians', async () => {
            let amountToTransfer = 10000;
            await addGuardians([guardian1, guardian2, guardian3])
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 3, '3 guardians should be active');
            let before = await erc20.balanceOf(recipient.address);
            // should fail with one confirmation
            let txReceipt = await manager.relay(transferModule, "transferToken", [wallet.contractAddress, erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, guardian1]);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, "transfer with 1 guardian signature should fail");
            // should succeed with 2 confirmations
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
            let after = await erc20.balanceOf(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ERC20 amount');
        });
    });

    describe("Transfer approved by smart-contract guardians", () => {
        it('should transfer ETH with 1 confirmations for 1 guardians', async () => {
            let amountToTransfer = 10000;
            await addGuardians(await createSmartContractGuardians([guardian1]));
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 1, '1 guardians should be active');
            let before = await deployer.provider.getBalance(recipient.address);
            // should succeed with one confirmation
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, guardian1]);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
        });
        it('should transfer ETH with 1 confirmations for 2 guardians', async () => {
            let amountToTransfer = 10000;
            await addGuardians(await createSmartContractGuardians([guardian1, guardian2]));
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 2, '2 guardians should be active');
            let before = await deployer.provider.getBalance(recipient.address);
            // should succeed with one confirmation
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, guardian1]);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
        });
        it('should only transfer ETH with 2 confirmations for 3 guardians', async () => {
            let amountToTransfer = 10000;
            await addGuardians(await createSmartContractGuardians([guardian1, guardian2, guardian3]));
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 3, '3 guardians should be active');
            let before = await deployer.provider.getBalance(recipient.address);
            // should fail with one confirmation
            let txReceipt = await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, guardian1]);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, "transfer with 1 guardian signature should fail");
            // should succeed with 2 confirmations
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
        });
        it('should transfer ERC20 with 1 confirmations for 1 guardians', async () => {
            let amountToTransfer = 10000;
            await addGuardians(await createSmartContractGuardians([guardian1]));
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 1, '1 guardians should be active');
            let before = await erc20.balanceOf(recipient.address);
            // should succeed with one confirmation
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, guardian1]);
            let after = await erc20.balanceOf(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
        });
        it('should only transfer ERC20 with 2 confirmations for 3 guardians', async () => {
            let amountToTransfer = 10000;
            await addGuardians(await createSmartContractGuardians([guardian1, guardian2, guardian3]));
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 3, '3 guardians should be active');
            let before = await erc20.balanceOf(recipient.address);
            // should fail with one confirmation
            let txReceipt = await manager.relay(transferModule, "transferToken", [wallet.contractAddress, erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, guardian1]);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, "transfer with 1 guardian signature should throw");
            // should succeed with 2 confirmations
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
            let after = await erc20.balanceOf(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ERC20 amount');
        });
    });

    describe("Transfer approved by EOA and smart-contract guardians", () => {
        it('should transfer ETH with 1 EOA guardian and 2 smart-contract guardians', async () => {
            let amountToTransfer = 10000;
            await addGuardians([guardian1, ...(await createSmartContractGuardians([guardian2, guardian3]))]);
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 3, '3 guardians should be active');
            let before = await deployer.provider.getBalance(recipient.address);
            // should succeed with 2 confirmations
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
            // should succeed with 2 confirmations
            before = after;
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, ...sortWalletByAddress([guardian1, guardian3])]);
            after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
            // should succeed with 2 confirmations
            before = after;
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, ...sortWalletByAddress([guardian2, guardian3])]);
            after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
        });
        it('should transfer ETH with 2 EOA guardian and 1 smart-contract guardians', async () => {
            let amountToTransfer = 10000;
            await addGuardians([guardian1, guardian2, ...await createSmartContractGuardians([guardian3])]);
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 3, '3 guardians should be active');
            let before = await deployer.provider.getBalance(recipient.address);
            // should succeed with 2 confirmations
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
            // should succeed with 2 confirmations
            before = after;
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, ...sortWalletByAddress([guardian1, guardian3])]);
            after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
            // should succeed with 2 confirmations
            before = after;
            await manager.relay(transferModule, "transferToken", [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner, ...sortWalletByAddress([guardian2, guardian3])]);
            after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
        });
    });

    describe("Transfer with data approved by EOA and smart-contract guardians", () => {

        let contract, dataToTransfer;

        beforeEach(async () => {
            contract = await deployer.deploy(TestContract);
            assert.equal(await contract.state(), 0, "initial contract state should be 0");
        });

        it('should call a contract and transfer ETH with 1 EOA guardian and 2 smart-contract guardians', async () => {
            let amountToTransfer = 10000;
            await addGuardians([guardian1, ...(await createSmartContractGuardians([guardian2, guardian3]))]);
            let count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 3, '3 guardians should be active');
            let before = await deployer.provider.getBalance(contract.contractAddress);
            // should succeed with 2 confirmations
            dataToTransfer = contract.contract.interface.functions['setState'].encode([2]);
            let txReceipt = await manager.relay(transferModule, "callContract", [wallet.contractAddress, contract.contractAddress, amountToTransfer, dataToTransfer], wallet, [owner, ...sortWalletByAddress([guardian1, guardian2])]);
            let after = await deployer.provider.getBalance(contract.contractAddress);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
            assert.equal((await contract.state()).toNumber(), 2, 'the state of the external contract should have been changed');
            // should succeed with 2 confirmations
            before = after;
            dataToTransfer = contract.contract.interface.functions['setState'].encode([3]);
            await manager.relay(transferModule, "callContract", [wallet.contractAddress, contract.contractAddress, amountToTransfer, dataToTransfer], wallet, [owner, ...sortWalletByAddress([guardian1, guardian3])]);
            after = await deployer.provider.getBalance(contract.contractAddress);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
            assert.equal((await contract.state()).toNumber(), 3, 'the state of the external contract should have been changed');
            // should succeed with 2 confirmations
            before = after;
            dataToTransfer = contract.contract.interface.functions['setState'].encode([4]);
            await manager.relay(transferModule, "callContract", [wallet.contractAddress, contract.contractAddress, amountToTransfer, dataToTransfer], wallet, [owner, ...sortWalletByAddress([guardian2, guardian3])]);
            after = await deployer.provider.getBalance(contract.contractAddress);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the ETH amount');
            assert.equal((await contract.state()).toNumber(), 4, 'the state of the external contract should have been changed');
        });
    });

});