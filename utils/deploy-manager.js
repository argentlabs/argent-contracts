require("dotenv").config();
const path = require("path");

const Configurator = require("./configurator.js");
const ConfiguratorLoader = require("./configurator-loader.js");
const PrivateKeyLoader = require("./private-key-loader.js");
const ABIUploader = require("./abi-uploader.js");
const VersionUploader = require("./version-uploader.js");

module.exports = {
  async getProps() {
    const idx = process.argv.indexOf("--network");
    const network = idx > -1 ? process.argv[idx + 1] : "development";
    console.log(`## ${network} network ##`);

    const env = process.env.CONFIG_ENVIRONMENT;
    const remotelyManagedNetworks = (process.env.S3_BUCKET_SUFFIXES || "").split(":");
    const configLocalPath = process.env.CONFIG_LOCAL_PATH;

    const accounts = await web3.eth.getAccounts();
    const deploymentAccount = accounts[0];

    // config
    let configLoader;
    if (remotelyManagedNetworks.includes(network)) {
      const bucket = `${process.env.S3_BUCKET_PREFIX}-${network}`;
      const key = process.env.S3_CONFIG_KEY;
      configLoader = new ConfiguratorLoader.S3(bucket, key);
    } else if (configLocalPath) {
      configLoader = new ConfiguratorLoader.Local(configLocalPath);
    } else {
      const fileName = env ? `${network}.${env}.json` : `${network}.json`;
      const filePath = path.join(__dirname, "./config", fileName);
      configLoader = new ConfiguratorLoader.Local(filePath);
    }
    const configurator = new Configurator(configLoader);
    await configurator.load();
    const { config } = configurator;

    let infuraKey;
    if (config.settings.deployer.type === "infura") {
      const { key, envvar } = config.settings.deployer.options;
      infuraKey = key || process.env[envvar];
    }

    let pkey;
    // getting private key if any is available
    if (config.settings.privateKey && config.settings.privateKey.type === "plain") {
      const { value, envvar } = config.settings.privateKey.options;
      pkey = value || process.env[envvar];
    } else if (config.settings.privateKey && config.settings.privateKey.type === "s3") {
      const { options } = config.settings.privateKey;
      const pkeyLoader = new PrivateKeyLoader(options.bucket, options.key);
      try {
        pkey = await pkeyLoader.fetch();
      } catch (e) {
        // if we failed here, it's most likely because the AWS account is not authorised
        // to read the pkey. But since we don't currently use the AWS pkey, we can safely continue
        console.warn("Failed to fetch pkey:", e);
      }
    }

    // setting backend account and multi-sig owner for environments not managed on S3
    if (network === "development") {
      configurator.updateBackendAccounts([deploymentAccount]);
      configurator.updateMultisigOwner([deploymentAccount]);
    }

    let abiUploader;
    // abi upload
    if (config.settings.abiUpload) {
      abiUploader = new ABIUploader.S3(config.settings.abiUpload.bucket);
    } else {
      abiUploader = new ABIUploader.None();
    }

    let versionUploader;
    // version upload
    if (config.settings.versionUpload) {
      versionUploader = new VersionUploader.S3(config.settings.versionUpload.bucket, config.settings.versionUpload.url);
    } else {
      const dirPath = path.join(__dirname, "./versions/", network);
      versionUploader = new VersionUploader.Local(dirPath, env);
    }

    return { network, deploymentAccount, infuraKey, pkey, configurator, abiUploader, versionUploader };
  }
};
