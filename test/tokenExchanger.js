const Wallet = require("../build/BaseWallet");
const ModuleRegistry = require("../build/ModuleRegistry");
const KyberNetwork = require("../build/KyberNetworkTest");
const GuardianStorage = require("../build/GuardianStorage");
const TokenExchanger = require("../build/TokenExchanger");
const ERC20 = require("../build/TestERC20");

const ETH_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const DECIMALS = 12; // number of decimal for TOKN contract
const KYBER_RATE = 51 * 10 ** 13; // 1 TOKN = 0.00051 ETH
const FEE_RATIO = 30;

const TestManager = require("../utils/test-manager");

describe("Test Token Exchanger", function () {
    this.timeout(10000);

    const manager = new TestManager();

    let infrastructure = accounts[0].signer;
    let owner = accounts[1].signer;
    let collector = accounts[2].signer;

    let wallet, kyber, exchanger;

    before(async () => {
        deployer = manager.newDeployer();
        const registry = await deployer.deploy(ModuleRegistry);
        kyber = await deployer.deploy(KyberNetwork);
        const guardianStorage = await deployer.deploy(GuardianStorage);
        exchanger = await deployer.deploy(TokenExchanger, {}, registry.contractAddress, guardianStorage.contractAddress, kyber.contractAddress, collector.address, FEE_RATIO);
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [exchanger.contractAddress]);
        erc20 = await deployer.deploy(ERC20, {}, [kyber.contractAddress, wallet.contractAddress], 10000000, DECIMALS); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for kyber)
        await kyber.addToken(erc20.contractAddress, KYBER_RATE, DECIMALS);
        await infrastructure.sendTransaction({ to: wallet.contractAddress, value: 50000000 });
        await infrastructure.sendTransaction({ to: kyber.contractAddress, value: 50000000 });
    });

    describe("Expected Trade for token ", () => {
        it('should get the correct fee', async () => {
            let srcAmount = 10000;
            let rate = await exchanger.getExpectedTrade(ETH_TOKEN, erc20.contractAddress, srcAmount);
            let fee = ethers.utils.bigNumberify(rate[1]).toNumber();
            assert.equal(fee, srcAmount * FEE_RATIO / 10000, "rate should be correct");
        });
    });

    describe("Trade token ", () => {
        it('should receive the correct amount of destination tokens (blockchain tx)', async () => {
            const srcAmount = 10000;
            const beforeERC20 = await erc20.balanceOf(wallet.contractAddress);
            const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
            assert.isTrue(beforeETH.gte(srcAmount), "wallet should have enough ether");

            const tx = await exchanger.from(owner).trade(
                wallet.contractAddress,
                ETH_TOKEN,
                srcAmount,
                erc20.contractAddress,
                ethers.utils.bigNumberify('10000000000000000000000'),
                0,
                { gasLimit: 200000 }
            );
            const txReceipt = await exchanger.verboseWaitForTransaction(tx);
            const destAmount = txReceipt.events.find(log => log.event === "TokenExchanged").args["destAmount"];
            const afterERC20 = await erc20.balanceOf(wallet.contractAddress)
            const afterETH = await deployer.provider.getBalance(wallet.contractAddress);

            assert.isTrue(afterERC20.sub(beforeERC20).eq(destAmount), "should receive the tokens");
            assert.isTrue(beforeETH.sub(afterETH).eq(srcAmount), "should send the ether");
        });

        it('should receive the correct amount of destination tokens (relayed tx)', async () => {
            const srcAmount = 10000;
            const beforeERC20 = await erc20.balanceOf(wallet.contractAddress);
            const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
            assert.isTrue(beforeETH.gte(srcAmount), "wallet should have enough ether");

            const txReceipt = await manager.relay(exchanger, 'trade', [
                wallet.contractAddress,
                ETH_TOKEN,
                srcAmount,
                erc20.contractAddress,
                '10000000000000000000000',
                0
            ], wallet, [owner]);
            const destAmount = txReceipt.events.find(log => log.event === "TokenExchanged").args["destAmount"];
            const afterERC20 = await erc20.balanceOf(wallet.contractAddress)
            const afterETH = await deployer.provider.getBalance(wallet.contractAddress);

            assert.isTrue(afterERC20.sub(beforeERC20).eq(destAmount), "should receive the tokens");
            assert.isTrue(beforeETH.sub(afterETH).eq(srcAmount), "should send the ether");
        });

        it('should receive the correct amount of destination ether (blockchain tx)', async () => {
            const srcAmount = 100;
            const beforeERC20 = await erc20.balanceOf(wallet.contractAddress);
            const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
            assert.isTrue(beforeERC20.gte(srcAmount), "wallet should have enough ERC20");

            const tx = await exchanger.from(owner).trade(
                wallet.contractAddress,
                erc20.contractAddress,
                srcAmount,
                ETH_TOKEN,
                '10000000000000000000000',
                0
            );
            const txReceipt = await exchanger.verboseWaitForTransaction(tx);
            const destAmount = txReceipt.events.find(log => log.event === "TokenExchanged").args["destAmount"];
            const afterERC20 = await erc20.balanceOf(wallet.contractAddress)
            const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
            assert.isTrue(beforeERC20.sub(afterERC20).eq(srcAmount), "should send the tokens");
            assert.isTrue(afterETH.sub(beforeETH).eq(destAmount), "should receive the ether");
        });

        it('should receive the correct amount of destination ether (relayed tx)', async () => {
            const srcAmount = 100;
            const beforeERC20 = await erc20.balanceOf(wallet.contractAddress);
            const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
            assert.isTrue(beforeERC20.gte(srcAmount), "wallet should have enough ERC20");

            const txReceipt = await manager.relay(exchanger, 'trade', [
                wallet.contractAddress,
                erc20.contractAddress,
                srcAmount,
                ETH_TOKEN,
                '10000000000000000000000',
                0,
            ], wallet, [owner]);
            const destAmount = txReceipt.events.find(log => log.event === "TokenExchanged").args["destAmount"];
            const afterERC20 = await erc20.balanceOf(wallet.contractAddress)
            const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
            assert.isTrue(beforeERC20.sub(afterERC20).eq(srcAmount), "should send the tokens");
            assert.isTrue(afterETH.sub(beforeETH).eq(destAmount), "should receive the ether");
        });
    });

});