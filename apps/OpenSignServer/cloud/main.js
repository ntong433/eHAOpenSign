import PDF from './parsefunction/pdf/PDF.js';
import sendmailv3 from './parsefunction/sendMailv3.js';
import usersignup from './parsefunction/usersignup.js';
import DocumentAftersave from './parsefunction/DocumentAftersave.js';
import ContactbookAftersave from './parsefunction/ContactBookAftersave.js';
import sendMailOTPv1 from './parsefunction/SendMailOTPv1.js';
import AuthLoginAsMail from './parsefunction/AuthLoginAsMail.js';
import getUserId from './parsefunction/getUserId.js';
import getUserDetails from './parsefunction/getUserDetails.js';
import getDocument from './parsefunction/getDocument.js';
import getDrive from './parsefunction/getDrive.js';
import getReport from './parsefunction/getReport.js';
import TemplateAfterSave from './parsefunction/TemplateAfterSave.js';
import GetTemplate from './parsefunction/GetTemplate.js';
import DocumentBeforesave from './parsefunction/DocumentBeforesave.js';
import TemplateBeforeSave from './parsefunction/TemplateBeforesave.js';
import DocumentBeforeFind from './parsefunction/DocumentAfterFind.js';
import TemplateAfterFind from './parsefunction/TemplateAfterFind.js';
import UserAfterFind from './parsefunction/UserAfterFInd.js';
import SignatureAfterFind from './parsefunction/SignatureAfterFind.js';
import TenantAterFind from './parsefunction/TenantAfterFind.js';
import VerifyEmail from './parsefunction/VerifyEmail.js';
import { getSignedUrl } from './parsefunction/getSignedUrl.js';
import createBatchDocs from './parsefunction/createBatchDocs.js';
import linkContactToDoc from './parsefunction/linkContactToDoc.js';
import isextenduser from './parsefunction/isextenduser.js';
import TeamsAftersave from './parsefunction/TeamsAftersave.js';
import GetLogoByDomain from './parsefunction/GetLogoByDomain.js';
import AddAdmin from './parsefunction/AddAdmin.js';
import CheckAdminExist from './parsefunction/CheckAdminExist.js';
import UpdateExistUserAsAdmin from './parsefunction/UpdateExistUserAsAdmin.js';
import Newsletter from './parsefunction/Newsletter.js';
import getTeams from './parsefunction/getTeams.js';
import getContact from './parsefunction/getContact.js';
import updateContactTour from './parsefunction/updateContactTour.js';
import declinedocument from './parsefunction/declinedocument.js';
import getTenant from './parsefunction/getTenant.js';
import getSigners from './parsefunction/getSigners.js';
import saveFile from './parsefunction/saveFile.js';
import savecontact from './parsefunction/savecontact.js';
import isUserInContactBook from './parsefunction/isUserInContactBook.js';
import updateTourStatus from './parsefunction/updateTourStatus.js';
import updateSignatureType from './parsefunction/updatesignaturetype.js';
import updatePreferences from './parsefunction/updatePreferences.js';
import createDuplicate from './parsefunction/createDuplicate.js';
import createBatchContact from './parsefunction/createBatchContact.js';
import generateCertificatebydocId from './parsefunction/generateCertificatebydocId.js';
import fileUpload from './parsefunction/fileUpload.js';
import getUserListByOrg from './parsefunction/getUserListByOrg.js';
import editContact from './parsefunction/editContact.js';
import forwardDoc from './parsefunction/ForwardDoc.js';
import saveAsTemplate from './parsefunction/saveAsTemplate.js';
import updateTenant from './parsefunction/updateTenant.js';
import recreateDocument from './parsefunction/recreateDocument.js';
import loginUser from './parsefunction/loginUser.js';
import { loginWithMicrosoft } from './functions/auth.js';
import addUser from './parsefunction/addUser.js';
import filterDocs from './parsefunction/filterDocs.js';
import sendDeleteUserMail from './parsefunction/sendDeleteUserMail.js';
import resetPassword from './parsefunction/resetPassword.js';
import saveSignature from './parsefunction/saveSignature.js';
import manageSign from './parsefunction/manageSign.js';
import getSignature from './parsefunction/getSignature.js';
import updateEmailTemplates from './parsefunction/updateEmailTemplates.js';
import triggerEvent from './parsefunction/triggerEvent.js';
import setWidgetPreferences from './parsefunction/setWidgetPreferences.js';
import createDocumentFromApp from './parsefunction/createDocumentFromApp.js';
import authorizeSigningLink from './parsefunction/authorizeSigningLink.js';
import getSigningLinkContext from './parsefunction/getSigningLinkContext.js';
import requestExternalSigningOtp from './parsefunction/requestExternalSigningOtp.js';
import verifyExternalSigningOtp from './parsefunction/verifyExternalSigningOtp.js';
import getExternalSigningCompletion from './parsefunction/getExternalSigningCompletion.js';
import getExternalSignedDocumentDownload from './parsefunction/getExternalSignedDocumentDownload.js';
import './functions/entraFunctions.js';

function defineCloudFunction(name, handler) {
  Parse.Cloud.define(name, handler);
  if (
    name === 'authorizeSigningLink' ||
    name === 'signPdf' ||
    name === 'getSigningLinkContext' ||
    name === 'requestExternalSigningOtp' ||
    name === 'verifyExternalSigningOtp' ||
    name === 'getExternalSigningCompletion' ||
    name === 'getExternalSignedDocumentDownload'
  ) {
    console.log(`Cloud function registered: ${name}`);
  }
}

