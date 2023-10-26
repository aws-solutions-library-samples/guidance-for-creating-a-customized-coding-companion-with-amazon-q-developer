import { Construct } from 'constructs';
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { KmsResources } from './kmsResources.construct';
import { S3Resources } from './s3Resources.construct';
import { FargateResources } from './fargateResources.construct';
import { ScanFunction } from './scanFunction.construct';
import { RepoDiffFunction } from './repoDiffFunction.construct';
import { TableLoaderFunction } from './tableLoaderFunction.construct';
import { DynamoDbResources } from './dynamoDbResources.construct';
import { SnsResources } from './snsResources.construct';
import { StepFunctionsResources } from './stepFunctionsResources.construct';


export class CustomAiCodeGeneratorStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const stackName = this.node.tryGetContext('stack_name');

    const dynamoDbResources = new DynamoDbResources(this, 'DynamoDbResources');

    const s3Resources = new S3Resources(this, 'S3Resources');

    const kmsResources = new KmsResources(this, 'KmsResources');

    const snsResources = new SnsResources(this, 'SnsResources', kmsResources.key);

    const scanFunction = new ScanFunction(this, 'ScanFunction', dynamoDbResources.table);

    const repoDiffFunction = new RepoDiffFunction(this, 'RepoDiffFunction');

    const tableLoaderFunction = new TableLoaderFunction(this, 'TableLoaderFunction', stackName, dynamoDbResources.table, s3Resources.bucket);

    const fargateResources = new FargateResources(this, 'FargateResources', s3Resources.bucket, tableLoaderFunction.repoConfigFile.bucket, snsResources.topic, kmsResources.key, dynamoDbResources.table);

    const stepFunctionResources = new StepFunctionsResources(this, 'StepFunctionsResources', fargateResources.cluster, fargateResources.taskDefinition, fargateResources.containerDefinition, s3Resources.bucket, dynamoDbResources.table, snsResources.topic, fargateResources.securityGroup, scanFunction.function, repoDiffFunction.function);

    new CfnOutput(this, 'RepositoryBucket', { value: s3Resources.bucket.bucketName });
  }

};
