// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from '@aws-cdk/core';
import cloudformation = require('@aws-cdk/aws-cloudformation');
import codecommit = require('@aws-cdk/aws-codecommit');
import codebuild = require('@aws-cdk/aws-codebuild');
import events = require('@aws-cdk/aws-events');
import iam = require('@aws-cdk/aws-iam');
import lambda = require('@aws-cdk/aws-lambda');
import path = require('path');
import targets = require('@aws-cdk/aws-events-targets')
import { CodecommitCollaborationModel } from './codecommit-policy';

export class CodecommitDevopsModelStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    const stack = cdk.Stack.of(this);

    const repo1 = new codecommit.Repository(this, 'Repository1', {
      repositoryName: `${stack.stackName}-MyApp1`,
      description: 'Repo fo App1.', // optional property
    });
    cdk.Tag.add(repo1, 'app', 'my-app-1');
    cdk.Tag.add(repo1, 'cost-center', '12345');
    cdk.Tag.add(repo1, 'team', 'abc');

    const repo2 = new codecommit.Repository(this, 'Repository2', {
      repositoryName: `${stack.stackName}-MyApp2`,
      description: 'Repo fo App2.', // optional property
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

    const repoAdmin = new iam.User(this, 'Repo1Admin', {
      path: '/codecommitmodel/',
    });
    repoAdmin.attachInlinePolicy(codeCollaboratorModel.codeCommitAdminPolicy);
    const repo1Collaborator = new iam.User(this, 'Repo1Collaborator', {
      path: '/codecommitmodel/',
    });
    repo1Collaborator.attachInlinePolicy(codeCollaboratorModel.codeCommitCollaboratorPolicy);

    // create a repo without tags either 'app' or 'team'
    const repo3 = new codecommit.Repository(this, 'Repository3', {
      repositoryName: `${stack.stackName}-MyApp3`,
      description: 'Repo fo App3.',
    });

    // Add PR build and trigger on PR created/updated
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
    const buildPRRole = new iam.Role(this, `CodeCommit-Repo1-PR-Build-Role`, {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      inlinePolicies: {
        codecommit: new iam.PolicyDocument({
          statements: [codecommitPolicy]
        }),
      }
    });
    const prBuild = new codebuild.Project(this, `Repo1-PRBuild`, {
      role: buildPRRole,
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
            commands: [
              'pip install --upgrade awscli'
            ]
          },
          pre_build: {
            commands: [
              `echo Build PR $pullRequestId of repo $repositoryName...`,
              `aws codecommit update-pull-request-approval-state --pull-request-id $pullRequestId \
                  --revision-id $revisionId --approval-state "REVOKE"`,
              `aws codecommit post-comment-for-pull-request --pull-request-id $pullRequestId \
                  --repository-name $repositoryName --before-commit-id $destinationCommit \
                  --after-commit-id $sourceCommit --content "Started CI build $CODEBUILD_BUILD_ID for this PR."`
            ]
          },
          build: {
            commands: [
              'echo Source repo $CODEBUILD_SOURCE_REPO_URL with version $CODEBUILD_SOURCE_VERSION',
              'echo here is building task',
            ],
            finally: [
              `if [ $CODEBUILD_BUILD_SUCCEEDING == "0" ]; then \
                  aws codecommit post-comment-for-pull-request --pull-request-id $pullRequestId \
                  --repository-name $repositoryName --before-commit-id $destinationCommit \
                  --after-commit-id $sourceCommit --content "CI build at $CODEBUILD_BUILD_ID failed."; \
                  else aws codecommit post-comment-for-pull-request --pull-request-id $pullRequestId \
                  --repository-name $repositoryName --before-commit-id $destinationCommit \
                  --after-commit-id $sourceCommit --content "CI build at $CODEBUILD_BUILD_ID successed."; fi`
            ]
          },
          post_build: {
            commands: [
              `if [ $CODEBUILD_BUILD_SUCCEEDING == "1" ]; then \
                  aws codecommit update-pull-request-approval-state --pull-request-id $pullRequestId \
                  --revision-id $revisionId --approval-state "APPROVE"; fi`
            ]
          }
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_2,
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
    const approvalRuleTemplateProvider = new lambda.Function(this, `CodeCommitApprovalRuleTemplate`, {
      role: codeCommitApprovalRuleTemplateRole,
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset(path.join(__dirname, '../assets')),
      handler: 'codecommit.approvalRuleTemplate',
      timeout: cdk.Duration.minutes(5),
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
              repoAdmin.userArn,
              cdk.Arn.format({
                service: 'sts',
                region: '',
                resource: 'assumed-role',
                resourceName: `${buildPRRole.roleName}/*`,
                sep: '/'
              }, stack)
            ]
          }
        }
      }
    });

    // create lambda based custom resource to associate/disassociate approval rule with repos
    const approvalRuleTemplateRepoAssociationProvider = new lambda.Function(this, `CodeCommitApprovalRuleTemplateRepoAssociation`, {
      role: codeCommitApprovalRuleTemplateRole,
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset(path.join(__dirname, '../assets')),
      handler: 'codecommit.approvalRuleRepoAssociation',
      timeout: cdk.Duration.minutes(5),
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

    new cdk.CfnOutput(this, 'IAMUser:RepoAdmin', {
      value: `${repoAdmin.userName}`,
      exportName: `${stack.stackName}-AdminUsername`,
      description: 'admin of repo'
    });
    new cdk.CfnOutput(this, 'IAMUser:RepoCollaborator', {
      value: `${repo1Collaborator.userName}`,
      exportName: `${stack.stackName}-CollaboratorUsername`,
      description: 'collaborator of repo'
    });

  }
}
