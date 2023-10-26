import { Construct } from 'constructs'
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { NagSuppressions } from 'cdk-nag';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { ServicePrincipal, Role, PolicyStatement, Effect, Policy } from 'aws-cdk-lib/aws-iam'
import { Stack, Duration } from "aws-cdk-lib";
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Trigger } from 'aws-cdk-lib/triggers';
import * as fs from 'fs';
import path = require('path');
import { Bucket } from 'aws-cdk-lib/aws-s3';


export class TableLoaderFunction extends Construct {

    public function: NodejsFunction;
    public repoConfigFile: Asset;

    constructor(scope: Stack, id: string, stackName: string, table: Table, bucket: Bucket) {
        super(scope, id);

        const repos: string[] = this.node.tryGetContext('public_github_repos');

        const repoJsonObject: any = {
            repositories: []
        }

        let params: StringParameter[] = [];
        let ignoreFiles: Asset[] = [];

        for (let i = 0; i < repos.length; i++) {

            const repo = repos[i];

            const repoSplit = repo.split('/');
            const org = repoSplit[0];
            const repoName = repoSplit[1];
            let ignoreFileParam = undefined;

            if (fs.existsSync(`lib/ignore/${org}_${repoName}.ignore`)) {

                let asset = new Asset(scope, `${stackName}_${org}_${repoName}.ignore`, {
                    path: path.join(__dirname, `ignore/${org}_${repoName}.ignore`),
                });

                console.log(`${org}_${repoName}.ignore`)

                ignoreFiles.push(asset);

                const param = new StringParameter(scope, `${stackName}_${org}_${repoName}.param`, {
                    parameterName: `/${stackName}/${org}/${repoName}/ignore_file`,
                    stringValue: asset.s3ObjectUrl,
                    description: `Ignore file for ${stackName}/${org}/${repoName}`
                });

                params.push(param);

                ignoreFileParam = `/${stackName}/${org}/${repoName}/ignore_file`;
            }

            repoJsonObject.repositories.push({
                id: repo,
                org: org,
                repo: repoName,
                ignore_file_param: ignoreFileParam
            });
        };

        fs.writeFileSync('./lib/repo.config', JSON.stringify(repoJsonObject));

        console.log('Successfully wrote file')
        this.repoConfigFile = new Asset(scope, 'RepoConfigFile', {
            path: path.join(__dirname, `repo.config`),
        });

        const tableLoaderFunctionRole = new Role(scope, "TableLoaderFunctionRole", {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            path: "/",
        });

        this.function = new NodejsFunction(scope, 'TableLoaderNodejsFunction', {
            entry: 'lib/lambda/nodejs/table-loader/index.ts',
            handler: 'index.handler',
            runtime: Runtime.NODEJS_18_X,
            timeout: Duration.seconds(30),
            environment: {
                'TABLE_NAME': table.tableName,
                'REPOS': repos.join(";"),
                'REPO_CONFIG_BUCKET': this.repoConfigFile.s3BucketName,
                'REPO_CONFIG_KEY': this.repoConfigFile.s3ObjectKey,
            },
            role: tableLoaderFunctionRole
        });

        const tableLoaderFunctionLogGroup = new LogGroup(scope, 'TableLoaderFunctionLogGroup', {
            logGroupName: `/aws/lambda/${this.function.functionName}`,
        });

        let paramArns: string[] = [];

        params.forEach(param => {
            paramArns.push(param.parameterArn);
        });

        const tableLoaderFunctionRolePolicy = new Policy(scope, "TableLoaderFunctionRolePolicy", {
            statements: [
                new PolicyStatement({
                    actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
                    resources: [
                        tableLoaderFunctionLogGroup.logGroupArn
                    ],
                }),
                new PolicyStatement({
                    actions: [
                        'dynamodb:UpdateItem',
                        'dynamodb:Scan'
                    ],
                    resources: [table.tableArn],
                    effect: Effect.ALLOW,
                }),
                new PolicyStatement({
                    actions: ["s3:GetObject"],
                    resources: [
                        `arn:aws:s3:::${bucket.bucketName}/*`,
                    ],
                }),
                new PolicyStatement({
                    actions: ["s3:GetObject*", "s3:GetBucket*", "s3:List*"],
                    resources: [
                        `arn:aws:s3:::${this.repoConfigFile.bucket.bucketName}/*`,
                        `arn:aws:s3:::${this.repoConfigFile.bucket.bucketName}`,
                    ],
                }),
                new PolicyStatement({
                    actions: ["ssm:GetParameter"],
                    resources: paramArns,
                })
            ],
        });

        tableLoaderFunctionRolePolicy.attachToRole(tableLoaderFunctionRole);

        // Suppress resource based findings automatically added by CDK
        NagSuppressions.addResourceSuppressions(
            [tableLoaderFunctionRolePolicy],
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'lorem ipsum',
                    appliesTo: [
                        {
                            regex: `/^Resource::arn:aws:s3:::<${bucket.node.id}(.*)\\*$/g`
                        }
                    ]
                }
            ]
        );

        // Suppress resource based findings automatically added by CDK
        NagSuppressions.addResourceSuppressions(
            [tableLoaderFunctionRolePolicy],
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'lorem ipsum',
                    appliesTo: [
                        'Action::s3:List*',
                        'Action::s3:GetObject*',
                        'Action::s3:GetBucket*',
                        `Resource::arn:aws:s3:::${this.repoConfigFile.bucket.bucketName}/*`
                    ]
                }
            ],
            true
        );

        const trigger = new Trigger(scope, 'Trigger', {
            handler: this.function,
        });
    }
}