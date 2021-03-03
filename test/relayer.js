/* global artifacts */
const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { assert, expect } = chai;
chai.use(bnChai(BN));

// UniswapV2
const UniswapV2Factory = artifacts.require("UniswapV2Factory");
const UniswapV2Router01 = artifacts.require("UniswapV2Router01");
const WETH = artifacts.require("WETH9");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModuleTest");
const DappRegistry = artifacts.require("DappRegistry");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
const ERC20 = artifacts.require("TestERC20");

const utils = require("../utils/utilities.js");
const { ETH_TOKEN, encodeTransaction, addTrustedContact, initNonce } = require("../utils/utilities.js");

const ZERO_BYTES32 = ethers.constants.HashZero;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const RelayManager = require("../utils/relay-manager");

contract("ArgentModule", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const recipient = accounts[4];
  const relayer = accounts[9];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let walletImplementation;
  let token;
  let dappRegistry;
  let tokenPriceRegistry;

  before(async () => {
    // deploy Uniswap V2
    const weth = await WETH.new();
    token = await ERC20.new([infrastructure], web3.utils.toWei("1000"), 18);
    const uniswapFactory = await UniswapV2Factory.new(ZERO_ADDRESS);
    const uniswapRouter = await UniswapV2Router01.new(uniswapFactory.address, weth.address);
    await token.approve(uniswapRouter.address, web3.utils.toWei("600"));
    const timestamp = await utils.getTimestamp();
    await uniswapRouter.addLiquidityETH(
      token.address,
      web3.utils.toWei("600"),
      1,
      1,
      infrastructure,
      timestamp + 300,
      { value: web3.utils.toWei("300") }
    );

    // deploy Argent
    registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();
    dappRegistry = await DappRegistry.new(0);

    module = await ArgentModule.new(
      registry.address,
      guardianStorage.address,
      transferStorage.address,
      dappRegistry.address,
      uniswapRouter.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      RECOVERY_PERIOD,
      LOCK_PERIOD);

    await registry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentModule"));
    await dappRegistry.addDapp(0, relayer, ZERO_ADDRESS);

    walletImplementation = await BaseWallet.new();

    tokenPriceRegistry = await TokenPriceRegistry.new();
    await tokenPriceRegistry.addManager(infrastructure);
    const tokenRate = new BN(10).pow(new BN(18)).div(new BN(2));
    await tokenPriceRegistry.setPriceForTokenList([token.address], [tokenRate]);

    manager = new RelayManager(guardianStorage.address, tokenPriceRegistry.address);
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);
    await wallet.send(web3.utils.toWei("1"));
    await token.transfer(wallet.address, web3.utils.toWei("1"));
  });

  describe("relay transactions", () => {
    it("should fail when _data is less than 36 bytes", async () => {
      const nonce = await utils.getNonceForRelay();
      const gasLimit = 2000000;
      await truffleAssert.reverts(
        module.execute(
          wallet.address,
          "0xf435f5a7",
          nonce,
          "0xdeadbeef",
          0,
          gasLimit,
          ETH_TOKEN,
          ethers.constants.AddressZero,
          { gas: 2 * gasLimit, gasPrice: 0, from: relayer }
        ), "RM: Invalid dataWallet");
    });

    it("should fail when the first param is not the wallet", async () => {
      const transaction = encodeTransaction(recipient, 10, ZERO_BYTES32);
      await truffleAssert.reverts(
        manager.relay(module, "multiCall", [infrastructure, [transaction]], wallet, [owner]),
        "RM: Target of _data != _wallet"
      );
    });

    it("should fail when the gas of the transaction is less then the gasLimit", async () => {
      const nonce = await utils.getNonceForRelay();
      const gasLimit = 2000000;

      await truffleAssert.reverts(
        module.execute(
          wallet.address,
          "0xdeadbeef",
          nonce,
          "0xdeadbeef",
          0,
          gasLimit,
          ETH_TOKEN,
          ethers.constants.AddressZero,
          { gas: gasLimit * 0.9, gasPrice: 0, from: relayer }
        ), "RM: not enough gas provided");
    });

    it("should fail when a wrong number of signatures is provided", async () => {
      const transaction = encodeTransaction(recipient, 10, ZERO_BYTES32);
      await truffleAssert.reverts(
        manager.relay(module, "multiCall", [wallet.address, [transaction]], wallet, [owner, recipient]),
        "RM: Wrong number of signatures"
      );
    });

    it("should fail a duplicate transaction", async () => {
      const nonce = await utils.getNonceForRelay();
      const chainId = await utils.getChainId();
      const gasLimit = 100000;
      const transaction = encodeTransaction(recipient, 10, ZERO_BYTES32);
      const methodData = module.contract.methods.multiCall(wallet.address, [transaction]).encodeABI();
      const signatures = await utils.signOffchain(
        [owner],
        module.address,
        0,
        methodData,
        chainId,
        nonce,
        0,
        gasLimit,
        ETH_TOKEN,
        ethers.constants.AddressZero,
      );

      await module.execute(
        wallet.address,
        methodData,
        nonce,
        signatures,
        0,
        gasLimit,
        ETH_TOKEN,
        ethers.constants.AddressZero);

      await truffleAssert.reverts(
        module.execute(
          wallet.address,
          methodData,
          nonce,
          signatures,
          0,
          gasLimit,
          ETH_TOKEN,
          ethers.constants.AddressZero),
        "RM: Duplicate request");
    });

    it("should update the nonce after the transaction", async () => {
      const transaction = encodeTransaction(recipient, 10, ZERO_BYTES32);

      const nonceBefore = await module.getNonce(wallet.address);
      await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);
      const nonceAfter = await module.getNonce(wallet.address);
      expect(nonceAfter).to.be.gt.BN(nonceBefore);
    });
  });

  describe("refund", () => {
    beforeEach(async () => {
      await initNonce(wallet, module, manager, SECURITY_PERIOD);
      await addTrustedContact(wallet, recipient, module, SECURITY_PERIOD);
    });

    it("should refund in ETH", async () => {
      // eth balance
      const balanceStart = await utils.getBalance(wallet.address);
      // send erc20
      const data = token.contract.methods.transfer(recipient, 100).encodeABI();
      const transaction = encodeTransaction(token.address, 0, data);

      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "transfer failed");
      const balanceEnd = await utils.getBalance(wallet.address);
      expect(balanceEnd.sub(balanceStart)).to.be.lt.BN(0);
    });

    it("should refund in ERC20", async () => {
      // token balance
      const balanceStart = await token.balanceOf(relayer);
      // send ETH
      const transaction = encodeTransaction(recipient, 10, ZERO_BYTES32);
      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        1,
        token.address,
        relayer);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "transfer failed");
      const balanceEnd = await token.balanceOf(relayer);
      expect(balanceEnd.sub(balanceStart)).to.be.gt.BN(0);
    });

    it("should emit the Refund event", async () => {
      const transaction = encodeTransaction(recipient, 10, ZERO_BYTES32);
      const txReceipt = await manager.relay(
        module,
        "multiCall",
        [wallet.address, [transaction]],
        wallet,
        [owner],
        1,
        ETH_TOKEN,
        relayer);
      await utils.hasEvent(txReceipt, module, "Refund");
    });

    it("should fail when there is not enough ETH to refund", async () => {
      const balance = await utils.getBalance(wallet.address);
      const transaction = encodeTransaction(recipient, balance.toString(), ZERO_BYTES32);

      await truffleAssert.reverts(
        manager.relay(
          module,
          "multiCall",
          [wallet.address, [transaction]],
          wallet,
          [owner],
          1,
          ETH_TOKEN,
          relayer)
      );
    });

    it("should fail when there is not enough ERC20 to refund", async () => {
      const balance = await token.balanceOf(wallet.address);
      const data = token.contract.methods.transfer(recipient, balance.toString()).encodeABI();
      const transaction = encodeTransaction(token.address, 0, data);

      await truffleAssert.reverts(
        manager.relay(
          module,
          "multiCall",
          [wallet.address, [transaction]],
          wallet,
          [owner],
          1,
          token.address,
          relayer)
      );
    });
  });
});
