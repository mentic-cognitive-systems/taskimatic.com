# taskimatic.com
the assets and services served by taskimatic.com

The task app uses browser-native ES modules; no build step or package installation is required.
Serve this directory over HTTP for development (for example, `python3 -m http.server 8765`).

- `index.html`: page metadata, accessible shell, and portable workspace seed.
- `css/tasks.css` and `css/protect-modal.css`: global workspace and Lock In styles.
- `webcomp/`: custom elements, with each component's template, styles, and event handling together. `task-workspace.js` coordinates the workspace and its views.
- `js/tasks-app.js`: startup and component registration after translations are ready.
- `js/task-model.js`: task normalization, shared formatting, and duration caching.
- `js/task-repository.js`: OPFS persistence, IndexedDB migration/fallback, and memory fallback.
- `js/task-analytics.js`: analytics and date windows.
- `js/task-api.js`: the public `window.taskimatic` API.
- `js/portable-app.js`: self-contained HTML exports, including styles, translations, scripts, and workspace data.
- `js/workspace-tabs.js` and `js/offline.js`: page navigation and offline/install setup.

Run checks with `node --test tests/*.test.mjs`.
When adding an app dependency, include it in `tasks-sw.js` and bump the cache version.
Portable exports support static named imports, side-effect imports, and named exports.
Keep that module syntax for app dependencies and run the portable bundle test when changing imports.
