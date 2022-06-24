#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CodecommitDevopsModelStack } from '../lib/codecommit-devops-model-stack';

const app = new cdk.App();
new CodecommitDevopsModelStack(app, 'CodecommitDevopsModelStack');
