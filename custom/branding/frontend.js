const DEFAULT_BRANDING = {
  productName: 'Life Helpers Signature Portal',
  companyName: 'Life Helpers Initiative',
  metaDescription: 'Secure digital signature portal by Life Helpers Initiative',
  logoUrl: '',
  loginLogoUrl: '',
  faviconUrl: '',
  loginBackgroundUrl: '',
  colors: {
    primary: '#ED3237',
    secondary: '#F58634',
    accent: '#1F7A4D',
    background: '#F7F8FA',
    surface: '#FFFFFF',
    text: '#1F2933',
    muted: '#667085',
    border: '#D8DEE8',
    success: '#168A4A',
    warning: '#B7791F',
    danger: '#C81E1E'
  },
  footer: {
    copyrightText: '© Life Helpers Initiative',
    releaseNotesUrl: ''
  }
};

function getProcessEnv() {
  if (typeof process === 'undefined') {
    return {};
  }
  return process.env || {};
}

function parseJson(value) {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn('Invalid enterprise branding JSON:', error.message);
    return {};
  }
}

function normalizeBranding(source = {}) {
  const logos = source.logos || {};
  const login = source.login || {};

  return {
    productName: source.productName || source.appName,
    companyName: source.companyName,
    metaDescription: source.metaDescription,
    logoUrl: source.logoUrl || logos.app,
    loginLogoUrl: source.loginLogoUrl || login.logo || logos.login,
    faviconUrl: source.faviconUrl || logos.favicon,
    loginBackgroundUrl: source.loginBackgroundUrl || login.backgroundImage,
    colors: source.colors,
    footer: source.footer
  };
}

function removeEmptyValues(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  return Object.entries(value).reduce((acc, [key, item]) => {
    if (item === undefined || item === null || item === '') {
      return acc;
    }
    if (typeof item === 'object' && !Array.isArray(item)) {
      const nested = removeEmptyValues(item);
      if (Object.keys(nested).length > 0) {
        acc[key] = nested;
      }
      return acc;
    }
    acc[key] = item;
    return acc;
  }, {});
}

function mergeBranding(...sources) {
  return sources.reduce((acc, source) => {
    const cleaned = removeEmptyValues(normalizeBranding(source));
    return {
      ...acc,
      ...cleaned,
      colors: {
        ...acc.colors,
        ...cleaned.colors
      },
      footer: {
        ...acc.footer,
        ...cleaned.footer
      }
    };
  }, DEFAULT_BRANDING);
}

function getRuntimeBranding() {
  if (typeof window === 'undefined') {
    return {};
  }
  return window.RUNTIME_ENV?.BRANDING || window.RUNTIME_ENV?.ENTERPRISE_BRANDING || {};
}

function getEnvBranding() {
  const env = getProcessEnv();
  const jsonBranding = parseJson(env.REACT_APP_ENTERPRISE_BRANDING_JSON);

  return mergeBranding(jsonBranding, {
    productName: env.REACT_APP_ENTERPRISE_PRODUCT_NAME,
    companyName: env.REACT_APP_ENTERPRISE_COMPANY_NAME,
    metaDescription: env.REACT_APP_ENTERPRISE_META_DESCRIPTION,
    logoUrl: env.REACT_APP_ENTERPRISE_LOGO_URL,
    loginLogoUrl: env.REACT_APP_ENTERPRISE_LOGIN_LOGO_URL,
    faviconUrl: env.REACT_APP_ENTERPRISE_FAVICON_URL,
    loginBackgroundUrl: env.REACT_APP_ENTERPRISE_LOGIN_BACKGROUND_URL,
    colors: {
      primary: env.REACT_APP_ENTERPRISE_PRIMARY_COLOR,
      secondary: env.REACT_APP_ENTERPRISE_SECONDARY_COLOR,
      accent: env.REACT_APP_ENTERPRISE_ACCENT_COLOR
    },
    footer: {
      copyrightText: env.REACT_APP_ENTERPRISE_FOOTER_TEXT,
      releaseNotesUrl: env.REACT_APP_ENTERPRISE_RELEASE_NOTES_URL
    }
  });
}

export function getBrandingConfig(overrides = {}) {
  return mergeBranding(getEnvBranding(), getRuntimeBranding(), overrides);
}

export function applyEnterpriseBranding() {
  if (typeof document === 'undefined') {
    return getBrandingConfig();
  }

  const branding = getBrandingConfig();
  const root = document.documentElement;

  root.style.setProperty('--enterprise-primary-color', branding.colors.primary);
  root.style.setProperty('--enterprise-secondary-color', branding.colors.secondary);
  root.style.setProperty('--enterprise-accent-color', branding.colors.accent);
  root.style.setProperty('--lhi-primary', branding.colors.primary);
  root.style.setProperty('--lhi-secondary', branding.colors.secondary);
  root.style.setProperty('--lhi-accent', branding.colors.accent);
  root.style.setProperty('--lhi-background', branding.colors.background || '#F7F8FA');
  root.style.setProperty('--lhi-surface', branding.colors.surface || '#FFFFFF');
  root.style.setProperty('--lhi-text', branding.colors.text || '#1F2933');
  root.style.setProperty('--lhi-muted', branding.colors.muted || '#667085');
  root.style.setProperty('--lhi-border', branding.colors.border || '#D8DEE8');
  root.style.setProperty('--lhi-success', branding.colors.success || '#168A4A');
  root.style.setProperty('--lhi-warning', branding.colors.warning || '#B7791F');
  root.style.setProperty('--lhi-danger', branding.colors.danger || '#C81E1E');
  root.style.setProperty('--enterprise-login-background', `url("${branding.loginBackgroundUrl}")`);
  root.classList.add('enterprise-branding-ready');

  if (typeof localStorage !== 'undefined') {
    if (branding.logoUrl) {
      localStorage.setItem('appLogo', branding.logoUrl);
    }
    if (branding.faviconUrl) {
      localStorage.setItem('favicon', branding.faviconUrl);
    }
    if (branding.productName) {
      localStorage.setItem('appname', branding.productName);
    }
  }

  let themeColor = document.querySelector('meta[name="theme-color"]');
  if (!themeColor) {
    themeColor = document.createElement('meta');
    themeColor.setAttribute('name', 'theme-color');
    document.head.appendChild(themeColor);
  }
  themeColor.setAttribute('content', branding.colors.primary);

  return branding;
}
