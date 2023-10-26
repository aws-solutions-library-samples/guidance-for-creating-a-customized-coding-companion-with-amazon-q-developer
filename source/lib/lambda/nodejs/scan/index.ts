import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
const client = new DynamoDBClient();

export const handler = async (event: any, context: any) => {

    const response = await scanForEnabledRepos();
    console.log(response);
    return {
        body: {
            response: response
        }
    };
};

async function scanForEnabledRepos() {

    let enabledRepos: any[] = [];

    try {

        console.log(`Scanning for enabled repos in table ${process.env.TABLE_NAME}`);

        const input = {
            TableName: process.env.TABLE_NAME,
            ExpressionAttributeValues: {
                ':f': {
                    BOOL: true
                }
            },
            FilterExpression: 'enabled = :f',
            ProjectionExpression: 'id, version, ignore_file_s3_url'
        };

        const command = new ScanCommand(input);
        const response: any = await client.send(command);
        console.log(response);

        for (let i = 0; i < response.Items.length; i++) {

            enabledRepos.push({
                id: response.Items[i].id.S,
                version: response.Items[i]?.version ? response.Items[i].version.S : "NULL",
                ignore_file_s3_url: response.Items[i]?.ignore_file_s3_url ? response.Items[i].ignore_file_s3_url.S : "NULL"
            });
        }

    } catch (err) {
        console.log(err);
    }

    return enabledRepos;
}