// This afterSave function triggers after an object is added or updated in the specified class, allowing for post-processing logic.
Parse.Cloud.afterSave('contracts_Document', DocumentAftersave);
Parse.Cloud.afterSave('contracts_Contactbook', ContactbookAftersave);
Parse.Cloud.afterSave('contracts_Template', TemplateAfterSave);
Parse.Cloud.afterSave('contracts_Teams', TeamsAftersave);

// This beforeSave function triggers before an object is added or updated in the specified class, allowing for validation or modification.
Parse.Cloud.beforeSave('contracts_Document', DocumentBeforesave);
Parse.Cloud.beforeSave('contracts_Template', TemplateBeforeSave);

// This afterFind function triggers after a query retrieves objects from the specified class, allowing for post-processing of the results.
Parse.Cloud.afterFind(Parse.User, UserAfterFind);
Parse.Cloud.afterFind('contracts_Document', DocumentBeforeFind);
Parse.Cloud.afterFind('contracts_Template', TemplateAfterFind);
Parse.Cloud.afterFind('contracts_Signature', SignatureAfterFind);
Parse.Cloud.afterFind('partners_Tenant', TenantAterFind);

// This define function creates a custom Cloud Function that can be called from the client-side, enabling custom business logic on the server.
defineCloudFunction('signPdf', PDF);
defineCloudFunction('sendmailv3', sendmailv3);
defineCloudFunction('usersignup', usersignup);
defineCloudFunction('SendOTPMailV1', sendMailOTPv1);
defineCloudFunction('AuthLoginAsMail', AuthLoginAsMail);
defineCloudFunction('getUserId', getUserId);
defineCloudFunction('getUserDetails', getUserDetails);
defineCloudFunction('getDocument', getDocument);
defineCloudFunction('getDrive', getDrive);
defineCloudFunction('getReport', getReport);
defineCloudFunction('getTemplate', GetTemplate);
defineCloudFunction('verifyemail', VerifyEmail);
defineCloudFunction('getsignedurl', getSignedUrl);
defineCloudFunction('batchdocuments', createBatchDocs);
defineCloudFunction('linkcontacttodoc', linkContactToDoc);
defineCloudFunction('isextenduser', isextenduser);
defineCloudFunction('getlogobydomain', GetLogoByDomain);
defineCloudFunction('addadmin', AddAdmin);
defineCloudFunction('checkadminexist', CheckAdminExist);
defineCloudFunction('updateuserasadmin', UpdateExistUserAsAdmin);
defineCloudFunction('newsletter', Newsletter);
defineCloudFunction('getteams', getTeams);
defineCloudFunction('getcontact', getContact);
defineCloudFunction('updatecontacttour', updateContactTour);
defineCloudFunction('declinedoc', declinedocument);
defineCloudFunction('gettenant', getTenant);
defineCloudFunction('getsigners', getSigners);
defineCloudFunction('savefile', saveFile);
defineCloudFunction('savecontact', savecontact);
defineCloudFunction('isuserincontactbook', isUserInContactBook);
defineCloudFunction('updatetourstatus', updateTourStatus);
defineCloudFunction('updatesignaturetype', updateSignatureType);
defineCloudFunction('updatepreferences', updatePreferences);
defineCloudFunction('createduplicate', createDuplicate);
defineCloudFunction('createbatchcontact', createBatchContact);
defineCloudFunction('generatecertificate', generateCertificatebydocId);
defineCloudFunction('fileupload', fileUpload);
defineCloudFunction('getuserlistbyorg', getUserListByOrg);
defineCloudFunction('editcontact', editContact);
defineCloudFunction('forwarddoc', forwardDoc);
defineCloudFunction('saveastemplate', saveAsTemplate);
defineCloudFunction('updatetenant', updateTenant);
defineCloudFunction('recreatedoc', recreateDocument);
defineCloudFunction('loginuser', loginUser);
defineCloudFunction('loginWithMicrosoft', loginWithMicrosoft);
defineCloudFunction('adduser', addUser);
defineCloudFunction('filterdocs', filterDocs);
defineCloudFunction('senddeleterequest', sendDeleteUserMail);
defineCloudFunction('resetpassword', resetPassword);
defineCloudFunction('savesignature', saveSignature);
defineCloudFunction('managesign', manageSign);
defineCloudFunction('getdefaultsignature', getSignature);
defineCloudFunction('updateemailtemplates', updateEmailTemplates);
defineCloudFunction('triggerevent', triggerEvent);
defineCloudFunction('setwidgetpreferences', setWidgetPreferences);
defineCloudFunction('createdocumentfromapp', createDocumentFromApp);
defineCloudFunction('authorizeSigningLink', authorizeSigningLink);
defineCloudFunction('getSigningLinkContext', getSigningLinkContext);
defineCloudFunction('requestExternalSigningOtp', requestExternalSigningOtp);
defineCloudFunction('verifyExternalSigningOtp', verifyExternalSigningOtp);
defineCloudFunction('getExternalSigningCompletion', getExternalSigningCompletion);
defineCloudFunction('getExternalSignedDocumentDownload', getExternalSignedDocumentDownload);
