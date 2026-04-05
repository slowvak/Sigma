export default {
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8050',
        changeOrigin: true,
        ws: true,
      },
    },
  },
};
