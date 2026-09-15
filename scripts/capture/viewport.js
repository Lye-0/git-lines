// Injected only into the capture build, before the production Webview module.
(() => {
  const acquire = window.acquireVsCodeApi;
  let api;
  window.acquireVsCodeApi = () => (api ??= acquire());
  let hasMore = false;
  let graphRequest;
  let graphError;
  window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'graph') { hasMore = message.layout.hasMore; graphRequest = message.requestId; graphError = undefined; }
    if (message.type === 'error') graphError = message.title;
    if (message.type !== 'capture-position') return;
    const scroller = document.querySelector('.graph-scroll');
    if (scroller) scroller.scrollTo({ top: message.top ?? 0, left: message.left ?? 0, behavior: 'instant' });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      api?.postMessage({ type: 'capture-viewport', token: message.token, graphRequest, error: graphError,
        hasMore, top: scroller?.scrollTop ?? 0, left: scroller?.scrollLeft ?? 0,
        height: scroller?.clientHeight ?? innerHeight, width: scroller?.clientWidth ?? innerWidth,
        scrollHeight: scroller?.scrollHeight ?? innerHeight, scrollWidth: scroller?.scrollWidth ?? innerWidth });
    }));
  });
})();
