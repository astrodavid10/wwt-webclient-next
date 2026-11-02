const { defineConfig } = require("@vue/cli-service");

module.exports = defineConfig({
  publicPath: "./",
  // Source maps would publish the full source and local paths.
  productionSourceMap: false,
  devServer: {
    allowedHosts: process.env.ALLOW_ALL_HOSTS ? "all" : "auto",
    client: { overlay: false },
  },
});
