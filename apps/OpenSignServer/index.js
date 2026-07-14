import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import express from 'express';
import cors from 'cors';
import { ParseServer } from 'parse-server';
import path from 'path';
const __dirname = path.resolve();
import http from 'http';
import S3Adapter from '@parse/s3-files-adapter';
import FSFilesAdapter from '@parse/fs-files-adapter';
import { app as customRoute } from './cloud/customRoute/customApp.js';
import { exec } from 'child_process';
import { appName, cloudServerUrl, serverAppId, useLocal } from './Utils.js';
import { SSOAuth } from './auth/authadapter.js';
import runDbMigrations from './migrationdb/index.js';
import { validateSignedLocalUrl } from './cloud/parsefunction/getSignedUrl.js';
import { EmailService } from './cloud/services/EmailService.js';
// Validate required environment configuration
const requiredEnvVars = ['MASTER_KEY', 'SERVER_URL', 'PUBLIC_URL'];
const missingVars = [];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    missingVars.push(envVar);
  }
}
if (!process.env.DATABASE_URI && !process.env.MONGODB_URI) {
  missingVars.push('DATABASE_URI / MONGODB_URI');
}

const getOrigin = (urlStr) => {
  try {
    return new URL(urlStr).origin;
  } catch (e) {
    return urlStr || 'not set';
  }
};

const envName = process.env.NODE_ENV || 'development';
const publicAppOrigin = getOrigin(process.env.PUBLIC_URL);
const publicParseOrigin = getOrigin(process.env.SERVER_URL);
const redirectUri = process.env.MICROSOFT_REDIRECT_URI || process.env.VITE_MICROSOFT_REDIRECT_URI || '';
const microsoftRedirectOrigin = getOrigin(redirectUri);
const graphSenderMailbox = process.env.GRAPH_DEFAULT_SENDER || process.env.GRAPH_SERVICE_ACCOUNT || 'not set';
const hasGraphCreds = Boolean(
  process.env.MICROSOFT_CLIENT_ID &&
  process.env.MICROSOFT_CLIENT_SECRET &&
  process.env.MICROSOFT_TENANT_ID
);

console.log('=== BACKEND STARTUP CONFIGURATION AUDIT ===');
console.log(`- Environment Name: ${envName}`);
console.log(`- Public Application Origin: ${publicAppOrigin}`);
console.log(`- Public Parse Origin: ${publicParseOrigin}`);
console.log(`- Microsoft Redirect Origin: ${microsoftRedirectOrigin}`);
console.log(`- Graph Sender Mailbox: ${graphSenderMailbox}`);
console.log(`- Graph Credentials Present: ${hasGraphCreds}`);
console.log('============================================');

if (missingVars.length > 0) {
  console.error(`FATAL: Missing required environment configuration variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

let fsAdapter;

if (useLocal !== 'true') {
  try {
    // const spacesEndpoint = new AWS.Endpoint(process.env.DO_ENDPOINT);
    const spacesEndpoint = process.env.DO_ENDPOINT?.includes('http')
      ? process.env.DO_ENDPOINT
      : `https://${process.env.DO_ENDPOINT}`; //"e.g https://blr1.digitaloceanspaces.com"
    const s3Options = {
      bucket: process.env.DO_SPACE,
      baseUrl: process.env.DO_BASEURL,
      fileAcl: 'none',
      region: process.env.DO_REGION,
      directAccess: true,
      preserveFileName: true,
      presignedUrl: true,
      presignedUrlExpires: 900,
      s3overrides: {
        credentials: {
          accessKeyId: process.env.DO_ACCESS_KEY_ID,
          secretAccessKey: process.env.DO_SECRET_ACCESS_KEY,
        },
        endpoint: spacesEndpoint,
        signatureVersion: 'v4',
      },
    };
    fsAdapter = new S3Adapter(s3Options);
  } catch (err) {
    console.log('Please provide AWS credintials in env file! Defaulting to local storage.');
    fsAdapter = new FSFilesAdapter({
      filesSubDirectory: 'files', // optional, defaults to ./files
    });
  }
} else {
  fsAdapter = new FSFilesAdapter({
    filesSubDirectory: 'files', // optional, defaults to ./files
  });
}

