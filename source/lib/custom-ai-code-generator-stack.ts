import { Construct } from 'constructs';
import { EventbridgeToStepfunctions, EventbridgeToStepfunctionsProps } from '@aws-solutions-constructs/aws-eventbridge-stepfunctions';
import * as cdk from 'aws-cdk-lib';
import * as cliLayer from 'aws-cdk-lib/lambda-layer-awscli';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as triggers from 'aws-cdk-lib/triggers';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as fs from 'fs';
import path = require('path');
import * as assets from 'aws-cdk-lib/aws-s3-assets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';


export class CustomAiCodeGeneratorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const repoTable = new ddb.Table(this, 'RepoTable', {
      partitionKey: {
        name: 'id',
        type: ddb.AttributeType.STRING
      },
      encryption: ddb.TableEncryption.AWS_MANAGED,
    });

    repoTable.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    const repoBucket = new s3.Bucket(this, 'RepoBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED
    });

    const repos: string[] = this.node.tryGetContext('public_github_repos');

    const repoJsonObject: any = {
      repositories: []
    }

    let params: ssm.StringParameter[] = [];
    let ignoreFiles: assets.Asset[] = [];

    for (let i = 0; i < repos.length; i++) {

      const repo = repos[i];

      const repoSplit = repo.split('/');
      const org = repoSplit[0];
      const repoName = repoSplit[1];
      let ignoreFileParam = undefined;

      if (fs.existsSync(`lib/ignore/${org}_${repoName}.ignore`)) {

        let asset = new assets.Asset(this, `${org}_${repoName}.ignore`, {
          path: path.join(__dirname, `ignore/${org}_${repoName}.ignore`),
        });

        console.log(`${org}_${repoName}.ignore`)

        ignoreFiles.push(asset);

        const param = new ssm.StringParameter(this, `${org}_${repoName}.param`, {
          parameterName: `/${org}/${repoName}/ignore_file`,
          stringValue: asset.s3ObjectUrl,
          description: `Ignore file for ${org}/${repoName}`
        });

        params.push(param);

        ignoreFileParam = `/${org}/${repoName}/ignore_file`;
      }

      repoJsonObject.repositories.push({
        id: repo,
        org: org,
        repo: repoName,
        ignore_file_param: ignoreFileParam
      });
    };

    fs.writeFile('./lib/repo.config', JSON.stringify(repoJsonObject), err => {
      if (err) {
        console.log('Error writing file', err)
      } else {
        console.log('Successfully wrote file')
        const repoConfigFile = new assets.Asset(this, 'RepoConfigFile', {
          path: path.join(__dirname, `repo.config`),
        });

        const triggerFunction = new NodejsFunction(this, 'TableLoaderFunction', {
          entry: 'lib/lambda/nodejs/table-loader/index.ts',
          handler: 'index.handler',
          runtime: lambda.Runtime.NODEJS_18_X,
          timeout: cdk.Duration.seconds(30),
          environment: {
            'TABLE_NAME': repoTable.tableName,
            'REPOS': repos.join(";"),
            'REPO_CONFIG_BUCKET': repoConfigFile.s3BucketName,
            'REPO_CONFIG_KEY': repoConfigFile.s3ObjectKey,
          },

        });

        repoConfigFile.grantRead(triggerFunction);

        params.forEach(param => {
          param.grantRead(triggerFunction);
        });

        triggerFunction.addToRolePolicy(new iam.PolicyStatement({
          actions: [
            'dynamodb:UpdateItem',
            'dynamodb:Scan',
          ],
          resources: [repoTable.tableArn],
          effect: iam.Effect.ALLOW,
        }));

        const trigger = new triggers.Trigger(this, 'Trigger', {
          handler: triggerFunction
        });
      }
    });




    const scanFunction = new NodejsFunction(this, 'ScanFunction', {
      entry: 'lib/lambda/nodejs/repo-lookup/index.ts',
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
      environment: {
        'TABLE_NAME': repoTable.tableName
      },

    });

    scanFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:Scan',
      ],
      resources: [repoTable.tableArn],
      effect: iam.Effect.ALLOW,
    }));

    const repoDiffFunction = new NodejsFunction(this, 'RepoDiffFunction', {
      entry: 'lib/lambda/nodejs/repo-diff/index.ts',
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30)
    });

    const archiveFunction = new lambda.Function(this, 'ArchiveFunction', {
      code: lambda.Code.fromAsset('lib/lambda/python/repo-archive'),
      handler: 'main.handler',
      runtime: lambda.Runtime.PYTHON_3_11,
      timeout: cdk.Duration.seconds(900),
      environment: {
        'TABLE_NAME': repoTable.tableName,
        'BUCKET_NAME': repoBucket.bucketName
      },
      layers: [
        new cliLayer.AwsCliLayer(this, 'AwsCliLayer'),
        lambda.LayerVersion.fromLayerVersionArn(this, 'GitLayer', `arn:aws:lambda:${this.region}:553035198032:layer:git-lambda2:8`)
      ],
      architecture: lambda.Architecture.X86_64,
      memorySize: 1024,
      ephemeralStorageSize: cdk.Size.gibibytes(4)
    });

    archiveFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:UpdateItem',
      ],
      resources: [repoTable.tableArn],
      effect: iam.Effect.ALLOW,
    }));

    repoBucket.grantReadWrite(archiveFunction);

    ignoreFiles.forEach(ignoreFile => {
      ignoreFile.grantRead(archiveFunction);
      console.log(ignoreFile.s3ObjectUrl)
    });

    const map = new sfn.Map(this, "RepoDiffTask", {
      itemsPath: '$.Payload.body.response',
    });

    const choice = new sfn.Choice(this, 'Choice');
    const condition1 = sfn.Condition.booleanEquals("$.Payload.body.should_archive", true);

    const definition = choice.when(condition1, new tasks.LambdaInvoke(this, "ArchiveTask", {
      lambdaFunction: archiveFunction
    })).otherwise(new sfn.Pass(this, 'Pass')).afterwards().next(new sfn.Succeed(this, 'Succeed'));

    const mapDefinition = new tasks.LambdaInvoke(this, "DiffTask", {
      lambdaFunction: repoDiffFunction
    }).next(choice);

    map.iterator(mapDefinition);

    const constructProps: EventbridgeToStepfunctionsProps = {
      stateMachineProps: {
        definition: new tasks.LambdaInvoke(this, "ScanTask", {
          lambdaFunction: scanFunction
        }).next(map)
      },
      eventRuleProps: {
        schedule: events.Schedule.rate(cdk.Duration.minutes(60))
      }
    };

    new EventbridgeToStepfunctions(this, 'ScheduledStateMachine', constructProps);
  }
};
