const etherlime = require('etherlime-lib');
const Wallet = require("../build/BaseWallet");
const ModuleRegistry = require("../build/ModuleRegistry");
const UniswapFactory = require("../contracts/test/uniswap/UniswapFactory");
const UniswapExchange = require("../contracts/test/uniswap/UniswapExchange");
const UniswapManager = require("../build/UniswapManager");
const GuardianStorage = require("../build/GuardianStorage");
const ERC20 = require("../build/TestERC20");
const TestManager = require("../utils/test-manager");
const { parseEther, bigNumberify } = require('ethers').utils;

describe("Invest Manager with Uniswap", function () {
    this.timeout(1000000);

    const manager = new TestManager();

    let infrastructure = accounts[0].signer;
    let owner = accounts[1].signer;

    let wallet, uniswapFactory, investManager, token;

    before(async () => {
        deployer = manager.newDeployer();
        // deploy Uniswap contracts
        uniswapFactory = await deployer.deploy(UniswapFactory);
        const uniswapTemplateExchange = await deployer.deploy(UniswapExchange);
        await uniswapFactory.initializeFactory(uniswapTemplateExchange.contractAddress);
        // deploy Argent contracts
        const registry = await deployer.deploy(ModuleRegistry);
        const guardianStorage = await deployer.deploy(GuardianStorage);
        investManager = await deployer.deploy(
            UniswapManager,
            {},
            registry.contractAddress,
            guardianStorage.contractAddress,
            uniswapFactory.contractAddress);
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [investManager.contractAddress]);
        token = await deployer.deploy(ERC20, {}, [infrastructure.address], 10000, 18);
    });

    async function testCreatePool(initialEthLiquidity, initialTokenPrice) {
        let initialTokenAmount = initialEthLiquidity.mul(initialTokenPrice);
        await uniswapFactory.from(infrastructure).createExchange(token.contractAddress);
        const exchangeAddress = await uniswapFactory.getExchange(token.contractAddress);
        const liquidityPool = await etherlime.ContractAt(UniswapExchange, exchangeAddress);
        await token.from(infrastructure).approve(liquidityPool.contractAddress, initialTokenAmount);
        const currentBlock = await manager.getCurrentBlock();
        const timestamp = await manager.getTimestamp(currentBlock);
        await liquidityPool.from(infrastructure).addLiquidity(1, initialTokenAmount, timestamp + 300, { value: initialEthLiquidity, gasLimit: 150000 });
        const totalSupply = await liquidityPool.totalSupply();
        const shares = await liquidityPool.balanceOf(infrastructure.address);
        assert.isTrue(totalSupply.eq(initialEthLiquidity));
        assert.isTrue(shares.eq(totalSupply));
        return liquidityPool;
    };

    async function addInvestment(ethLiquidity, tokenPrice, amount, relay = false) {

        let ethBefore = await deployer.provider.getBalance(wallet.contractAddress);
        let tokenBefore = await token.balanceOf(wallet.contractAddress);
        let pool = await testCreatePool(ethLiquidity, tokenPrice);

        let txReceipt;
        const params = [wallet.contractAddress, token.contractAddress, amount, 0];
        if (relay) {
            txReceipt = await manager.relay(investManager, 'addInvestment', params, wallet, [owner]);
        }
        else {
            const tx = await investManager.from(owner).addInvestment(...params, { gasLimit: 300000 });
            txReceipt = await investManager.verboseWaitForTransaction(tx);
        }
        assert.isTrue(await utils.hasEvent(txReceipt, investManager, "InvestmentAdded"), "should have generated InvestmentAdded event");

        let shares = await pool.balanceOf(wallet.contractAddress);
        let ethAfter = await deployer.provider.getBalance(wallet.contractAddress);
        let tokenAfter = await token.balanceOf(wallet.contractAddress);

        assert.isTrue(shares.gt(0), "should have received shares");
        assert.isTrue(tokenAfter - tokenBefore.sub(amount) <= tokenPrice, "Should have invested the correct amount of tokens");
        assert.isTrue(ethAfter - ethBefore.sub(amount.div(tokenPrice)) <= tokenPrice, "Should have taken the correct amount of ETH");

        return [pool, shares];
    };

    async function removeInvestment(investedAmount, fraction, relay = false) {

        let ethLiquidity = parseEther('0.1');
        let tokenPrice = 3;

        await infrastructure.sendTransaction({ to: wallet.contractAddress, value: investedAmount });
        await token.from(infrastructure).transfer(wallet.contractAddress, investedAmount);
        let result = await addInvestment(ethLiquidity, tokenPrice, investedAmount, 0);
        let sharesBefore = result[1];

        let txReceipt;
        const params = [wallet.contractAddress, token.contractAddress, fraction];
        if (relay) {
            txReceipt = await manager.relay(investManager, 'removeInvestment', params, wallet, [owner]);
        }
        else {
            const tx = await investManager.from(owner).removeInvestment(...params, { gasLimit: 300000 });
            txReceipt = await investManager.verboseWaitForTransaction(tx);
        }
        assert.isTrue(await utils.hasEvent(txReceipt, investManager, "InvestmentRemoved"), "should have generated InvestmentRemoved event");

        let sharesAfter = await result[0].balanceOf(wallet.contractAddress);
        assert.isTrue(sharesAfter.sub(sharesBefore.mul(10000 - fraction).div(10000)) <= 1, "should have sold the correct amount of shares");
    }

    describe("Basic framework", () => {
        it('should create a liquidity pool with the correct supply', async () => {
            await testCreatePool(bigNumberify('10000000000000000'), 2);
        });
    });

    describe("Add investment", () => {

        function testInvestWithRandomParameters(ethLiquidity, tokenPrice, amount, relay) {
            it(`should successfully invest ${amount} tokens with ETH liquidity ${ethLiquidity} and token/ETH price of ${tokenPrice} (${relay ? "relay" : "blockchain"} tx)`, async () => {
                await infrastructure.sendTransaction({ to: wallet.contractAddress, value: parseEther('1') });
                await token.from(infrastructure).transfer(wallet.contractAddress, amount);
                await addInvestment(ethLiquidity, tokenPrice, amount, relay);
            })
        }

        for (i = 0; i < 10; i++) {
            let ethLiquidity = parseEther('0.1').add(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1);
            let tokenPrice = Math.floor(Math.random() * 100) + 1;
            let amount = parseEther('0.001').add(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1);
            testInvestWithRandomParameters(ethLiquidity, tokenPrice, amount, false);
            testInvestWithRandomParameters(ethLiquidity, tokenPrice, amount, true);
        }

        it('should successfully invest when the user has not enough tokens but enough ETH (blockchain tx)', async () => {
            let tokens = parseEther('0.001');
            await token.from(infrastructure).transfer(wallet.contractAddress, tokens);
            await infrastructure.sendTransaction({ to: wallet.contractAddress, value: parseEther('1') });
            await addInvestment(parseEther('1'), 2, tokens.div(2), 0, false);
        });

        it('should successfully invest when the user has not enough tokens but enough ETH (relay tx)', async () => {
            let tokens = parseEther('0.001');
            await token.from(infrastructure).transfer(wallet.contractAddress, tokens);
            await infrastructure.sendTransaction({ to: wallet.contractAddress, value: parseEther('1') });
            await addInvestment(parseEther('1'), 2, tokens.div(2), 0, true);
        });

        it('should fail to invest when the user has enough tokens but not enough ETH (blockchain tx)', async () => {
            let tokens = parseEther('0.001');
            await token.from(infrastructure).transfer(wallet.contractAddress, tokens);
            await infrastructure.sendTransaction({ to: wallet.contractAddress, value: parseEther('0.0000001') });
            await assert.revert(addInvestment(parseEther('1'), 2, tokens, 0, false), "should revert");
        });

        it('should fail to invest when the user has enough tokens but not enough ETH (relay tx)', async () => {
            let tokens = parseEther('0.001');
            await token.from(infrastructure).transfer(wallet.contractAddress, tokens);
            await infrastructure.sendTransaction({ to: wallet.contractAddress, value: parseEther('0.0000001') });
            await assert.revert(addInvestment(parseEther('1'), 2, tokens, 0, true), "should revert");
        });

        it('should fail to invest when the user has not enough tokens and not enough ETH (blockchain tx)', async () => {
            let tokens = parseEther('0.001');
            await token.from(infrastructure).transfer(wallet.contractAddress, tokens);
            await infrastructure.sendTransaction({ to: wallet.contractAddress, value: parseEther('0.0000001') });
            await assert.revert(addInvestment(parseEther('1'), 2, tokens.div(2), 0, false), "should revert");
        });

        it('should fail to invest when the user has not enough tokens and not enough ETH (relay tx)', async () => {
            let tokens = parseEther('0.001');
            await token.from(infrastructure).transfer(wallet.contractAddress, tokens);
            await infrastructure.sendTransaction({ to: wallet.contractAddress, value: parseEther('0.0000001') });
            await assert.revert(addInvestment(parseEther('1'), 2, tokens.div(2), 0, true), "should revert");
        });
    });

    describe("Remove investment", () => {

        function testRemoveInvestment(investedAmount, fraction, relay) {
            it(`should remove ${fraction / 100} % of an investment of ${investedAmount} tokens (${relay ? "relay" : "blockchain"} tx)`, async () => {
                await removeInvestment(investedAmount, fraction);
            });
        }

        for (i = 0; i < 10; i++) {
            let investedAmount = parseEther('0.0001').mul(Math.floor(Math.random() * 1000) + 1);
            let fraction = (i + 1) * 1000;
            testRemoveInvestment(investedAmount, fraction, false);
            testRemoveInvestment(investedAmount, fraction, true);
        }
    });

});