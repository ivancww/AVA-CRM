const CRM_SCOPE = './';

export function registerAppShellUpdate({ navigatorObject = globalThis.navigator, windowObject = globalThis.window } = {}) {
  if (!navigatorObject?.serviceWorker || !windowObject) return Promise.resolve(null);

  let reloading = false;
  let hadController = Boolean(navigatorObject.serviceWorker.controller);
  navigatorObject.serviceWorker.addEventListener('controllerchange', () => {
    // The first install claims an otherwise uncontrolled page; that page is
    // already running the current network response and does not need a reload.
    if (!hadController) {
      hadController = true;
      return;
    }
    if (reloading) return;
    reloading = true;
    windowObject.location.reload();
  });

  return navigatorObject.serviceWorker.register('./sw.js', {
    scope: CRM_SCOPE,
    updateViaCache: 'none'
  }).then((registration) => {
    // A direct launch must discover a newly deployed worker without waiting
    // for the browser's periodic worker check. Platform launch checks are
    // complementary and are not required for this path.
    return registration.update().then(() => registration);
  });
}
