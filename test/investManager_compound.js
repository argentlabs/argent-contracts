const { parseEther, formatBytes32String, bigNumberify } = require('ethers').utils;

const GuardianStorage = require("../build/GuardianStorage");
const Registry = require("../build/ModuleRegistry");

const Wallet = require("../build/BaseWallet");
const InvestManager = require("../build/InvestManager");

// Compound
const Unitroller = require("../build/Unitroller");
const PriceOracle = require("../build/SimplePriceOracle");
const Comptroller = require("../build/Comptroller");
const InterestModel = require("../build/StableCoinInterestRateModel");
const CEther = require("../build/CEther");
const CErc20 = require("../build/CErc20");
const CompoundProvider = require("../build/CompoundV2");
const CompoundRegistry = require("../build/CompoundRegistry");

const WAD = bigNumberify('1000000000000000000') // 10**18
const ETH_EXCHANGE_RATE = bigNumberify('200000000000000000000000000');


const ERC20 = require("../build/TestERC20");
const ETH_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const TestManager = require("../utils/test-manager");

describe("Invest Manager with Compound", function () {
    this.timeout(1000000);

    const manager = new TestManager(accounts, 'ganache');

    let infrastructure = accounts[0].signer;
    let owner = accounts[1].signer;

    let wallet, investManager, compoundProvider, compoundRegistry, token, cToken, cEther;

    before(async () => {
        deployer = manager.newDeployer();

        /* Deploy Compound V2 Architecture */

        // deploy Interest rate model
        const interestModel = await deployer.deploy(InterestModel); 
        // deploy price oracle
        const oracle = await deployer.deploy(PriceOracle);
        // deploy comptroller proxy
        const comptrollerProxy = await deployer.deploy(Unitroller);
        // deploy comptroller implementation
        const comptrollerImpl = await deployer.deploy(Comptroller);
        // set implementation for proxy
        await comptrollerProxy._setPendingImplementation(comptrollerImpl.contractAddress);
        // configure comptroller
        await comptrollerImpl._become(comptrollerProxy.contractAddress, oracle.contractAddress, bigNumberify('500000000000000000'), 14, false);
        const comptroller = deployer.wrapDeployedContract(Comptroller, comptrollerProxy.contractAddress);
        await comptroller._setLiquidationIncentive(bigNumberify('1050000000000000000'), {gasLimit: 150000});
        // deploy token
        token = await deployer.deploy(ERC20, {}, [infrastructure.address], 10000, 18); 
        // deploy CEther
        cEther = await deployer.deploy(
            CEther, 
            {}, 
            comptroller.contractAddress,
            interestModel.contractAddress,
            ETH_EXCHANGE_RATE,
            formatBytes32String("Compound Ether"),
            formatBytes32String("cETH"),
            8
            );
        await cEther._setReserveFactor(parseEther('1'));
        // deploy CToken
        cToken = await deployer.deploy(
            CErc20, 
            {}, 
            token.contractAddress,
            comptroller.contractAddress,
            interestModel.contractAddress,
            ETH_EXCHANGE_RATE,
            "Compound Token",
            "cTOKEN",
            18
            );
        await cToken._setReserveFactor(parseEther('1'));
        // add CTokens to comptroller
        await comptroller._supportMarket(cEther.contractAddress);
        await comptroller._supportMarket(cToken.contractAddress);
        // set underlying price
        await oracle.setUnderlyingPrice(cToken.contractAddress, WAD.mul(10));
        
        /* Deploy Argent Architecture */

        compoundProvider = await deployer.deploy(CompoundProvider);
        compoundRegistry = await deployer.deploy(CompoundRegistry);
        await compoundRegistry.addCToken(ETH_TOKEN, cEther.contractAddress);
        await compoundRegistry.addCToken(token.contractAddress, cToken.contractAddress);
        const registry = await deployer.deploy(Registry);
        const guardianStorage = await deployer.deploy(GuardianStorage);
        investManager = await deployer.deploy(InvestManager, {}, registry.contractAddress, guardianStorage.contractAddress);
        await investManager.addProvider(compoundProvider.contractAddress, [comptroller.contractAddress, compoundRegistry.contractAddress]);
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [investManager.contractAddress]);
    });

    describe("Environment", () => {
        it('should deploy the environment correctly', async () => {
            let getCToken = await compoundRegistry.getCToken(token.contractAddress);
            assert.isTrue(getCToken == cToken.contractAddress, "cToken should be registered");
            let getCEther = await compoundRegistry.getCToken(ETH_TOKEN);
            assert.isTrue(getCEther == cEther.contractAddress, "cEther should be registered");
        });
    });

    describe("Add investment", () => {

        async function addInvestment(tokenAddress, amount, days, relay = false) {
            
            let txReceipt;
            const params = [wallet.contractAddress, compoundProvider.contractAddress, [tokenAddress], [amount], 0];
            if(relay) {
                txReceipt = await manager.relay(investManager, 'addInvestment', params, wallet, [owner]);
            }
            else {
                const tx = await investManager.from(owner).addInvestment(...params, {gasLimit: 300000});
                txReceipt = await investManager.verboseWaitForTransaction(tx);
            }

            assert.isTrue(await utils.hasEvent(txReceipt, investManager, "InvestmentAdded"), "should have generated InvestmentAdded event");

            // wait period and update interests
            await manager.increaseTime(3600 * 24 * days); 
            await cToken.accrueInterest();
            await cEther.accrueInterest();
            let bal = await cToken.balanceOf(wallet.contractAddress); console.log(bal);
            let output = await investManager.getInvestment(wallet.contractAddress, compoundProvider.contractAddress, tokenAddress); console.log(output);
            assert.isTrue(output._tokenValue > amount, 'investment should have gained value');
            return output._tokenValue;
        }

        it('should invest in ERC20 for 1 year and gain interests (blockchain tx)', async () => {
            await addInvestment(token.contractAddress, parseEther('1'), 365, false);
        });
    });

});