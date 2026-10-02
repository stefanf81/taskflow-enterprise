module.exports = function (api) {
  const isTest = api.env('test');
  return {
    // MSW's Node interceptor resolves its WASM parser relative to import.meta.url.
    presets: [['babel-preset-expo', { transformImportMeta: !isTest }]],
    plugins: isTest ? ['babel-plugin-transform-import-meta'] : [],
  };
};
