import type { Plugin } from "vite";

/**
 * `main.tsx` awaits the active Lingui catalog before the first render, so no
 * untranslated copy ever flashes. The catalog is a dynamic import, which means
 * the browser can only start fetching it after the entry chunk has downloaded
 * and executed: one serial round trip in front of the first paint.
 *
 * This injects a small inline script that resolves the locale the app is about
 * to pick (the same rule as `detectInitialLocale`) and preloads only that
 * catalog, so the fetch overlaps the entry chunk instead of following it.
 *
 * Preloading both catalogs would waste a download; picking at runtime needs the
 * build-time hashed filenames, hence the generated map.
 */
export function linguiCatalogPreload(options: {
  locales: readonly string[];
  storageKey: string;
  sourceLocale: string;
}): Plugin {
  const catalogs = new Map<string, string>();
  let base = "/";

  return {
    name: "lingui-catalog-preload",
    apply: "build",

    configResolved(config) {
      base = config.base;
    },

    generateBundle(_output, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") {
          continue;
        }

        const source = chunk.facadeModuleId ?? "";

        for (const locale of options.locales) {
          if (source.includes(`/locales/${locale}/messages.po`)) {
            catalogs.set(locale, fileName);
          }
        }
      }
    },

    transformIndexHtml: {
      order: "post",
      handler() {
        if (catalogs.size === 0) {
          return;
        }

        const map = Object.fromEntries(
          [...catalogs].map(([locale, fileName]) => [
            locale,
            `${base}${fileName}`,
          ]),
        );

        return [
          {
            tag: "script",
            injectTo: "head" as const,
            children: `(function(){try{
var c=${JSON.stringify(map)};
var l=localStorage.getItem(${JSON.stringify(options.storageKey)});
if(!l||!c[l]){l=(navigator.language||"").toLowerCase().indexOf("pt")===0?"pt-BR":${JSON.stringify(options.sourceLocale)};}
var href=c[l]||c[${JSON.stringify(options.sourceLocale)}];
if(!href)return;
var link=document.createElement("link");
link.rel="modulepreload";link.crossOrigin="";link.href=href;
document.head.appendChild(link);
}catch(e){}})();`,
          },
        ];
      },
    },
  };
}