const isMailAdapter = true;
const mailsender = process.env.GRAPH_DEFAULT_SENDER || process.env.GRAPH_SERVICE_ACCOUNT || 'helpdesk@lhinigeria.org';
export const config = {
  databaseURI:
    process.env.DATABASE_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/dev',
  cloud: function () {
    import('./cloud/main.js');
  },
  appId: serverAppId,
  logLevel: ['error'],
  maxLimit: 500,
  maxUploadSize: '100mb',
  masterKey: process.env.MASTER_KEY, //Add your master key here. Keep it secret!
  masterKeyIps: ['0.0.0.0/0', '::/0'], // '::1'
  serverURL: cloudServerUrl, // Don't forget to change to https if needed
  verifyUserEmails: false,
  publicServerURL: process.env.SERVER_URL || cloudServerUrl,
  // Your apps name. This will appear in the subject and body of the emails that are sent.
  appName: appName,
  allowClientClassCreation: false,
  allowExpiredAuthDataToken: false,
  enableInsecureAuthAdapters: false,
  databaseOptions: { allowPublicExplain: false },
  encodeParseObjectInCloudFunction: true,
  ...(isMailAdapter === true
    ? {
        emailAdapter: {
          module: 'parse-server-api-mail-adapter',
          options: {
            // The email address from which emails are sent.
            sender: appName + ' <' + mailsender + '>',
            // The email templates.
            templates: {
              // The template used by Parse Server to send an email for password
              // reset; this is a reserved template name.
              passwordResetEmail: {
                subjectPath: './files/password_reset_email_subject.txt',
                textPath: './files/password_reset_email.txt',
                htmlPath: './files/password_reset_email.html',
              },
              // The template used by Parse Server to send an email for email
              // address verification; this is a reserved template name.
              verificationEmail: {
                subjectPath: './files/verification_email_subject.txt',
                textPath: './files/verification_email.txt',
                htmlPath: './files/verification_email.html',
              },
            },
            apiCallback: async ({ payload, locale }) => {
              await EmailService.send({
                recipient: payload.to,
                subject: payload.subject,
                bodyContent: payload.html || payload.text,
                greeting: 'Hello',
              });
            },
          },
        },
      }
    : {}),
  filesAdapter: fsAdapter,
  auth: { google: { clientId: process.env.GOOGLE_CLIENT_ID }, sso: SSOAuth },
  // for fix Adapter prototype don't match expected prototype
  push: { queueOptions: { disablePushWorker: true } },
};
// Client-keys like the javascript key or the .NET key are not necessary with parse-server
// If you wish you require them, you can set them as options in the initialization above:
// javascriptKey, restAPIKey, dotNetKey, clientKey

export const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(function (req, res, next) {
  req.headers['x-real-ip'] = getUserIP(req);
  const publicUrl = process.env.PUBLIC_URL || ('https://' + req?.get('host'));
  req.headers['public_url'] = publicUrl;
  next();
});
function getUserIP(request) {
  let forwardedFor = request.headers['x-forwarded-for'];
  if (forwardedFor) {
    if (forwardedFor.indexOf(',') > -1) {
      return forwardedFor.split(',')[0];
    } else {
      return forwardedFor;
    }
  } else {
    return request.socket.remoteAddress;
  }
}

