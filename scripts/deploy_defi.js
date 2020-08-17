// AWS_PROFILE=argent-test AWS_SDK_LOAD_CONFIG=true etherlime deploy --file ./scripts/deploy_defi.js --compile false
/* global artifacts */

const ethers = require("ethers");
const { parseEther, formatBytes32String } = require("ethers").utils;

const DeployManager = require("../utils/deploy-manager.js");

const UniswapFactory = require("../lib/uniswap/UniswapFactory");
const UniswapExchange = require("../lib/uniswap/UniswapExchange");

const Vox = artifacts.require("SaiVox");
const Tub = artifacts.require("SaiTub");
const DSToken = artifacts.require("DSToken");
const WETH = artifacts.require("WETH9");
const DSValue = artifacts.require("DSValue");

const RAY = ethers.BigNumber.from("1000000000000000000000000000"); // 10**27
const WAD = ethers.BigNumber.from("1000000000000000000"); // 10**18
const USD_PER_DAI = RAY; // 1 DAI = 1 USD
const USD_PER_ETH = WAD.mul(250); // 1 ETH = 250 USD
const USD_PER_MKR = WAD.mul(700); // 1 MKR = 700 USD

const ETH_PER_MKR = WAD.mul(USD_PER_MKR).div(USD_PER_ETH); // 1 MKR = 2.8 ETH

async function getTimestamp(deployer) {
  const block = await deployer.provider.getBlock("latest");
  return block.timestamp;
}

function sleep(ms) {
  console.log("sleeping...");
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deploy() {
  const idx = process.argv.indexOf("--network");
  const network = idx > -1 ? process.argv[idx + 1] : "test";

  const deployManager = new DeployManager(network);
  await deployManager.setup();
  const { deployer } = deployManager;
  const manager = deployer.signer; // the pit

  /* ************* Deploy Maker *************** */
  const vox = await Vox.new(USD_PER_DAI);
  const sai = await DSToken.new(formatBytes32String("DAI"));
  const gov = await DSToken.new(formatBytes32String("MKR"));
  const sin = await DSToken.new(formatBytes32String("SIN"));
  const skr = await DSToken.new(formatBytes32String("PETH"));
  const gem = await WETH.new();
  const pip = await DSValue.new();
  const pep = await DSValue.new();
  const tub = await Tub.new(
    sai.address,
    sin.address,
    skr.address,
    gem.address,
    gov.address,
    pip.address,
    pep.address,
    vox.address,
    manager);

  // let the Tub mint PETH and DAI
  await skr.setOwner(tub.address);
  await sai.setOwner(tub.address);
  // setup USD/ETH oracle with a convertion rate of 100 USD/ETH
  await pip.poke(`0x${USD_PER_ETH.toHexString().slice(2).padStart(64, "0")}`);
  // setup USD/MKR oracle with a convertion rate of 400 USD/MKR
  await pep.poke(`0x${USD_PER_MKR.toHexString().slice(2).padStart(64, "0")}`);
  // set the total DAI debt ceiling to 50,000 DAI
  await tub.mold(formatBytes32String("cap"), parseEther("50000"));
  // set the liquidity ratio to 150%
  await tub.mold(formatBytes32String("mat"), RAY.mul(3).div(2));
  // set the governance fee to 7.5% APR
  await tub.mold(formatBytes32String("fee"), "1000000002293273137447730714", { gasLimit: 150000 });
  // set the liquidation penalty to 13%
  await tub.mold(formatBytes32String("axe"), "1130000000000000000000000000", { gasLimit: 150000 });

  /* ************* Deploy Uniswap ****************** */

  const uniswapFactory = await UniswapFactory.new();
  const uniswapTemplateExchange = await UniswapExchange.new();
  await uniswapFactory.initializeFactory(uniswapTemplateExchange.address);

  /* *************** create MKR exchange ***************** */

  const ethLiquidity = parseEther("1");
  const mkrLiquidity = ethLiquidity.mul(WAD).div(ETH_PER_MKR);
  await gov["mint(address,uint256)"](manager, mkrLiquidity);

  await uniswapFactory.createExchange(gov.address, { gasLimit: 450000 });
  let exchange = "0x0000000000000000000000000000000000000000";
  while (exchange === "0x0000000000000000000000000000000000000000") {
    exchange = await uniswapFactory.getExchange(gov.address);
    console.log("exchange: ", exchange);
    await sleep(5000);
  }
  const mkrExchange = await UniswapExchange.at(exchange);
  await gov.approve(mkrExchange.address, mkrLiquidity);
  const timestamp = await getTimestamp(deployer);
  await mkrExchange.addLiquidity(1, mkrLiquidity, timestamp + 300, { value: ethLiquidity, gasLimit: 250000 });

  console.log("******* contracts *******");
  console.log(`DAI: ${sai.address}`);
  console.log(`MKR: ${gov.address}`);
  console.log(`MAKER TUB: ${tub.address}`);
  console.log(`UNISWAP FACTORY: ${uniswapFactory.address}`);
  console.log("********************************");
}

module.exports = {
  deploy,
};
