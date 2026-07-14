import axios from 'axios';
import https from 'https';
import Parse from 'parse/node'; // Ensure Parse is available
import { sanitizeFileName } from '../../Utils.js';

const GRAPH_TOKEN_URL = () => `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID || process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;

let _cachedToken = null;
let _tokenExpiry = null;
const DEFAULT_SENDER = 'helpdesk@lhinigeria.org';
const MAX_DIRECT_ATTACHMENT_BYTES = Number(process.env.GRAPH_MAX_DIRECT_ATTACHMENT_BYTES || 3 * 1024 * 1024);
const MAX_UPLOAD_ATTACHMENT_BYTES = Number(process.env.GRAPH_MAX_UPLOAD_ATTACHMENT_BYTES || 150 * 1024 * 1024);
const GRAPH_UPLOAD_CHUNK_BYTES = 327680 * 12;

export class EmailService {
  /**
   * Retrieves an Application token via Client Credentials.
   */
  static async getAppToken() {
    if (_cachedToken && _tokenExpiry && Date.now() < _tokenExpiry) {
      return _cachedToken;
    }

    const tenantId = process.env.GRAPH_TENANT_ID || process.env.MICROSOFT_TENANT_ID;
    const clientId = process.env.GRAPH_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.GRAPH_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error("Missing Microsoft Graph configuration for EmailService.");
    }

    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('client_secret', clientSecret);
    params.append('grant_type', 'client_credentials');

    try {
      const response = await axios.post(GRAPH_TOKEN_URL(), params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
        httpsAgent: new https.Agent({ family: 4 })
      });

      _cachedToken = response.data.access_token;
      // Expire 5 minutes before actual expiration
      _tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;
      return _cachedToken;
    } catch (err) {
      console.error('Token fetch error:', err.response?.data || err.message);
      throw new Error(`Could not get application token for EmailService: ${err.message}`);
    }
  }

  /**
   * Generates HTML content for the email based on action.
   */
  static generateHtmlTemplate({ title, greeting, documentName, primaryActionUrl, primaryActionText, bodyContent }) {
    const year = new Date().getFullYear();
    const timestamp = new Date().toLocaleString();
    
    // HTML string built using template literals
    return `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f9f9f9; color: #333; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
  .header { background-color: #ED3237; padding: 24px; text-align: center; color: white; }
  .header img { max-height: 50px; margin-bottom: 12px; }
  .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
  .content { padding: 32px 24px; }
  .greeting { font-size: 18px; margin-bottom: 16px; font-weight: 600; }
  .body-text { font-size: 16px; line-height: 1.5; margin-bottom: 24px; color: #555; }
  .doc-name { font-weight: 600; color: #ED3237; }
  .button-container { text-align: center; margin: 32px 0; }
  .button { background-color: #ED3237; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block; }
  .footer { background-color: #f1f1f1; padding: 24px; text-align: center; font-size: 12px; color: #777; border-top: 1px solid #e0e0e0; }
  .footer p { margin: 4px 0; }
  .footer a { color: #ED3237; text-decoration: none; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Life Helpers Signature Portal</h1>
  </div>
  <div class="content">
    <div class="greeting">${greeting || 'Hello'},</div>
    <div class="body-text">
      ${bodyContent || 'You have a new notification.'}
      ${documentName ? '<br><br>Document: <span class="doc-name">' + documentName + '</span>' : ''}
    </div>
    ${primaryActionUrl && primaryActionText ? '<div class="button-container"><a href="' + primaryActionUrl + '" class="button">' + primaryActionText + '</a></div>' : ''}
  </div>
  <div class="footer">
    <p>Life Helpers Initiative | Life Helpers Signature Portal</p>
    <p>This is an automated notification generated at ${timestamp}.</p>
    <p>For assistance, contact helpdesk@lhinigeria.org.</p>
    <p><a href="${process.env.PUBLIC_URL || 'https://lhinigeria.org'}">${process.env.PUBLIC_URL || 'https://lhinigeria.org'}</a></p>
  </div>
</div>
</body>
</html>
    `;
  }

  /**
   * Sleeps for exponential backoff
   */
  static async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static graphHeaders(token, idempotencyKey = null) {
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'client-request-id': idempotencyKey } : {})
    };
  }

  static async sendWithUploadSession({ token, senderEmail, message, attachments, idempotencyKey }) {
    const baseUrl = `https://graph.microsoft.com/v1.0/users/${senderEmail}`;
    const headers = this.graphHeaders(token, idempotencyKey);
    const draftResponse = await axios.post(`${baseUrl}/messages`, message, {
      headers,
      timeout: 15000,
      httpsAgent: new https.Agent({ family: 4 })
    });
    const messageId = draftResponse.data?.id;
    if (!messageId) {
      throw new Error('Microsoft Graph did not return a draft message id for attachment upload.');
    }

    let graphRequestId =
      draftResponse.headers['request-id'] || draftResponse.headers['client-request-id'] || 'unknown';

    for (const attachment of attachments) {
      const uploadSessionResponse = await axios.post(
        `${baseUrl}/messages/${messageId}/attachments/createUploadSession`,
        {
          AttachmentItem: {
            attachmentType: 'file',
            name: attachment.name,
            size: attachment.byteLength,
            contentType: attachment.contentType
          }
        },
        {
          headers,
          timeout: 15000,
          httpsAgent: new https.Agent({ family: 4 })
        }
      );
      const uploadUrl = uploadSessionResponse.data?.uploadUrl;
      if (!uploadUrl) {
        throw new Error(`Microsoft Graph did not return an upload URL for attachment "${attachment.name}".`);
      }
      graphRequestId =
        uploadSessionResponse.headers['request-id'] ||
        uploadSessionResponse.headers['client-request-id'] ||
        graphRequestId;

      const buffer = Buffer.from(attachment.contentBytes, 'base64');
      for (let start = 0; start < buffer.length; start += GRAPH_UPLOAD_CHUNK_BYTES) {
        const end = Math.min(start + GRAPH_UPLOAD_CHUNK_BYTES, buffer.length) - 1;
        const chunk = buffer.subarray(start, end + 1);
        const uploadResponse = await axios.put(uploadUrl, chunk, {
          headers: {
            'Content-Length': chunk.length,
            'Content-Range': `bytes ${start}-${end}/${buffer.length}`
          },
          timeout: 60000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity
        });
        graphRequestId =
          uploadResponse.headers['request-id'] ||
          uploadResponse.headers['client-request-id'] ||
          graphRequestId;
      }
    }

    const sendResponse = await axios.post(`${baseUrl}/messages/${messageId}/send`, null, {
      headers,
      timeout: 15000,
      httpsAgent: new https.Agent({ family: 4 })
    });

    graphRequestId =
      sendResponse.headers['request-id'] || sendResponse.headers['client-request-id'] || graphRequestId;

    return { graphRequestId, messageId };
  }

  /**
   * Main send function
   */
  static async send(options) {
    const {
      recipient, // String or Array
      subject,
      title,
      greeting,
      documentName,
      bodyContent,
      primaryActionUrl,
      primaryActionText,
      attachments = [], // [{name, contentBytes, contentType}]
      startedByUserId = null, // The user ID who initiated the action
      senderEmail: requestedSenderEmail,
      forceApplication = false,
      cc = [],
      bcc = [],
      replyTo = [],
      htmlContent,
      idempotencyKey = null
    } = options;

    const startTime = Date.now();
    let mode = 'Application';
    const defaultSender = requestedSenderEmail || process.env.GRAPH_DEFAULT_SENDER || process.env.GRAPH_SERVICE_ACCOUNT || DEFAULT_SENDER;
    let senderEmail = defaultSender;

    // Determine sender and mode
    if (startedByUserId && !forceApplication && !requestedSenderEmail) {
      try {
        const userQuery = new Parse.Query(Parse.User);
        const user = await userQuery.get(startedByUserId, { useMasterKey: true });
        
        // If the user has a Microsoft UPN or matched email from directory, they are a Microsoft user
        // We will send as them.
        if (user && (user.get('UPN') || user.get('email'))) {
          // If UPN exists, use it, else email
          const userEmail = user.get('UPN') || user.get('email');
          if (userEmail && userEmail.endsWith('@lhinigeria.org')) {
             mode = 'Delegated';
             senderEmail = userEmail;
          }
        }
      } catch (err) {
        console.warn("Could not fetch user for EmailService. Falling back to default sender.");
      }
    }

    const renderedHtmlContent = htmlContent || this.generateHtmlTemplate({
      title,
      greeting,
      documentName,
      bodyContent,
      primaryActionUrl,
      primaryActionText
    });

    const toRecipients = Array.isArray(recipient) 
      ? recipient.map(r => ({ emailAddress: { address: r } }))
      : [{ emailAddress: { address: recipient } }];
    const ccRecipients = Array.isArray(cc)
      ? cc.filter(Boolean).map(r => ({ emailAddress: { address: r } }))
      : cc
        ? [{ emailAddress: { address: cc } }]
        : [];
    const bccRecipients = Array.isArray(bcc)
      ? bcc.filter(Boolean).map(r => ({ emailAddress: { address: r } }))
      : bcc
        ? [{ emailAddress: { address: bcc } }]
        : [];
    const replyToRecipients = Array.isArray(replyTo)
      ? replyTo.filter(Boolean).map(r => ({ emailAddress: { address: r } }))
      : replyTo
        ? [{ emailAddress: { address: replyTo } }]
        : [];

    const normalizedAttachments = attachments.map(att => {
      const contentBytes = att.contentBytes || '';
      const byteLength = Buffer.byteLength(contentBytes, 'base64');
      if (byteLength > MAX_UPLOAD_ATTACHMENT_BYTES) {
        throw new Error(
          `Attachment "${att.name}" is ${byteLength} bytes and exceeds the configured Microsoft Graph upload attachment limit (${MAX_UPLOAD_ATTACHMENT_BYTES} bytes).`
        );
      }
      return {
        name: sanitizeFileName(att.name || 'attachment.pdf') || 'attachment.pdf',
        contentBytes,
        contentType: att.contentType || 'application/octet-stream',
        byteLength
      };
    });
    const useUploadSession = normalizedAttachments.some(
      att => att.byteLength > MAX_DIRECT_ATTACHMENT_BYTES
    );
    const directAttachments = useUploadSession
      ? []
      : normalizedAttachments.map(att => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: att.name,
          contentBytes: att.contentBytes,
          contentType: att.contentType
        }));

    const message = {
      subject: subject,
      body: {
        contentType: 'HTML',
        content: renderedHtmlContent
      },
      toRecipients: toRecipients
    };
    if (directAttachments.length > 0) message.attachments = directAttachments;
    if (ccRecipients.length > 0) message.ccRecipients = ccRecipients;
    if (bccRecipients.length > 0) message.bccRecipients = bccRecipients;
    if (replyToRecipients.length > 0) message.replyTo = replyToRecipients;

    const graphPayload = {
      message: message,
      saveToSentItems: true
    };

    // The endpoint to use
    // Using Application permissions, we use /users/{id | userPrincipalName}/sendMail
    const endpoint = `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`;

    const maxRetries = 3;
    let attempt = 0;
    let success = false;
    let lastError = null;
    let graphRequestId = null;
    let messageId = null;

    while (attempt < maxRetries && !success) {
      attempt++;
      try {
        const token = await this.getAppToken();

        if (useUploadSession) {
          const response = await this.sendWithUploadSession({
            token,
            senderEmail,
            message,
            attachments: normalizedAttachments,
            idempotencyKey
          });
          graphRequestId = response.graphRequestId;
          messageId = response.messageId;
        } else {
          const response = await axios.post(endpoint, graphPayload, {
            headers: this.graphHeaders(token, idempotencyKey),
            timeout: 15000,
            httpsAgent: new https.Agent({ family: 4 })
          });
          
          graphRequestId = response.headers['request-id'] || response.headers['client-request-id'] || 'unknown';
          messageId = graphRequestId;
        }
        success = true;
      } catch (err) {
        lastError = err;
        const status = err.response?.status;
        graphRequestId = err.response?.headers?.['request-id'] || 'unknown';
        
        // Retry logic for transient errors (429 Too Many Requests, 503, 504)
        if (status === 429 || status === 503 || status === 504) {
          console.warn(`EmailService transient error ${status}. Retrying attempt ${attempt}/${maxRetries}...`);
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          await this.sleep(delay);
        } else {
          // Break immediately on non-transient errors (e.g. 400 Bad Request, 403 Forbidden)
          break;
        }
      }
    }

    const duration = Date.now() - startTime;

    // Logging
    console.log("\n=== EMAIL SERVICE ===");
    console.log("Provider:\nMicrosoft Graph");
    console.log(`\nMode:\n${mode}`);
    console.log(`\nSender:\n${senderEmail}`);
    console.log(`\nRecipient:\n${Array.isArray(recipient) ? recipient.join(', ') : recipient}`);
    console.log(`\nSubject:\n${subject}`);
    console.log(`\nStatus:\n${success ? 'Success' : 'Failed'}`);
    console.log(`\nGraph Request ID:\n${graphRequestId}`);
    console.log(`\nTimestamp:\n${new Date().toISOString()}`);
    console.log(`\nDuration:\n${duration}ms`);
    console.log("=====================\n");

    if (!success) {
      console.error("========== GRAPH EMAIL ERROR ==========");
      console.error("HTTP Status:", lastError.response?.status);
      console.error("Graph Request ID:", graphRequestId);
      console.error("Correlation ID:", lastError.response?.headers?.['x-ms-ags-diagnostic'] || 'unknown');
      console.error("Sender:", senderEmail);
      console.error("Recipient:", recipient);
      console.error("Subject:", subject);
      console.error("Timestamp:", new Date().toISOString());
      console.error("Stack Trace:", lastError.stack);
      console.error("Response Data:", lastError.response?.data);
      console.error("=======================================\n");

      throw new Error(`EmailService failed to send email after ${attempt} attempts. Microsoft Graph Error: ${lastError.message}`);
    }

    return { success, mode, senderEmail, duration, graphRequestId, messageId };
  }
}
