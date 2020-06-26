/* global accounts */
const { bigNumberify, parseEther } = require("ethers").utils;
const { AddressZero } = require("ethers").constants;

// Paraswap
const AugustusSwapper = require("../build/AugustusSwapper");
const Whitelisted = require("../build/Whitelisted");
const PartnerRegistry = require("../build/PartnerRegistry");
const PartnerDeployer = require("../build/PartnerDeployer");
const Kyber = require("../build/Kyber");
const UniswapV2 = require("../build/UniswapV2");

// Kyber
const KyberNetwork = require("../build/KyberNetworkTest");

// UniswapV2
const UniswapV2Factory = require("../build/UniswapV2Factory");
const UniswapV2Router01 = require("../build/UniswapV2Router01");
const WETH = require("../build/WETH9");

// Argent
const ModuleRegistry = require("../build/ModuleRegistry");
const Proxy = require("../build/Proxy");
const BaseWallet = require("../build/BaseWallet");
const OldWallet = require("../build-legacy/v1.3.0/BaseWallet");
const GuardianStorage = require("../build/GuardianStorage");
const TokenExchanger = require("../build/TokenExchangerV2");
const ERC20 = require("../build/TestERC20");
const TransferStorage = require("../build/TransferStorage");
const TransferManager = require("../build/TransferManager");
const TokenPriceProvider = require("../build/TokenPriceProvider");

// Utils
const { makePathes } = require("../utils/paraswap/multiswap-helper");
const { makeRoutes } = require("../utils/paraswap/buy-helper");
const { ETH_TOKEN } = require("../utils/utilities.js");
const TestManager = require("../utils/test-manager");

// Constants
const DECIMALS = 18; // number of decimal for TOKEN_A, TOKEN_B contracts
const TOKEN_A_RATE = parseEther("0.06");
const TOKEN_B_RATE = parseEther("0.03");

