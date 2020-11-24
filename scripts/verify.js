// ///////////////////////////////////////////////////////////////////
// Script to verify in EtherScan all contracts from the configuration file's
// "contracts" and "modules" sections.
// Can be executed (from the project root as we're loading .env file from root via `dotenv`) as:
// bash ./scripts/execute_script.sh --no-compile scripts/verify.js test
//
// where:
//     - network = [test, staging, prod]
// ////////////////////////////////////////////////////////////////////
require("dotenv").config();

const util = require("util");
const exec = util.promisify(require("child_process").exec);

const ConfiguratorLoader = require("../utils/configurator-loader.js");
const Configurator = require("../utils/configurator.js");

async function execVerify(contractName, contractAddress, network) {
  const res = await exec(`npx truffle run verify ${contractName}@${contractAddress} --network ${network}`).catch((e) => e);
  console.log(res.stdout);
}

async function main() {
  const idx = process.argv.indexOf("--network");
  const network = process.argv[idx + 1];
  const remotelyManagedNetworks = (process.env.S3_BUCKET_SUFFIXES || "").split(":");

  // Ensure a supported network is requested
  if (!remotelyManagedNetworks.includes(network)) {
    console.error("Error: Invalid network selected");
    return;
  }

  const bucket = `${process.env.S3_BUCKET_PREFIX}-${network}`;
  const key = process.env.S3_CONFIG_KEY;
  const configLoader = new ConfiguratorLoader.S3(bucket, key);

  const configurator = new Configurator(configLoader);

  // This will allow the config to be printed regardless of whether it's valid or not
  await configurator.load(false);
  const configuration = configurator.copyConfig();

  for (const [contractName, contractAddress] of Object.entries(configuration.contracts)) {
    await execVerify(contractName, contractAddress, network);
  }

  for (const [moduleName, moduleAddress] of Object.entries(configuration.modules)) {
    await execVerify(moduleName, moduleAddress, network);
  }
}

main().catch((err) => {
  throw err;
});
