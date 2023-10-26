import { Construct } from 'constructs'
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { ServicePrincipal, Role, PolicyStatement, Policy } from 'aws-cdk-lib/aws-iam'
import { Stack, Duration } from "aws-cdk-lib";


export class RepoDiffFunction extends Construct {

    public function: NodejsFunction;

    constructor(scope: Stack, id: string) {
        super(scope, id);

        const repoDiffFunctionRole = new Role(scope, "RepoDiffFunctionRole", {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            path: "/",
        });

        this.function = new NodejsFunction(scope, 'RepoDiffNodejsFunction', {
            entry: 'lib/lambda/nodejs/repo-diff/index.ts',
            handler: 'index.handler',
            runtime: Runtime.NODEJS_18_X,
            timeout: Duration.seconds(30),
            role: repoDiffFunctionRole
        });


        const repoDiffFunctionLogGroup = new LogGroup(scope, 'RepoDiffFunctionLogGroup', {
            logGroupName: `/aws/lambda/${this.function.functionName}`,
        });

        const repoDiffFunctionRolePolicy = new Policy(scope, "RepoDiffFunctionPolicy", {
            statements: [
                new PolicyStatement({
                    actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
                    resources: [
                        repoDiffFunctionLogGroup.logGroupArn,
                    ],
                }),
            ],
        });

        repoDiffFunctionRolePolicy.attachToRole(repoDiffFunctionRole);
    }
}