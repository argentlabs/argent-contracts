#!/usr/bin/env node

const API = require('solidity-coverage/api');
const utils = require('solidity-coverage/utils');
const truffleUtils = require('solidity-coverage/plugins/resources/truffle.utils');
const PluginUI = require('solidity-coverage/plugins/resources/truffle.ui');
const pkg = require('solidity-coverage/package.json');
const TruffleConfig = require('@truffle/config');
const death = require('death');
const path = require('path');
const shell = require('shelljs');

async function coverage(){
  let ui;
  let api;
  let error;
  let truffle;
  let config;
  let tempArtifactsDir;
  let tempContractsDir;
  const defaultConfigName = "truffle-config.js";

  try {
    death(utils.finish.bind(null, config, api)); // Catch interrupt signals
    // =======
    // Configs
    // =======
    const configs = [
      "truffle-config-lib-0.5.js",
      "truffle-config-lib-0.7.js",
      "truffle-config-infrastructure-0.5.js",
      "truffle-config-infrastructure.js",
      "truffle-config-modules.js",
      "truffle-config-wallet.js",
      "truffle-config-contracts-test.js"
    ]

    function initializeForConfigFile(configFile){
      const configJS = require(path.join(process.cwd(), configFile));
      const truffleConfig = (new TruffleConfig()).with(configJS)

      config = truffleUtils.normalizeConfig(truffleConfig);
    }

    initializeForConfigFile(defaultConfigName);
    api = new API(utils.loadSolcoverJS(config));
    truffle = truffleUtils.loadLibrary(config);

    for (configFile of configs){

      initializeForConfigFile(configFile);

      // =====================
      // Instrument Contracts
      // =====================
      const skipFiles = api.skipFiles || [];

      let {
        targets,
        skipped
      } = utils.assembleFiles(config, skipFiles);

      targets = api.instrument(targets);
      utils.reportSkipped(config, skipped);

      // =================================
      // Filesys and compile configuration
      // =================================
      ({
        tempArtifactsDir,
        tempContractsDir
      } = utils.getTempLocations(config));

      // Only make the artifacts directory once.
      if (!shell.test('-e', tempArtifactsDir)){
        shell.mkdir(tempArtifactsDir);
      }

      // Delete temp contracts dirs if they're left over after a crash.
      if (shell.test('-e', tempContractsDir)){
        shell.rm('-Rf', tempContractsDir);
      }

      shell.mkdir(tempContractsDir);

      utils.save(targets, config.contracts_directory, tempContractsDir);
      utils.save(skipped, config.contracts_directory, tempContractsDir);

      config.contracts_directory = tempContractsDir;
      config.build_directory = tempArtifactsDir;

      config.contracts_build_directory = path.join(
        tempArtifactsDir,
        path.basename(config.contracts_build_directory)
      );

      config.all = true;
      config.compilers.solc.settings.optimizer.enabled = false;
      config.compilers.solc.docker = false;

      // ========
      // Compile
      // ========
      await truffle.contracts.compile(config);

      // Clean up after partial compilation
      shell.rm('-Rf', tempContractsDir);
    }

    // Final config before server launch & test
    initializeForConfigFile(defaultConfigName);

    ({
      tempArtifactsDir,
      tempContractsDir
    } = utils.getTempLocations(config));

    config.build_directory = tempArtifactsDir;
    config.contracts_build_directory = path.join(
      tempArtifactsDir,
      path.basename(config.contracts_build_directory)
    );

    // Copy Uniswap pre-compiles into temp build folder
    const exchangePath = path.join(process.cwd(), 'lib_0.5/uniswap/UniswapExchange.json')
    const factoryPath = path.join(process.cwd(), 'lib_0.5/uniswap/UniswapFactory.json')
    const factoryV3Path = path.join(process.cwd(), 'lib_0.7/uniV3/UniswapV3Factory.json')
    const routerV3Path = path.join(process.cwd(), 'lib_0.7/uniV3/SwapRouter.json')
    shell.cp(exchangePath, config.contracts_build_directory);
    shell.cp(factoryPath, config.contracts_build_directory);
    shell.cp(factoryV3Path, config.contracts_build_directory);
    shell.cp(routerV3Path, config.contracts_build_directory);

    config.compileNone = true;     // Do *not* let Truffle compile anything else.
    config.network = 'development' // Use regular test network (8545)

    truffleUtils.setNetwork(config, api);

    // ========
    // Ganache
    // ========
    const client = api.client || truffle.ganache;
    const address = await api.ganache(client);

    const accountsRequest = await utils.getAccountsGanache(api.server.provider);
    const nodeInfoRequest = await utils.getNodeInfoGanache(api.server.provider);
    const ganacheVersion = nodeInfoRequest.result.split('/')[1];

    truffleUtils.setNetworkFrom(config, accountsRequest.result);

    ui = new PluginUI(config.logger.log);

    // Version Info
    ui.report('versions', [
      truffle.version,
      ganacheVersion,
      pkg.version
    ]);

    // Exit if --version
    if (config.version) return await utils.finish(config, api);

    ui.report('network', [
      config.network,
      config.networks[config.network].network_id,
      config.networks[config.network].port
    ]);

    // ==============
    // Test
    // ==============
    config.test_files = await truffleUtils.getTestFilePaths(config);
    // Run tests
    try {
      failures = await truffle.test.run(config)
    } catch (e) {
      error = e.stack;
    }

    // ========
    // Istanbul
    // ========
    await api.report();

  } catch(e){
    error = e;
  }

  // ====
  // Exit
  // ====
  await utils.finish(config, api);

  if (error !== undefined) throw error;
  if (failures > 0) throw new Error(ui.generate('tests-fail', [failures]));
}

// Run coverage
coverage()
  .then(() => process.exit(0))
  .catch(err => {
    console.log(err);
    process.exit(1)
  });
