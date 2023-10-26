import { Construct } from 'constructs'
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3'
import { Stack, RemovalPolicy } from "aws-cdk-lib";

export class S3Resources extends Construct {

    public bucket: Bucket

    constructor(scope: Stack, id: string) {
        super(scope, id);

        const removalPolicyString: string = scope.node.tryGetContext("bucket_removal_policy");
        let removalPolicy: RemovalPolicy;
        let autoDeleteObjects: boolean;

        if (removalPolicyString === 'DESTROY') {
            removalPolicy = RemovalPolicy.DESTROY;
            autoDeleteObjects = true;
        } else {
            removalPolicy = RemovalPolicy.RETAIN;
            autoDeleteObjects = false;
        }

        this.bucket = new Bucket(scope, 'RepoBucket', {
            bucketName: `${scope.node.tryGetContext('bucket_name_prefix')}-${scope.account}-${scope.region}`,
            removalPolicy: removalPolicy,
            autoDeleteObjects: autoDeleteObjects,
            encryption: BucketEncryption.S3_MANAGED,
            serverAccessLogsPrefix: 's3_server_access_logs/',
            enforceSSL: true,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL
        });

    }
}