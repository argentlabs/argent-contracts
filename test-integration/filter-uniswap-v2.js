/* global artifacts */

const { assert } = require("chai");
const BN = require("bn.js");
const { deployArgent } = require("../utils/argent-deployer.js");
const utils = require("../utils/utilities.js");
const { makeUniswapMethods } = require("../utils/uniswap.js");

const ERC20 = artifacts.require("TestERC20");
const UniZap = artifacts.require("UniZap");
const UniZapFilter = artifacts.require("UniswapV2UniZapFilter");
const TokenRegistry = artifacts.require("TokenRegistry");

const { ETH_TOKEN } = utils;

const UNI_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const UNI_INIT_CODE = "0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f";
const USDC_ETH_PAIR = "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc";
const UNIZAP_ADDRESS = "0xbCc492DF37bD4ec651D46d72230E340c9ec1950c";

const amount = web3.utils.toWei("1", "finney");

contract("Uniswap V2", (accounts) => {
  let argent;
  let wallet;

  let tokenRegistry;
  let token;
  let lpToken;
  let uniZap;

  let addLiquidity;
  let removeLiquidity;

  const recipient = accounts[3];

  before(async () => {
    argent = await deployArgent(accounts);

    token = argent.USDC;
    lpToken = await ERC20.at(USDC_ETH_PAIR);
    uniZap = await UniZap.at(UNIZAP_ADDRESS);

    // make LP token tradable
    tokenRegistry = await TokenRegistry.new();
    await tokenRegistry.setTradableForTokenList([lpToken.address], [true]);

    const filter = await UniZapFilter.new(tokenRegistry.address, UNI_FACTORY, UNI_INIT_CODE, argent.WETH.address);
    await argent.dappRegistry.addDapp(0, uniZap.address, filter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet();
    ({ addLiquidity, removeLiquidity } = makeUniswapMethods(argent, wallet, uniZap, token, lpToken));
  });

  describe("UniZap methods", () => {
    it("should add liquidity with ETH", async () => {
      await addLiquidity(ETH_TOKEN, amount, wallet.address);
    });

    it("should add liquidity with token", async () => {
      await addLiquidity(token, amount, wallet.address);
    });

    it("should block adding liquidity when the recipient is not the wallet", async () => {
      const receipt = await addLiquidity(token, amount, recipient);
      utils.assertFailedWithError(receipt, "TM: call not authorised");
    });

    it("should block adding liquidity when the pair is not valid", async () => {
      await tokenRegistry.setTradableForTokenList([lpToken.address], [false]);
      const receipt = await addLiquidity(token, amount, wallet.address);
      await tokenRegistry.setTradableForTokenList([lpToken.address], [true]);
      utils.assertFailedWithError(receipt, "TM: call not authorised");
    });

    it("should remove liquidity to ETH", async () => {
      await addLiquidity(ETH_TOKEN, amount, wallet.address);
      const lpBalance = await lpToken.balanceOf(wallet.address);
      await removeLiquidity(ETH_TOKEN, lpBalance.div(new BN(2)).toString(), wallet.address);
    });

    it("should remove liquidity to token", async () => {
      await addLiquidity(ETH_TOKEN, amount, wallet.address);
      const lpBalance = await lpToken.balanceOf(wallet.address);
      await removeLiquidity(token.address, lpBalance.div(new BN(2)).toString(), wallet.address);
    });

    it("should block removing liquidity when the recipient is not the wallet", async () => {
      await addLiquidity(ETH_TOKEN, amount, wallet.address);
      const lpBalance = await lpToken.balanceOf(wallet.address);
      const receipt = await removeLiquidity(token.address, lpBalance.div(new BN(2)).toString(), recipient);
      utils.assertFailedWithError(receipt, "TM: call not authorised");
    });

    it("should block removing liquidity when the pair is not valid", async () => {
      await tokenRegistry.setTradableForTokenList([lpToken.address], [false]);
      await addLiquidity(ETH_TOKEN, amount, wallet.address);
      const lpBalance = await lpToken.balanceOf(wallet.address);
      const receipt = await removeLiquidity(token.address, lpBalance.div(new BN(2)).toString(), wallet.address);
      await tokenRegistry.setTradableForTokenList([lpToken.address], [true]);
      utils.assertFailedWithError(receipt, "TM: call not authorised");
    });
  });

  describe("ETH and ERC20 methods", () => {
    it("should block sending ETH to the zap", async () => {
      const transaction = await utils.encodeTransaction(uniZap.address, amount, "0x");
      const { receipt } = await argent.multiCall(wallet, [transaction]);
      utils.assertFailedWithError(receipt, "TM: call not authorised");
    });

    it("should block sending an ERC20 to the zap", async () => {
      const data = token.contract.methods.transfer(uniZap.address, amount).encodeABI();
      const { receipt } = await argent.multiCall(wallet, [utils.encodeTransaction(token.address, 0, data)]);
      utils.assertFailedWithError(receipt, "TM: call not authorised");
    });

    it("should approve an ERC20", async () => {
      const data = token.contract.methods.approve(uniZap.address, amount).encodeABI();
      const { success } = await argent.multiCall(wallet, [utils.encodeTransaction(token.address, 0, data)]);
      assert.isTrue(success, "transfer failed");
    });
  });
});
