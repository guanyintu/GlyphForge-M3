/** Registration is optional; failures never block IndexedDB or local creation. */
export function prepareOffline() {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}offline-worker.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .catch(() => {});
  }
}