app.use(async function (req, res, next) {
  const isFilePath = req.path?.includes('/files/') || false;
  if (isFilePath && req.method.toLowerCase() === 'get') {
    const serverUrl = new URL(process.env.SERVER_URL);
    const origin = serverUrl.pathname === '/api/app' ? serverUrl.origin + '/api' : serverUrl.origin;
    const fileUrl = origin + req.originalUrl;
    const params = fileUrl?.split('?')?.[1];
    
    let validationError = null;
    let fileRes = 'Unauthorized';
    if (params) {
      fileRes = await validateSignedLocalUrl(fileUrl);
      if (fileRes.startsWith('Unauthorized')) {
        validationError = fileRes.split(':')[1] || 'unauthorized';
        fileRes = 'Unauthorized';
      }
    } else {
      validationError = 'No query parameters provided';
    }

    // Capture response status and content type
    const originalSend = res.send;
    const originalStatus = res.status;
    let loggedStatus = 200;
    let loggedContentType = 'application/pdf';

    res.status = function(code) {
      loggedStatus = code;
      return originalStatus.apply(this, arguments);
    };

    res.send = function(body) {
      loggedContentType = res.get('Content-Type') || '';
      printDiagnostics().catch(err => console.error('Diagnostics error:', err));
      return originalSend.apply(this, arguments);
    };

    res.on('finish', () => {
      if (loggedStatus === 200) {
        loggedContentType = res.get('Content-Type') || 'application/pdf';
        printDiagnostics().catch(err => console.error('Diagnostics error:', err));
      }
    });

    async function printDiagnostics() {
      if (req._diagnosticsPrinted) return;
      req._diagnosticsPrinted = true;

      const filename = req.path.substring(req.path.lastIndexOf('/') + 1);
      let docId = 'unknown';
      let fieldName = 'unknown';
      try {
        const query = new Parse.Query('contracts_Document');
        query.contains('URL', filename);
        const doc = await query.first({ useMasterKey: true });
        if (doc) {
          docId = doc.id;
          fieldName = doc.get('URL')?.includes(filename) ? 'URL' : (doc.get('SignedUrl')?.includes(filename) ? 'SignedUrl' : 'URL');
        } else {
          const queryTemplate = new Parse.Query('contracts_Template');
          queryTemplate.contains('URL', filename);
          const temp = await queryTemplate.first({ useMasterKey: true });
          if (temp) {
            docId = temp.id;
            fieldName = 'URL';
          }
        }
      } catch (e) {
        // ignore
      }

      console.info('=== PDF REQUEST DIAGNOSTICS ===');
      console.info(`- Document objectId: ${docId}`);
      console.info(`- Selected PDF field name: ${fieldName}`);
      console.info(`- PDF source type: local`);
      console.info(`- URL origin and path: ${req.protocol || 'http'}://${req.get('host')}${req.path}`);
      console.info(`- Response status: ${loggedStatus}`);
      console.info(`- Response content type: ${loggedContentType}`);
      console.info(`- Actual file-server error message: ${validationError || 'None'}`);
      console.info('================================');
    }

    if (fileRes === 'Unauthorized') {
      res.status(400).json({ message: 'unauthorized' });
      return;
    }
    next();
  } else {
    next();
  }
});

// Serve static assets from the /public folder
app.use('/public', express.static(path.join(__dirname, '/public')));

// Serve the Parse API on the /parse URL prefix
if (!process.env.TESTING) {
  const mountPath = process.env.PARSE_MOUNT || '/app';
  try {
    const server = new ParseServer(config);
    await server.start();
    app.use(mountPath, server.app);
  } catch (err) {
    console.log(err);
    process.exit();
  }
}
// Mount your custom express app
app.use('/', customRoute);

// Parse Server plays nicely with the rest of your web routes
app.get('/', function (req, res) {
  res.status(200).send('opensign-server is running !!!');
});

if (!process.env.TESTING) {
  const port = process.env.PORT || 8080;
  const httpServer = http.createServer(app);
  // Set the Keep-Alive and headers timeout to 100 seconds
  httpServer.keepAliveTimeout = 100000; // in milliseconds
  httpServer.headersTimeout = 100000; // in milliseconds
  httpServer.listen(port, '0.0.0.0', function () {
    console.log('opensign-server running on port ' + port + '.');
    const isWindows = process.platform === 'win32';
    // console.log('isWindows', isWindows);
    runDbMigrations();
    exec('npx parse-dbtool migrate', {
      env: {
        ...process.env,
        APPLICATION_ID: serverAppId,
        SERVER_URL: cloudServerUrl,
        MASTER_KEY: process.env.MASTER_KEY,
      },
    }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`Error: ${stderr}`);
        return;
      }
      console.log(`Command output: ${stdout}`);
    });
  });
}
