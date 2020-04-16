// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { CloudFormationCustomResourceHandler, CloudFormationCustomResourceUpdateEvent, CloudFormationCustomResourceDeleteEvent } from 'aws-lambda';
import CodeCommit = require('aws-sdk/clients/codecommit');
const cfnCR = require('cfn-custom-resource');
const { configure, sendResponse, LOG_VERBOSE, SUCCESS, FAILED } = cfnCR;
const equal = require('deep-equal');

configure({ logLevel: LOG_VERBOSE });

function buildTemplateContent(props: {
    ServiceToken: string;
    [Key: string]: any;}): string {
        const template = {
            Version: '2018-11-08',
            DestinationReferences: props.Template.destinationReferences || undefined,
            Statements: [
                {
                    Type: 'Approvers',
                    NumberOfApprovalsNeeded: props.Template.approvers.numberOfApprovalsNeeded,
                    ApprovalPoolMembers: props.Template.approvers.approvalPoolMembers || undefined,
                }
            ]
        };
        return JSON.stringify(template, null, 2);
}

export const approvalRuleTemplate: CloudFormationCustomResourceHandler = async (event, _context) => {
    console.info(`Receiving ApprovalRuleEvent of CodeCommit ${JSON.stringify(event, null, 2)}`);
    const codecommit = new CodeCommit();
    var responseData: any;
    var result = SUCCESS;  
    var reason: any = '';
    var resourceId: string | undefined = undefined;
    try {
        switch (event.RequestType) {
            case 'Create':
                const createTempalteResponse = await codecommit.createApprovalRuleTemplate({
                    approvalRuleTemplateName: event.ResourceProperties.ApprovalRuleTemplateName,
                    approvalRuleTemplateDescription: event.ResourceProperties.ApprovalRuleTemplateDescription || '',
                    approvalRuleTemplateContent: buildTemplateContent(event.ResourceProperties),
                }).promise();
                console.info(`Created approval rule template ${JSON.stringify(createTempalteResponse.$response.data, null, 2)}.`);
                responseData = (createTempalteResponse.$response.data as CodeCommit.Types.CreateApprovalRuleTemplateOutput).approvalRuleTemplate;
                resourceId = responseData.approvalRuleTemplateId;
                break;
            case 'Update':
                const updateEvent = event as CloudFormationCustomResourceUpdateEvent;
                resourceId = updateEvent.PhysicalResourceId;
                const changes = [];
                if (!equal(updateEvent.ResourceProperties.Template, updateEvent.OldResourceProperties.Template)) {
                   changes.push(codecommit.updateApprovalRuleTemplateContent({
                       approvalRuleTemplateName: updateEvent.OldResourceProperties.ApprovalRuleTemplateName,
                       newRuleContent: buildTemplateContent(updateEvent.ResourceProperties),
                   }).promise()) 
                }
                if (updateEvent.ResourceProperties.ApprovalRuleTemplateDescription !== updateEvent.OldResourceProperties.ApprovalRuleTemplateDescription) {
                    changes.push(codecommit.updateApprovalRuleTemplateDescription({
                        approvalRuleTemplateName: updateEvent.OldResourceProperties.ApprovalRuleTemplateName,
                        approvalRuleTemplateDescription: updateEvent.ResourceProperties.ApprovalRuleTemplateDescription || '',
                    }).promise());
                }
                if (changes.length > 0) {
                    const updateDescAndTemplateRt = await Promise.all(changes);
                    console.info(`Updated approval rule '${updateEvent.OldResourceProperties.ApprovalRuleTemplateName}' descirption and template content ${updateDescAndTemplateRt}.`);
                    responseData = (updateDescAndTemplateRt[0].$response.data as CodeCommit.Types.UpdateApprovalRuleTemplateContentOutput | 
                        CodeCommit.Types.UpdateApprovalRuleTemplateDescriptionOutput).approvalRuleTemplate;
                }
                if (updateEvent.ResourceProperties.ApprovalRuleTemplateName !== updateEvent.OldResourceProperties.ApprovalRuleTemplateName) {
                    const updatedApprovalTemplate = await codecommit.updateApprovalRuleTemplateName({
                        newApprovalRuleTemplateName: updateEvent.ResourceProperties.ApprovalRuleTemplateName,
                        oldApprovalRuleTemplateName: updateEvent.OldResourceProperties.ApprovalRuleTemplateName,
                    }).promise();
                    console.log(`Updated approval rule name from '${updateEvent.OldResourceProperties.ApprovalRuleTemplateName} to '${updateEvent.ResourceProperties.ApprovalRuleTemplateName}'.`)
                    responseData = (updatedApprovalTemplate as CodeCommit.Types.UpdateApprovalRuleTemplateNameOutput).approvalRuleTemplate;
                }
                break;
            case 'Delete':
                const deleteEvent = event as CloudFormationCustomResourceDeleteEvent;
                resourceId = deleteEvent.PhysicalResourceId;
                const deleteTempalteResponse = await codecommit.deleteApprovalRuleTemplate({
                    approvalRuleTemplateName: event.ResourceProperties.ApprovalRuleTemplateName,
                }).promise();
                console.info(`Deleted approval rule template ${JSON.stringify(deleteTempalteResponse.$response.data, null, 2)}.`);
                responseData = deleteTempalteResponse.$response.data;
                break;
        }
    } catch (err) {
        console.error(`Failed to create approval rule template due to ${err}.`);
        responseData = err.message;
        result = FAILED;
        reason = err.message;
    }
    return await sendResponse({ Status: result, Reason: reason, PhysicalResourceId: (resourceId ? resourceId : _context.logStreamName), Data: responseData }, event);
}

