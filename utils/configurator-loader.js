const AWS = require('aws-sdk');
const fs = require('fs');

const s3 = new AWS.S3();

class ConfiguratorLoaderS3 {
    constructor(bucket, key) {
        this.bucket = bucket;
        this.key = key;
    }

    async load() {
        const params = {
            Bucket: this.bucket,
            Key: this.key
        };
        const object = await s3.getObject(params).promise();
        const json = object.Body.toString('utf-8');
        return json;
    }

    async save(json) {
        const params = {
            Body: json,
            Bucket: this.bucket,
            Key: this.key
        };
        await s3.putObject(params).promise();
    }
}

class ConfiguratorLoaderLocal {
    constructor(path) {
        this.path = path;
    }

    async load() {
        const json = fs.readFileSync(this.path, 'utf8');
        return json;
    }

    async save(json) {
        fs.writeFileSync(this.path, json);
    }
}

module.exports = {
    S3: ConfiguratorLoaderS3,
    Local: ConfiguratorLoaderLocal,
};
