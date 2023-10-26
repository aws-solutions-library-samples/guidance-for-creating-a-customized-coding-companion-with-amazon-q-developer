import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3'
import { Cluster, Compatibility, TaskDefinition, ContainerImage, AwsLogDriver, ContainerDefinition } from 'aws-cdk-lib/aws-ecs'
import { Construct } from 'constructs'
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { FlowLogTrafficType, FlowLogDestination, SecurityGroup, Vpc } from 'aws-cdk-lib/aws-ec2'
import { Key } from 'aws-cdk-lib/aws-kms';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { NagSuppressions } from 'cdk-nag';
import { ServicePrincipal, Role, PolicyStatement, ManagedPolicy, Effect } from 'aws-cdk-lib/aws-iam'
import { Stack } from "aws-cdk-lib";
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Topic } from 'aws-cdk-lib/aws-sns';
import path = require('path');


export class FargateResources extends Construct {

    public cluster: Cluster;
    public taskDefinition: TaskDefinition;
    public containerDefinition: ContainerDefinition;
    public securityGroup: SecurityGroup;

    constructor(scope: Stack, id: string, bucket: Bucket, assetBucket: IBucket, topic: Topic, key: Key, table: Table) {
        super(scope, id);

        const containerAsset = new DockerImageAsset(scope, 'ArchiveContainerImageAsset', {
            directory: path.join(__dirname, 'container/repo-archive')
        });

        this.cluster = new Cluster(scope, 'FargateCluster', {
            vpc: new Vpc(scope, 'ClusterVpc', {
                maxAzs: 3,
            }),
            containerInsights: true
        });

        this.cluster.vpc.addFlowLog('VpcFlowLog', {
            trafficType: FlowLogTrafficType.ALL,
            destination: FlowLogDestination.toCloudWatchLogs()
        })

        const taskDefinitionExecutionRole = new Role(scope, 'ArchiveTaskExecutionRole', {
            assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
        });

        taskDefinitionExecutionRole.addToPolicy(new PolicyStatement({
            actions: [
                "ecr:BatchCheckLayerAvailability",
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer"
            ],
            resources: [
                containerAsset.repository.repositoryArn
            ]
        }));

        taskDefinitionExecutionRole.addToPolicy(new PolicyStatement({
            actions: [
                "ecr:GetAuthorizationToken",
            ],
            resources: [
                "*"
            ]
        }));

        const logGroup = new LogGroup(scope, 'FargateLogGroup');

        const logDriver = new AwsLogDriver({
            logGroup: logGroup,
            streamPrefix: "ArchiveFargateTask"
        });

        taskDefinitionExecutionRole.addToPolicy(new PolicyStatement({
            actions: [
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            resources: [
                `${logGroup.logGroupArn}:*`
            ]
        }));

        NagSuppressions.addResourceSuppressions(
            taskDefinitionExecutionRole,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Wildcard is used for creating new logs in the Fargate log group.',
                    appliesTo: [
                        'Resource::*',
                        {
                            regex: '/^Resource::<FargateLogGroup(.*):\\*$/g'
                        },
                    ]
                }
            ],
            true
        );

        this.taskDefinition = new TaskDefinition(scope, 'ArchiveTaskDefinition', {
            memoryMiB: '512',
            cpu: '256',
            compatibility: Compatibility.FARGATE,
            executionRole: taskDefinitionExecutionRole
        });

        this.taskDefinition.taskRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName(
                "service-role/AmazonECSTaskExecutionRolePolicy"
            )
        );

        this.taskDefinition.addToTaskRolePolicy(new PolicyStatement({
            actions: [
                'dynamodb:UpdateItem',
            ],
            resources: [table.tableArn],
            effect: Effect.ALLOW,
        }));

        this.taskDefinition.addToTaskRolePolicy(new PolicyStatement({
            actions: [
                "s3:DeleteObject",
                "s3:GetBucketLocation",
                "s3:GetObject",
                "s3:ListBucket",
                "s3:PutObject",
            ],
            resources: [
                `arn:aws:s3:::${bucket.bucketName}`,
                `arn:aws:s3:::${bucket.bucketName}/*`
            ],
        }));

        this.taskDefinition.addToTaskRolePolicy(new PolicyStatement({
            actions: [
                "sns:Publish",
            ],
            resources: [
                topic.topicArn
            ],
        }));

        this.taskDefinition.addToTaskRolePolicy(new PolicyStatement({
            actions: [
                "kms:GenerateDataKey*",
                "kms:Decrypt",
            ],
            resources: [
                key.keyArn
            ],
        }));

        this.taskDefinition.addToTaskRolePolicy(new PolicyStatement({
            actions: ["s3:GetObject*", "s3:GetBucket*", "s3:List*"],
            resources: [
                `arn:aws:s3:::${assetBucket.bucketName}/*`,
                `arn:aws:s3:::${assetBucket.bucketName}`,
            ],
        }),);

        // Suppress resource based findings automatically added by CDK
        NagSuppressions.addResourceSuppressions(
            [this.taskDefinition.taskRole],
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Using managed policy as recommended in Task Execution IAM Role documentation for ECS: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html',
                    appliesTo: [
                        'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
                    ]
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Explicit permission for the Fargate task to access all objects in the provided S3 bucket.',
                    appliesTo: [
                        {
                            regex: `/^Resource::arn:aws:s3:::<${bucket.node.id}(.*)\\*$/g`
                        }
                    ]
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Default permissions for accessing objects in CDK assets bucket (from cdk bootstrap).',
                    appliesTo: [
                        'Action::s3:List*',
                        'Action::s3:GetObject*',
                        'Action::s3:GetBucket*',
                        `Resource::arn:aws:s3:::${assetBucket.bucketName}/*`,
                    ]
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Configured as described in Amazon SNS Developer Guide: https://docs.aws.amazon.com/sns/latest/dg/sns-key-management.html',
                    appliesTo: [
                        'Action::kms:GenerateDataKey*',
                    ]
                }
            ],
            true
        );

        this.containerDefinition = this.taskDefinition.addContainer('ArchiveContainerDefinition', {
            image: ContainerImage.fromDockerImageAsset(containerAsset),
            memoryLimitMiB: 256,
            logging: logDriver
        });

        this.securityGroup = new SecurityGroup(scope, 'FargateSecurityGroup', {
            vpc: this.cluster.vpc,
            securityGroupName: "Fargate",
            description: "Allow access to Fargate",
        });

    }
}