export const approvalRuleRepoAssociation: CloudFormationCustomResourceHandler = async (event, _context) => {
    console.info(`Receiving ApprovalRuleAssociationEvent of CodeCommit ${JSON.stringify(event, null, 2)}`);
    const codecommit = new CodeCommit();
    var responseData: any;
    var result = SUCCESS;  
    var reason: any = '';
    var resourceId: string | undefined = undefined;
    try {
        switch (event.RequestType) {
            case 'Create':
                const assoRsp = await codecommit.batchAssociateApprovalRuleTemplateWithRepositories({
                    approvalRuleTemplateName: event.ResourceProperties.ApprovalRuleTemplateName,
                    repositoryNames: event.ResourceProperties.RepositoryNames
                }).promise();
                console.info(`Associated ${assoRsp.associatedRepositoryNames} with ${event.ResourceProperties.ApprovalRuleTemplateName}.`);
                resourceId = `${event.ResourceProperties.ApprovalRuleTemplateName}-repos`;
                responseData = {
                    AssociatedRepoNames: assoRsp.associatedRepositoryNames,
                };
                break;
            case 'Update':
                const updateEvent = event as CloudFormationCustomResourceUpdateEvent;
                resourceId = `${updateEvent.ResourceProperties.ApprovalRuleTemplateName}-repos`;
                const added = updateEvent.ResourceProperties.ApprovalRuleTemplateName == 
                    updateEvent.OldResourceProperties.ApprovalRuleTemplateName ? 
                    (updateEvent.ResourceProperties.RepositoryNames as Array<string>).filter((element, index, array) => {
                        return !(updateEvent.OldResourceProperties.RepositoryNames as Array<string>).includes(element);
                    }) : updateEvent.ResourceProperties.RepositoryNames as Array<string>;
                const deleted = updateEvent.ResourceProperties.ApprovalRuleTemplateName == 
                    updateEvent.OldResourceProperties.ApprovalRuleTemplateName ? 
                    (updateEvent.OldResourceProperties.RepositoryNames as Array<string>).filter((element, index, array) => {
                        return !(updateEvent.ResourceProperties.RepositoryNames as Array<string>).includes(element);
                    }) : updateEvent.OldResourceProperties.RepositoryNames as Array<string>;
                const changes = [];
                if (added.length > 0) {
                    const assoRsp = await codecommit.batchAssociateApprovalRuleTemplateWithRepositories({
                        approvalRuleTemplateName: updateEvent.ResourceProperties.ApprovalRuleTemplateName,
                        repositoryNames: added
                    }).promise();
                    console.info(`Associated ${assoRsp.associatedRepositoryNames} with ${updateEvent.ResourceProperties.ApprovalRuleTemplateName}.`); 
                    responseData = {
                        AssociatedRepoNames: assoRsp.associatedRepositoryNames,
                    };
                }
                if (deleted.length > 0) {
                    const disassoRsp = codecommit.batchDisassociateApprovalRuleTemplateFromRepositories({
                        approvalRuleTemplateName: updateEvent.OldResourceProperties.ApprovalRuleTemplateName,
                        repositoryNames: deleted,
                    }).promise();
                    console.info(`DisAssociated ${(await disassoRsp).disassociatedRepositoryNames} with ${updateEvent.OldResourceProperties.ApprovalRuleTemplateName}.`); 
                    responseData = Object.assign(responseData ? responseData : {}, {
                        DisAssociatedRepoNames: (await disassoRsp).disassociatedRepositoryNames,
                    });
                }
                break;
            case 'Delete':
                const deleteEvent = event as CloudFormationCustomResourceDeleteEvent;
                resourceId = deleteEvent.PhysicalResourceId;
                const disassociateRsp = await codecommit.batchDisassociateApprovalRuleTemplateFromRepositories({
                    approvalRuleTemplateName: deleteEvent.ResourceProperties.ApprovalRuleTemplateName,
                    repositoryNames: deleteEvent.ResourceProperties.RepositoryNames
                }).promise();
                console.info(`Disassociated ${disassociateRsp.disassociatedRepositoryNames} with ${deleteEvent.ResourceProperties.ApprovalRuleTemplateName}.`);
                responseData = {
                    DisAssociatedRepoNames: disassociateRsp.disassociatedRepositoryNames,
                };
                break;
        }
    } catch (err) {
        console.error(`Failed to associate/disassociate approval rule template with repos due to ${err}.`);
        responseData = err.message;
        result = FAILED;
        reason = err.message;
    }
    return await sendResponse({ Status: result, Reason: reason, PhysicalResourceId: (resourceId ? resourceId : _context.logStreamName), Data: responseData }, event);
}
