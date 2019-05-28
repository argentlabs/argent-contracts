const { parseEther, formatBytes32String, bigNumberify } = require('ethers').utils;

const GuardianStorage = require("../build/GuardianStorage");
const Registry = require("../build/ModuleRegistry");

const Wallet = require("../build/BaseWallet");
const InvestManager = require("../build/InvestManager");

// Compound
const Unitroller = require("../build/Unitroller");
const PriceOracle = require("../build/SimplePriceOracle");
const PriceOracleProxy = require("../build/PriceOracleProxy");
const Comptroller = require("../build/Comptroller");
const InterestModel = require("../build/StableCoinInterestRateModel");
const CEther = require("../build/CEther");
const CErc20 = require("../build/CErc20");
const CompoundProvider = require("../build/CompoundV2Provider");
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
    let liquidityProvider = accounts[2].signer;
    let borrower = accounts[3].signer;

    let wallet, investManager, compoundProvider, compoundRegistry, token, cToken, cEther, comptroller, oracleProxy;

    before(async () => {
        deployer = manager.newDeployer();

        /* Deploy Compound V2 Architecture */

        // deploy price oracle
        const oracle = await deployer.deploy(PriceOracle); 
        // deploy comptroller
        const comptrollerProxy = await deployer.deploy(Unitroller);
        const comptrollerImpl = await deployer.deploy(Comptroller);
        await comptrollerProxy._setPendingImplementation(comptrollerImpl.contractAddress);
        await comptrollerImpl._become(comptrollerProxy.contractAddress, oracle.contractAddress, WAD.div(10), 5, false);
        comptroller = deployer.wrapDeployedContract(Comptroller, comptrollerProxy.contractAddress); 
        // deploy Interest rate model
        const interestModel = await deployer.deploy(InterestModel); 
        // deploy CEther
        cEther = await deployer.deploy(
            CEther, 
            {}, 
            comptroller.contractAddress,
            interestModel.contractAddress,
            ETH_EXCHANGE_RATE,
            formatBytes32String("Compound Ether"),
            formatBytes32String("cETH"),
            8);
        // deploy token
        token = await deployer.deploy(ERC20, {}, [infrastructure.address, liquidityProvider.address, borrower.address], 10000, 18); 
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
            18);
        // add price to Oracle
        await oracle.setUnderlyingPrice(cToken.contractAddress, WAD.div(10));
        // list cToken in Comptroller
        await comptroller._supportMarket(cEther.contractAddress);
        await comptroller._supportMarket(cToken.contractAddress);
        // deploy Price Oracle proxy
        oracleProxy = await deployer.deploy(PriceOracleProxy, {}, comptroller.contractAddress, oracle.contractAddress, cEther.contractAddress); 
        await comptroller._setPriceOracle(oracleProxy.contractAddress, {gasLimit: 200000}); 
        // set collateral factor
        await comptroller._setCollateralFactor(cToken.contractAddress, WAD.div(10));
        await comptroller._setCollateralFactor(cEther.contractAddress, WAD.div(10));

        // add liquidity to tokens
        //await cEther.from(liquidityProvider).mint({value: parseEther('10')});
        //await token.from(liquidityProvider).approve(cToken.contractAddress, parseEther('10'));
        //await cToken.from(liquidityProvider).mint(parseEther('10'));
        
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
            let cOracle = await comptroller.oracle(); 
            assert.isTrue(cOracle == oracleProxy.contractAddress, "oracle should be registered");
            let cTokenPrice = await oracleProxy.getUnderlyingPrice(cToken.contractAddress); 
            assert.isTrue(cTokenPrice.eq(WAD.div(10)), "cToken price should be 1e17");
            let cEtherPrice = await oracleProxy.getUnderlyingPrice(cEther.contractAddress); 
            assert.isTrue(cEtherPrice.eq(WAD), "cEther price should be 1e18");
        });
    });

    describe("Add investment", () => {

        async function addInvestment(tokenAddress, amount, days, relay = false) {

            let tx, txReceipt;
            let investInEth = (tokenAddress == ETH_TOKEN) ? true : false;

            if(investInEth) { 
                await infrastructure.sendTransaction({ to: wallet.contractAddress, value: amount });
            }
            else {
                await token.from(infrastructure).transfer(wallet.contractAddress, amount);
            }
            
            const params = [wallet.contractAddress, compoundProvider.contractAddress, [tokenAddress], [amount], 0];
            if(relay) { 
                txReceipt = await manager.relay(investManager, 'addInvestment', params, wallet, [owner]);
            }
            else { 
                tx = await investManager.from(owner).addInvestment(...params, {gasLimit: 300000});
                txReceipt = await investManager.verboseWaitForTransaction(tx);
            } 
            assert.isTrue(await utils.hasEvent(txReceipt, investManager, "InvestmentAdded"), "should have generated InvestmentAdded event"); 

            // genrate borrows to create interests
            await comptroller.from(borrower).enterMarkets([cEther.contractAddress, cToken.contractAddress]); 
            if(investInEth) { 
                await token.from(borrower).approve(cToken.contractAddress, parseEther('10'));
                await cToken.from(borrower).mint(parseEther('10'));
                tx = await cEther.from(borrower).borrow(parseEther('0.1')); 
                txReceipt = await cEther.verboseWaitForTransaction(tx);
                assert.isTrue(await utils.hasEvent(txReceipt, cEther, "Borrow"), "should have generated Borrow event"); 
            }
            else {
                await cEther.from(borrower).mint({value: parseEther('10')});
                tx = await cToken.from(borrower).borrow(parseEther('1'));
                txReceipt = await cToken.verboseWaitForTransaction(tx);
                assert.isTrue(await utils.hasEvent(txReceipt, cToken, "Borrow"), "should have generated Borrow event"); 
            }
            // increase time to accumulate interests
            await manager.increaseTime(3600 * 24 * days); 
            await cToken.accrueInterest();
            await cEther.accrueInterest();
            
            let output = await investManager.getInvestment(wallet.contractAddress, compoundProvider.contractAddress, tokenAddress); 
            assert.isTrue(output._tokenValue > amount, 'investment should have gained value');
            return output._tokenValue;
        }

        it('should invest in ETH for 1 year and gain interests (blockchain tx)', async () => {
            await addInvestment(ETH_TOKEN, parseEther('1'), 365, false);
        });

        it('should invest in ERC20 for 1 year and gain interests (blockchain tx)', async () => {
            await addInvestment(token.contractAddress, parseEther('1'), 365, false);
        });
    });

});