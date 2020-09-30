const MultiSig = require("../build/MultiSigWallet");
const TokenPriceRegistry = require("../build/TokenPriceRegistry");

const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  // Read Command Line Arguments
  const idx = process.argv.indexOf("--network");
  const network = process.argv[idx + 1];

  // Setup deployer
  const manager = new DeployManager(network);
  await manager.setup();
  const { configurator } = manager;
  const { deployer } = manager;
  const deploymentWallet = deployer.signer;
  const { config } = configurator;

  const TokenPriceStorageWrapper = await deployer.wrapDeployedContract(TokenPriceRegistry, config.modules.TokenPriceRegistry);

  const tokens = [
    "0x7b2810576aa1cce68f2b118cef1f36467c648f92",
    "0x4BFBa4a8F28755Cb2061c413459EE562c6B9c51b",
    "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    "0x9Fcc27c7320703c43368cf1A4bf076402cd0D6B4",
    "0xDb0040451F373949A4Be60dcd7b6B8D6E42658B6",
    "0x72fd6C7C1397040A66F33C2ecC83A0F71Ee46D5c",
    "0xff67881f8d12f372d91baae9752eb3631ff0ed00",
    "0xc55f20a1bb0fdaf619226317ad870c5931c99ae8",
    "0xb4f7332ed719Eb4839f091EDDB2A3bA309739521",
    "0xc778417e063141139fce010982780140aa0cd5ab",
    "0x013ae307648f529aa72c5767a334ddd37aab43c3",
    "0x2b536482a01e620ee111747f8334b395a42a555e",
    "0x189ca88be39c9c1b8c8dd437f5ff1db1f584b14b",
    "0xaD6D458402F60fD3Bd25163575031ACDce07538D",
  ];

  const tradable = Array(tokens.length).fill(true);

//  const res = await TokenPriceStorageWrapper.getTradableForTokenList(tokens);

  const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign, { gasPrice: 50e9 });
  await multisigExecutor.executeCall(TokenPriceStorageWrapper, "setTradableForTokenList", [tokens, tradable]);
}

main().catch((err) => {
  throw err;
});
