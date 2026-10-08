import type { ChalkdApi } from '../preload/preload';

declare global {
  interface Window {
    chalkd: ChalkdApi;
  }
}
