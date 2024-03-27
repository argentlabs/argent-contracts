# Deployment

## 1. Compile the contracts:

`npm run cc`

If setting up a new environment `ENV_NAME` for the first time:

- Add the new environment in `truffle-config.base.js`
- Add a new AWS configuration locally
- Add it to `S3_BUCKET_SUFFIXES` in `.env`

## 2. Deploy and verify the contracts:


If you need to do some manual changes to the config file and reupload it to S3 you can do it like this:

Download:

`aws-vault exec argent-ENV_NAME -- aws s3 cp s3://argent-smartcontracts-ENV_NAME/backend/config.json ./config.json`

Upload:

`aws-vault exec argent-ENV_NAME -- aws s3 cp ./config.json s3://argent-smartcontracts-ENV_NAME/backend/config.json`


Run the four deployments scripts in order (you can find them in the `deployment/` directory).

```
./scripts/deploy.sh --no-compile ENV_NAME 1
./scripts/deploy.sh --no-compile ENV_NAME 2
./scripts/deploy.sh --no-compile ENV_NAME 3
./scripts/deploy.sh --no-compile ENV_NAME 4
./scripts/execute_script.sh --no-compile scripts/verify.js ENV_NAME
```

## 3. Configure the DappRegistry

- Go to the `argent-trustslists` repo
- Make sure the values in `scripts/config/ENV_NAME.json` match the config file you created earlier in `argent-contracts` (multisig, ens manager, dapp registry, ...)
- Run the deploy script: `aws-vault exec argent-ENV_NAME -- yarn hardhat run ./scripts/configure-registries.ts --network ENV_NAME`
