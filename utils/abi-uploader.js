"use strict"

var AWS = require('aws-sdk');

var s3 = new AWS.S3();

const S3_BUCKET_FOLDER_ABI = "ABI";
const S3_BUCKET_FOLDER_BUILD = "build";

class ABIUploaderS3 {
    constructor(bucket) {
      this._bucket = bucket;
    }

    async upload(contractWrapper, folder) {
        const contractName = contractWrapper._contract.contractName;
        const filename = contractWrapper.contractAddress;

        console.log(`Uploading ${contractName} ABI to AWS...`)

        await s3.putObject({
            Body: JSON.stringify(contractWrapper._contract.abi),
            Bucket: this._bucket,
            Key: `${S3_BUCKET_FOLDER_ABI}/${folder}/${contractName}/${filename}.json`
        }).promise();

        await s3.putObject({
            Body: JSON.stringify(contractWrapper._contract.abi),
            Bucket: this._bucket,
            Key: `${S3_BUCKET_FOLDER_ABI}/ALL/${filename}.json`
        }).promise();

        await s3.putObject({
            Body: JSON.stringify(contractWrapper._contract),
            Bucket: this._bucket,
            Key: `${S3_BUCKET_FOLDER_BUILD}/${folder}/${contractName}/${filename}.json`
        }).promise();

        await s3.putObject({
            Body: JSON.stringify(contractWrapper._contract),
            Bucket: this._bucket,
            Key: `${S3_BUCKET_FOLDER_BUILD}/ALL/${filename}.json`
        }).promise();
    }
}

class ABIUploaderNone {
    async upload(contract, folder) { }
}

module.exports = {
    S3: ABIUploaderS3,
    None: ABIUploaderNone
}
