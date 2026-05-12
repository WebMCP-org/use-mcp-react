import { afterAll, afterEach, beforeAll } from "vitest";
import { setupWorker, type SetupWorker } from "msw/browser";

const workerState = globalThis as typeof globalThis & {
  __useMcpReactMswWorker?: SetupWorker;
  __useMcpReactMswWorkerStarted?: boolean;
};

export const worker = (workerState.__useMcpReactMswWorker ??= setupWorker());

beforeAll(async () => {
  if (workerState.__useMcpReactMswWorkerStarted) {
    return;
  }

  await worker.start({
    onUnhandledRequest: "error",
    serviceWorker: {
      url: "/mockServiceWorker.js",
      options: {
        scope: "/",
      },
    },
  });
  workerState.__useMcpReactMswWorkerStarted = true;
});

afterEach(() => {
  worker.resetHandlers();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

afterAll(async () => {
  if (!workerState.__useMcpReactMswWorkerStarted) {
    return;
  }

  worker.stop();
  workerState.__useMcpReactMswWorkerStarted = false;
});
