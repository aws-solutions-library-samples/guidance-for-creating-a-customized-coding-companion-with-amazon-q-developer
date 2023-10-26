import { Construct } from 'constructs'
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { NagSuppressions } from 'cdk-nag';
import { ServicePrincipal, Role, PolicyStatement, Effect, Policy } from 'aws-cdk-lib/aws-iam'
import { Stack, Duration } from "aws-cdk-lib";
import { Table } from 'aws-cdk-lib/aws-dynamodb';


export class ScanFunction extends Construct {

    public function: NodejsFunction;

    constructor(scope: Stack, id: string, table: Table) {
        super(scope, id);

        const scanFunctionRole = new Role(scope, "ScanFunctionRole", {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            path: "/",
        });

        this.function = new NodejsFunction(scope, 'ScanNodejsFunction', {
            entry: 'lib/lambda/nodejs/scan/index.ts',
            handler: 'index.handler',
            runtime: Runtime.NODEJS_18_X,
            timeout: Duration.seconds(30),
            environment: {
                'TABLE_NAME': table.tableName
            },
            role: scanFunctionRole
        });

        const scanFunctionLogGroup = new LogGroup(scope, 'ScanFunctionLogGroup', {
            logGroupName: `/aws/lambda/${this.function.functionName}`,
        });

        const scanFunctionRolePolicy = new Policy(scope, "ScanFunctionPolicy", {
            statements: [
                new PolicyStatement({
                    actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
                    resources: [
                        scanFunctionLogGroup.logGroupArn,
                    ],
                }),
                new PolicyStatement({
                    actions: [
                        'dynamodb:Scan',
                    ],
                    resources: [table.tableArn],
                    effect: Effect.ALLOW,
                })
            ],
        });

        scanFunctionRolePolicy.attachToRole(scanFunctionRole);

    }
}