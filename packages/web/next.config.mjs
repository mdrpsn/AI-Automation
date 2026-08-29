/** @type {import('next').NextConfig} */
const nextConfig = {
  // The engine ships as TypeScript source so it stays a single source of truth
  // for both the app and the simulation harness.
  transpilePackages: ['@openplay/engine'],
  reactStrictMode: true,

  webpack: (config) => {
    // The engine's imports carry explicit `.js` specifiers (correct for ESM
    // TypeScript), which must resolve back to the `.ts` sources.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
