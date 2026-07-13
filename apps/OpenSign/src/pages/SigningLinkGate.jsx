import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import Parse from "parse";
import Loader from "../primitives/Loader";
import { lhiBranding } from "../config/branding";
import { loginWithMicrosoftRedirect } from "../services/microsoftAuth";
import {
  clearExternalSigningGrant,
  clearSigningEntryAuthorization,
  markSigningEntryAuthorized,
  readExternalSigningGrant,
  storeExternalSigningGrant,
} from "../utils/externalSigningGrant";
import {
  storePostLoginRedirect,
} from "../utils/postLoginRedirect";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

const INITIAL_STATE = {
  phase: "loading",
  message: "Checking your signature request...",
  error: "",
  traceId: "",
  context: null,
  maskedEmail: "",
};

const decodeSigningToken = (token = "") => {
  try {
    const decoded = window.atob(String(token || ""));
    const [docId, signerEmail, signerId, sendmail] = decoded.split("/");
    return {
      docId: docId || "",
      signerEmail: signerEmail || "",
      signerId: signerId || "",
      sendmail: sendmail || "",
    };
  } catch {
    return {
      docId: "",
      signerEmail: "",
      signerId: "",
      sendmail: "",
    };
  }
};

const getErrorMessage = (error, fallback) => {
  return (
    error?.message ||
    error?.error ||
    error?.response?.data?.error ||
    error?.response?.data?.result?.error ||
    fallback
  );
};

const preserveShellStorage = () => {
  const keys = [
    "baseUrl",
    "parseAppId",
    "favicon",
    "appLogo",
    "appname",
    "userSettings",
    "defaultmenuid",
    "PageLanding",
  ];
  const snapshot = {};
  keys.forEach((key) => {
    const value = localStorage.getItem(key);
    if (value !== null) {
      snapshot[key] = value;
    }
  });
  return snapshot;
};

const restoreShellStorage = (snapshot = {}) => {
  Object.entries(snapshot).forEach(([key, value]) => {
    localStorage.setItem(key, value);
  });
};

