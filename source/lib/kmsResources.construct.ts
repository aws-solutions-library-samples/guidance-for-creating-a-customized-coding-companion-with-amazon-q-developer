import { Construct } from 'constructs'
import { Key } from 'aws-cdk-lib/aws-kms';
import { PolicyDocument, PolicyStatement, ArnPrincipal, Effect } from 'aws-cdk-lib/aws-iam';
import { Stack } from "aws-cdk-lib";

export class KmsResources extends Construct {

    public key: Key

    constructor(scope: Stack, id: string) {
        super(scope, id);

        const encryptionKeyPolicy = new PolicyDocument({
            statements: [
                new PolicyStatement({
                    actions: ["kms:*"],
                    resources: ["*"],
                    effect: Effect.ALLOW,
                    principals: [
                        new ArnPrincipal(
                            `arn:aws:iam::${scope.account}:root`
                        ),
                    ],
                }),
            ],
        });

        this.key = new Key(this, "EncryptionKey", {
            enabled: true,
            enableKeyRotation: true,
            policy: encryptionKeyPolicy,
        });

    }
}