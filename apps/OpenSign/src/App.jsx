import { useState, useEffect } from "react";
import { lazyWithRetry, hideUpgradeProgress } from "./utils";
import { Routes, Route, BrowserRouter } from "react-router";
import { pdfjs } from "react-pdf";
import Form from "./pages/Form";
import Report from "./pages/Report";
import Dashboard from "./pages/Dashboard";
import HomeLayout from "./layout/HomeLayout";
import PageNotFound from "./pages/PageNotFound";
import ValidateRoute from "./primitives/ValidateRoute";
import Validate from "./primitives/Validate";
import TemplatePlaceholder from "./pages/TemplatePlaceholder";
import SignYourSelf from "./pages/SignyourselfPdf";
import DraftDocument from "./components/pdf/DraftDocument";
import PlaceHolderSign from "./pages/PlaceHolderSign";
import PdfRequestFiles from "./pages/PdfRequestFiles";
import Lazy from "./primitives/LazyPage";
import Loader from "./primitives/Loader";
import UserList from "./pages/UserList";
import { serverUrl_fn } from "./constant/appinfo";
import DocSuccessPage from "./pages/DocSuccessPage";
import DragProvider from "./components/DragProivder";
import Title from "./components/Title";
const DebugPdf = lazyWithRetry(() => import("./pages/DebugPdf"));
const ForgetPassword = lazyWithRetry(() => import("./pages/ForgetPassword"));
const SigningLinkGate = lazyWithRetry(() => import("./pages/SigningLinkGate"));
const ExternalSigningCompleted = lazyWithRetry(
  () => import("./pages/ExternalSigningCompleted")
);
const ChangePassword = lazyWithRetry(() => import("./pages/ChangePassword"));
const UserProfile = lazyWithRetry(() => import("./pages/UserProfile"));
const Opensigndrive = lazyWithRetry(() => import("./pages/Opensigndrive"));
const ManageSign = lazyWithRetry(() => import("./pages/Managesign"));
const AddAdmin = lazyWithRetry(() => import("./pages/AddAdmin"));
const UpdateExistUserAdmin = lazyWithRetry(
  () => import("./pages/UpdateExistUserAdmin")
);
const Preferences = lazyWithRetry(() => import("./pages/Preferences"));
const Login = lazyWithRetry(() => import("./pages/Login"));
const VerifyDocument = lazyWithRetry(() => import("./pages/VerifyDocument"));
const EmailBuilder = lazyWithRetry(() => import("./pages/EmailBuilder"));
const DirectorySync = lazyWithRetry(() => import("./pages/Admin/DirectorySync"));

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;

import { checkRedirectCallback } from "./services/microsoftAuth";
import { authenticateWithMicrosoftBackend } from "./services/authService";
import Parse from "parse";
import { consumePostLoginRedirect } from "./utils/postLoginRedirect";

