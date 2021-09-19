// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from '@aws-cdk/core';
import cloudformation = require('@aws-cdk/aws-cloudformation');
import codecommit = require('@aws-cdk/aws-codecommit');
import codebuild = require('@aws-cdk/aws-codebuild');
import events = require('@aws-cdk/aws-events');
import iam = require('@aws-cdk/aws-iam');
import lambda = require('@aws-cdk/aws-lambda');
import lambdaNodejs = require('@aws-cdk/aws-lambda-nodejs');
import path = require('path');
import targets = require('@aws-cdk/aws-events-targets')
import { CodecommitCollaborationModel } from './codecommit-policy';

export class CodecommitDevopsModelStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    const stack = cdk.Stack.of(this);
    const bizTags = [
      {
        name: 'app',
        value: 'my-app-1',
      },
      {
        name: 'cost-center',
        value: '12345',
      },
      {
        name: 'team',
        value: 'abc',
      }
    ];

    const repo1 = new codecommit.Repository(this, 'Repository1', {
      repositoryName: `${stack.stackName}-MyApp1`,
      description: 'Repo for App1.', // optional property
    });
    bizTags.forEach(tag => { cdk.Tag.add(repo1, tag.name, tag.value )});

    const repo2 = new codecommit.Repository(this, 'Repository2', {
      repositoryName: `${stack.stackName}-MyApp2`,
      description: 'Repo for App2.', // optional property
    });
    cdk.Tag.add(repo2, 'app', 'my-app-2');
    cdk.Tag.add(repo2, 'team', 'abc');

    const codeCollaboratorModel = new CodecommitCollaborationModel(this, `CodecommitCollaborationModel`, {
      name: 'MyApp1',
      tags: {
        'app': 'my-app-1',
        'team': 'abc',
      }
    });

    const repo1AdminRole = new iam.Role(this, 'Repo1AdminRole', {
      assumedBy: new iam.AccountPrincipal(this.account),
      managedPolicies: [codeCollaboratorModel.codeCommitAdminPolicy],
      path: '/codecommitmodel/',
    });
    const repo1CollaboratorRole = new iam.Role(this, 'Repo1CollaboratorRole', {
      assumedBy: new iam.AccountPrincipal(stack.account),
      managedPolicies: [codeCollaboratorModel.codeCommitCollaboratorPolicy],
      path: '/codecommitmodel/',
    });
    
    // create a repo without tags either 'app' or 'team'
    const repo3 = new codecommit.Repository(this, 'Repository3', {
      repositoryName: `${stack.stackName}-MyApp3`,
      description: 'Repo for App3.',
    });

    // Add PR build and trigger on PR created/updated
    const codeBuildPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "codebuild:BatchGetReports",
        "codebuild:DescribeTestCases",
        "codebuild:ListReportGroups",
        "codebuild:CreateReportGroup",
        "codebuild:CreateReport",
        "codebuild:BatchPutTestCases",
        "codebuild:UpdateReport",
      ],
      resources: [ '*' ]
    });
    const prBuildRole = new iam.Role(this, `CodeCommit-Repo1-PR-Build-Role`, {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      inlinePolicies: {
        codebuild: new iam.PolicyDocument({
          statements: [codeBuildPolicy]
        }),
      }
    });
    const prBuild = new codebuild.Project(this, `Repo1-PRBuild`, {
      role: prBuildRole,
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        env: {
          variables: {
          },
        },
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '12',
            },
          },
          pre_build: {
            commands: [
              `echo Build PR $pullRequestId of repo $repositoryName...`,
            ]
          },
          build: {
            commands: [
              'echo Source repo $CODEBUILD_SOURCE_REPO_URL with version $CODEBUILD_SOURCE_VERSION',
              'echo here is building task',
            ],
          },
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
        computeType: codebuild.ComputeType.SMALL,
      },
      source: codebuild.Source.codeCommit({ repository: repo1 }),
      cache: codebuild.Cache.local(
        codebuild.LocalCacheMode.SOURCE,
        codebuild.LocalCacheMode.DOCKER_LAYER,
        codebuild.LocalCacheMode.CUSTOM
      ),
      timeout: cdk.Duration.minutes(30),
    });
    bizTags.forEach(tag => { cdk.Tag.add(prBuild, tag.name, tag.value )});

    // create lambda to listen on the state changed of PR Build
    const codecommitPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "codecommit:PostCommentForPullRequest",
        "codecommit:UpdatePullRequestApprovalState",
      ],
      resources: [
        repo1.repositoryArn
      ],
    });
    const prBuildEventLambaRole = new iam.Role(this, `CodeCommitRepo1PRBuildEventLambdaRole`, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        codecommit: new iam.PolicyDocument({
          statements: [codecommitPolicy]
        }),
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ]
    });
    const prBuildEventHandler = new lambdaNodejs.NodejsFunction(this, `CodeCommitRepo1PRBuildEventHandler`, {
      role: prBuildEventLambaRole,
      runtime: lambda.Runtime.NODEJS_14_X,
      entry: path.join(__dirname, '../assets/pr-build-events/handler.ts'),
      handler: 'prBuildStateChanged',
      timeout: cdk.Duration.minutes(1),
      bundling: {
        sourceMap: true,
        minify: false,
      },
    });
    prBuild.onBuildStarted(`Repo1PRBuildStarted`, {
      target: new targets.LambdaFunction(prBuildEventHandler),
    });
    prBuild.onBuildSucceeded(`Repo1PRBuildSuccessed`, {
      target: new targets.LambdaFunction(prBuildEventHandler),
    });
    prBuild.onBuildFailed(`Repo1PRBuildFailed`, {
      target: new targets.LambdaFunction(prBuildEventHandler),
    });

    // create cloudwatch event to trigger pr build when pr is create or the source branch is updated
    const prRule = repo1.onPullRequestStateChange('PRBuild', {
      target: new targets.CodeBuildProject(prBuild, {
        event: events.RuleTargetInput.fromObject({
          sourceVersion: events.EventField.fromPath('$.detail.sourceCommit'),
          environmentVariablesOverride: [
            {
              "name": "pullRequestId",
              "value": events.EventField.fromPath('$.detail.pullRequestId'),
              "type": "PLAINTEXT"
            },
            {
              "name": "repositoryName",
              "value": events.EventField.fromPath('$.detail.repositoryNames[0]'),
              "type": "PLAINTEXT"
            },
            {
              "name": "sourceCommit",
              "value": events.EventField.fromPath('$.detail.sourceCommit'),
              "type": "PLAINTEXT"
            },
            {
              "name": "destinationCommit",
              "value": events.EventField.fromPath('$.detail.destinationCommit'),
              "type": "PLAINTEXT"
            },
            {
              "name": "title",
              "value": events.EventField.fromPath('$.detail.title'),
              "type": "PLAINTEXT"
            },
            {
              "name": "description",
              "value": events.EventField.fromPath('$.detail.notificationBody'),
              "type": "PLAINTEXT"
            },
            {
              "name": "revisionId",
              "value": events.EventField.fromPath('$.detail.revisionId'),
              "type": "PLAINTEXT"
            }
          ]
        }),
      }),
    });
    prRule.addEventPattern({
      detail: {
        event: [
          'pullRequestSourceBranchUpdated',
          'pullRequestCreated'
        ]
      }
    });

    // Add deployment build and trigger on master branch changes with least privileges to run `cdk deploy`
    const stackName = 'TheStackNameDefinedInCDK'; // the stack name in your cdk project
    const cloudformationPolicyCreation = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "cloudformation:CreateStack",
      ],
      resources: ["*"],
    });
    const cloudformationPolicyCDKStack = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "cloudformation:DescribeStacks",
      ],
      resources: [
        cdk.Arn.format({
          service: 'cloudformation',
          resource: 'stack',
          region: '*',
          resourceName: `CDKToolkit/*`,
          sep: '/',
        }, stack),
      ],
    });
    const cloudformationPolicyUpdation = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "cloudformation:GetTemplate",
        "cloudformation:DescribeStacks",
        "cloudformation:UpdateStack",
        "cloudformation:CreateChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:ExecuteChangeSet",
        "cloudformation:DescribeStackEvents",
      ],
      resources: [
        cdk.Arn.format({
          service: 'cloudformation',
          resource: 'stack',
          resourceName: `${stackName}/*`,
          sep: '/',
        }, stack),
      ],
    });
    const cdkS3Policy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "s3:*Object",
        "s3:ListBucket",
      ],
      resources: [
        cdk.Arn.format({
          service: 's3',
          region: '',
          account: '',
          resource: `cdktoolkit-stagingbucket-*`,
        }, stack),
      ],
    });
    const buildDeploymentRole = new iam.Role(this, `CodeCommit-Repo1-Deployment-Build-Role`, {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      inlinePolicies: {
        cloudformation: new iam.PolicyDocument({
          statements: [
            cloudformationPolicyCreation,
            cloudformationPolicyUpdation,
            cloudformationPolicyCDKStack,
          ]
        }),
        s3: new iam.PolicyDocument({
          statements: [cdkS3Policy],
        }),
      }
    });
    const deploymentBuild = new codebuild.Project(this, `Repo1-DeploymentBuild`, {
      role: buildDeploymentRole,
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        env: {
          variables: {
          },
        },
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '12',
            },
          },
          pre_build: {
            commands: [
              `echo deplyment build of repo ${repo1.repositoryName}...`,
            ]
          },
          build: {
            commands: [
              `echo Here running 'cdk deploy --require-approval never'`,
            ],
          },
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
        computeType: codebuild.ComputeType.SMALL,
      },
      source: codebuild.Source.codeCommit({ repository: repo1 }),
      cache: codebuild.Cache.local(
        codebuild.LocalCacheMode.SOURCE,
        codebuild.LocalCacheMode.DOCKER_LAYER,
        codebuild.LocalCacheMode.CUSTOM
      ),
      timeout: cdk.Duration.minutes(30),
    });
    repo1.onCommit('CommitOnMaster', {
      branches: ['master'],
      target: new targets.CodeBuildProject(deploymentBuild),
    });
    bizTags.forEach(tag => { cdk.Tag.add(deploymentBuild, tag.name, tag.value )});
    
    // create lambda based custom resource to create approval rule template
    const codecommitApprovalRulePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "codecommit:CreateApprovalRuleTemplate",
        "codecommit:DeleteApprovalRuleTemplate",
        "codecommit:GetApprovalRuleTemplate",
        "codecommit:UpdateApprovalRuleTemplateContent",
        "codecommit:UpdateApprovalRuleTemplateDescription",
        "codecommit:UpdateApprovalRuleTemplateName",
        "codecommit:AssociateApprovalRuleTemplateWithRepository",
        "codecommit:BatchAssociateApprovalRuleTemplateWithRepositories",
        "codecommit:BatchDisassociateApprovalRuleTemplateFromRepositories",
        "codecommit:DisassociateApprovalRuleTemplateFromRepository",
        "codecommit:ListAssociatedApprovalRuleTemplatesForRepository",
      ],
      resources: [ '*' ],
    });
    const codeCommitApprovalRuleTemplateRole = new iam.Role(this, `CustomResource-CodeCommit-Role`, {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        codecommit: new iam.PolicyDocument({
          statements: [ codecommitApprovalRulePolicy ]
        })
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ]
    });
    const approvalRuleTemplateProvider = new lambdaNodejs.NodejsFunction(this, `CodeCommitApprovalRuleTemplate`, {
      role: codeCommitApprovalRuleTemplateRole,
      runtime: lambda.Runtime.NODEJS_14_X,
      entry: path.join(__dirname, '../assets/approval-rule-template/codecommit.ts'),
      handler: 'approvalRuleTemplate',
      timeout: cdk.Duration.minutes(5),
      bundling: {
        sourceMap: true,
        minify: false,
      },
    });

    const approvalRuleTemplaate = new cloudformation.CustomResource(this, 'CustomResource-CodeCommit-ApprovalRuleTemplate', {
      provider: cloudformation.CustomResourceProvider.lambda(approvalRuleTemplateProvider),
      resourceType: 'Custom::CodeCommitApprovalRuleTemplate',
      properties: {
        ApprovalRuleTemplateName: `approval-rule-template-${repo1.repositoryName}`,
        ApprovalRuleTemplateDescription: `Approval rule template for repo ${repo1.repositoryName}`, // optional
        Template: {
          destinationReferences: [ 'refs/heads/master' ], // optional or non empty valid git references list
          approvers: {
            numberOfApprovalsNeeded: 2,
            approvalPoolMembers: [ // optional
              cdk.Arn.format({
                service: 'sts',
                region: '',
                resource: 'assumed-role',
                resourceName: `${repo1AdminRole.roleName}/*`,
                sep: '/'
              }, stack),
              cdk.Arn.format({
                service: 'sts',
                region: '',
                resource: 'assumed-role',
                resourceName: `${prBuildEventLambaRole.roleName}/*`,
                sep: '/'
              }, stack)
            ]
          }
        }
      }
    });

    // create lambda based custom resource to associate/disassociate approval rule with repos
    const approvalRuleTemplateRepoAssociationProvider = new lambdaNodejs.NodejsFunction(this, `CodeCommitApprovalRuleTemplateRepoAssociation`, {
      role: codeCommitApprovalRuleTemplateRole,
      runtime: lambda.Runtime.NODEJS_12_X,
      entry: path.join(__dirname, '../assets/approval-rule-template/codecommit.ts'),
      handler: 'approvalRuleRepoAssociation',
      timeout: cdk.Duration.minutes(5),
      bundling: {
        sourceMap: true,
        minify: false,
      },
    });

    new cloudformation.CustomResource(this, 'CustomResource-CodeCommit-ApprovalRuleTemplate-Repos-Association', {
      provider: cloudformation.CustomResourceProvider.lambda(approvalRuleTemplateRepoAssociationProvider),
      resourceType: 'Custom::CodeCommitApprovalRuleTemplateReposAssociation',
      properties: {
        ApprovalRuleTemplateName: approvalRuleTemplaate.getAttString('approvalRuleTemplateName'),
        RepositoryNames: [ 
          repo1.repositoryName,
          repo2.repositoryName,
        ],
      }
    });

    new cdk.CfnOutput(this, 'Repo1AdminRoleOutput', {
      value: `${repo1AdminRole.roleArn}`,
      exportName: `${stack.stackName}-Repo1AdminRole`,
      description: 'admin role of repo1'
    });
    new cdk.CfnOutput(this, 'Repo1CollaboratorRoleOutput', {
      value: `${repo1CollaboratorRole.roleArn}`,
      exportName: `${stack.stackName}-Repo1CollaboratorRole`,
      description: 'collaborator role of repo1'
    });

  }
}
