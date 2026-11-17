// Keep telemetry useful even when the CDN is blocked or the app is offline.
const reportAppFailure = (() => {
  if (location.origin !== 'https://sergal.org') return () => {};

  const operations = new Set(['timeline', 'reconnect', 'upload', 'media-processing']);
  const categories = new Set(['network', 'timeout', 'server', 'unexpected']);
  const scripts = new Set(['app.js', 'live.js', 'theme.js', 'video-player.js', 'composer-media.js', 'emoji.js', 'monitoring.js']);
  const exceptionTypes = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'AggregateError']);
  const pending = [];
  let client;
  let remaining = 20;

  function localFrame(frame) {
    if (!frame?.filename) return null;
    try {
      const url = new URL(frame.filename, location.origin);
      const name = url.pathname.slice('/masto-client/'.length);
      if (url.origin !== location.origin || !url.pathname.startsWith('/masto-client/') || !scripts.has(name)) return null;
      const version = url.searchParams.get('v');
      const filename = url.origin + url.pathname + (/^\d{1,8}$/.test(version || '') ? '?v=' + version : '');
      return {
        filename, in_app: true,
        lineno: Number.isSafeInteger(frame.lineno) && frame.lineno > 0 ? frame.lineno : undefined,
        colno: Number.isSafeInteger(frame.colno) && frame.colno > 0 ? frame.colno : undefined,
      };
    } catch {
      return null;
    }
  }

  function appRelease() {
    const script = document.querySelector('script[src^="live.js?v="]');
    const version = new URL(script?.src || location.origin).searchParams.get('v');
    return 'speedy-fedi@live.' + (/^\d{1,8}$/.test(version || '') ? version : 'unknown');
  }

  // Allowlist the final payload. Error text, query strings, breadcrumbs and SDK-added context can contain private data.
  function safeEvent(event) {
    const safe = {
      event_id: /^[a-f0-9]{32}$/.test(event.event_id || '') ? event.event_id : undefined,
      timestamp: Number.isFinite(event.timestamp) ? event.timestamp : undefined,
      platform: 'javascript',
      environment: 'production',
      release: appRelease(),
      level: 'error',
    };
    const {operation, category, http_status: status} = event.tags || {};
    if (operations.has(operation) && categories.has(category)) {
      const statusTag = Number.isInteger(status) && (status === 408 || status >= 500 && status <= 599)
        ? String(status) : undefined;
      return {
        ...safe,
        message: 'speedy-fedi: ' + operation + ' failed (' + category + ')',
        tags: {operation, category, http_status: statusTag},
        fingerprint: ['speedy-fedi', operation, category, statusTag || 'none'],
      };
    }

    const exception = event.exception?.values?.at(-1);
    const frames = (exception?.stacktrace?.frames || []).map(localFrame).filter(Boolean);
    if (!frames.length) return null;
    const type = exceptionTypes.has(exception.type) ? exception.type : 'Error';
    return {
      ...safe,
      exception: {values: [{type, value: 'Unhandled ' + type, stacktrace: {frames}, mechanism: {type: 'generic', handled: false}}]},
    };
  }

  function send(item) {
    try {
      if (item.error) client.captureException(item.error);
      else client.captureEvent(item.event);
    } catch {
      // Reporting should never take down the app.
    }
  }

  function loadSDK() {
    try { window.Sentry?.forceLoad?.(); } catch {}
  }

  function capture(item) {
    if (remaining <= 0) return;
    remaining--;
    if (client) send(item);
    else {
      pending.push(item);
      loadSDK();
    }
  }

  window.sentryOnLoad = () => {
    window.Sentry.init({
      defaultIntegrations: false,
      integrations: () => [],
      sendDefaultPii: false,
      sendClientReports: false,
      autoSessionTracking: false,
      enableLogs: false,
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      beforeSend: safeEvent,
    });
    client = window.Sentry;
    for (const item of pending.splice(0)) send(item);
  };

  window.addEventListener('error', event => {
    const frame = localFrame({filename: event.filename, lineno: event.lineno, colno: event.colno});
    if (!frame) return;
    if (event.error?.stack) capture({error: event.error});
    else capture({event: {exception: {values: [{type: 'Error', stacktrace: {frames: [frame]}}]}}});
  });
  window.addEventListener('unhandledrejection', event => {
    if (event.reason instanceof Error) capture({error: event.reason});
  });

  const loader = document.createElement('script');
  loader.src = 'https://js.sentry-cdn.com/b2638a0086770c325f9e2c5e4f32bab1.min.js';
  loader.crossOrigin = 'anonymous';
  loader.async = true;
  loader.addEventListener('load', () => {
    if (pending.length) loadSDK();
  }, {once: true});
  document.head.append(loader);

  return (operation, error) => {
    if (!operations.has(operation) || error?.name === 'AbortError') return;
    const status = error?.status;
    if (status >= 400 && status < 500 && status !== 408) return;
    const category = status === 408 || error?.failure === 'timeout' ? 'timeout'
      : error?.failure === 'network' ? 'network'
      : status >= 500 && status <= 599 ? 'server' : 'unexpected';
    capture({event: {tags: {operation, category, http_status: status}}});
  };
})();
