import { useEffect, useState } from "react";
import { useParams } from "react-router";
import Parse from "parse";
import { lhiBranding } from "../config/branding";
import Loader from "../primitives/Loader";
import CheckCircle from "../primitives/CheckCircle";

const formatTimestamp = (value) => {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const getErrorMessage = (error, fallback) =>
  error?.message ||
  error?.error ||
  error?.response?.data?.error ||
  error?.response?.data?.result?.error ||
  fallback;

function ExternalSigningCompleted() {
  const { completionReference = "" } = useParams();
  const [state, setState] = useState({
    loading: true,
    error: "",
    details: null
  });
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    let isMounted = true;
    const loadCompletion = async () => {
      setState({ loading: true, error: "", details: null });
      try {
        const result = await Parse.Cloud.run("getExternalSigningCompletion", {
          completionReference
        });
        if (!isMounted) return;
        setState({ loading: false, error: "", details: result });
      } catch (error) {
        if (!isMounted) return;
        setState({
          loading: false,
          error: getErrorMessage(
            error,
            "This download link is invalid or no longer available."
          ),
          details: null
        });
      }
    };

    loadCompletion();
    return () => {
      isMounted = false;
    };
  }, [completionReference]);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const result = await Parse.Cloud.run("getExternalSignedDocumentDownload", {
        completionReference
      });
      if (!result?.downloadUrl) {
        throw new Error("The signed document is not available for download.");
      }
      const link = document.createElement("a");
      link.href = result.downloadUrl;
      link.download = result.filename || "signed-document.pdf";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      setDownloadError(
        getErrorMessage(error, "The signed document could not be downloaded.")
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--lhi-bg,#F7F8FA)] px-4 py-8 text-[var(--lhi-text,#1F2933)]">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-2xl flex-col justify-center">
        <div className="rounded-lg border border-[var(--lhi-border,#D8DEE8)] bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex justify-center">
            <img
              src={lhiBranding.logo}
              alt={`${lhiBranding.organizationName} logo`}
              className="h-12 w-auto"
            />
          </div>

          {state.loading ? (
            <div className="flex justify-center py-10">
              <Loader />
            </div>
          ) : state.error ? (
            <div className="space-y-5 text-center">
              <h1 className="text-2xl font-semibold">
                Life Helpers Signature Portal
              </h1>
              <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {state.error}
              </p>
              <a
                className="inline-flex items-center justify-center rounded-md border border-[var(--lhi-border,#D8DEE8)] px-4 py-2 text-sm font-medium"
                href={`mailto:${lhiBranding.supportEmail}`}
              >
                Contact support
              </a>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col items-center gap-3 text-center">
                <CheckCircle className="h-14 w-14 text-green-600" />
                <p className="text-sm font-semibold uppercase tracking-wide text-[var(--lhi-primary,#ED3237)]">
                  Life Helpers Signature Portal
                </p>
                <h1 className="text-2xl font-semibold">
                  Your signature has been submitted successfully.
                </h1>
                <p className="text-sm text-[var(--lhi-muted,#667085)]">
                  You can download the document you just signed below.
                </p>
              </div>

              <dl className="grid gap-3 rounded-md border border-[var(--lhi-border,#D8DEE8)] bg-[#FBFCFD] p-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-[var(--lhi-muted,#667085)]">
                    Document
                  </dt>
                  <dd className="mt-1 break-words font-semibold">
                    {state.details?.documentTitle || "Document"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-[var(--lhi-muted,#667085)]">
                    Status
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {state.details?.copyLabel || "Signed copy"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-[var(--lhi-muted,#667085)]">
                    Signed by
                  </dt>
                  <dd className="mt-1 break-words font-semibold">
                    {state.details?.signerDisplayName ||
                      state.details?.maskedEmail ||
                      "Verified signer"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-[var(--lhi-muted,#667085)]">
                    Signed at
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {formatTimestamp(state.details?.signedAt) || "Completed"}
                  </dd>
                </div>
              </dl>

              {downloadError ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {downloadError}
                </p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  className="op-btn op-btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold"
                  onClick={handleDownload}
                  disabled={downloading}
                >
                  <i className="fa-light fa-download" aria-hidden="true"></i>
                  <span>{downloading ? "Preparing download..." : "Download signed document"}</span>
                </button>
                <button
                  type="button"
                  className="op-btn op-btn-neutral inline-flex items-center justify-center px-4 py-2 text-sm font-semibold"
                  onClick={() => window.close()}
                >
                  Close
                </button>
              </div>

              <p className="text-center text-xs text-[var(--lhi-muted,#667085)]">
                Need help? Contact{" "}
                <a
                  className="font-medium text-[var(--lhi-primary,#ED3237)]"
                  href={`mailto:${lhiBranding.supportEmail}`}
                >
                  {lhiBranding.supportEmail}
                </a>
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

export default ExternalSigningCompleted;
