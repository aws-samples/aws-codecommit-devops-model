// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from '@aws-cdk/core';
import iam = require('@aws-cdk/aws-iam');

export interface CodecommitCollaborationModelProps {
    readonly name: string;
    readonly tags: { [key: string]: string };
}

export class CodecommitCollaborationModel extends cdk.Construct {

    readonly codeCommitCollaboratorPolicy: iam.ManagedPolicy;
    readonly codeCommitAdminPolicy: iam.ManagedPolicy;

    constructor(scope: cdk.Construct, id: string, props: CodecommitCollaborationModelProps) {
        super(scope, id);

        const listAllPolicyStatement = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "codecommit:ListApprovalRuleTemplates",
                "codecommit:ListRepositories",
                'codebuild:ListProjects',
            ],
            resources: ['*'],
        });
        const codeBuildReadonlyPolicyStatement = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'codebuild:BatchGetBuilds',
                'codebuild:BatchGetProjects',
                'codebuild:ListBuildsForProject',
                'codebuild:ListCuratedEnvironmentImages',
                'codebuild:StartBuild',
                'codebuild:StopBuild',
            ],
            resources: ['*'],
            conditions: this.toTagCondition(props.tags),
        });
        // Code Collaborator Policy
        this.codeCommitCollaboratorPolicy = new iam.ManagedPolicy(this, `CodeCommitCollarator-${props.name}`, {
            statements: [
                listAllPolicyStatement,
                codeBuildReadonlyPolicyStatement,
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        "codecommit:BatchGet*",
                        "codecommit:BatchDescribe*",
                        "codecommit:CreatePullRequest",
                        "codecommit:EvaluatePullRequestApprovalRules",
                        "codecommit:Get*",
                        "codecommit:Describe*",
                        "codecommit:List*",
                        "codecommit:GitPull",
                        "codecommit:PostCommentForComparedCommit",
                        "codecommit:PostCommentForPullRequest",
                        "codecommit:PostCommentReply",
                        "codecommit:UpdateComment",
                        "codecommit:UpdatePullRequestDescription",
                        "codecommit:UpdatePullRequestStatus",
                        "codecommit:UpdatePullRequestTitle",
                    ],
                    resources: ['*'],
                    conditions: this.toTagCondition(props.tags),
                }),
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        "codecommit:CreateBranch",
                        "codecommit:GitPush",
                        "codecommit:Merge*",
                    ],
                    resources: ['*'],
                    conditions: Object.assign(
                        {
                            "StringLikeIfExists": {
                                "codecommit:References": [
                                    "refs/heads/pr/*",
                                    "refs/heads/features/*",
                                    "refs/heads/bugs/*"
                                ]
                            }
                        },
                        this.toTagCondition(props.tags)
                    )
                }),
            ]
        });

        // Code Admin Policy
        this.codeCommitAdminPolicy = new iam.ManagedPolicy(this, `CodeCommitAdmin-${props.name}`, {
            statements: [
                listAllPolicyStatement,
                codeBuildReadonlyPolicyStatement,
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        "codecommit:BatchGet*",
                        "codecommit:BatchDescribe*",
                        "codecommit:Create*",
                        "codecommit:Delete*",
                        "codecommit:EvaluatePullRequestApprovalRules",
                        "codecommit:Get*",
                        "codecommit:Describe*",
                        "codecommit:List*",
                        "codecommit:GitPull",
                        "codecommit:GitPush",
                        "codecommit:Put*",
                        "codecommit:Post*",
                        "codecommit:Merge*",
                        "codecommit:Test*",
                        "codecommit:Update*",
                        "codecommit:UploadArchive",
                        "codecommit:CancelUploadArchive",
                    ],
                    resources: ['*'],
                    conditions: this.toTagCondition(props.tags),
                }),
                new iam.PolicyStatement({
                    effect: iam.Effect.DENY,
                    actions: [
                        "codecommit:GitPush",
                        "codecommit:DeleteBranch",
                        "codecommit:PutFile",
                    ],
                    resources: ['*'],
                    conditions: Object.assign(
                        {
                            "StringLike": {
                                "codecommit:References": [
                                    "refs/heads/master",
                                ]
                            }
                        },
                        this.toTagCondition(props.tags)),
                }),
            ]
        });
    }

    private toTagCondition(tags: { [key: string]: string }): { [key: string]: {} } {
        const resourceTags: { [key: string]: string } = {};
        const nullCheck: { [key: string]: boolean } = {};
        Object.keys(tags).forEach(tag => {
            resourceTags[`aws:ResourceTag/${tag}`] = tags[tag];
            nullCheck[`aws:ResourceTag/${tag}`] = false;
        });
        return {
            "ForAllValues:StringEquals": resourceTags,
            "Null": nullCheck,
        }
    }
}