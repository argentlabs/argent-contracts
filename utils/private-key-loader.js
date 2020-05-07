const AWS = require("aws-sdk");

const kms = new AWS.KMS();
const s3 = new AWS.S3();

class PrivateKeyLoader {
  constructor(s3Bucket, s3Key) {
    this.s3Bucket = s3Bucket;
    this.s3Key = s3Key;
  }

  async fetch() {
    const object = await s3.getObject({ Bucket: this.s3Bucket, Key: this.s3Key }).promise();
    const data = await kms.decrypt({ CiphertextBlob: object.Body }).promise();
    const pkey = data.Plaintext.toString("utf8");

    return pkey;
  }
}

module.exports = PrivateKeyLoader;
