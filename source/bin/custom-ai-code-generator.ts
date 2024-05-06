#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CustomAiCodeGeneratorStack } from '../lib/custom-ai-code-generator-stack';
import { AwsSolutionsChecks } from 'cdk-nag'

const app = new cdk.App();

// Add the cdk-nag AwsSolutions Pack with extra verbose logging enabled.
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))

new CustomAiCodeGeneratorStack(app, app.node.tryGetContext("stack_name"), {
  // Amazon Q Developer is hosted in us-east-1, hence the hard-coded region for this AWS environment.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  description: "Guidance for Custom AI Code Generator on AWS (SO9338)",
  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});