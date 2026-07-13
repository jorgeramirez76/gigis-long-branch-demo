/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clover Ecommerce public apiAccessKey (PAKMS). Empty → card payment stays off. */
  readonly VITE_CLOVER_PAKMS_KEY?: string;
  /** Optional clover.js SDK URL override (defaults to production hosted SDK). */
  readonly VITE_CLOVER_SDK_URL?: string;
}
