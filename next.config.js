// next.config.js
module.exports = {
    webpack: (config, { dev }) => {
      if (dev) {
        config.devtool = 'source-map';
      }
      return config;
    },
  };