function SigningLinkGate() {
  const navigate = useNavigate();
  const { base64url } = useParams();
  const signingToken = useMemo(() => {
    try {
      return decodeURIComponent(base64url || "");
    } catch {
      return base64url || "";
    }
  }, [base64url]);
  const decoded = useMemo(() => decodeSigningToken(signingToken), [signingToken]);
  const redirectRoute = useMemo(
    () => `/login/${encodeURIComponent(signingToken || "")}`,
    [signingToken]
  );
  const otpRequestedRef = useRef(false);
  const redirectingRef = useRef(false);
  const [state, setState] = useState(INITIAL_STATE);
  const [otpCode, setOtpCode] = useState("");
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);
  const [otpBusy, setOtpBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);

  useEffect(() => {
    if (!resendSecondsLeft) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setResendSecondsLeft((value) => (value > 0 ? value - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendSecondsLeft]);

  useEffect(() => {
    let isMounted = true;

    const setGateState = (next) => {
      if (!isMounted) return;
      setState((current) => ({
        ...current,
        ...next,
      }));
    };

    const goToSigningPage = (docId, signerId, authMode = "") => {
      if (redirectingRef.current) return;
      redirectingRef.current = true;
      markSigningEntryAuthorized(signingToken, {
        docId,
        signerId,
        authMode,
      });
      navigate(
        `/load/recipientSignPdf/${docId}/${signerId}?token=${encodeURIComponent(
          signingToken || ""
        )}`,
        { replace: true }
      );
    };

    const authorizeInternalSigner = async (context) => {
      const sessionToken = localStorage.getItem("accesstoken");
      if (!sessionToken) {
        storePostLoginRedirect(redirectRoute);
        navigate("/", { replace: true, state: { from: redirectRoute } });
        return;
      }

      setGateState({
        phase: "loading",
        message: "Verifying your account...",
        error: "",
      });

      try {
        await Parse.User.become(sessionToken);
        const authorization = await Parse.Cloud.run("authorizeSigningLink", {
          token: signingToken,
          docId: context.docId,
          signerId: context.signerId,
          signerEmail: decoded.signerEmail,
        });
        goToSigningPage(
          authorization.docId,
          authorization.signerId,
          authorization.authMode
        );
      } catch (error) {
        const message = getErrorMessage(
          error,
          "We could not verify this signature request."
        );
        if (
          message === "This signature request belongs to another account."
        ) {
          setGateState({
            phase: "wrong-account",
            error: message,
          });
          return;
        }
        setGateState({
          phase: "error",
          error: message,
          message: "",
        });
      }
    };

    const authorizeExternalSigner = async (context, externalGrant) => {
      setGateState({
        phase: "loading",
        message: "Opening your signing session...",
        error: "",
      });
      try {
        const authorization = await Parse.Cloud.run("authorizeSigningLink", {
          token: signingToken,
          docId: context.docId,
          signerId: context.signerId,
          signerEmail: decoded.signerEmail,
          externalSigningGrant: externalGrant,
        });
        goToSigningPage(
          authorization.docId,
          authorization.signerId,
          authorization.authMode
        );
      } catch (error) {
        clearExternalSigningGrant(signingToken);
        const message = getErrorMessage(
          error,
          "This authorization session has expired. Verify your email again."
        );
        setGateState({
          phase: "otp",
          error: message,
          message: "Verify your email to continue.",
        });
      }
    };

    const loadContext = async () => {
      if (!signingToken || !decoded.docId) {
        setGateState({
          phase: "error",
          error: "This signature request is no longer available.",
          message: "",
        });
        return;
      }

      setGateState({
        phase: "loading",
        message: "Checking your signature request...",
        error: "",
      });

      try {
        const context = await Parse.Cloud.run("getSigningLinkContext", {
          token: signingToken,
          docId: decoded.docId,
          signerId: decoded.signerId,
          signerEmail: decoded.signerEmail,
        });

        if (!isMounted) return;

        if (context?.alreadySigned) {
          setGateState({
            phase: "completed",
            context,
            traceId: context.traceId || "",
            maskedEmail: context.maskedEmail || "",
            error: "This document has already been signed.",
            message: "",
          });
          return;
        }

        setGateState({
          phase: "ready",
          context,
          traceId: context.traceId || "",
          maskedEmail: context.maskedEmail || "",
          error: "",
          message: "",
        });

        if (context?.authMode === "external_email_otp") {
          const existingGrant = readExternalSigningGrant(signingToken);
          if (existingGrant?.grantToken) {
            await authorizeExternalSigner(context, existingGrant.grantToken);
            return;
          }
          setGateState({
            phase: "otp",
            context,
            traceId: context.traceId || "",
            maskedEmail: context.maskedEmail || "",
            error: "",
            message: "Verify your email to continue.",
          });
          return;
        }

        await authorizeInternalSigner(context);
      } catch (error) {
        setGateState({
          phase: "error",
          error: getErrorMessage(
            error,
            "This signature request is no longer available."
          ),
          message: "",
        });
      }
    };

    loadContext();

    return () => {
      isMounted = false;
    };
  }, [decoded.docId, decoded.signerEmail, decoded.signerId, navigate, redirectRoute, signingToken]);

  useEffect(() => {
    if (
      state.phase !== "otp" ||
      !state.context ||
      otpRequestedRef.current ||
      otpBusy
    ) {
      return;
    }

    otpRequestedRef.current = true;

    const requestOtp = async () => {
      setOtpBusy(true);
      try {
        await Parse.Cloud.run("requestExternalSigningOtp", {
          token: signingToken,
          docId: state.context.docId,
          signerId: state.context.signerId,
          signerEmail: decoded.signerEmail,
        });
        setResendSecondsLeft(RESEND_COOLDOWN_SECONDS);
        setState((current) => ({
          ...current,
          error: "",
          message: `We sent a verification code to ${current.maskedEmail}.`,
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          error: getErrorMessage(
            error,
            "We could not send a verification code right now."
          ),
          message: "",
        }));
      } finally {
        setOtpBusy(false);
      }
    };

    requestOtp();
  }, [
    signingToken,
    decoded.signerEmail,
    otpBusy,
    state.context,
    state.phase,
  ]);

  const handleResendCode = async () => {
    if (!state.context || resendSecondsLeft > 0 || otpBusy) {
      return;
    }
    setOtpBusy(true);
    try {
      await Parse.Cloud.run("requestExternalSigningOtp", {
        token: signingToken,
        docId: state.context.docId,
        signerId: state.context.signerId,
        signerEmail: decoded.signerEmail,
      });
      setResendSecondsLeft(RESEND_COOLDOWN_SECONDS);
      setState((current) => ({
        ...current,
        error: "",
        message: `We sent a new verification code to ${current.maskedEmail}.`,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: getErrorMessage(
          error,
          "Please wait before requesting another code."
        ),
      }));
    } finally {
      setOtpBusy(false);
    }
  };

  const handleVerifyOtp = async (event) => {
    event.preventDefault();
    if (!state.context || verifyBusy) {
      return;
    }
    if (otpCode.trim().length !== OTP_LENGTH) {
      setState((current) => ({
        ...current,
        error: "Enter the 6-digit verification code.",
      }));
      return;
    }

    setVerifyBusy(true);
    setState((current) => ({
      ...current,
      error: "",
      message: "Verifying your code...",
    }));

	    try {
	      const result = await Parse.Cloud.run("verifyExternalSigningOtp", {
	        token: signingToken,
        docId: state.context.docId,
        signerId: state.context.signerId,
        signerEmail: decoded.signerEmail,
        otpCode,
      });
      storeExternalSigningGrant(signingToken, {
        grantToken: result.externalGrant,
        expiresAt: result.expiresAt,
        docId: result.docId,
        signerId: result.signerId,
      });
      const authorization = await Parse.Cloud.run("authorizeSigningLink", {
        token: signingToken,
        docId: state.context.docId,
        signerId: state.context.signerId,
        signerEmail: decoded.signerEmail,
        externalSigningGrant: result.externalGrant,
      });
      markSigningEntryAuthorized(signingToken, {
        docId: authorization.docId,
        signerId: authorization.signerId,
        authMode: authorization.authMode,
        expiresAt: result.expiresAt,
      });
      navigate(
        `/load/recipientSignPdf/${state.context.docId}/${state.context.signerId}?token=${encodeURIComponent(
          signingToken || ""
        )}`,
        { replace: true }
      );
    } catch (error) {
      clearExternalSigningGrant(signingToken);
      setState((current) => ({
        ...current,
        phase: "otp",
        error: getErrorMessage(
          error,
          "This verification code is incorrect."
        ),
        message: "",
      }));
    } finally {
      setVerifyBusy(false);
    }
  };

  const handleSwitchAccount = async () => {
    const snapshot = preserveShellStorage();
    storePostLoginRedirect(redirectRoute);
    clearExternalSigningGrant(signingToken);
    clearSigningEntryAuthorization(signingToken);
    try {
      await Parse.User.logOut();
    } catch (error) {
      console.error("Error signing out current user", error);
    }
    localStorage.clear();
    restoreShellStorage(snapshot);
    navigate("/", { replace: true, state: { from: redirectRoute } });
  };

  const handleMicrosoftSwitch = async () => {
    await handleSwitchAccount();
    try {
      await loginWithMicrosoftRedirect();
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: "wrong-account",
        error: getErrorMessage(
          error,
          "Microsoft login could not be started."
        ),
      }));
    }
  };

  const card = (
    <div className="w-full max-w-md rounded-lg border border-[var(--lhi-border)] bg-[var(--lhi-surface)] p-6 shadow-[var(--lhi-shadow)] sm:p-8">
      <div className="mb-6 flex justify-center">
        <img
          src={lhiBranding.logo}
          alt={`${lhiBranding.organizationName} logo`}
          className="h-12 w-auto sm:h-14"
        />
      </div>
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold text-[var(--lhi-text)]">
          Life Helpers Signature Portal
        </h1>
        <p className="text-sm text-[var(--lhi-muted)]">{state.message}</p>
      </div>

      {state.error ? (
        <div
          className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {state.error}
        </div>
      ) : null}

      {state.phase === "loading" || state.phase === "ready" ? (
        <div className="mt-8 flex justify-center">
          <Loader />
        </div>
      ) : null}

      {state.phase === "otp" ? (
        <form className="mt-8 space-y-5" onSubmit={handleVerifyOtp}>
          <div className="space-y-2 text-center">
            <h2 className="text-lg font-semibold text-[var(--lhi-text)]">
              Verify your email
            </h2>
            <p className="text-sm text-[var(--lhi-muted)]">
              We sent a verification code to{" "}
              <span className="font-medium text-[var(--lhi-text)]">
                {state.maskedEmail}
              </span>
              .
            </p>
          </div>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--lhi-text)]">
              Verification code
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={OTP_LENGTH}
              value={otpCode}
              onChange={(event) =>
                setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className="lhi-focus-ring w-full rounded-md border border-[var(--lhi-border)] bg-white px-4 py-3 text-center text-xl tracking-[0.35em] text-[var(--lhi-text)]"
              aria-label="One-time verification code"
            />
          </label>
          <button
            type="submit"
            disabled={verifyBusy}
            className="lhi-focus-ring w-full rounded-md bg-[var(--lhi-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#cf252b] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {verifyBusy ? "Verifying..." : "Verify"}
          </button>
          <button
            type="button"
            onClick={handleResendCode}
            disabled={otpBusy || resendSecondsLeft > 0}
            className="lhi-focus-ring w-full rounded-md border border-[var(--lhi-border)] px-4 py-3 text-sm font-medium text-[var(--lhi-text)] transition hover:border-[var(--lhi-primary)] hover:text-[var(--lhi-primary)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {otpBusy
              ? "Sending..."
              : resendSecondsLeft > 0
              ? `Resend code in ${resendSecondsLeft}s`
              : "Resend code"}
          </button>
        </form>
      ) : null}

      {state.phase === "wrong-account" ? (
        <div className="mt-8 space-y-4">
          <p className="text-sm leading-6 text-[var(--lhi-text)]">
            This signature request was sent to a different account.
          </p>
          <p className="text-sm leading-6 text-[var(--lhi-muted)]">
            Sign out and authenticate using the intended recipient account.
          </p>
          <button
            type="button"
            onClick={handleSwitchAccount}
            className="lhi-focus-ring w-full rounded-md bg-[var(--lhi-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#cf252b]"
          >
            Switch account
          </button>
          <button
            type="button"
            onClick={handleMicrosoftSwitch}
            className="lhi-focus-ring w-full rounded-md border border-[var(--lhi-border)] px-4 py-3 text-sm font-medium text-[var(--lhi-text)] transition hover:border-[var(--lhi-primary)] hover:text-[var(--lhi-primary)]"
          >
            Sign in with Microsoft
          </button>
        </div>
      ) : null}

      {state.phase === "completed" || state.phase === "error" ? (
        <div className="mt-8 space-y-3">
          <NavLink
            to="/"
            className="lhi-focus-ring block w-full rounded-md bg-[var(--lhi-primary)] px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-[#cf252b]"
          >
            Return to dashboard
          </NavLink>
        </div>
      ) : null}

      {(state.phase === "otp" || state.phase === "wrong-account") && (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <a
            href={`mailto:${lhiBranding.supportEmail}?subject=Life%20Helpers%20Signature%20Portal%20Support`}
            className="lhi-focus-ring flex-1 rounded-md border border-[var(--lhi-border)] px-4 py-3 text-center text-sm font-medium text-[var(--lhi-text)] transition hover:border-[var(--lhi-primary)] hover:text-[var(--lhi-primary)]"
          >
            Contact support
          </a>
          <NavLink
            to="/"
            className="lhi-focus-ring flex-1 rounded-md border border-[var(--lhi-border)] px-4 py-3 text-center text-sm font-medium text-[var(--lhi-text)] transition hover:border-[var(--lhi-primary)] hover:text-[var(--lhi-primary)]"
          >
            Return to dashboard
          </NavLink>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--lhi-background)] px-4 py-8">
      {card}
    </div>
  );
}

export default SigningLinkGate;
