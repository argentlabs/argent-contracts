/* global artifacts */

const { formatBytes32String } = require("ethers").utils;
const BN = require("bn.js");

const UniswapFactory = artifacts.require("UniswapFactory");
const UniswapExchange = artifacts.require("UniswapExchange");

const ScdMcdMigration = artifacts.require("ScdMcdMigration");
const DSValue = artifacts.require("DSValue");
const DSToken = artifacts.require("DSToken");
const Dai = artifacts.require("Dai");
const Vox = artifacts.require("SaiVox");
const Tub = artifacts.require("SaiTub");
const WETH = artifacts.require("WETH9");
const Vat = artifacts.require("Vat");
const Pot = artifacts.require("Pot");
const Jug = artifacts.require("Jug");
const CdpManager = artifacts.require("DssCdpManager");
const GemJoin = artifacts.require("GemJoin");
const DaiJoin = artifacts.require("DaiJoin");

const RAY = new BN(10).pow(new BN(27)); // 10**27
const WAD = new BN(10).pow(new BN(18)); // 10**18
const RAD = RAY.mul(WAD);
const USD_PER_DAI = RAY; // 1 DAI = 1 USD
const USD_PER_ETH = WAD.muln(100); // 1 ETH = 100 USD
const USD_PER_MKR = WAD.muln(400); // 1 MKR = 400 USD
const ETH_PER_MKR = WAD.mul(USD_PER_MKR).div(USD_PER_ETH); // 1 MKR = 4 ETH
const ETH_PER_DAI = WAD.mul(USD_PER_DAI).div(RAY).mul(WAD).div(USD_PER_ETH); // 1 DAI = 0.01 ETH
const MAT = RAY.muln(3).divn(2); // collateralizsation ratio = 150%