describe("Token Exchanger V2", function () {
  this.timeout(10000);

  const manager = new TestManager();
  const infrastructure = accounts[0].signer;
  const owner = accounts[1].signer;
  let deployer;

  let registry;
  let guardianStorage;
  let wallet;
  let walletImplementation;
  let exchanger;
  let transferManager;

  let kyberNetwork;
  let kyberAdapter;
  let uniswapRouter;
  let uniswapV2Adapter;
  let tokenA;
  let tokenB;
  let paraswap;

  before(async () => {
    deployer = manager.newDeployer();
    registry = await deployer.deploy(ModuleRegistry);
    guardianStorage = await deployer.deploy(GuardianStorage);

    // Deploy test tokens
    tokenA = await deployer.deploy(ERC20, {}, [infrastructure.address], parseEther("1000"), DECIMALS);
    tokenB = await deployer.deploy(ERC20, {}, [infrastructure.address], parseEther("1000"), DECIMALS);

    // Deploy and fund Kyber
    kyberNetwork = await deployer.deploy(KyberNetwork);
    await tokenA.mint(kyberNetwork.contractAddress, parseEther("1000"));
    await tokenB.mint(kyberNetwork.contractAddress, parseEther("1000"));
    await kyberNetwork.addToken(tokenA.contractAddress, TOKEN_A_RATE, DECIMALS);
    await kyberNetwork.addToken(tokenB.contractAddress, TOKEN_B_RATE, DECIMALS);
    await infrastructure.sendTransaction({ to: kyberNetwork.contractAddress, value: parseEther("10") });

    // Deploy and fund UniswapV2
    const uniswapFactory = await deployer.deploy(UniswapV2Factory, {}, AddressZero);
    const weth = await deployer.deploy(WETH);
    uniswapRouter = await deployer.deploy(UniswapV2Router01, {}, uniswapFactory.contractAddress, weth.contractAddress);
    await tokenA.approve(uniswapRouter.contractAddress, parseEther("300"));
    await tokenB.approve(uniswapRouter.contractAddress, parseEther("600"));
    const timestamp = await manager.getTimestamp(await manager.getCurrentBlock());
    await uniswapRouter.addLiquidity(
      tokenA.contractAddress,
      tokenB.contractAddress,
      parseEther("300"),
      parseEther("600"),
      1,
      1,
      infrastructure.address,
      timestamp + 300,
    );

    // Deploy Paraswap
    const whitelist = await deployer.deploy(Whitelisted);
    const partnerDeployer = await deployer.deploy(PartnerDeployer);
    const partnerRegistry = await deployer.deploy(PartnerRegistry, {}, partnerDeployer.contractAddress);
    paraswap = await deployer.deploy(
      AugustusSwapper,
      {},
      whitelist.contractAddress,
      infrastructure.address,
      partnerRegistry.contractAddress,
      infrastructure.address,
      infrastructure.address,
    );
    kyberAdapter = await deployer.deploy(Kyber, {}, infrastructure.address);
    uniswapV2Adapter = await deployer.deploy(UniswapV2, {}, weth.contractAddress);
    await whitelist.addWhitelisted(kyberAdapter.contractAddress);
    await whitelist.addWhitelisted(uniswapV2Adapter.contractAddress);

    // Deploy exchanger module
    exchanger = await deployer.deploy(
      TokenExchanger,
      {},
      registry.contractAddress,
      guardianStorage.contractAddress,
      paraswap.contractAddress,
      "argent",
      [kyberAdapter.contractAddress, uniswapV2Adapter.contractAddress],
    );

    // Deploy TransferManager module
    const priceProvider = await deployer.deploy(TokenPriceProvider);
    const transferStorage = await deployer.deploy(TransferStorage);
    transferManager = await deployer.deploy(TransferManager, {},
      AddressZero,
      transferStorage.contractAddress,
      guardianStorage.contractAddress,
      priceProvider.contractAddress,
      3600,
      3600,
      10000,
      AddressZero);

    // Deploy wallet implementation
    walletImplementation = await deployer.deploy(BaseWallet);
  });

  beforeEach(async () => {
    // create wallet
    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
    await wallet.init(owner.address, [exchanger.contractAddress, transferManager.contractAddress]);

    // fund wallet
    await infrastructure.sendTransaction({ to: wallet.contractAddress, value: parseEther("0.1") });
    await tokenA.mint(wallet.contractAddress, parseEther("1000"));
    await tokenB.mint(wallet.contractAddress, parseEther("1000"));
  });

  async function getBalance(tokenAddress, _wallet) {
    let balance;
    if (tokenAddress === ETH_TOKEN) {
      balance = await deployer.provider.getBalance(_wallet.contractAddress);
    } else if (tokenAddress === tokenA.contractAddress) {
      balance = await tokenA.balanceOf(_wallet.contractAddress);
    } else {
      balance = await tokenB.balanceOf(_wallet.contractAddress);
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

  function buildPathes({
    fromToken, toToken, srcAmount, destAmount,
  }) {
    const routes = getRoutes({
      fromToken, toToken, srcAmount, destAmount,
    });
    const exchanges = { kyber: kyberAdapter.contractAddress, uniswapv2: uniswapV2Adapter.contractAddress };
    const targetExchanges = { kyber: kyberNetwork.contractAddress, uniswapv2: uniswapRouter.contractAddress };
    return makePathes(fromToken, toToken, routes, exchanges, targetExchanges, false);
  }

  function buildRoutes({
    fromToken, toToken, srcAmount, destAmount,
  }) {
    const routes = getRoutes({
      fromToken, toToken, srcAmount, destAmount,
    });
    const exchanges = { kyber: kyberAdapter.contractAddress, uniswapv2: uniswapV2Adapter.contractAddress };
    const targetExchanges = { kyber: kyberNetwork.contractAddress, uniswapv2: uniswapRouter.contractAddress };
    return makeRoutes(fromToken, toToken, routes, exchanges, targetExchanges);
  }

  function getParams({
    method = "multiSwap", fromToken, toToken, fixedAmount, variableAmount, expectedDestAmount = "123", _wallet = wallet,
  }) {
    let routes;
    let srcAmount;
    let destAmount;
    if (method === "multiSwap") {
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
    const params = [_wallet.contractAddress, fromToken, toToken, srcAmount.toString(), destAmount.toString(), expectedDestAmount, routes, 0];
    return params;
  }

  async function testTrade({
    method = "multiSwap", fromToken, toToken, relayed = true, _wallet = wallet,
  }) {
    const beforeFrom = await getBalance(fromToken, _wallet);
    const beforeTo = await getBalance(toToken, _wallet);
    const fixedAmount = parseEther("0.01");
    const variableAmount = method === "multiSwap" ? 1 : beforeFrom;
    if (method === "multiSwap") { assert.isTrue(beforeFrom.gte(fixedAmount), "wallet should have enough of fromToken"); }

    const params = getParams({
      method,
      fromToken,
      toToken,
      fixedAmount, // srcAmount for multiSwap; destAmount for buy
      variableAmount, // destAmount for multiSwap; srcAmount for buy
      _wallet,
    });

    let txR;
    if (relayed) {
      txR = await manager.relay(exchanger, method, params, _wallet, [owner]);
      assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
    } else {
      txR = await (await exchanger.from(owner)[method](...params, { gasLimit: 2000000 })).wait();
    }
    const { destAmount } = txR.events.find((log) => log.event === "TokenExchanged").args;

    const afterFrom = await getBalance(fromToken, _wallet);
    const afterTo = await getBalance(toToken, _wallet);

    if (method === "multiSwap") {
      assert.isTrue(beforeFrom.sub(afterFrom).eq(fixedAmount), "should send the exact amount of fromToken");
      assert.isTrue(afterTo.gt(beforeTo), "should receive some toToken");
      assert.isTrue(destAmount.gte(variableAmount), "should receive more toToken than minimum specified");
    }
    if (method === "buy") {
      assert.isTrue(beforeFrom.gt(afterFrom), "should send some fromToken");
      assert.isTrue(afterTo.sub(beforeTo).eq(fixedAmount), "should receive the exact amount of toToken");
      assert.isTrue(destAmount.eq(fixedAmount), "destAmount should be the requested amount of toToken");
    }
  }


  function testsForMethod(method) {
    it("trades ETH to ERC20 (blockchain tx)", async () => {
      await testTrade({
        method, fromToken: ETH_TOKEN, toToken: tokenA.contractAddress, relayed: false,
      });
    });
    it("trades ETH to ERC20 (relayed tx)", async () => {
      await testTrade({
        method, fromToken: ETH_TOKEN, toToken: tokenA.contractAddress, relayed: true,
      });
    });
    it("trades ERC20 to ETH (blockchain tx)", async () => {
      await testTrade({
        method, fromToken: tokenA.contractAddress, toToken: ETH_TOKEN, relayed: false,
      });
    });
    it("trades ERC20 to ETH (relayed tx)", async () => {
      await testTrade({
        method, fromToken: tokenA.contractAddress, toToken: ETH_TOKEN, relayed: true,
      });
    });
    it("trades ERC20 to ERC20 (blockchain tx)", async () => {
      await testTrade({
        method, fromToken: tokenA.contractAddress, toToken: tokenB.contractAddress, relayed: false,
      });
    });
    it("trades ERC20 to ERC20 (relayed tx)", async () => {
      await testTrade({
        method, fromToken: tokenA.contractAddress, toToken: tokenB.contractAddress, relayed: true,
      });
    });

    it("can exclude exchanges", async () => {
      const fromToken = tokenA.contractAddress;
      const toToken = tokenB.contractAddress;
      const exchangerExcludingUniswapV2 = await deployer.deploy(
        TokenExchanger,
        {},
        registry.contractAddress,
        guardianStorage.contractAddress,
        paraswap.contractAddress,
        "argent",
        [kyberAdapter.contractAddress], // UniswapV2 excluded
      );
      const fixedAmount = parseEther("0.01");
      const variableAmount = method === "multiSwap" ? "1" : await getBalance(fromToken, wallet);
      const params = getParams({
        fromToken, toToken, fixedAmount, variableAmount,
      });
      await assert.revertWith(exchangerExcludingUniswapV2.from(owner).multiSwap(...params, { gasLimit: 2000000 }), "TE: Unauthorised Exchange");
    });

    it("lets old wallets call multiSwap successfully", async () => {
      // create wallet
      const oldWalletImplementation = await deployer.deploy(OldWallet);
      const proxy = await deployer.deploy(Proxy, {}, oldWalletImplementation.contractAddress);
      const oldWallet = deployer.wrapDeployedContract(OldWallet, proxy.contractAddress);
      await oldWallet.init(owner.address, [exchanger.contractAddress]);
      // fund wallet
      await infrastructure.sendTransaction({ to: oldWallet.contractAddress, value: parseEther("0.1") });
      // call multiSwap
      await testTrade({
        method,
        fromToken: ETH_TOKEN,
        toToken: tokenA.contractAddress,
        _wallet: oldWallet,
        relayed: false,
      });
    });

    const testTradeWithPreExistingAllowance = async (allowance) => {
      const spender = await paraswap.getTokenTransferProxy();
      await transferManager.from(owner).approveToken(wallet.contractAddress, tokenA.contractAddress, spender, allowance);
      // call multiSwap
      await testTrade({
        method, fromToken: tokenA.contractAddress, toToken: ETH_TOKEN, relayed: false,
      });
    };

    it(`calls ${method} successfully with a pre-existing allowance`, async () => {
      // Make the wallet grant some non-zero allowance to the Paraswap proxy
      await testTradeWithPreExistingAllowance(3);
    });
    it(`calls ${method} successfully with a pre-existing infinite allowance`, async () => {
      // Make the wallet grant an infinite allowance to the Paraswap proxy
      const infiniteAllowance = bigNumberify(2).pow(256).sub(1);
      await testTradeWithPreExistingAllowance(infiniteAllowance);
    });
  }

  describe("MultiSwap", () => testsForMethod("multiSwap"));
  describe("Buy", () => testsForMethod("buy"));
});
