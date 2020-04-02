// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import CodecommitCollaborationModel = require('../lib/codecommit-devops-model-stack');

test('Stack can be synthesised.', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new CodecommitCollaborationModel.CodecommitDevopsModelStack(app, 'MyTestStack');
});
