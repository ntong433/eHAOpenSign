import { appName, updateMailCount } from '../../Utils.js';
import { EmailService } from '../services/EmailService.js';
async function getDocument(docId) {
  try {
    const query = new Parse.Query('contracts_Document');
    query.equalTo('objectId', docId);
    query.include('ExtUserPtr');
    query.include('CreatedBy');
    query.include('Signers');
    query.include('AuditTrail.UserPtr');
    query.include('ExtUserPtr.TenantId');
    query.include('Placeholders');
    query.notEqualTo('IsArchive', true);
    const res = await query.first({ useMasterKey: true });
    const _res = res?.toJSON();
    return _res?.ExtUserPtr?.objectId;
  } catch (err) {
    console.log('err ', err);
  }
}
async function sendMailOTPv1(request) {
  try {
    let code = Math.floor(1000 + Math.random() * 9000);
    let email = request.params.email;
    let TenantId = request.params.TenantId ? request.params.TenantId : undefined;
    const AppName = appName;

    if (email) {
      const recipient = request.params.email;
      try {
        const subject = 'Verify Your Email Address';
        const result = await EmailService.send({
          recipient: email,
          subject: subject,
          greeting: 'Hello',
          bodyContent: `<div style='padding:20px;'><p style='font-family:system-ui;font-size:14px;'>Your verification code is</p><p style='text-decoration:none;font-weight:bolder;color:#F36F21;font-size:45px;margin:20px;'>${code}</p><p style='font-family:system-ui;font-size:14px;'>This code expires in 10 minutes.</p></div>`,
          startedByUserId: request.user?.id
        });
        
        console.log('\n=== OTP EMAIL ===');
        console.log(`Recipient: ${email}`);
        console.log(`Subject: ${subject}`);
        console.log(`Graph Provider: Microsoft Graph`);
        console.log(`Status: ${result.success ? 'Success' : 'Failed'}`);
        console.log(`Message ID: ${result.graphRequestId || 'unknown'}`);
        console.log('=================\n');

        if (request.params?.docId) {
          const extUserId = await getDocument(request.params?.docId);
          if (extUserId) {
            updateMailCount(extUserId);
          }
        }
      } catch (err) {
        console.log('\n=== OTP EMAIL ===');
        console.log(`Recipient: ${email}`);
        console.log(`Subject: Verify Your Email Address`);
        console.log(`Graph Provider: Microsoft Graph`);
        console.log(`Status: Failed`);
        console.log(`Error: ${err.message}`);
        console.log('=================\n');
      }
      const tempOtp = new Parse.Query('defaultdata_Otp');
      tempOtp.equalTo('Email', email);
      const resultOTP = await tempOtp.first({ useMasterKey: true });
      // console.log('resultOTP', resultOTP);
      if (resultOTP !== undefined) {
        const updateOtpQuery = new Parse.Query('defaultdata_Otp');
        const updateOtp = await updateOtpQuery.get(resultOTP.id, {
          useMasterKey: true,
        });
        updateOtp.set('OTP', code);
        updateOtp.save(null, { useMasterKey: true });
        //   console.log("update otp Res in tempSendOtp ", updateRes);
      } else {
        const otpClass = Parse.Object.extend('defaultdata_Otp');
        const newOtpQuery = new otpClass();
        newOtpQuery.set('OTP', code);
        newOtpQuery.set('Email', email);
        newOtpQuery.set('TenantId', TenantId);
        await newOtpQuery.save(null, { useMasterKey: true });
        //   console.log("new otp Res in tempSendOtp ", newRes);
      }
      return 'Otp send';
    } else {
      return 'Please Enter valid email';
    }
  } catch (err) {
    console.log('err in sendMailOTPv1');
    console.log(err);
    return err;
  }
}
export default sendMailOTPv1;
