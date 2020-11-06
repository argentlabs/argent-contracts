require("dotenv").config();
const path = require("path");

const Configurator = require("./configurator.js");
const ConfiguratorLoader = require("./configurator-loader.js");
const PrivateKeyLoader = require("./private-key-loader.js");
const ABIUploader = require("./abi-uploader.js");
const VersionUploader = require("./version-uploader.js");

class DeployManager {
  constructor(deploymentAccount) {
    const idx = process.argv.indexOf("--network");
    const network = idx > -1 ? process.argv[idx + 1] : "development";
    console.log(`## ${network} network ##`);

    this.network = network;
    this.deploymentAccount = deploymentAccount;
    this.env = process.env.CONFIG_ENVIRONMENT;
    this.remotelyManagedNetworks = (process.env.S3_BUCKET_SUFFIXES || "").split(":");

    // config
    let configLoader;
    if (this.remotelyManagedNetworks.includes(this.network)) {
      const bucket = `${process.env.S3_BUCKET_PREFIX}-${this.network}`;
      const key = process.env.S3_CONFIG_KEY;
      configLoader = new ConfiguratorLoader.S3(bucket, key);
    } else {
      const fileName = this.env ? `${this.network}.${this.env}.json` : `${this.network}.json`;
      const filePath = path.join(__dirname, "./config", fileName);
      configLoader = new ConfiguratorLoader.Local(filePath);
    }
    this.configurator = new Configurator(configLoader);
  }

  async setup() {
    await this.configurator.load();
    const { config } = this.configurator;

    if (config.settings.deployer.type === "infura") {
      const { key, envvar } = config.settings.deployer.options;
      this.infuraKey = key || process.env[envvar];
    }
    // getting private key if any is available
    if (config.settings.privateKey && config.settings.privateKey.type === "plain") {
      const { value, envvar } = config.settings.privateKey.options;
      this.pkey = value || process.env[envvar];
    } else if (config.settings.privateKey && config.settings.privateKey.type === "s3") {
      const { options } = config.settings.privateKey;
      const pkeyLoader = new PrivateKeyLoader(options.bucket, options.key);
      this.pkey = await pkeyLoader.fetch();
    }

    // setting backend accounts and multi-sig owner for environments not managed on S3
    if (!this.remotelyManagedNetworks.includes(this.network)) {
      this.configurator.updateBackendAccounts([this.deploymentAccount]);
      this.configurator.updateMultisigOwner([this.deploymentAccount]);
    }

    // abi upload
    if (config.settings.abiUpload) {
      this.abiUploader = new ABIUploader.S3(config.settings.abiUpload.bucket);
    } else {
      this.abiUploader = new ABIUploader.None();
    }

    // version upload
    if (config.settings.versionUpload) {
      this.versionUploader = new VersionUploader.S3(config.settings.versionUpload.bucket, config.settings.versionUpload.url);
    } else {
      const dirPath = path.join(__dirname, "./versions/", this.network);
      this.versionUploader = new VersionUploader.Local(dirPath, this.env);
    }
  }
}

module.exports = DeployManager;
