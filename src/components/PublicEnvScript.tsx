import { collectPublicEnvForInjection } from "@/lib/public-env";

/** Injects window.__PUBLIC_ENV__ from server secrets before client bundles run. */
export function PublicEnvScript() {
  if (typeof window !== "undefined") return null;

  const env = collectPublicEnvForInjection();
  const json = JSON.stringify(env).replace(/</g, "\\u003c");

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `window.__PUBLIC_ENV__=${json};`,
      }}
    />
  );
}
