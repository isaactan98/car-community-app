import { registerRootComponent } from 'expo';

// IMPORTANT: import for side effects BEFORE the app registers, so
// TaskManager.defineTask runs in the headless JS context too (background /
// screen locked / app killed). Do not move this below registerRootComponent.
import './locationTask';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
