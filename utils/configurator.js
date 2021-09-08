const Ajv = require("ajv");

const ajv = Ajv({ allErrors: true });

const schema = require("./config-schema.json");

class Configurator {
  constructor(loader) {
    this.loader = loader;
  }

  get config() {
    return this._config;
  }

  copyConfig() {
    return JSON.parse(JSON.stringify(this._config));
  }

  updateInfrastructureAddresses(contracts) {
    if (!this._config.contracts) this._config.contracts = {};
    Object.assign(this._config.contracts, contracts);
  }

  updateModuleAddresses(modules) {
    if (!this._config.modules) this._config.modules = {};
    Object.assign(this._config.modules, modules);
  }

  updateENSRegistry(address) {
    this._config.ENS.ensRegistry = address;
  }

  updateDappRegistry(address) {
    this._config.trustlist.dappRegistry = address;
  }

  updateUniswapV2(factory, router, zap, initCode) {
    this._config.defi.uniswap.factoryV2 = factory;
    this._config.defi.uniswap.v2Router = router;
    this._config.defi.uniswap.unizap = zap;
    this._config.defi.uniswap.initCodeV2 = initCode;
  }

  updateBackendAccounts(accounts) {
    this._config.backend.accounts = accounts;
  }

  updateMultisigOwner(owners) {
    if (this._config.multisig.autosign === false) return;
    this._config.multisig.owners = owners;
  }

  updateGitHash(hash) {
    this._config.gitCommit = hash;
  }

  async load(validate = true) {
    const json = await this.loader.load();
    this._config = JSON.parse(json);
    if (validate) { this._validate(); }
    return this._config;
  }

  async save() {
    this._validate();
    const json = JSON.stringify(this._config);
    await this.loader.save(json);
  }

  _validate() {
    const valid = ajv.validate(schema, this._config);
    if (!valid) {
      console.log(ajv.errors);
      throw new Error("Configuration is not valid");
    }
  }
}

module.exports = Configurator;
