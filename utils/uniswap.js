const { expect } = require("chai");
const utils = require("./utilities.js");

const { ETH_TOKEN } = utils;

module.exports.makeUniswapMethods = (argent, wallet, uniZap, token, lpToken) => {
  const getBalance = async (tokenAddress, _wallet) => {
    if (tokenAddress === ETH_TOKEN) {
      return utils.getBalance(_wallet.address);
    }
    if (tokenAddress === token.address) {
      return token.balanceOf(_wallet.address);
    }
    return lpToken.balanceOf(_wallet.address);
  };

  return {
    async addLiquidity(tokenAddress, amount, to) {
      const transactions = [];
      const balancesBefore = [];
      const balancesAfter = [];
      const deadline = (await utils.getTimestamp()) + 10;

      if (tokenAddress === ETH_TOKEN) {
        const data = uniZap.contract.methods.swapExactETHAndAddLiquidity(token.address, 0, to, deadline).encodeABI();
        transactions.push(utils.encodeTransaction(uniZap.address, amount, data));
        balancesBefore.push(await getBalance(ETH_TOKEN, wallet));
      } else {
        let data = token.contract.methods.approve(uniZap.address, amount).encodeABI();
        transactions.push(utils.encodeTransaction(token.address, 0, data));
        data = uniZap.contract.methods.swapExactTokensAndAddLiquidity(token.address, argent.WETH.address, amount, 0, to, deadline).encodeABI();
        transactions.push(utils.encodeTransaction(uniZap.address, 0, data));
        balancesBefore.push(await getBalance(token.address, wallet));
      }

      balancesBefore.push(await getBalance(lpToken.address, wallet));
      const receipt = await argent.manager.relay(
        argent.module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [argent.owner]);
      const { success } = await utils.parseRelayReceipt(receipt);
      if (success) {
        if (tokenAddress === ETH_TOKEN) {
          balancesAfter.push(await getBalance(ETH_TOKEN, wallet));
        } else {
          balancesAfter.push(await getBalance(token.address, wallet));
        }
        balancesAfter.push(await getBalance(lpToken.address, wallet));
        expect(balancesBefore[0].sub(balancesAfter[0])).to.gt.BN(0); // should have send weth/token
        expect(balancesBefore[1].sub(balancesAfter[1])).to.lt.BN(0); // should have received lp token
      }

      return receipt;
    },

    async removeLiquidity(tokenAddress, amount, to) {
      const transactions = [];
      const balancesBefore = [];
      const balancesAfter = [];
      const deadline = (await utils.getTimestamp()) + 10;

      let data = lpToken.contract.methods.approve(uniZap.address, amount).encodeABI();
      transactions.push(utils.encodeTransaction(lpToken.address, 0, data));
      if (tokenAddress === ETH_TOKEN) {
        data = uniZap.contract.methods.removeLiquidityAndSwapToETH(token.address, amount, 0, to, deadline).encodeABI();
        transactions.push(utils.encodeTransaction(uniZap.address, 0, data));
        balancesBefore.push(await getBalance(ETH_TOKEN, wallet));
      } else {
        data = uniZap.contract.methods.removeLiquidityAndSwapToToken(argent.WETH.address, token.address, amount, 0, to, deadline).encodeABI();
        transactions.push(utils.encodeTransaction(uniZap.address, 0, data));
        balancesBefore.push(await getBalance(token.address, wallet));
      }

      balancesBefore.push(await getBalance(lpToken.address, wallet));
      const receipt = await argent.manager.relay(
        argent.module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [argent.owner]);
      const { success } = await utils.parseRelayReceipt(receipt);
      if (success) {
        if (tokenAddress === ETH_TOKEN) {
          balancesAfter.push(await getBalance(ETH_TOKEN, wallet));
        } else {
          balancesAfter.push(await getBalance(token.address, wallet));
        }
        balancesAfter.push(await getBalance(lpToken.address, wallet));
        expect(balancesBefore[0].sub(balancesAfter[0])).to.lt.BN(0); // should have received weth/token
        expect(balancesBefore[1].sub(balancesAfter[1])).to.gt.BN(0); // should have burn lp tokens
      }

      return receipt;
    }
  };
};
