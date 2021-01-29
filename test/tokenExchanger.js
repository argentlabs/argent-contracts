/* global artifacts */

const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));

// Paraswap
const AugustusSwapper = artifacts.require("AugustusSwapper");
const Whitelisted = artifacts.require("Whitelisted");
const PartnerRegistry = artifacts.require("PartnerRegistry");
const PartnerDeployer = artifacts.require("PartnerDeployer");
const Kyber = artifacts.require("Kyber");
const UniswapV2 = artifacts.require("UniswapV2");

// Kyber
const KyberNetwork = artifacts.require("KyberNetworkTest");

// UniswapV2
const UniswapV2Factory = artifacts.require("UniswapV2Factory");
const UniswapV2Router01 = artifacts.require("UniswapV2Router01");
const WETH = artifacts.require("WETH9");

// Argent
const DexRegistry = artifacts.require("DexRegistry");
const ERC20 = artifacts.require("TestERC20");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
const IWallet = artifacts.require("IWallet");
const DelegateProxy = artifacts.require("DelegateProxy");

// Utils
const { setupWalletVersion } = require("../utils/wallet_definition.js");
const { makePathes } = require("../utils/paraswap/sell-helper");
const { makeRoutes } = require("../utils/paraswap/buy-helper");
const { ETH_TOKEN } = require("../utils/utilities.js");
const utils = require("../utils/utilities.js");
const RelayManager = require("../utils/relay-manager");

// Constants
const DECIMALS = 18; // number of decimal for TOKEN_A, TOKEN_B contracts
const TOKEN_A_RATE = web3.utils.toWei("0.06");
const TOKEN_B_RATE = web3.utils.toWei("0.03");

