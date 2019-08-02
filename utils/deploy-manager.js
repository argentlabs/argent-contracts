require('dotenv').config();
const etherlime = require('etherlime');
const path = require("path");

const Configurator = require('./configurator.js');
const ConfiguratorLoader = require('./configurator-loader.js');
const PrivateKeyLoader = require('./private-key-loader.js');
const ABIUploader = require('./abi-uploader.js');
const VersionUploader = require('./version-uploader.js');

const defaultConfigs = {
    gasPrice: 20000000000, // 20 Gwei
    gasLimit: 6000000
}

class DeployManager {
    constructor(network) {
        this.network = network;

        const suffixes = (process.env.S3_BUCKET_SUFFIXES || "").split(':');

        // config
        let configLoader;
        if (suffixes.includes(this.network)) {
            const bucket = `${process.env.S3_BUCKET_PREFIX}-${this.network}`;
            const key = process.env.S3_CONFIG_KEY;
            configLoader = new ConfiguratorLoader.S3(bucket, key);
        } else {
            const filePath = path.join(__dirname, './config', `${this.network}.json`)
            configLoader = new ConfiguratorLoader.Local(filePath)
        }
        this.configurator = new Configurator(configLoader);
    }

    async setup() {
	    await this.configurator.load();
	    const config = this.configurator.config;

        // deployer
        if (config.settings.deployer.type === 'ganache') {
            this.deployer = new etherlime.EtherlimeGanacheDeployer();

            // this need to be tested
            const account = await this.deployer.signer.getAddress();
            this.configurator.updateBackendAccounts([account]);
            this.configurator.updateMultisigOwner([account]);
        } else {
            let pkey;
            if (config.settings.privateKey.type === 'plain') {
                const options = config.settings.privateKey.options;
                pkey = options.value;
            } else if (config.settings.privateKey.type === 's3') {
                const options = config.settings.privateKey.options;
                const pkeyLoader = new PrivateKeyLoader(options.bucket, options.key);
                pkey = await pkeyLoader.fetch();
            }

            if (config.settings.deployer.type === 'infura') {
                const options = config.settings.deployer.options;
                this.deployer = new etherlime.InfuraPrivateKeyDeployer(pkey, options.network, options.key, defaultConfigs);
            } else if (config.settings.deployer.type === 'jsonrpc') {
                const options = config.settings.deployer.options;
                this.deployer = new etherlime.JSONRPCPrivateKeyDeployer(pkey, options.url, defaultConfigs);
            }
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
            const dirPath = path.join(__dirname, './versions/', this.network);
            this.versionUploader = new VersionUploader.Local(dirPath);
        }
    }
}

module.exports = DeployManager;
