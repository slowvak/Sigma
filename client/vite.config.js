export default {
  server: {
    port: 5275,
    proxy: {
      '/api': {
        target: 'http://localhost:8050',
        changeOrigin: true,
        ws: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
};
