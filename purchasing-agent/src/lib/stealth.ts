/**
 * Comprehensive browser fingerprint patches.
 * Injected via context.addInitScript() to make Playwright look like real Chrome.
 *
 * Covers: navigator props, plugins, WebGL, chrome object, Permissions API.
 */

/** JavaScript init script that patches detectable automation artifacts. */
export const STEALTH_INIT_SCRIPT = `
// --- navigator.webdriver ---
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// --- navigator.plugins (Chrome ships 5 default plugins) ---
const pluginData = [
  { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
  { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
  { name: 'Chromium PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  { name: 'Chromium PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
];

const pluginArray = pluginData.map(p => {
  const mimeType = { type: 'application/pdf', suffixes: 'pdf', description: p.description, enabledPlugin: null };
  return {
    name: p.name,
    filename: p.filename,
    description: p.description,
    length: 1,
    0: mimeType,
    item: (i) => (i === 0 ? mimeType : null),
    namedItem: (name) => (name === 'application/pdf' ? mimeType : null),
    [Symbol.iterator]: function* () { yield mimeType; },
  };
});

Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const arr = pluginArray;
    arr.item = (i) => arr[i] || null;
    arr.namedItem = (name) => arr.find(p => p.name === name) || null;
    arr.refresh = () => {};
    return arr;
  },
});

// --- navigator.mimeTypes ---
Object.defineProperty(navigator, 'mimeTypes', {
  get: () => {
    const mt = { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: pluginArray[0] };
    const arr = [mt];
    arr.item = (i) => arr[i] || null;
    arr.namedItem = (name) => (name === 'application/pdf' ? mt : null);
    return arr;
  },
});

// --- navigator.languages ---
Object.defineProperty(navigator, 'languages', {
  get: () => ['ja', 'ja-JP', 'en-US', 'en'],
});

// --- navigator.hardwareConcurrency ---
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

// --- navigator.deviceMemory ---
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

// --- window.chrome (runtime object that real Chrome exposes) ---
if (!window.chrome) {
  window.chrome = {};
}
if (!window.chrome.runtime) {
  window.chrome.runtime = {
    connect: () => {},
    sendMessage: () => {},
    onMessage: { addListener: () => {}, removeListener: () => {}, hasListeners: () => false },
    id: undefined,
  };
}

// --- WebGL vendor/renderer override ---
const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(param) {
  // UNMASKED_VENDOR_WEBGL
  if (param === 0x9245) return 'Google Inc. (Apple)';
  // UNMASKED_RENDERER_WEBGL
  if (param === 0x9246) return 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)';
  return getParameterOrig.call(this, param);
};
if (typeof WebGL2RenderingContext !== 'undefined') {
  const getParameter2Orig = WebGL2RenderingContext.prototype.getParameter;
  WebGL2RenderingContext.prototype.getParameter = function(param) {
    if (param === 0x9245) return 'Google Inc. (Apple)';
    if (param === 0x9246) return 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)';
    return getParameter2Orig.call(this, param);
  };
}

// --- Permissions API ---
const origQuery = navigator.permissions.query.bind(navigator.permissions);
navigator.permissions.query = (params) => {
  if (params.name === 'notifications') {
    return Promise.resolve({ state: 'prompt', onchange: null, addEventListener: () => {}, removeEventListener: () => {} });
  }
  return origQuery(params);
};

// --- Prevent detection via toString ---
// Some bot detectors check if native functions have been overridden by checking .toString()
const nativeToString = Function.prototype.toString;
const patchedFns = new Set();
const originalToString = nativeToString.call(Function.prototype.toString);
Function.prototype.toString = function() {
  if (patchedFns.has(this)) {
    return 'function () { [native code] }';
  }
  return nativeToString.call(this);
};
patchedFns.add(Function.prototype.toString);
`;

/**
 * Same stealth patches as a Python-compatible string for use in
 * context.add_init_script() in the Python Playwright path.
 */
export const STEALTH_INIT_SCRIPT_PYTHON = STEALTH_INIT_SCRIPT;
