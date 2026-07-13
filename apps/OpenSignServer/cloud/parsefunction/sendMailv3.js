import { updateMailCount } from '../../Utils.js';
import { EmailService } from '../services/EmailService.js';

async function sendMailProvider(req) {
  const extUserId = req.params?.extUserId || '';
  
  try {
    const from = req.params.from || '';
    const recipient = req.params.recipient;
    const subject = req.params.subject;
    const text = req.params.text || 'mail';
    const html = req.params.html || '';

    await EmailService.send({
      recipient,
      subject,
      bodyContent: html, // Let EmailService generate the template around this
      startedByUserId: req.user?.id || req.params.startedByUserId // Attempt to pass user ID if available
    });

    if (extUserId) {
      await updateMailCount(extUserId);
    }
    return { status: 'success' };
  } catch (err) {
    console.log(`sendmailv3 Error: ${err.message}`);
    return { status: 'error' };
  }
}

async function sendmailv3(req) {
  const nonCustomMail = await sendMailProvider(req);
  return nonCustomMail;
}

export default sendmailv3;
