import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".ts": [".ts"],
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      "@cloud-directory/domain": path.resolve(here, "../packages/domain/src/index.ts"),
    };
    return config;
  },
};

export default nextConfig;