module.exports = {
  RAY,
  WAD,
  ETH_PER_MKR,
  ETH_PER_DAI,

  deployUniswap: async (infrastructure, tokens = [], ethPerToken = [], ethLiquidity = web3.utils.toWei("10")) => {
    const uniswapFactory = await UniswapFactory.new();
    const uniswapTemplateExchange = await UniswapExchange.new();
    await uniswapFactory.initializeFactory(uniswapTemplateExchange.address);
    const uniswapExchanges = {};
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      await uniswapFactory.createExchange(token.address, { from: infrastructure });
      const uniswapExchangeAddress = await uniswapFactory.getExchange(token.address);
      const tokenExchange = await UniswapExchange.at(uniswapExchangeAddress);
      uniswapExchanges[token.address] = tokenExchange;
      const tokenLiquidity = new BN(ethLiquidity).mul(WAD).div(ethPerToken[i]);
      await token.mint(infrastructure, tokenLiquidity);
      await token.approve(tokenExchange.address, tokenLiquidity, { from: infrastructure });
      const { timestamp } = await web3.eth.getBlock("latest");
      await tokenExchange.addLiquidity(1, tokenLiquidity, timestamp + 300, { value: ethLiquidity, gasLimit: 150000, from: infrastructure });
    }
    return { uniswapFactory, uniswapExchanges };
  },

  deployMaker: async (infrastructure) => {
    //
    // Deploy and setup SCD
    //
    const sai = await DSToken.new(formatBytes32String("SAI"));
    const dai = await Dai.new(42);
    const gov = await DSToken.new(formatBytes32String("MKR"));
    const weth = await WETH.new();
    const vox = await Vox.new(USD_PER_DAI);
    const sin = await DSToken.new(formatBytes32String("SIN"));
    const skr = await DSToken.new(formatBytes32String("PETH"));
    const pip = await DSValue.new();
    const pep = await DSValue.new();
    const tub = await Tub.new(
      sai.address,
      sin.address,
      skr.address,
      weth.address,
      gov.address,
      pip.address,
      pep.address,
      vox.address,
      infrastructure);
    // Let the Tub mint PETH and DAI
    await skr.setOwner(tub.address);
    await sai.setOwner(tub.address);
    // Setup USD/ETH oracle with a convertion rate of 100 USD/ETH
    await pip.poke(`0x${USD_PER_ETH.toString(16, 64)}`);
    // Setup USD/MKR oracle with a convertion rate of 400 USD/MKR
    await pep.poke(`0x${USD_PER_MKR.toString(16, 64)}`);
    // Set the total DAI debt ceiling to 50,000 DAI
    await tub.mold(formatBytes32String("cap"), web3.utils.toWei("50000"));
    // Set the collateralization ratio to 150%
    await tub.mold(formatBytes32String("mat"), MAT);
    // Set the governance fee to 7.5% APR
    await tub.mold(formatBytes32String("fee"), "1000000002293273137447730714");

    //
    // Deploy and setup MCD
    //

    // Vat setup
    const vat = await Vat.new();
    // Setting the debt ceiling
    await vat.file(formatBytes32String("Line"), "138000000000000000000000000000000000000000000000000000");

    const cdpManager = await CdpManager.new(vat.address);

    // Pot setup
    const pot = await Pot.new(vat.address);
    await vat.rely(pot.address);

    // Jug setup
    const jug = await Jug.new(vat.address);
    await vat.rely(jug.address);

    // SAI collateral setup
    const saiIlk = formatBytes32String("SAI");
    await jug.init(saiIlk);
    await vat.init(saiIlk);
    await vat.file(saiIlk, formatBytes32String("spot"), "100000000000000000000000000000000000000000000000000");
    await vat.file(saiIlk, formatBytes32String("line"), "100000000000000000000000000000000000000000000000000000");
    await vat.file(saiIlk, formatBytes32String("dust"), "0");
    const saiJoin = await GemJoin.new(vat.address, saiIlk, sai.address);
    await vat.rely(saiJoin.address);

    // WETH collateral setup
    const wethIlk = formatBytes32String("ETH-A");
    await jug.init(wethIlk);
    await vat.init(wethIlk);
    await vat.file(wethIlk, formatBytes32String("spot"), "88050000000000000000000000000");
    await vat.file(wethIlk, formatBytes32String("line"), "50000000000000000000000000000000000000000000000000000");
    await vat.file(wethIlk, formatBytes32String("dust"), "20000000000000000000000000000000000000000000000");
    const wethJoin = await GemJoin.new(vat.address, wethIlk, weth.address);
    await vat.rely(wethJoin.address);

    // BAT collateral setup
    const bat = await DSToken.new(formatBytes32String("BAT"));
    const batIlk = formatBytes32String("BAT-A");
    await jug.init(batIlk);
    await vat.init(batIlk);
    await vat.file(batIlk, formatBytes32String("spot"), "88050000000000000000000000000");
    await vat.file(batIlk, formatBytes32String("line"), "50000000000000000000000000000000000000000000000000000");
    await vat.file(batIlk, formatBytes32String("dust"), "20000000000000000000000000000000000000000000000");
    const batJoin = await GemJoin.new(vat.address, batIlk, bat.address);
    await vat.rely(batJoin.address);

    // DAI debt setup
    const daiJoin = await DaiJoin.new(vat.address, dai.address);
    // Allow daiJoin to mint DAI
    await dai.rely(daiJoin.address);
    // Give daiJoin some internal DAI in the vat
    await vat.suck(daiJoin.address, daiJoin.address, RAD.muln(1000000));

    // Deploy and setup SCD to MCD Migration
    const migration = await ScdMcdMigration.new(
      tub.address,
      cdpManager.address,
      saiJoin.address,
      wethJoin.address,
      daiJoin.address,
    );
    // Setting up the common migration vault used by ScdMcdMigration
    const initialSaiAmountInMigrationVault = web3.utils.toWei("1000");
    await sai.mint(infrastructure, initialSaiAmountInMigrationVault);
    await sai.approve(migration.address, initialSaiAmountInMigrationVault, { from: infrastructure });
    await migration.swapSaiToDai(initialSaiAmountInMigrationVault, { from: infrastructure });

    return {
      sai,
      dai,
      gov,
      bat,
      weth,
      vat,
      daiJoin,
      batJoin,
      wethJoin,
      tub,
      pip,
      pot,
      jug,
      cdpManager,
      migration,
    };
  },
};
