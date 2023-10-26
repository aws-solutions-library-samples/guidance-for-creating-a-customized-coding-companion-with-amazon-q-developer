import { Construct } from 'constructs'
import { Key } from 'aws-cdk-lib/aws-kms';
import { PolicyStatement, AnyPrincipal, Effect } from 'aws-cdk-lib/aws-iam'
import { Stack } from "aws-cdk-lib";
import { Topic } from 'aws-cdk-lib/aws-sns';


export class SnsResources extends Construct {

    public topic: Topic

    constructor(scope: Stack, id: string, key: Key) {
        super(scope, id);

        this.topic = new Topic(scope, 'AlertTopic', {
            displayName: 'Repository Alert Topic',
            masterKey: key
        });

        const resourcePolicyStatement = new PolicyStatement({
            principals: [
                new AnyPrincipal()
            ],
            effect: Effect.DENY,
            actions: ["sns:Publish"],
            resources: [
                this.topic.topicArn,
            ],
            conditions: {
                Bool: { "aws:SecureTransport": "false" },
            },
        });

        this.topic.addToResourcePolicy(resourcePolicyStatement);
    }
}