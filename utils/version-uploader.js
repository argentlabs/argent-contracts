"use strict"

const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const s3 = new AWS.S3();

const S3_BUCKET_FOLDER_VERSION = "version";

class VersionUploaderS3 {
    constructor(bucket, baseUrl) {
      this._bucket = bucket;
      this._baseUrl = baseUrl;
    }

    async upload(version) {
        let params = {
            Body: JSON.stringify(version),
            Bucket: this._bucket,
            Key: `${S3_BUCKET_FOLDER_VERSION}/${version.fingerprint}.json`
        };
        await s3.putObject(params).promise();

        params = {
            Body: JSON.stringify(version),
            Bucket: this._bucket,
            Key: `${S3_BUCKET_FOLDER_VERSION}/latest.json`
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

    constructor(dir, env) {
        this._dir = dir;
        this._env = env;
    }

    async upload(version) { 
        fs.writeFileSync(this._path(), JSON.stringify(version));
    }

    async load(count) {
        const string = fs.readFileSync(this._path(), 'utf8'); 
        const json = JSON.parse(string);
        return [ json ];
    }

    _path() {
        return path.join(this._dir, this._env ? `${this._env}.latest.json` : `latest.json`);
    }
}

module.exports = {
    S3: VersionUploaderS3,
    Local: VersionUploaderLocal
}
