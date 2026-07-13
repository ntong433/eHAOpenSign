const POST_LOGIN_REDIRECT_KEY = "lhi.postLoginRedirect";

export const isSafeRelativeRoute = (value) => {
  if (typeof value !== "string") return false;
  const route = value.trim();
  if (!route.startsWith("/") || route.startsWith("//")) return false;
  if (route.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(route)) return false;
  try {
    const url = new URL(route, window.location.origin);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
};

export const storePostLoginRedirect = (route) => {
  if (isSafeRelativeRoute(route)) {
    sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, route);
    return true;
  }
  return false;
};

export const peekPostLoginRedirect = () => {
  const route = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
  return isSafeRelativeRoute(route) ? route : "";
};

export const consumePostLoginRedirect = () => {
  const route = peekPostLoginRedirect();
  sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
  return route;
};

export const getPostLoginRedirect = (fallback, stateFrom) => {
  const stored = consumePostLoginRedirect();
  if (stored) return stored;
  if (isSafeRelativeRoute(stateFrom)) return stateFrom;
  return fallback;
};
