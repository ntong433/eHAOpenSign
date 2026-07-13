import { appName } from '../../Utils.js';
import { EmailService } from '../services/EmailService.js';

export const errHtml = err => {
  return `<html><head><meta http-equiv="Content-Type" content="text/html;charset=UTF-8" /><title>Reset Password</title></head>
  <body><h1 style="color:#1a5fa0; margin-bottom:16px;">${err}</h1></body></html>`;
};
const sendDeleteUserMail = async req => {
  const app = req.params.app || appName;
  if (!req.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
  try {
    const { userId } = req.params;
    if (!userId) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Missing userId parameter.');
    }

    const userPointer = { __type: 'Pointer', className: '_User', objectId: userId };

    const createdByPointer = { __type: 'Pointer', className: '_User', objectId: req.user.id };

    const userCondition = new Parse.Query('contracts_Users');
    userCondition.equalTo('UserId', userPointer);

    const userAndCreatorCondition = new Parse.Query('contracts_Users');
    userAndCreatorCondition.equalTo('UserId', userPointer);
    userAndCreatorCondition.equalTo('CreatedBy', createdByPointer);

    const mainQuery = Parse.Query.or(userCondition, userAndCreatorCondition);

    const result = await mainQuery.first({ useMasterKey: true });
    const username = result.get('Email')?.toLowerCase()?.replace(/\s/g, '');
    const name = result?.get('Name') ? `<b>${result?.get('Name')}</b>` : '';
    const isAdmin = result?.get('UserRole') === 'contracts_Admin';
    if (!isAdmin) {
      throw new Parse.Error(
        Parse.Error.SCRIPT_FAILED,
        'This action is not permitted. Kindly contact your administrator to request account deletion.'
      );
    }

    const serverUrl = process.env?.SERVER_URL?.replace(/\/app\/?$/, '/');
    const deleteUrl = `${serverUrl}delete-account/${userId}`;
    await EmailService.send({
      recipient: username,
      subject: `Account Deletion Request for ${username} – ${app}`,
      greeting: `Hello ${name}`,
      bodyContent: `<p style="font-size:16px; line-height:1.5;">
            We have received a request to permanently delete your <b>${app}</b> account associated with <b>${username}</b>.
        </p>
        <p style="font-size:16px; line-height:1.5;">
            If you did not make this request, please ignore this email. Otherwise, click the button below to proceed
            with the deletion.
        </p>
        <p style="font-size:14px; color:#777;">
            Note: This action is irreversible and all your data will be permanently removed from our systems.
        </p>`,
      primaryActionUrl: deleteUrl,
      primaryActionText: 'Confirm Account Deletion',
      startedByUserId: req.user.id
    });
    return 'mail sent.';
  } catch (err) {
    console.log('Err in sending delete user email ', err);
    throw new Parse.Error(Parse.Error.SCRIPT_FAILED, err.message);
  }
};
export default sendDeleteUserMail;
