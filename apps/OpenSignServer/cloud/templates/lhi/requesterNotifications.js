import { sanitizeFileName } from '../../../Utils.js';
import { getSignerEmail, getSignerName } from '../../utils/recipientIdentity.js';

const supportEmail = 'helpdesk@lhinigeria.org';
const productName = 'Life Helpers Signature Portal';
const organizationName = 'Life Helpers Initiative';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value = new Date()) {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function layout({ title, body, actionUrl }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;background:#f7f8fa;font-family:Segoe UI,Arial,sans-serif;color:#1f2933;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f8fa;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #d8dee8;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:#ed3237;color:#ffffff;padding:22px 24px;">
              <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">${organizationName}</div>
              <div style="font-size:22px;font-weight:700;margin-top:6px;">${escapeHtml(title)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px;font-size:15px;line-height:1.6;">
              ${body}
              ${
                actionUrl
                  ? `<p style="margin:28px 0 0;"><a href="${escapeHtml(actionUrl)}" style="background:#ed3237;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700;display:inline-block;">View request</a></p>`
                  : ''
              }
            </td>
          </tr>
          <tr>
            <td style="background:#f1f4f8;border-top:1px solid #d8dee8;padding:18px 24px;font-size:12px;line-height:1.5;color:#667085;">
              <div>${organizationName}</div>
              <div>${productName}</div>
              <div>For assistance, contact <a href="mailto:${supportEmail}" style="color:#ed3237;">${supportEmail}</a>.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildProgressNotification({ doc, signer, remainingCount, status, viewUrl, signedAt }) {
  const documentTitle = doc?.Name || 'Document';
  const signerName = getSignerName(signer) || 'A signer';
  const signerEmail = getSignerEmail(signer);
  return {
    subject: `Signature Completed — ${documentTitle}`,
    html: layout({
      title: 'Signature Completed',
      actionUrl: viewUrl,
      body: `
        <p>Hello,</p>
        <p><strong>${escapeHtml(signerName)}</strong> has completed their signature.</p>
        <table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0;width:100%;font-size:14px;">
          <tr><td style="font-weight:700;padding:5px 0;">Document</td><td>${escapeHtml(documentTitle)}</td></tr>
          <tr><td style="font-weight:700;padding:5px 0;">Signer</td><td>${escapeHtml(signerName)}</td></tr>
          <tr><td style="font-weight:700;padding:5px 0;">Signer email</td><td>${escapeHtml(signerEmail)}</td></tr>
          <tr><td style="font-weight:700;padding:5px 0;">Signed at</td><td>${escapeHtml(formatDate(signedAt))}</td></tr>
          <tr><td style="font-weight:700;padding:5px 0;">Status</td><td>${escapeHtml(status)}</td></tr>
        </table>
        <p>${remainingCount} signature(s) remain.</p>
      `,
    }),
  };
}

export function buildFinalNotification({ doc, signers, viewUrl, completedAt }) {
  const documentTitle = doc?.Name || 'Document';
  const signerList = (signers || [])
    .map(signer => `<li>${escapeHtml(getSignerName(signer) || getSignerEmail(signer) || 'Signer')} &lt;${escapeHtml(getSignerEmail(signer))}&gt;</li>`)
    .join('');
  return {
    subject: `Document Fully Signed — ${documentTitle}`,
    html: layout({
      title: 'Document Fully Signed',
      actionUrl: viewUrl,
      body: `
        <p>Hello,</p>
        <p><strong>${escapeHtml(documentTitle)}</strong> has been fully signed.</p>
        <p><strong>Completion timestamp:</strong> ${escapeHtml(formatDate(completedAt))}</p>
        <p><strong>Completed signers:</strong></p>
        <ul>${signerList}</ul>
        <p>The final fully signed PDF is attached.</p>
      `,
    }),
  };
}

export function buildFinalPdfFilename(documentTitle = 'Document') {
  const base = sanitizeFileName(`${documentTitle}-Fully-Signed.pdf`);
  return base || 'Fully-Signed.pdf';
}
