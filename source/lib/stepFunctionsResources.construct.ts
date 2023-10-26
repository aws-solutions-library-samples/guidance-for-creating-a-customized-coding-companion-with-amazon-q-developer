import { Construct } from 'constructs'
import { Stack, Duration } from "aws-cdk-lib";
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { EcsRunTask, EcsFargateLaunchTarget, LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { IntegrationPattern, JsonPath, Choice, Condition, Map, Pass, Succeed, LogLevel } from 'aws-cdk-lib/aws-stepfunctions';
import { Role, ServicePrincipal, Policy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Schedule } from 'aws-cdk-lib/aws-events';
import { EventbridgeToStepfunctions, EventbridgeToStepfunctionsProps } from '@aws-solutions-constructs/aws-eventbridge-stepfunctions';
import { NagSuppressions } from 'cdk-nag';
import { Cluster, ContainerDefinition, TaskDefinition } from 'aws-cdk-lib/aws-ecs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export class StepFunctionsResources extends Construct {

    public table: Table;

    constructor(scope: Stack, id: string, cluster: Cluster, taskDefinition: TaskDefinition, containerDefinition: ContainerDefinition, bucket: Bucket, table: Table, topic: Topic, securityGroup: SecurityGroup, scanFunction: NodejsFunction, repoDiffFunction: NodejsFunction) {
        super(scope, id);

        const runArchiveTask = new EcsRunTask(scope, 'RunFargateArchiveTask', {
            integrationPattern: IntegrationPattern.RUN_JOB,
            cluster,
            taskDefinition,
            assignPublicIp: true,
            containerOverrides: [{
                containerDefinition,
                environment: [
                    { name: 'BUCKET_NAME', value: bucket.bucketName },
                    { name: 'TABLE_NAME', value: table.tableName },
                    { name: 'TAG_NAME', value: JsonPath.stringAt('$.Payload.body.release.tag_name') },
                    { name: 'IGNORE_FILE_S3_URL', value: JsonPath.stringAt('$.Payload.body.ignore_file_s3_url') },
                    { name: 'ZIPBALL_URL', value: JsonPath.stringAt('$.Payload.body.release.zipball_url') },
                    { name: 'REPO_ID', value: JsonPath.stringAt('$.Payload.body.id') },
                    { name: 'LAST_VERSION', value: JsonPath.stringAt('$.Payload.body.last_version') },
                    { name: 'SNS_TOPIC_ARN', value: topic.topicArn }
                ],
            }],
            launchTarget: new EcsFargateLaunchTarget(),
            resultPath: "$.archiveResults",
            securityGroups: [
                securityGroup
            ]
        });

        const stateMachineRole = new Role(scope, "StateMachineRole", {
            assumedBy: new ServicePrincipal("states.amazonaws.com"),
            path: "/",
        });

        const map = new Map(scope, "RepoDiffTask", {
            itemsPath: '$.Payload.body.response',
        });

        const choice = new Choice(scope, 'Choice');
        const condition1 = Condition.booleanEquals("$.Payload.body.should_archive", true);

        const definition = choice.when(condition1, runArchiveTask)
            .otherwise(new Pass(scope, 'Pass'))
            .afterwards().next(new Succeed(scope, 'Succeed'));

        const mapDefinition = new LambdaInvoke(scope, "DiffTask", {
            lambdaFunction: repoDiffFunction,
        }).next(choice);

        map.iterator(mapDefinition);

        const intervalMinutes: number = Number(scope.node.tryGetContext("update_interval_minutes"));

        const stateMachineLogGroup = new LogGroup(scope, 'StateMachineLogGroup');

        const stateMachineRolePolicy = new Policy(scope, "StateMachinePolicy", {
            statements: [
                new PolicyStatement({
                    actions: [
                        "logs:CreateLogDelivery",
                        "logs:CreateLogGroup",
                        "logs:CreateLogStream",
                        "logs:DeleteLogDelivery",
                        "logs:DescribeLogGroups",
                        "logs:DescribeResourcePolicies",
                        "logs:GetLogDelivery",
                        "logs:ListLogDeliveries",
                        "logs:PutLogEvents",
                        "logs:PutResourcePolicy",
                        "logs:UpdateLogDelivery",
                    ],
                    resources: [
                        stateMachineLogGroup.logGroupArn
                    ],
                }),
                new PolicyStatement({
                    actions: [
                        'lambda:InvokeFunction',
                    ],
                    resources: [
                        scanFunction.functionArn,
                        repoDiffFunction.functionArn
                    ],
                    effect: Effect.ALLOW,
                }),
            ],
        });

        stateMachineRolePolicy.attachToRole(stateMachineRole);

        const constructProps: EventbridgeToStepfunctionsProps = {
            stateMachineProps: {
                definition: new LambdaInvoke(scope, "ScanTask", {
                    lambdaFunction: scanFunction,
                }).next(map),
                logs: {
                    level: LogLevel.ALL,
                    destination: stateMachineLogGroup
                },
                tracingEnabled: true,
                role: stateMachineRole,
            },
            eventRuleProps: {
                schedule: Schedule.rate(Duration.minutes(intervalMinutes))
            },
        };

        const eventbridgeToSfn = new EventbridgeToStepfunctions(scope, 'ScheduledStateMachine', constructProps);

        // Suppress resource based findings automatically added by CDK
        NagSuppressions.addResourceSuppressions(
            eventbridgeToSfn.stateMachine.role,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Suppress AwsSolutions-IAM5 resource and action based findings for StepFunction default policy',
                    appliesTo: [
                        'Resource::*',
                        {
                            regex: '/^Resource::<ScanNodejsFunction(.*):\\*$/g'
                        },
                        {
                            regex: '/^Resource::<RepoDiffNodejsFunction(.*):\\*$/g'
                        },
                    ]
                }
            ],
            true
        );
    }
}