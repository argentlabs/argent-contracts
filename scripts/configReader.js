// Example Usage:
// from the project root (as we're loading .env file from root via `dotenv`)
// bash ./scripts/execute.sh scripts/configReader.js staging

require("dotenv").config();

const path = require("path");

const ConfiguratorLoader = require("../utils/configurator-loader.js");
const Configurator = require("../utils/configurator.js");

async function main() {
  const idx = process.argv.indexOf("--network");
  const network = process.argv[idx + 1];
  const env = process.env.CONFIG_ENVIRONMENT;
  const remotelyManagedNetworks = (process.env.S3_BUCKET_SUFFIXES || "").split(":");

  let configLoader;
  if (remotelyManagedNetworks.includes(network)) {
    const bucket = `${process.env.S3_BUCKET_PREFIX}-${network}`;
    const key = process.env.S3_CONFIG_KEY;
    configLoader = new ConfiguratorLoader.S3(bucket, key);
  } else {
    const fileName = env ? `${network}.${env}.json` : `${network}.json`;
    const filePath = path.join(__dirname, "./config", fileName);
    configLoader = new ConfiguratorLoader.Local(filePath);
  }
  const configurator = new Configurator(configLoader);
  await configurator.load();
  const configuration = configurator.copyConfig();
  console.log(configuration);
}

main().catch((err) => {
  throw err;
});
