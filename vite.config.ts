import { defineConfig, loadEnv } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "NEXT_PUBLIC_");
  return {
    define: {
      "process.env.NEXT_PUBLIC_API_URL": JSON.stringify(env.NEXT_PUBLIC_API_URL ?? ""),
    },
    plugins: [
      vinext({
        cache: {
          cdn: cdnAdapter(),
        },
        images: { optimizer: imagesOptimizer() },
      }),
      cloudflare({
        viteEnvironment: {
          name: "rsc",
          childEnvironments: ["ssr"],
        },
      }),
    ],
    resolve: {
      alias: {
        "sharp": path.resolve(import.meta.dirname, "empty-stub.js"),
      },
    },
  };
});
