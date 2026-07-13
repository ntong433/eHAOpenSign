import { useEffect, useState } from "react";
import Parse from "parse";
import { useDispatch } from "react-redux";

import axios from "axios";
import { NavLink, useNavigate, useLocation } from "react-router";
import ModalUi from "../primitives/ModalUi";
import {
  emailRegex,
} from "../constant/const";
import Alert from "../primitives/Alert";
import { appInfo } from "../constant/appinfo";
import { fetchAppInfo } from "../redux/reducers/infoReducer";
import { showTenant } from "../redux/reducers/ShowTenant";
import {
  getAppLogo,
  saveLanguageInLocal,
  usertimezone
} from "../constant/Utils";
import Loader from "../primitives/Loader";
import { useTranslation } from "react-i18next";
import SelectLanguage from "../components/pdf/SelectLanguage";
import { getBrandingConfig } from "@custom/branding/frontend";
import { loginWithMicrosoftRedirect } from "../services/microsoftAuth.js";
import { lhiBranding } from "../config/branding";
import { getPostLoginRedirect } from "../utils/postLoginRedirect";

function Login() {
  const appName = getBrandingConfig().productName;
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const [state, setState] = useState({
    email: "",
    password: "",
    alertType: "success",
    alertMsg: "",
    passwordVisible: false,
    loading: !!localStorage.getItem("accesstoken"),
    thirdpartyLoader: false,
  });
  const [userDetails, setUserDetails] = useState({
    Company: "",
    Destination: ""
  });
  const [isModal, setIsModal] = useState(false);
  const [image, setImage] = useState();
  const [errMsg, setErrMsg] = useState();
  useEffect(() => {
    handleUserExist();
    // eslint-disable-next-line
  }, []);

  const handleUserExist = async () => {
    checkUserExt();
  };


  const setLocalVar = (user) => {
    localStorage.setItem("accesstoken", user.sessionToken);
    localStorage.setItem("UserInformation", JSON.stringify(user));
    localStorage.setItem("userEmail", user.email);
    if (user.ProfilePic) {
      localStorage.setItem("profileImg", user.ProfilePic);
    } else {
      localStorage.setItem("profileImg", "");
    }
  };

  const showToast = (type, msg) => {
    setState({ ...state, loading: false, alertType: type, alertMsg: msg });
    setTimeout(() => setState({ ...state, alertMsg: "" }), 2000);
  };

  const checkUserExt = async () => {
    const app = await getAppLogo();
    if (app?.error === "invalid_json") {
      setErrMsg(t("server-down", { appName: appName }));
    } else if (
      app?.user === "not_exist"
    ) {
      navigate("/addadmin");
    }
    if (app?.logo) {
      setImage(app?.logo);
    } else {
      setImage(appInfo?.applogo || undefined);
    }
    dispatch(fetchAppInfo());
    if (localStorage.getItem("accesstoken")) {
      setState({ ...state, loading: true });
      GetLoginData();
    }
  };
  const handleChange = (event) => {
    let { name, value } = event.target;
    if (name === "email") {
      value = value?.toLowerCase()?.replace(/\s/g, "");
    }
    setState({ ...state, [name]: value });
  };

  const handleLogin = async (
  ) => {
    const email = state?.email
    const password = state?.password

    if (!email || !password) {
      return;
    }
    localStorage.removeItem("accesstoken");
    try {
      setState({ ...state, loading: true });
      localStorage.setItem("appLogo", appInfo.applogo);
      const _user = await Parse.Cloud.run("loginuser", { email, password });
      if (!_user) {
        setState({ ...state, loading: false });
        return;
      }
      // Get extended user data (including 2FA status) using cloud function
      try {
        await Parse.User.become(_user.sessionToken);
        setLocalVar(_user);
        await continueLoginFlow();
      } catch (error) {
        console.error("Error checking 2FA status:", error);
        showToast("danger", t("something-went-wrong-mssg"));
      }
    } catch (error) {
      console.error("Error while logging in user", error);
      setState({ ...state, loading: false });
      if (error?.code === 1001) {
        showToast("danger", t("action-prohibited"));
      } else {
        showToast("danger", t("invalid-username-password-region"));
      }
    }
  };
  const handleLoginBtn = async (event) => {
    event.preventDefault();
    if (!emailRegex.test(state.email)) {
      alert(t("valid-email-alert"));
      return;
    }
    await handleLogin();
  };

  const setThirdpartyLoader = (value) => {
    setState({ ...state, thirdpartyLoader: value });
  };

  const thirdpartyLoginfn = async (sessionToken) => {
    const baseUrl = localStorage.getItem("baseUrl");
    const parseAppId = localStorage.getItem("parseAppId");
    const res = await axios.get(baseUrl + "users/me", {
      headers: {
        "X-Parse-Session-Token": sessionToken,
        "X-Parse-Application-Id": parseAppId
      }
    });
    await Parse.User.become(sessionToken).then(() => {
      window.localStorage.setItem("accesstoken", sessionToken);
    });
    if (res.data) {
      let _user = res.data;
      setLocalVar(_user);
      // Check extended class user role and tenentId
      try {
        const userSettings = appInfo.settings;
        const extUser = await Parse.Cloud.run("getUserDetails");
        if (extUser) {
          const IsDisabled = extUser?.get("IsDisabled") || false;
          if (!IsDisabled) {
            const userRole = extUser?.get("UserRole");
            const menu =
              userRole && userSettings.find((menu) => menu.role === userRole);
            if (menu) {
              const _currentRole = userRole;
              const fallbackRoute = `/${menu.pageType}/${menu.pageId}`;
              const redirectUrl = getPostLoginRedirect(
                fallbackRoute,
                location?.state?.from
              );
              const _role = _currentRole.replace("contracts_", "");
              const extInfo = JSON.parse(JSON.stringify(extUser));
              localStorage.setItem("_user_role", _role);
              localStorage.setItem("Extand_Class", JSON.stringify([extUser]));
              localStorage.setItem("userEmail", extInfo?.Email);
              localStorage.setItem("username", extInfo?.Name);
              if (extInfo?.TenantId) {
                const tenant = {
                  Id: extInfo?.TenantId?.objectId || "",
                  Name: extInfo?.TenantId?.TenantName || ""
                };
                localStorage.setItem("TenantId", tenant?.Id);
                dispatch(showTenant(tenant?.Name));
                localStorage.setItem("TenantName", tenant?.Name);
              }
              localStorage.setItem("PageLanding", menu.pageId);
              localStorage.setItem("defaultmenuid", menu.menuId);
              localStorage.setItem("pageType", menu.pageType);
                navigate(redirectUrl);
            } else {
              showToast("danger", t("role-not-found"));
              logOutUser();
            }
          } else {
            showToast("danger", t("do-not-access-contact-admin"));
            logOutUser();
          }
        } else {
          showToast("danger", t("user-not-found"));
          logOutUser();
        }
      } catch (error) {
        console.error("err in fetching extUser", err);
        showToast("danger", `${err.message}`);
        const payload = { sessionToken: _user.sessionToken };
        handleSubmitbtn(payload);
      } finally {
        setThirdpartyLoader(false);
      }
    }
  };

  const GetLoginData = async () => {
    setState({ ...state, loading: true });
    try {
      const user = await Parse.User.become(localStorage.getItem("accesstoken"));
      const _user = user.toJSON();
      setLocalVar(_user);
      const userSettings = appInfo.settings;
      const extUser = await Parse.Cloud.run("getUserDetails");
      if (extUser) {
        const IsDisabled = extUser?.get("IsDisabled") || false;
        if (!IsDisabled) {
          const userRole = extUser.get("UserRole");
          const _currentRole = userRole;
          const menu =
            userRole && userSettings.find((menu) => menu.role === userRole);
          if (menu) {
            const extInfo = JSON.parse(JSON.stringify(extUser));
            const _role = _currentRole.replace("contracts_", "");
            localStorage.setItem("_user_role", _role);
            const fallbackRoute = `/${menu.pageType}/${menu.pageId}`;
            const redirectUrl = getPostLoginRedirect(
              fallbackRoute,
              location?.state?.from
            );
            localStorage.setItem("Extand_Class", JSON.stringify([extUser]));
            localStorage.setItem("userEmail", extInfo.Email);
            localStorage.setItem("username", extInfo.Name);
            if (extInfo?.TenantId) {
              const tenant = {
                Id: extInfo?.TenantId?.objectId || "",
                Name: extInfo?.TenantId?.TenantName || ""
              };
              localStorage.setItem("TenantId", tenant?.Id);
              dispatch(showTenant(tenant?.Name));
              localStorage.setItem("TenantName", tenant?.Name);
            }
            localStorage.setItem("PageLanding", menu.pageId);
            localStorage.setItem("defaultmenuid", menu.menuId);
            localStorage.setItem("pageType", menu.pageType);
              navigate(redirectUrl);
          } else {
            setState({ ...state, loading: false });
            logOutUser();
          }
        } else {
          showToast("danger", t("do-not-access-contact-admin"));
          logOutUser();
        }
      } else {
        showToast("danger", t("user-not-found"));
        logOutUser();
      }
    } catch (error) {
      showToast("danger", t("something-went-wrong-mssg"));
      console.log("err", error);
    }
  };

  const togglePasswordVisibility = () => {
    setState({ ...state, passwordVisible: !state.passwordVisible });
  };

  const handleSubmitbtn = async (e) => {
    e.preventDefault();
    if (userDetails.Destination && userDetails.Company) {
      setThirdpartyLoader(true);
      const payload = { sessionToken: localStorage.getItem("accesstoken") };
      const userInformation = JSON.parse(
        localStorage.getItem("UserInformation")
      );
      if (payload && payload.sessionToken) {
        const params = {
          userDetails: {
            name: userInformation.name,
            email: userInformation.email,
            phone: userInformation?.phone || "",
            role: "contracts_User",
            company: userDetails.Company,
            jobTitle: userDetails.Destination,
            timezone: usertimezone
          }
        };
        const userSignUp = await Parse.Cloud.run("usersignup", params);
        if (userSignUp && userSignUp.sessionToken) {
          const LocalUserDetails = {
            name: userInformation.name,
            email: userInformation.email,
            phone: userInformation?.phone || "",
            company: userDetails.Company,
            jobTitle: userDetails.JobTitle
          };
          localStorage.setItem("userDetails", JSON.stringify(LocalUserDetails));
          thirdpartyLoginfn(userSignUp.sessionToken);
        } else {
          alert(userSignUp.message);
        }
      } else if (
        payload &&
        payload.message.replace(/ /g, "_") === "Internal_server_err"
      ) {
        alert(t("server-error"));
      }
    } else {
      showToast("warning", t("fill-required-details!"));
    }
  };

  const handleMicrosoftLogin = async () => {
    try {
      console.log("=== MSAL TRACE: Login Button Clicked ===");
      setState({ ...state, loading: true });
      await loginWithMicrosoftRedirect();
    } catch (error) {
      console.error("Microsoft login redirect error:", error);
      showToast("danger", "Microsoft login failed or requires setup.");
      setState({ ...state, loading: false });
    }
  };

  const logOutUser = async () => {
    setIsModal(false);
    try {
      await Parse.User.logOut();
    } catch (err) {
      console.log("Err while logging out", err);
    }
    let appdata = localStorage.getItem("userSettings");
    let applogo = localStorage.getItem("appLogo");
    let defaultmenuid = localStorage.getItem("defaultmenuid");
    let PageLanding = localStorage.getItem("PageLanding");
    let baseUrl = localStorage.getItem("baseUrl");
    let appid = localStorage.getItem("parseAppId");
    let favicon = localStorage.getItem("favicon");

    localStorage.clear();
    saveLanguageInLocal(i18n);

    localStorage.setItem("appLogo", applogo);
    localStorage.setItem("defaultmenuid", defaultmenuid);
    localStorage.setItem("PageLanding", PageLanding);
    localStorage.setItem("userSettings", appdata);
    localStorage.setItem("baseUrl", baseUrl);
    localStorage.setItem("parseAppId", appid);
    localStorage.setItem("favicon", favicon);
  };

  const continueLoginFlow = async (userData = null) => {
    try {
      const userSettings = appInfo.settings;
      const extUser = await Parse.Cloud.run("getUserDetails");
      if (extUser) {
        const IsDisabled = extUser?.get("IsDisabled") || false;
        if (!IsDisabled) {
          const userRole = extUser?.get("UserRole");
          const menu =
            userRole && userSettings?.find((menu) => menu.role === userRole);
          if (menu) {
            const _currentRole = userRole;
            const fallbackRoute = `/${menu.pageType}/${menu.pageId}`;
            const redirectUrl = getPostLoginRedirect(
              fallbackRoute,
              location?.state?.from
            );
            const _role = _currentRole.replace("contracts_", "");
            localStorage.setItem("_user_role", _role);
            const checkLanguage = extUser?.get("Language");
            if (checkLanguage) {
              checkLanguage && i18n.changeLanguage(checkLanguage);
            }
            const extInfo = JSON.parse(JSON.stringify(extUser));
            // Continue with storing user data and redirecting
            localStorage.setItem("Extand_Class", JSON.stringify([extUser]));
            localStorage.setItem("userEmail", extInfo.Email);
            localStorage.setItem("username", extInfo.Name);
            if (extInfo?.TenantId) {
              const tenant = {
                Id: extInfo?.TenantId?.objectId || "",
                Name: extInfo?.TenantId?.TenantName || ""
              };
              localStorage.setItem("TenantId", tenant?.Id);
              dispatch(showTenant(tenant?.Name));
              localStorage.setItem("TenantName", tenant?.Name);
            }
            localStorage.setItem("PageLanding", menu.pageId);
            localStorage.setItem("defaultmenuid", menu.menuId);
            localStorage.setItem("pageType", menu.pageType);
              setState((prev) => ({ ...prev, loading: false }));
              console.log("=== MSAL TRACE: Authentication context updated ===");
              console.log("=== MSAL TRACE: Dashboard navigation... Redirecting to:", redirectUrl);
              navigate(redirectUrl);
          } else {
            setState((prev) => ({ ...prev, loading: false }));
            setIsModal(true);
          }
        } else {
          showToast("danger", t("do-not-access-contact-admin"));
          logOutUser();
        }
      } else {
          showToast("danger", t("user-not-found"));
          logOutUser();
      }
    } catch (error) {
      console.error("Error during login flow", error);
      showToast("danger", error.message || t("something-went-wrong-mssg"));
    }
  };

  return errMsg ? (
    <div className="h-screen flex justify-center text-center items-center p-4 text-gray-500 text-base">
      {errMsg}
    </div>
  ) : (
    <>
      {state.loading && (
        <div
          aria-live="assertive"
          className="fixed w-full h-full flex justify-center items-center bg-black bg-opacity-30 z-50"
        >
          <Loader />
        </div>
      )}
      {appInfo && appInfo.appId ? (
        <div className="grid min-h-[100dvh] bg-[var(--lhi-background)] lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
          {/* Left Side: Hero Image */}
          <div className="relative hidden overflow-hidden bg-neutral lg:flex">
            <img 
              src="https://lhinigeria.org/wp-content/uploads/2024/10/PARTNERS-LIFE-HELPERS.jpg" 
              alt="Life Helpers Initiative community programme" 
              className="absolute inset-0 h-full w-full object-cover opacity-70"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-transparent"></div>
            <div className="relative z-10 flex h-full max-w-2xl flex-col justify-end p-10 text-white xl:p-14">
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-white/80">
                Life Helpers Initiative
              </p>
              <h1 className="mb-4 text-4xl font-bold leading-tight text-white xl:text-5xl">
                Secure signatures for the work that moves communities forward.
              </h1>
              <p className="max-w-xl text-base leading-7 text-white/90 xl:text-lg">
                A private signature workspace for Life Helpers Initiative documents,
                approvals, and partner workflows.
              </p>
            </div>
          </div>
          
          {/* Right Side: Login Card */}
          <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center px-4 py-4 sm:px-6 lg:px-8">
            <div className="lhi-surface w-full max-w-[420px] rounded-xl p-5 sm:p-6 lg:p-7">
              <div className="mb-4 flex justify-center">
                {image && (
                  <img
                    src={image}
                    className="h-12 object-contain sm:h-14"
                    alt={`${lhiBranding.organizationName} logo`}
                  />
                )}
              </div>
              
              <div className="mb-5 text-center">
                <h2 className="text-2xl font-bold text-[var(--lhi-text)]">{t("Welcome Back")}</h2>
                <p className="mt-1 text-sm text-[var(--lhi-muted)]">
                  Sign in to {lhiBranding.productName}.
                </p>
              </div>

              <form onSubmit={handleLoginBtn} aria-label="Login Form" className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-[var(--lhi-text)]" htmlFor="email">
                    {t("email")}
                  </label>
                  <input
                    id="email"
                    type="email"
                    className="h-11 w-full rounded-lg border border-[var(--lhi-border)] bg-white px-3 text-sm text-[var(--lhi-text)] shadow-sm transition-all"
                    name="email"
                    autoComplete="username"
                    value={state.email}
                    onChange={handleChange}
                    required
                    placeholder="Enter your email"
                    onInvalid={(e) => e.target.setCustomValidity(t("input-required"))}
                    onInput={(e) => e.target.setCustomValidity("")}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-[var(--lhi-text)]" htmlFor="password">
                    {t("password")}
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={state.passwordVisible ? "text" : "password"}
                      className="h-11 w-full rounded-lg border border-[var(--lhi-border)] bg-white px-3 pr-10 text-sm text-[var(--lhi-text)] shadow-sm transition-all"
                      name="password"
                      value={state.password}
                      autoComplete="current-password"
                      onChange={handleChange}
                      placeholder="Enter your password"
                      required
                    />
                    <button
                      type="button"
                      className="lhi-focus-ring absolute right-3 top-1/2 -translate-y-1/2 rounded text-[var(--lhi-muted)] hover:text-[var(--lhi-text)]"
                      onClick={togglePasswordVisibility}
                      aria-label={state.passwordVisible ? "Hide password" : "Show password"}
                    >
                      {state.passwordVisible ? (
                        <i className="fa-light fa-eye-slash" />
                      ) : (
                        <i className="fa-light fa-eye" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="checkbox checkbox-primary checkbox-sm rounded border-gray-300" />
                    <span className="text-sm text-[var(--lhi-muted)]">Remember Me</span>
                  </label>
                  <NavLink
                    to="/forgetpassword"
                    className="lhi-focus-ring rounded text-sm font-medium text-[var(--lhi-primary)] transition-colors hover:text-[var(--lhi-secondary)]"
                  >
                    {t("forgot-password")}?
                  </NavLink>
                </div>

                <button
                  type="submit"
                  className="lhi-focus-ring mt-2 flex h-11 w-full items-center justify-center rounded-lg bg-[var(--lhi-primary)] px-4 py-2.5 font-semibold text-white shadow-md transition hover:bg-[#cf252b]"
                  disabled={state.loading}
                >
                  {state.loading ? <span className="loading loading-spinner loading-sm"></span> : t("login")}
                </button>
              </form>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[var(--lhi-border)]"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-white px-3 text-[var(--lhi-muted)]">OR</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleMicrosoftLogin}
                className="lhi-focus-ring flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-[var(--lhi-border)] bg-white px-4 py-2.5 font-semibold text-[var(--lhi-text)] shadow-sm transition-colors hover:bg-[var(--lhi-background)]"
              >
                <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                </svg>
                Sign in with Microsoft
              </button>

              <div className="mt-4 text-center text-xs leading-5 text-[var(--lhi-muted)]">
                {lhiBranding.organizationName}<br/>
                Secure Digital Signature Platform
              </div>
            </div>
            
            <div className="mt-3">
              <SelectLanguage />
            </div>
          </div>
          
          {state.alertMsg && (
            <div className="fixed top-4 right-4 z-50">
              <Alert type={state.alertType}>{state.alertMsg}</Alert>
            </div>
          )}

          <ModalUi
            isOpen={isModal}
            title={t("additional-info")}
            showClose={false}
          >
            <form className="px-4 py-3 text-base-content bg-base-100">
              <div className="mb-3">
                <label
                  htmlFor="Company"
                  className="block text-sm font-semibold mb-1"
                >
                  {t("company")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary outline-none"
                  id="Company"
                  value={userDetails.Company}
                  onChange={(e) =>
                    setUserDetails({ ...userDetails, Company: e.target.value })
                  }
                  required
                />
              </div>
              <div className="mb-4">
                <label
                  htmlFor="JobTitle"
                  className="block text-sm font-semibold mb-1"
                >
                  {t("job-title")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary outline-none"
                  id="JobTitle"
                  value={userDetails.Destination}
                  onChange={(e) =>
                    setUserDetails({ ...userDetails, Destination: e.target.value })
                  }
                  required
                />
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  className="flex-1 py-2 bg-primary hover:bg-secondary text-white rounded-lg font-medium transition-colors"
                  onClick={(e) => handleSubmitbtn(e)}
                >
                  {t("login")}
                </button>
                <button
                  type="button"
                  className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
                  onClick={logOutUser}
                >
                  {t("cancel")}
                </button>
              </div>
            </form>
          </ModalUi>
        </div>
      ) : (
        <div
          aria-live="assertive"
          className="fixed w-full h-full flex justify-center items-center z-50 bg-base-100"
        >
          <Loader />
        </div>
      )}
    </>
  );
}
export default Login;
