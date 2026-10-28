import { registerRootComponent } from 'expo';

import App from './App';

// Entry point for the Metro bundler. `expo/AppEntry.js` imports `../../App` relative to its own
// location, which only works when expo is installed in mobile/node_modules; with npm workspaces
// it is hoisted to the repository root.
registerRootComponent(App);
