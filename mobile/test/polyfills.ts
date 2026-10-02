import { URL, URLSearchParams } from 'node:url';

// MSW's Node interceptor reads its WASM parser through a file: URL, which the
// React Native URL shim cannot resolve. Install Node's APIs before loading MSW.
globalThis.URL = URL;
globalThis.URLSearchParams = URLSearchParams;
