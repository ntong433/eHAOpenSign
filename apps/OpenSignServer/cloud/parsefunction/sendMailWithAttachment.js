import fs from 'node:fs';
import https from 'https';
import axios from 'axios';
import { updateMailCount } from '../../Utils.js';
import { EmailService } from '../services/EmailService.js';

function safeUnlink(filePath, label = 'file') {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.log(`sendMailWithAttachment unlink ${label} error`);
    }
  }
}

async function sendMailProvider(params) {
  const extUserId = params?.extUserId || '';

  try {
    if (params.url) {
      const randomNumber = Math.floor(Math.random() * 5000);
      const testPdf = `test_${randomNumber}.pdf`;
      try {
        let Pdf = fs.createWriteStream(testPdf);
        const writeToLocalDisk = () => {
          return new Promise((resolve, reject) => {
            const isSecure =
              new URL(params.url)?.protocol === 'https:' &&
              new URL(params.url)?.hostname !== 'localhost';
            if (isSecure) {
              https
                .get(params.url, async function (response) {
                  response.pipe(Pdf);
                  response.on('end', () => resolve('success'));
                })
                .on('error', e => {
                  console.error(`error: ${e.message}`);
                  resolve('error');
                });
            } else {
              const httpsAgent = new https.Agent({ rejectUnauthorized: false });
              const localUrl = params.url;
              const newlocalUrl = localUrl.replace(
                'https://localhost:3001/api',
                'http://localhost:8080'
              );
              axios
                .get(newlocalUrl, { responseType: 'stream', httpsAgent: httpsAgent })
                .then(response => {
                  response.data.pipe(Pdf);
                  Pdf.on('finish', () => resolve('success'));
                  Pdf.on('error', () => resolve('error'));
                })
                .catch(e => {
                  console.log('error in localurl', e.message);
                  resolve('error');
                });
            }
          });
        };

        const ress = await writeToLocalDisk();
        if (ress) {
          function readTolocal() {
            return new Promise((resolve, reject) => {
              setTimeout(() => {
                let PdfBuffer = fs.readFileSync(Pdf.path);
                resolve(PdfBuffer);
              }, 100);
            });
          }

          let PdfBuffer = await readTolocal();
          const pdfName = params.pdfName && `${params.pdfName}.pdf`;
          const filename = params.filename;
          
          let attachments = [];
          attachments.push({
            name: filename || pdfName || 'exported.pdf',
            contentBytes: PdfBuffer.toString('base64'),
            contentType: 'application/pdf'
          });

          const certificatePath = params.certificatePath || `./exports/certificate.pdf`;
          if (fs.existsSync(certificatePath)) {
            try {
              const certificateBuffer = fs.readFileSync(certificatePath);
              attachments.push({
                name: 'certificate.pdf',
                contentBytes: certificateBuffer.toString('base64'),
                contentType: 'application/pdf'
              });
            } catch (err) {
              console.log('sendMailWithAttachment read certificate error', err);
            }
          }

          const cleanupPaths = [
            { path: certificatePath, label: 'certificate' },
            { path: testPdf, label: 'pdf' },
          ];

          await EmailService.send({
            recipient: params.recipient,
            subject: params.subject,
            bodyContent: params.html || '',
            attachments: attachments,
            startedByUserId: params.startedByUserId
          });

          if (extUserId) {
            await updateMailCount(extUserId);
          }

          cleanupPaths.forEach(file => safeUnlink(file.path, file.label));
          return { status: 'success' };
        }
      } catch (err) {
        console.log(`sendMailWithAttachment error: ${err.message}`);
        safeUnlink(testPdf, 'testPdf');
        return { status: 'error' };
      }
    } else {
      await EmailService.send({
        recipient: params.recipient,
        subject: params.subject,
        bodyContent: params.html || '',
        startedByUserId: params.startedByUserId
      });

      if (extUserId) {
        await updateMailCount(extUserId);
      }
      return { status: 'success' };
    }
  } catch (err) {
    console.log(`sendMailWithAttachment Error: ${err.message}`);
    return { status: 'error' };
  }
}

export default async function sendMailWithAttachment(params) {
  const nonCustomMail = await sendMailProvider(params);
  return nonCustomMail;
}

