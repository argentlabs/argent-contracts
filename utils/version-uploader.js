"use strict"

var AWS = require('aws-sdk');

var s3 = new AWS.S3();

const S3_BUCKET_FOLDER_VERSION = "version";

class VersionUploaderS3 {
    constructor(bucket, baseUrl) {
      this._bucket = bucket;
      this._baseUrl = baseUrl;
    }

    async upload(version) {
        const params = {
            Body: JSON.stringify(version),
            Bucket: this._bucket,
            Key: `${S3_BUCKET_FOLDER_VERSION}/${version.fingerprint}.json`
        };
        await s3.putObject(params).promise();
    }

    async load(count) {
        const response = await fetch(`${this._baseUrl}/versions?count=${count}`);
        const json = await response.json();
        return json.versions;
    }
}

class VersionUploaderLocal{

    constructor(dir) {
        this._dir = dir;
    }
    async upload(version) { 
        console.log(version);
    }

    async load(count) {
        
    }
}

module.exports = {
    S3: VersionUploaderS3,
    Local: VersionUploaderLocal
}
