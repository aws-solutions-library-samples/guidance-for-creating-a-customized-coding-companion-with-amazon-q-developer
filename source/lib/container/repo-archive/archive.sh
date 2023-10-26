#!/bin/bash

echo $REPO_ID
echo $TAG_NAME
echo $BUCKET_NAME
echo $TABLE_NAME
echo $ZIPBALL_URL
echo $IGNORE_FILE_S3_URL
echo $LAST_VERSION

# download repository release
curl -L -o /tmp/repo_download.zip $ZIPBALL_URL

# unzip repository release
unzip -o /tmp/repo_download.zip -d /tmp/extracted

# use custom .gitignore file if it exists
if [ "$IGNORE_FILE_S3_URL" == "NULL" ]
then
    echo "\$IGNORE_FILE_S3_URL is empty. Skipping download."
else
    echo "\$IGNORE_FILE_S3_URL is NOT empty. Proceeding to download."

    # rename original .gitignore file to .gitignore.ORIGINAL
    mv "$(ls -d /tmp/extracted/* | head -n 1)/.gitignore" "$(ls -d /tmp/extracted/* | head -n 1)/.gitignore.ORIGINAL"

    # download custom .gitignore file
    aws s3 cp $IGNORE_FILE_S3_URL "$(ls -d /tmp/extracted/* | head -n 1)/.gitignore"

    # init Git repository
    git config --global init.defaultBranch main
    git init "$(ls -d /tmp/extracted/* | head -n 1)"

    # clean Git repository
    cd "$(ls -d /tmp/extracted/* | head -n 1)" && git add . && git clean -fdx

    # revert .gitignore.ORIGINAL file to .gitignore
    mv "$(ls -d /tmp/extracted/* | head -n 1)/.gitignore.ORIGINAL" "$(ls -d /tmp/extracted/* | head -n 1)/.gitignore"

    # delete Git module
    rm -rf "$(ls -d /tmp/extracted/* | head -n 1)/.git"
fi

# sync extracted files to s3
aws s3 sync "$(ls -d /tmp/extracted/* | head -n 1)" s3://$BUCKET_NAME/current/$REPO_ID/$TAG_NAME

# download custom .gitignore file if it exists
if [ "$LAST_VERSION" == "NULL" ]
then
    echo "\$LAST_VERSION is empty. Skipping archive."
else
    echo "\$LAST_VERSION is NOT empty. Proceeding to archive."

    aws s3 mv s3://$BUCKET_NAME/current/$REPO_ID/$LAST_VERSION s3://$BUCKET_NAME/archived/$REPO_ID/$LAST_VERSION --recursive
fi

# update DynamoDB table
echo "{\"id\": {\"S\": \"${REPO_ID}\"}}" >> /tmp/metadata.json
echo "{\":v\": {\"S\": \"${TAG_NAME}\"}}" >> /tmp/metadata_values.json
aws dynamodb update-item --table-name $TABLE_NAME --key file:///tmp/metadata.json --update-expression 'SET version = :v' --expression-attribute-values file:///tmp/metadata_values.json

# publish message to SNS topic
aws sns publish --topic-arn $SNS_TOPIC_ARN --message "Repository ${REPO_ID} with the tag ${TAG_NAME} has been extracted to S3."