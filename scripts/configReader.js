// ///////////////////////////////////////////////////////////////////
// Script to print environment configuration from AWS.
//
// Can be executed (from the project root as we're loading .env file from root via `dotenv`) as:
// bash ./scripts/execute_script.sh --no-compile scripts/configReader.js <network>
//
// where:
//     - network = [test, staging, prod]
// note: ganache configuration in solution under ./utils/config/ganache.json
// ////////////////////////////////////////////////////////////////////

require("dotenv").config();

const path = require("path");

const ConfiguratorLoader = require("../utils/configurator-loader.js");
const Configurator = require("../utils/configurator.js");

async function main() {
  const idx = process.argv.indexOf("--network");
  const network = process.argv[idx + 1];
  const env = process.env.CONFIG_ENVIRONMENT;
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
  console.log(JSON.stringify(configuration, null, 4));

  // Validate the configuration. Prints any validation error.
  configurator._validate();
}

main().catch((err) => {
  throw err;
});