const AppLoader = () => {
  return (
    <div className="flex justify-center items-center h-[100vh]">
      <Loader />
    </div>
  );
};
function App() {
  const [isloading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    // initialize creds
    const id = appInfo.appId;
    localStorage.setItem("parseAppId", id);
    localStorage.setItem("baseUrl", `${serverUrl_fn()}/`);
    hideUpgradeProgress();
    localStorage.removeItem("showUpgradeProgress");
    
    const initializeApp = async () => {
      // 1. Check for Microsoft Redirect Callback before routing
      if (window.location.hash.includes("code=") || window.location.search.includes("code=")) {
        const currentUser = Parse.User.current();
        const currentToken = localStorage.getItem("accesstoken");
        if (currentUser && currentToken) {
          console.log("=== MSAL TRACE: Active session found. Skipping redirect processing. ===");
          window.history.replaceState({}, document.title, window.location.pathname);
          setIsLoading(false);
          return;
        }

        console.log("=== MSAL TRACE: Redirect detected ===");
        try {
          const msAuthData = await checkRedirectCallback();
          if (msAuthData && msAuthData.idToken && msAuthData.accessToken) {
            console.log("=== MSAL TRACE: Calling Parse backend ===");
            const _user = await authenticateWithMicrosoftBackend(msAuthData.idToken, msAuthData.accessToken);
            
            if (_user && _user.sessionToken) {
              console.log("=== MSAL TRACE: Session created ===");
              console.log("=== MSAL TRACE: Returning session token ===");
              await Parse.User.become(_user.sessionToken);
              console.log("=== MSAL TRACE: Parse.User.become successful ===");
              
              const userJson = Parse.User.current().toJSON();
              localStorage.setItem("accesstoken", _user.sessionToken);
              localStorage.setItem("UserInformation", JSON.stringify(userJson));
              localStorage.setItem("userEmail", userJson.email);
              localStorage.setItem("profileImg", userJson.ProfilePic || "");
              
              console.log("=== MSAL TRACE: Auth Context updated ===");

              // Fetch extended user details for routing
              const extUser = await Parse.Cloud.run("getUserDetails");
              if (extUser && !extUser.get("IsDisabled")) {
                const userRole = extUser.get("UserRole");
                const { appInfo } = await import("./constant/appinfo");
                const menu = userRole && appInfo?.settings?.find((m) => m.role === userRole);
                
                if (menu) {
                  const extInfo = JSON.parse(JSON.stringify(extUser));
                  localStorage.setItem("_user_role", userRole.replace("contracts_", ""));
                  localStorage.setItem("Extand_Class", JSON.stringify([extUser]));
                  localStorage.setItem("username", extInfo.Name);
                  if (extInfo.TenantId) {
                    localStorage.setItem("TenantId", extInfo.TenantId.objectId || "");
                    localStorage.setItem("TenantName", extInfo.TenantId.TenantName || "");
                  }
                  localStorage.setItem("PageLanding", menu.pageId);
                  localStorage.setItem("defaultmenuid", menu.menuId);
                  localStorage.setItem("pageType", menu.pageType);
                  
                  const fallbackRoute = `/${menu.pageType}/${menu.pageId}`;
                  const redirectRoute = consumePostLoginRedirect() || fallbackRoute;
                  console.log("=== MSAL TRACE: Navigation target resolved ===", redirectRoute);
                  window.location.href = redirectRoute;
                  return; // Stop execution, browser will navigate
                }
              }
              // Fallback
              window.location.href = "/";
              return;
            }
          }
        } catch (error) {
          console.error("MSAL Redirect Processing Error:", error);
          setAuthError(error.message || "An error occurred during Microsoft login.");
          setIsLoading(false);
          // clear hash to stop re-processing
          window.history.replaceState({}, document.title, window.location.pathname);
          return;
        }
      }
      setIsLoading(false);
    };
    
    initializeApp();
  }, []);

  if (authError) {
    return (
      <div className="flex flex-col justify-center items-center h-[100vh] bg-base-200">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded max-w-lg text-center shadow-lg">
          <h2 className="font-bold mb-2">Authentication Error</h2>
          <p className="mb-4">{authError}</p>
          <button 
            onClick={() => window.location.href = "/"}
            className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
          >
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-base-200">
      {isloading ? (
        <AppLoader />
      ) : (
        <BrowserRouter>
          <Title />
          <Routes>
            <Route element={<ValidateRoute />}>
              <Route exact path="/" element={<Lazy Page={Login} />} />
                  <Route path="/addadmin" element={<Lazy Page={AddAdmin} />} />
                  <Route
                    path="/upgrade-2.1"
                    element={<Lazy Page={UpdateExistUserAdmin} />}
                  />
            </Route>
            <Route element={<Validate />}>
              <Route
                exact
                path="/load/recipientSignPdf/:docId/:contactBookId"
                element={<DragProvider Page={PdfRequestFiles} />}
              />
            </Route>
            <Route
              path="/login/:base64url"
              element={<Lazy Page={SigningLinkGate} />}
            />
            <Route
              path="/external-signing/completed/:completionReference"
              element={<Lazy Page={ExternalSigningCompleted} />}
            />
            <Route path="/debugpdf" element={<Lazy Page={DebugPdf} />} />
              <Route
                path="/forgetpassword"
                element={<Lazy Page={ForgetPassword} />}
              />
            <Route element={<HomeLayout />}>
                  <Route path="/users" element={<UserList />} />
                  <Route
                    path="/changepassword"
                    element={<Lazy Page={ChangePassword} />}
                  />
              <Route path="/form/:id" element={<Form />} />
              <Route path="/report/:id" element={<Report />} />
              <Route path="/dashboard/:id" element={<Dashboard />} />
              <Route path="/profile" element={<Lazy Page={UserProfile} />} />
              <Route path="/drive" element={<Lazy Page={Opensigndrive} />} />
              <Route path="/managesign" element={<Lazy Page={ManageSign} />} />
              <Route
                path="/template/:templateId"
                element={<DragProvider Page={TemplatePlaceholder} />}
              />
              {/* signyouself route with no rowlevel data using docId from url */}
              <Route
                path="/signaturePdf/:docId"
                element={<DragProvider Page={SignYourSelf} />}
              />
              {/* draft document route to handle and navigate route page according to document status */}
              <Route
                path="/draftDocument"
                element={<DragProvider Page={DraftDocument} />}
              />
              {/* recipient placeholder set route with no rowlevel data using docId from url*/}
              <Route
                path="/placeHolderSign/:docId"
                element={<DragProvider Page={PlaceHolderSign} />}
              />
              {/* recipient signature route with no rowlevel data using docId from url */}
              <Route
                path="/recipientSignPdf/:docId/:contactBookId"
                element={<DragProvider Page={PdfRequestFiles} />}
              />
              <Route
                path="/recipientSignPdf/:docId"
                element={<DragProvider Page={PdfRequestFiles} />}
              />
              <Route
                path="/verify-document"
                element={<Lazy Page={VerifyDocument} />}
              />
              <Route
                path="/preferences"
                element={<Lazy Page={Preferences} />}
              />
              <Route
                path="/admin/directory-sync"
                element={<Lazy Page={DirectorySync} />}
              />
            </Route>
            <Route path="/success" element={<DocSuccessPage />} />
            <Route path="/emailbuilder" element={<EmailBuilder />} />
            <Route path="/auth/microsoft/callback" element={<AppLoader />} />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </BrowserRouter>
      )}
    </div>
  );
}

export default App;
