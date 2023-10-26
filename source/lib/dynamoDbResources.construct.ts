import { Construct } from 'constructs'
import { Stack, RemovalPolicy } from "aws-cdk-lib";
import { Table, AttributeType, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';


export class DynamoDbResources extends Construct {

    public table: Table;

    constructor(scope: Stack, id: string) {
        super(scope, id);

        this.table = new Table(scope, 'RepoTable', {
            partitionKey: {
                name: 'id',
                type: AttributeType.STRING
            },
            encryption: TableEncryption.AWS_MANAGED,
            pointInTimeRecovery: true,
        });

        this.table.applyRemovalPolicy(RemovalPolicy.DESTROY);
    }
}