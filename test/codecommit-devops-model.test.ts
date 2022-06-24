// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from 'aws-cdk-lib/core';
import CodecommitCollaborationModel = require('../lib/codecommit-devops-model-stack');

test('Stack can be synthesised.', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new CodecommitCollaborationModel.CodecommitDevopsModelStack(app, 'MyTestStack');
});
