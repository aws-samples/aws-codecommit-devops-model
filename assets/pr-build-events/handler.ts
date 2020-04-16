// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import CodeCommit = require('aws-sdk/clients/codecommit');
import { Handler, ScheduledEvent } from 'aws-lambda';

export type CodeBuildStateChangedHandler = Handler<CodeBuildStateChangedEvent, void>;

export interface BuildPhase {
    'phase-context'?: [];
    'start-time': string;
    'end-time'?: string;
    'duration-in-seconds'?: number;
    'phase-type': string;
    'phase-status'?: string;
}

export interface BuildEnvironment {
    name: string;
    type: string;
    value: string;
}

export interface CodeBuildStateChangedEvent extends ScheduledEvent {
    'detail-type': "CodeBuild Build State Change",
    source: 'aws.codebuild',
    detail: {
        'build-status': string;
        'project-name': string;
        'build-id': string;
        'additional-information': {
            artifact: {
                md5sum?: string;
                sha256sum?: string;
                location: string;
            };
            cache?: {
                type: string;
                modes: string[];
            },
            environment: {
                image: string;
                'privileged-mode': boolean;
                'compute-type': string;
                type: string;
                'environment-variables': BuildEnvironment[];
            };
            'timeout-in-minutes': number;
            'build-complete': boolean;
            initiator: string;
            'build-start-time': string;
            source: {
                buildspec?: string;
                location: string;
                type: string;
            };
            logs: {
                'group-name'?: string;
                'stream-name'?: string;
                'deep-link': string;
            };
            phases: BuildPhase[];
            'queued-timeout-in-minutes': number;
            'current-phase': string;
            'current-phase-context': string;
            version: number;
        };
    };
}

const codecommit = new CodeCommit();

function findEnvironmentByName (envs: BuildEnvironment[], name: string): BuildEnvironment {
    const env = envs.find( env => env.name == name);
    if (env)
        return env;
    throw new Error(`Env with '${name}' can not be found.`);
}

export const prBuildStateChanged : CodeBuildStateChangedHandler = async (event, _context) => {
    console.info(`Receiving Build State Changed event of PR Build ${JSON.stringify(event, null, 2)}`);
    
    const envsOfBuild = event.detail["additional-information"].environment["environment-variables"];
    const pullRequestId = findEnvironmentByName(envsOfBuild, 'pullRequestId').value;
    const repositoryName = findEnvironmentByName(envsOfBuild, 'repositoryName').value;
    const beforeCommitId = findEnvironmentByName(envsOfBuild, 'sourceCommit').value;
    const afterCommitId = findEnvironmentByName(envsOfBuild, 'destinationCommit').value;
    switch (event.detail["build-status"]) {
        case 'IN_PROGRESS':
            await codecommit.postCommentForPullRequest({
                pullRequestId,
                repositoryName,
                beforeCommitId,
                afterCommitId,
                content: `Started CI build ${event.detail["build-id"]} on commit '${afterCommitId}' for this PR.`,
            }).promise();
            break;
        case 'SUCCEEDED':
            const actions = [];
            actions.push(codecommit.postCommentForPullRequest({
                pullRequestId,
                repositoryName,
                beforeCommitId,
                afterCommitId,
                content: `CI build '${event.detail["build-id"]}' on commit '${afterCommitId}' successed.`,
            }).promise());
            actions.push(codecommit.updatePullRequestApprovalState({
                pullRequestId,
                revisionId: findEnvironmentByName(envsOfBuild, 'revisionId').value,
                approvalState: 'APPROVE',
            }).promise());
            await Promise.all(actions);
            break;
        case 'FAILED':
            await codecommit.postCommentForPullRequest({
                pullRequestId,
                repositoryName,
                beforeCommitId,
                afterCommitId,
                content: `CI build '${event.detail["build-id"]}' on commit '${afterCommitId}' failed.`,
            }).promise();
            break;
        default:
            const msg = `Received pr build state changed event with unrecognized status '${event.detail["build-status"]}'.`;
            console.error(msg);
            throw new Error(msg);
    }
}