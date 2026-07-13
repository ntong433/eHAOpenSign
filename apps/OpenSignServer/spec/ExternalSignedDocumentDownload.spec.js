import {
  buildExternalDownloadFilename,
  stripSignedFileCredential,
} from '../cloud/services/externalSignedDocumentDownload.js';

describe('external signed document download helpers', () => {
  it('stores signed PDF file bindings without transient URL credentials', () => {
    const fileUrl =
      'http://127.0.0.1:8085/app/files/opensign/signed.pdf?token=secret-token';

    expect(stripSignedFileCredential(fileUrl)).toBe(
      'http://127.0.0.1:8085/app/files/opensign/signed.pdf'
    );
  });

  it('labels non-final and final external downloads distinctly', () => {
    expect(buildExternalDownloadFilename('Leave Approval', false)).toBe(
      'Leave Approval - Signed Copy.pdf'
    );
    expect(buildExternalDownloadFilename('Leave Approval', true)).toBe(
      'Leave Approval - Fully Signed.pdf'
    );
  });
});
