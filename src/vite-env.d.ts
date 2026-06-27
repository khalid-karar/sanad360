/// <reference types="vite/client" />

// Typed environment variables exposed to the browser via Vite's `import.meta.env`.
// Only VITE_-prefixed vars are ever sent to the client — never service-role keys.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_PDF_SERVICE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Side-effect imports of CSS / asset files (handled by Vite at build time).
declare module '*.css';
declare module 'leaflet/dist/leaflet.css';

// Background Sync API — not in the default DOM lib typings.
interface SyncManager {
  register(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}
interface ServiceWorkerRegistration {
  readonly sync?: SyncManager;
}
