// eslint-disable-next-line max-classes-per-file
const AWS = require("aws-sdk");

const s3 = new AWS.S3();

const S3_BUCKET_FOLDER_ABI = "ABI";
const S3_BUCKET_FOLDER_BUILD = "build";

class ABIUploaderS3 {
  constructor(bucket) {
    this._bucket = bucket;
  }

  async upload(contractWrapper, folder) {
    const { contractName } = contractWrapper._contract;
    const filename = contractWrapper.address;

    console.log(`Uploading ${contractName} ABI to AWS...`);

    await s3.putObject({
      Body: JSON.stringify(contractWrapper._contract.abi),
      Bucket: this._bucket,
      Key: `${S3_BUCKET_FOLDER_ABI}/${folder}/${contractName}/${filename}.json`,
    }).promise();

    await s3.putObject({
      Body: JSON.stringify(contractWrapper._contract.abi),
      Bucket: this._bucket,
      Key: `${S3_BUCKET_FOLDER_ABI}/ALL/${filename}.json`,
    }).promise();

    await s3.putObject({
      Body: JSON.stringify(contractWrapper._contract),
      Bucket: this._bucket,
      Key: `${S3_BUCKET_FOLDER_BUILD}/${folder}/${contractName}/${filename}.json`,
    }).promise();

    await s3.putObject({
      Body: JSON.stringify(contractWrapper._contract),
      Bucket: this._bucket,
      Key: `${S3_BUCKET_FOLDER_BUILD}/ALL/${filename}.json`,
    }).promise();
  }
}

class ABIUploaderNone {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars, no-empty-function
  async upload(contract, folder) { }
}

module.exports = {
  S3: ABIUploaderS3,
  None: ABIUploaderNone,
};
