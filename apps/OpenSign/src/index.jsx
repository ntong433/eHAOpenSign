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
import { serverUrl_fn } from "./constant/appinfo";
import "./i18n";
import { ScrollProvider } from "./context/ScrollPdfContext";
import { applyEnterpriseBranding } from "@custom/branding/frontend";

const appId =
  import.meta.env.VITE_APPID || process.env.REACT_APP_APPID || "opensign";
const serverUrl = serverUrl_fn();
Parse.initialize(appId);
Parse.serverURL = serverUrl;

console.log("=== Microsoft Auth Configuration ===");
console.log("Resolved Client ID:", import.meta.env.VITE_MICROSOFT_CLIENT_ID || "5946f825-88d7-47b9-ae8c-a5ec4df50999");
console.log("Resolved Tenant ID:", import.meta.env.VITE_MICROSOFT_TENANT_ID || "552a1d00-ce70-4fdb-940f-0ad131e4b9cb");
console.log("Resolved Redirect URI:", import.meta.env.VITE_MICROSOFT_REDIRECT_URI || "http://localhost:3000");
console.log("====================================");

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
