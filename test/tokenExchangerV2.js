/* global accounts */
const { bigNumberify } = require("ethers").utils;
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
const { getPath } = require("../utils/paraswap-helper");
const { ETH_TOKEN } = require("../utils/utilities.js");
const TestManager = require("../utils/test-manager");

// Constants
const DECIMALS = 12; // number of decimal for TOKEN_A, TOKEN_B contracts
const TOKEN_A_RATE = 60 * 10 ** 13; // 1 TOKEN_A = 0.00060 ETH
const TOKEN_B_RATE = 30 * 10 ** 13; // 1 TOKEN_B = 0.00030 ETH

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
    tokenA = await deployer.deploy(ERC20, {}, [infrastructure.address], 10000000000, DECIMALS);
    tokenB = await deployer.deploy(ERC20, {}, [infrastructure.address], 10000000000, DECIMALS);

    // Deploy and fund Kyber
    kyberNetwork = await deployer.deploy(KyberNetwork);
    await kyberNetwork.addToken(tokenA.contractAddress, TOKEN_A_RATE, DECIMALS);
    await kyberNetwork.addToken(tokenB.contractAddress, TOKEN_B_RATE, DECIMALS);
    await tokenA.mint(kyberNetwork.contractAddress, 1000000000);
    await tokenB.mint(kyberNetwork.contractAddress, 1000000000);
    await infrastructure.sendTransaction({ to: kyberNetwork.contractAddress, value: 50000000 });

    // Deploy and fund UniswapV2
    const uniswapFactory = await deployer.deploy(UniswapV2Factory, {}, AddressZero);
    const weth = await deployer.deploy(WETH);
    uniswapRouter = await deployer.deploy(UniswapV2Router01, {}, uniswapFactory.contractAddress, weth.contractAddress);
    await tokenA.approve(uniswapRouter.contractAddress, 1000000000);
    await tokenB.approve(uniswapRouter.contractAddress, 1000000000);
    const timestamp = await manager.getTimestamp(await manager.getCurrentBlock());
    await uniswapRouter.addLiquidity(
      tokenA.contractAddress,
      tokenB.contractAddress,
      30000000,
      60000000,
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
    await infrastructure.sendTransaction({ to: wallet.contractAddress, value: 50000000 });
    await tokenA.mint(wallet.contractAddress, 1000000000);
    await tokenB.mint(wallet.contractAddress, 1000000000);
  });

  function buildPath({
    fromToken, toToken, srcAmount, expectedDestAmount,
  }) {
    const exchange = [toToken, fromToken].includes(ETH_TOKEN) ? "kyber" : "uniswapV2";
    const payload = exchange === "kyber" ? {} : {
      path: [
        fromToken,
        toToken,
      ],
    };
    const priceRoute = [
      {
        exchange,
        amount: expectedDestAmount,
        srcAmount,
        percent: "100",
        data: {
          tokenFrom: fromToken,
          tokenTo: toToken,
          ...payload,
        },
      },
    ];
    const exchanges = { kyber: kyberAdapter.contractAddress, uniswapv2: uniswapV2Adapter.contractAddress };
    const targetExchanges = { kyber: kyberNetwork.contractAddress, uniswapv2: uniswapRouter.contractAddress };
    return getPath(fromToken, toToken, priceRoute, exchanges, targetExchanges, false);
  }

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

  function getMultiSwapParams({
    fromToken, toToken, srcAmount = "1000", minDestAmount = "1", expectedDestAmount = "123", _wallet = wallet,
  }) {
    const path = buildPath({
      fromToken, toToken, srcAmount, expectedDestAmount,
    });
    const params = [_wallet.contractAddress, fromToken, toToken, srcAmount, minDestAmount, expectedDestAmount, path, 0];
    return params;
  }

  async function testMultiSwap({
    fromToken, toToken, relayed = true, _wallet = wallet,
  }) {
    const srcAmount = "1000";
    const beforeFrom = await getBalance(fromToken, _wallet);
    const beforeTo = await getBalance(toToken, _wallet);
    assert.isTrue(beforeFrom.gte(srcAmount), "wallet should have enough of fromToken");

    let txR;

    const params = getMultiSwapParams({
      fromToken, toToken, srcAmount, _wallet,
    });
    const method = "multiSwap";
    if (relayed) {
      txR = await manager.relay(exchanger, method, params, _wallet, [owner]);
      assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
    } else {
      txR = await (await exchanger.from(owner)[method](...params, { gasLimit: 2000000 })).wait();
    }

    const { destAmount } = txR.events.find((log) => log.event === "TokenExchanged").args;
    const afterFrom = await getBalance(fromToken, _wallet);
    const afterTo = await getBalance(toToken, _wallet);
    assert.isTrue(afterTo.sub(beforeTo).gte(destAmount), "should receive the toToken");
    assert.isTrue(beforeFrom.sub(afterFrom).eq(srcAmount), "should send the fromToken");
  }

  it("trades ETH to ERC20 (blockchain tx)", async () => {
    await testMultiSwap({ fromToken: ETH_TOKEN, toToken: tokenA.contractAddress, relayed: false });
  });
  it("trades ETH to ERC20 (relayed tx)", async () => {
    await testMultiSwap({ fromToken: ETH_TOKEN, toToken: tokenA.contractAddress, relayed: true });
  });
  it("trades ERC20 to ETH (blockchain tx)", async () => {
    await testMultiSwap({ fromToken: tokenA.contractAddress, toToken: ETH_TOKEN, relayed: false });
  });
  it("trades ERC20 to ETH (relayed tx)", async () => {
    await testMultiSwap({ fromToken: tokenA.contractAddress, toToken: ETH_TOKEN, relayed: true });
  });
  it("trades ERC20 to ERC20 (blockchain tx)", async () => {
    await testMultiSwap({ fromToken: tokenA.contractAddress, toToken: tokenB.contractAddress, relayed: false });
  });
  it("trades ERC20 to ERC20 (relayed tx)", async () => {
    await testMultiSwap({ fromToken: tokenA.contractAddress, toToken: tokenB.contractAddress, relayed: true });
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
    const params = getMultiSwapParams({ fromToken, toToken });
    await assert.revertWith(exchangerExcludingUniswapV2.from(owner).multiSwap(...params, { gasLimit: 2000000 }), "TE: Unauthorised Exchange");
  });
  it("lets old wallets call multiSwap successfully", async () => {
    // create wallet
    const oldWalletImplementation = await deployer.deploy(OldWallet);
    const proxy = await deployer.deploy(Proxy, {}, oldWalletImplementation.contractAddress);
    const oldWallet = deployer.wrapDeployedContract(OldWallet, proxy.contractAddress);
    await oldWallet.init(owner.address, [exchanger.contractAddress]);
    // fund wallet
    await infrastructure.sendTransaction({ to: oldWallet.contractAddress, value: 50000000 });
    // call multiSwap
    await testMultiSwap({
      fromToken: ETH_TOKEN, toToken: tokenA.contractAddress, _wallet: oldWallet, relayed: false,
    });
  });
  it("calls multiSwap successfully with a pre-existing allowance", async () => {
    // Make the wallet grant some non-zero allowance to the Paraswap proxy
    const spender = await paraswap.getTokenTransferProxy();
    await transferManager.from(owner).approveToken(wallet.contractAddress, tokenA.contractAddress, spender, 3);
    // call multiSwap
    await testMultiSwap({ fromToken: tokenA.contractAddress, toToken: ETH_TOKEN, relayed: false });
  });
  it("calls multiSwap successfully with a pre-existing infinite allowance", async () => {
    // Make the wallet grant an infinite allowance to the Paraswap proxy
    const infiniteAllowance = bigNumberify(2).pow(256).sub(1);
    const spender = await paraswap.getTokenTransferProxy();
    await transferManager.from(owner).approveToken(wallet.contractAddress, tokenA.contractAddress, spender, infiniteAllowance);
    // call multiSwap
    await testMultiSwap({ fromToken: tokenA.contractAddress, toToken: ETH_TOKEN, relayed: false });
  });
});