contract("TokenExchanger", (accounts) => {
  const manager = new RelayManager();
  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian = accounts[2];

  let wallet;
  let registry;
  let dexRegistry;
  let relayerManager;
  let kyberNetwork;
  let kyberAdapter;
  let uniswapRouter;
  let uniswapV2Adapter;
  let tokenA;
  let tokenB;
  let paraswap;
  let tokenPriceRegistry;

  before(async () => {
    tokenPriceRegistry = await TokenPriceRegistry.new();
    dexRegistry = await DexRegistry.new();

    // Deploy test tokens
    tokenA = await ERC20.new([infrastructure], web3.utils.toWei("1000"), DECIMALS);
    tokenB = await ERC20.new([infrastructure], web3.utils.toWei("1000"), DECIMALS);

    // Deploy and fund Kyber
    kyberNetwork = await KyberNetwork.new();
    await tokenA.mint(kyberNetwork.address, web3.utils.toWei("1000"));
    await tokenB.mint(kyberNetwork.address, web3.utils.toWei("1000"));
    await kyberNetwork.addToken(tokenA.address, TOKEN_A_RATE, DECIMALS);
    await kyberNetwork.addToken(tokenB.address, TOKEN_B_RATE, DECIMALS);
    await kyberNetwork.send(web3.utils.toWei("10").toString());

    // Deploy and fund UniswapV2
    const uniswapFactory = await UniswapV2Factory.new(ethers.constants.AddressZero);
    const weth = await WETH.new();
    uniswapRouter = await UniswapV2Router01.new(uniswapFactory.address, weth.address);
    await tokenA.approve(uniswapRouter.address, web3.utils.toWei("300"));
    await tokenB.approve(uniswapRouter.address, web3.utils.toWei("600"));
    const timestamp = await utils.getTimestamp();
    await uniswapRouter.addLiquidity(
      tokenA.address,
      tokenB.address,
      web3.utils.toWei("300"),
      web3.utils.toWei("600"),
      1,
      1,
      infrastructure,
      timestamp + 300,
    );

    // Deploy Paraswap
    const whitelist = await Whitelisted.new();
    const partnerDeployer = await PartnerDeployer.new();
    const partnerRegistry = await PartnerRegistry.new(partnerDeployer.address);
    paraswap = await AugustusSwapper.new(
      whitelist.address,
      infrastructure,
      partnerRegistry.address,
      infrastructure,
      infrastructure,
    );
    kyberAdapter = await Kyber.new(infrastructure);
    uniswapV2Adapter = await UniswapV2.new(weth.address);
    await whitelist.addWhitelisted(kyberAdapter.address);
    await whitelist.addWhitelisted(uniswapV2Adapter.address);

    await tokenPriceRegistry.setTradableForTokenList([tokenA.address, tokenB.address], [true, true]);
    await dexRegistry.setAuthorised([kyberAdapter.address, uniswapV2Adapter.address], [true, true]);

    // Wire all modules in wallet version
    const modules = await setupWalletVersion({
      tokenPriceRegistry: tokenPriceRegistry.address,
      wethToken: weth.address,
      dexRegistry: dexRegistry.address,
      paraswap: paraswap.address 
    });
    registry = modules.registry;
    relayerManager = modules.relayerManager;
    await manager.setRelayerManager(relayerManager);
  });

  beforeEach(async () => {
    // create wallet
    const proxy = await DelegateProxy.new(registry.address, owner, guardian);
    wallet = await IWallet.at(proxy.address);

    // fund wallet
    await wallet.send(web3.utils.toWei("0.1"));
    await tokenA.mint(wallet.address, web3.utils.toWei("1000"));
    await tokenB.mint(wallet.address, web3.utils.toWei("1000"));
  });

  async function getBalance(tokenAddress, _wallet) {
    let balance;
    if (tokenAddress === ETH_TOKEN) {
      balance = await utils.getBalance(_wallet.address);
    } else if (tokenAddress === tokenA.address) {
      balance = await tokenA.balanceOf(_wallet.address);
    } else {
      balance = await tokenB.balanceOf(_wallet.address);
    }
    return balance;
  }

  function getRoutes({
    fromToken, toToken, srcAmount, destAmount, minConversionRateForBuy = "1",
  }) {
    const exchange = [toToken, fromToken].includes(ETH_TOKEN) ? "kyber" : "uniswapV2";
    const payload = exchange === "kyber" ? { minConversionRateForBuy } : {
      path: [
        fromToken,
        toToken,
      ],
    };
    const routes = [
      {
        exchange,
        percent: "100",
        srcAmount: srcAmount.toString(),
        destAmount: destAmount.toString(),
        data: {
          tokenFrom: fromToken,
          tokenTo: toToken,
          ...payload,
        },
      },
    ];
    return routes;
  }

  function buildPathes({ fromToken, toToken, srcAmount, destAmount }) {
    const routes = getRoutes({ fromToken, toToken, srcAmount, destAmount });
    const exchanges = { kyber: kyberAdapter.address, uniswapv2: uniswapV2Adapter.address };
    const targetExchanges = { kyber: kyberNetwork.address, uniswapv2: uniswapRouter.address };
    return makePathes(fromToken, toToken, routes, exchanges, targetExchanges, false);
  }

  function buildRoutes({ fromToken, toToken, srcAmount, destAmount }) {
    const routes = getRoutes({ fromToken, toToken, srcAmount, destAmount });
    const exchanges = { kyber: kyberAdapter.address, uniswapv2: uniswapV2Adapter.address };
    const targetExchanges = { kyber: kyberNetwork.address, uniswapv2: uniswapRouter.address };
    return makeRoutes(fromToken, toToken, routes, exchanges, targetExchanges);
  }

  function getParams({ method, fromToken, toToken, fixedAmount, variableAmount, expectedDestAmount = "123" }) {
    let routes;
    let srcAmount;
    let destAmount;
    if (method === "sell") {
      srcAmount = fixedAmount;
      destAmount = variableAmount;
      routes = buildPathes({
        fromToken, toToken, srcAmount, destAmount,
      });
    } else if (method === "buy") {
      srcAmount = variableAmount;
      destAmount = fixedAmount;
      routes = buildRoutes({
        fromToken, toToken, srcAmount, destAmount,
      });
    } else {
      throw new Error("Unsupported method:", method);
    }
    const params = [fromToken, toToken, srcAmount.toString(), destAmount.toString(), expectedDestAmount, routes, 0];
    return params;
  }

  async function testTrade({ method, fromToken, toToken, relayed = true }) {
    const beforeFrom = await getBalance(fromToken, wallet);
    const beforeTo = await getBalance(toToken, wallet);
    const fixedAmount = web3.utils.toWei("0.01");
    const variableAmount = method === "sell" ? 1 : beforeFrom;

    // wallet should have enough of fromToken
    if (method === "sell") { expect(beforeFrom).to.be.gte.BN(fixedAmount); }

    const params = getParams({
      method,
      fromToken,
      toToken,
      fixedAmount, // srcAmount for sell; destAmount for buy
      variableAmount // destAmount for sell; srcAmount for buy
    });

    let txR;
    if (relayed) {
      txR = await manager.relay(wallet, method, params, [owner]);
      const event = await utils.getEvent(txR, wallet, "TransactionExecuted");
      assert.isTrue(event.args.success, "Relayed tx should succeed");
    } else {
      const calldata = await wallet.contract.methods[method](...params).encodeABI();
      const tx = await wallet.sendTransaction({ data: calldata, gasLimit: 2000000, from: owner });
      txR = tx.receipt;
    }

    const event = await utils.getEvent(txR, wallet, "TokenExchanged");
    const { destAmount } = event.args;

    const afterFrom = await getBalance(fromToken, wallet);
    const afterTo = await getBalance(toToken, wallet);

    if (method === "sell") {
      // should send the exact amount of fromToken
      expect(beforeFrom.sub(afterFrom)).to.eq.BN(fixedAmount);
      // should receive some toToken
      expect(afterTo).to.be.gt.BN(beforeTo);
      // should receive more toToken than minimum specified
      expect(destAmount).to.be.gte.BN(variableAmount);
    }
    if (method === "buy") {
      // should send some fromToken
      expect(beforeFrom).to.be.gt.BN(afterFrom);
      // should receive the exact amount of toToken
      expect(afterTo.sub(beforeTo)).to.eq.BN(fixedAmount);
      // destAmount should be the requested amount of toToken
      expect(destAmount).to.eq.BN(fixedAmount);
    }
  }

  function testsForMethod(method) {
    it("trades ETH to ERC20 (blockchain tx)", async () => {
      await testTrade({ method, fromToken: ETH_TOKEN, toToken: tokenA.address, relayed: false });
    });
    it("trades ETH to ERC20 (relayed tx)", async () => {
      await testTrade({ method, fromToken: ETH_TOKEN, toToken: tokenA.address, relayed: true });
    });
    it("trades ERC20 to ETH (blockchain tx)", async () => {
      await testTrade({ method, fromToken: tokenA.address, toToken: ETH_TOKEN, relayed: false });
    });
    it.skip("trades ERC20 to ETH (relayed tx)", async () => {
      await testTrade({ method, fromToken: tokenA.address, toToken: ETH_TOKEN, relayed: true });
    });
    it("trades ERC20 to ERC20 (blockchain tx)", async () => {
      await testTrade({ method, fromToken: tokenA.address, toToken: tokenB.address, relayed: false });
    });
    it.skip("trades ERC20 to ERC20 (relayed tx)", async () => {
      await testTrade({ method, fromToken: tokenA.address, toToken: tokenB.address, relayed: true });
    });

    it("can exclude non tradable tokens", async () => {
      const fromToken = tokenA.address;
      const toToken = tokenB.address;
      const fixedAmount = web3.utils.toWei("0.01");
      const variableAmount = method === "sell" ? "1" : await getBalance(fromToken, wallet);
      const params = getParams({
        method,
        fromToken,
        toToken,
        fixedAmount,
        variableAmount,
      });
      await tokenPriceRegistry.setTradableForTokenList([toToken], [false]);
      await truffleAssert.reverts(wallet[method](...params, { gasLimit: 2000000, from: owner }), "TE: Token not tradable");
      await tokenPriceRegistry.setTradableForTokenList([toToken], [true]);
    });

    it("can exclude exchanges", async () => {
      const fromToken = tokenA.address;
      const toToken = tokenB.address;
      // whitelist no exchange
      await dexRegistry.setAuthorised([kyberAdapter.address, uniswapV2Adapter.address], [false, false]);
      const fixedAmount = web3.utils.toWei("0.01");
      const variableAmount = method === "sell" ? "1" : await getBalance(fromToken, wallet);
      const params = getParams({
        method,
        fromToken,
        toToken,
        fixedAmount,
        variableAmount,
      });
      await truffleAssert.reverts(wallet[method](...params, { gasLimit: 2000000, from: owner }), "DR: Unauthorised DEX");
      // reset whitelist
      await dexRegistry.setAuthorised([kyberAdapter.address, uniswapV2Adapter.address], [true, true]);
    });

    const testTradeWithPreExistingAllowance = async (allowance) => {
      const spender = await paraswap.getTokenTransferProxy();
      await wallet.approveToken(tokenA.address, spender, allowance, { from: owner });
      // call sell
      await testTrade({ method, fromToken: tokenA.address, toToken: ETH_TOKEN, relayed: false });
      // check that the pre-existing allowance is restored
      const newAllowance = await tokenA.allowance(wallet.address, spender);
      expect(newAllowance).to.eq.BN(allowance);
    };

    it(`calls ${method} successfully with a pre-existing allowance`, async () => {
      // Make the wallet grant some non-zero allowance to the Paraswap proxy
      await testTradeWithPreExistingAllowance(3);
    });

    it(`calls ${method} successfully with a pre-existing infinite allowance`, async () => {
      // Make the wallet grant an infinite allowance to the Paraswap proxy
      const infiniteAllowance = new BN(2).pow(new BN(256)).subn(1);
      await testTradeWithPreExistingAllowance(infiniteAllowance);
    });
  }

  describe("Sell", () => testsForMethod("sell"));
  describe("Buy", () => testsForMethod("buy"));

  describe("Relayed trades with refunds", () => {
    it("should be able to swap ETH for ERC20 (relayed tx)", async () => {
      await wallet.send("100000000000000");
      const beforeFrom = await utils.getBalance(wallet.address);
      const beforeTo = await tokenB.balanceOf(wallet.address);
      const srcAmount = web3.utils.toWei("0.01"); // _srcAmount
      const destAmount = 1; //_minDestAmount

      // wallet should have enough of tokenA tokens
      expect(beforeFrom).to.be.gte.BN(srcAmount);

      const paths = buildPathes({ fromToken: ETH_TOKEN, toToken: tokenA.address, srcAmount, destAmount });
      const params = [ETH_TOKEN, tokenA.address, srcAmount, destAmount, 123, paths, 0];

      const txR = await manager.relay(wallet, "sell", params, [owner], 10000, ETH_TOKEN, accounts[9]);
      // console.log(txR.gasUsed);

      let event = await utils.getEvent(txR, wallet, "TransactionExecuted");
      assert.isTrue(event.args.success, "Relayed tx should succeed");

      event = await utils.getEvent(txR, wallet, "TokenExchanged");
      const destAmountResult = event.args.destAmount;

      const afterFrom = await utils.getBalance(wallet.address);
      const afterTo = await tokenA.balanceOf(wallet.address);

      // should send the exact amount of fromToken
      expect(beforeFrom.sub(afterFrom)).to.be.gt.BN(srcAmount); // Wallet should have less the sent amount plus refund
      // should receive some toToken
      expect(afterTo).to.be.gt.BN(beforeTo);
      // should receive more toToken than minimum specified
      expect(destAmountResult).to.be.gte.BN(destAmount);
    });
  });
});
