#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CustomAiCodeGeneratorStack } from '../lib/custom-ai-code-generator-stack';

const app = new cdk.App();
new CustomAiCodeGeneratorStack(app, 'CustomAiCodeGeneratorStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});