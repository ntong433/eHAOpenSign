import ReactDOM from "react-dom/client";
import "./index.css";
import "./styles/dark-theme-improvements.css";
import "@custom/styles/enterprise.css";
import App from "./App";
import { showUpgradeProgress, hideUpgradeProgress } from "./utils";
import { Provider } from "react-redux";
import { store } from "./redux/store";
import Parse from "parse";
import "./polyfills";
import { appInfo, serverUrl_fn } from "./constant/appinfo";
import { getEnv } from "./constant/Utils";
import "./i18n";
import { ScrollProvider } from "./context/ScrollPdfContext";
import { applyEnterpriseBranding } from "@custom/branding/frontend";

const appId =
  appInfo.appId || import.meta.env.VITE_APPID || process.env.REACT_APP_APPID || "opensign";
const serverUrl = serverUrl_fn();
Parse.initialize(appId);
Parse.serverURL = serverUrl;

if (import.meta.env.DEV) {
  console.log("=== Parse Development Configuration ===");
  console.log("Parse APP_ID prefix:", `${appId.slice(0, 4)}…`);
  console.log("Parse server URL:", serverUrl);
  console.log("Environment: development");
  console.log("Local auth enabled:", getEnv()?.LOCAL_AUTH_ENABLED !== "false");
  console.log("=======================================");
}

if (localStorage.getItem("showUpgradeProgress")) {
  showUpgradeProgress();
}

const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") {
  document.documentElement.setAttribute("data-theme", "opensigndark");
}

// CUSTOM-LAYER: initialize configurable enterprise branding before first render.
applyEnterpriseBranding();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <Provider store={store}>
    <ScrollProvider>
      <App />
    </ScrollProvider>
  </Provider>
);

hideUpgradeProgress();
localStorage.removeItem("showUpgradeProgress");
