import { DynamoDBClient, ScanCommand, UpdateItemCommand, UpdateItemCommandInput } from "@aws-sdk/client-dynamodb";
import { S3Client, GetObjectCommand, GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { SSMClient, GetParameterCommand, GetParameterCommandOutput } from "@aws-sdk/client-ssm";
const dynamoDbClient = new DynamoDBClient();
const s3Client = new S3Client();
const ssmClient = new SSMClient();

export const handler = async (event: any, context: any) => {

    const repos: any = await getJsonFromS3();
    console.log(repos);

    await insertRepos(repos);
    await disableRepos(repos);

    return { body: 'Finished repository table operations.' };
};

async function getStringFromSSM(parameterName: string) {
    const input = {
        Name: parameterName,
        WithDecryption: true
    };
    const command = new GetParameterCommand(input);
    const response: GetParameterCommandOutput = await ssmClient.send(command);
    return response.Parameter?.Value;
}

async function getJsonFromS3() {
    const input = {
        "Bucket": process.env.REPO_CONFIG_BUCKET,
        "Key": process.env.REPO_CONFIG_KEY
    };
    const command = new GetObjectCommand(input);
    const response: GetObjectCommandOutput = await s3Client.send(command);
    const data = await response.Body?.transformToString();
    const repos: any = JSON.parse(data!);
    return repos['repositories'];
}

async function insertRepos(repos: any[]) {

    for (let index = 0; index < repos.length; index++) {

        const repo = repos[index].id;
        console.log(`Upserting repo ${repo} into table ${process.env.TABLE_NAME}`);
        let input: UpdateItemCommandInput;

        try {

            if (repos[index]?.ignore_file_param) {

                const s3Url: any = await getStringFromSSM(repos[index].ignore_file_param);

                input = {
                    TableName: process.env.TABLE_NAME,
                    Key: {
                        id: {
                            S: repo
                        }
                    },
                    ReturnValues: 'ALL_NEW',
                    ExpressionAttributeNames: {
                        '#m': 'modified',
                        '#e': 'enabled',
                        '#i': 'ignore_file_s3_url'
                    },
                    ExpressionAttributeValues: {
                        ':t': {
                            N: Date.now().toString()
                        },
                        ':f': {
                            BOOL: true
                        },
                        ':i': {
                            S: s3Url
                        }
                    },
                    UpdateExpression: 'SET #m = :t, #e = :f, #i = :i',
                };

            } else {

                input = {
                    TableName: process.env.TABLE_NAME,
                    Key: {
                        id: {
                            S: repo
                        }
                    },
                    ReturnValues: 'ALL_NEW',
                    ExpressionAttributeNames: {
                        '#m': 'modified',
                        '#e': 'enabled'
                    },
                    ExpressionAttributeValues: {
                        ':t': {
                            N: Date.now().toString()
                        },
                        ':f': {
                            BOOL: true
                        }
                    },
                    UpdateExpression: 'SET #m = :t, #e = :f',
                };

            }

            const command = new UpdateItemCommand(input);
            const response = await dynamoDbClient.send(command);

        } catch (err) {
            console.log(err);
        }
    }

    return { body: 'Finished inserting repositories.' };
}

async function disableRepos(repos: any[]) {

    let values: any = {};
    let valueNames = []

    for (let i = 0; i < repos.length; i++) {

        values[`:s${i}`] = { S: repos[i].id };
        valueNames.push(`:s${i}`);
    }

    try {

        console.log(`Disabling unused repos in table ${process.env.TABLE_NAME}`);

        const input = {
            TableName: process.env.TABLE_NAME,
            FilterExpression: `NOT id in (${valueNames.join(", ")})`,
            ExpressionAttributeValues: values,
            ProjectionExpression: 'id'
        };

        const command = new ScanCommand(input);
        const response: any = await dynamoDbClient.send(command);
        console.log(response);

        for (let j = 0; j < response.Items.length; j++) {

            let id = response.Items[j].id.S;

            const disableInput = {
                TableName: process.env.TABLE_NAME,
                Key: {
                    id: {
                        S: id
                    }
                },
                ReturnValues: 'ALL_NEW',
                ExpressionAttributeNames: {
                    '#m': 'modified',
                    '#e': 'enabled'
                },
                ExpressionAttributeValues: {
                    ':t': {
                        N: Date.now().toString()
                    },
                    ':f': {
                        BOOL: false
                    }
                },
                UpdateExpression: 'SET #m = :t, #e = :f',
            };

            const disableCommand = new UpdateItemCommand(disableInput);
            const disableResponse = await dynamoDbClient.send(disableCommand);

        }

    } catch (err) {
        console.log(err);
    }

    return { body: 'Finished disabling repositories.' };
}
