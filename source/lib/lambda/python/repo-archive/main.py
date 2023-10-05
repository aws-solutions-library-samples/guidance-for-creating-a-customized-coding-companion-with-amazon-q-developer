from urllib.request import urlretrieve
import json
import subprocess
import logging
from zipfile import ZipFile
import os
import shlex

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):

    repo_id = event['Payload']['body']['id']
    release = event['Payload']['body']['release']

    downloadFile(release['zipball_url'])
    extractDownload()

    if 'ignore_file_s3_url' in event['Payload']['body']:
        renameGitignore('.gitignore', '.gitignore.ORIGINAL')
        downloadIgnoreFile(event['Payload']['body']['ignore_file_s3_url'], release['tag_name'])
        initGit()
        gitClean()
        renameGitignore('.gitignore.ORIGINAL', '.gitignore')
        deleteGitDir()

    syncExtractionToS3(os.environ['BUCKET_NAME'], repo_id, release['tag_name'])

    if 'last_version' in event['Payload']['body']:
        archivePreviousVersion(os.environ['BUCKET_NAME'], repo_id, event['Payload']['body']['last_version'])
    
    updateMetadata(os.environ['TABLE_NAME'], repo_id, release['tag_name'])

    print('request: {}'.format(json.dumps(event)))

    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'text/plain'
        },
        'body': 'Repository archive operations completed.'
    }

def run_command(command):
    command_list = shlex.split(command)

    try:
        logger.info("Running shell command: \"{}\"".format(command))
        result = subprocess.run(command, stdout=subprocess.PIPE, shell=True);
        logger.info("Command output:\n---\n{}\n---".format(result.stdout.decode('UTF-8')))
    except Exception as e:
        logger.error("Exception: {}".format(e))
        return False

    return True  

def downloadFile(url):

    urlretrieve(url, '/tmp/repo_download.zip')

def extractDownload():

    with ZipFile('/tmp/repo_download.zip', 'r') as f:
        f.extractall('/tmp/extracted')

def downloadIgnoreFile(s3_url, version):

    run_command(f'/opt/awscli/aws s3 cp {s3_url} "$(ls -d /tmp/extracted/* | head -n 1)/.gitignore"')

def initGit():

    run_command(f'git init "$(ls -d /tmp/extracted/* | head -n 1)"')

def gitClean():

    run_command(f'git clean -fdx "$(ls -d /tmp/extracted/* | head -n 1)"')

def renameGitignore(current_name, desired_name):

    run_command(f'mv "$(ls -d /tmp/extracted/* | head -n 1)/{current_name}" "$(ls -d /tmp/extracted/* | head -n 1)/{desired_name}"')

def deleteGitDir():

    run_command(f'rm -rf "$(ls -d /tmp/extracted/* | head -n 1)/.git"')

def syncExtractionToS3(bucket, id, version):

    run_command(f'/opt/awscli/aws s3 sync "$(ls -d /tmp/extracted/* | head -n 1)" s3://{bucket}/current/{id}/{version}')

def archivePreviousVersion(bucket, id, last_version):
    
    run_command(f'/opt/awscli/aws s3 mv s3://{bucket}/current/{id}/{last_version} s3://{bucket}/archived/{id}/{last_version} --recursive')

def updateMetadata(table, id, version):

    metadata = {
        'id': {'S': id},
    }

    metadata_values = {
        ':v': {'S': version}
    }

    with open('/tmp/metadata.json', 'w') as f:
        json.dump(metadata, f)

    with open('/tmp/metadata_values.json', 'w') as f:
        json.dump(metadata_values, f)
    
    run_command("/opt/awscli/aws dynamodb update-item --table-name {} --key file:///tmp/metadata.json --update-expression 'SET version = :v' --expression-attribute-values file:///tmp/metadata_values.json".format(table))