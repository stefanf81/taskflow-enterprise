# Cross-platform contracts and the web ↔ mobile sync workflow

OpenAPI baseline, generated DTO types, shared tokens and the steps for porting a feature between platforms.

_Detail moved out of [`AGENTS.md`](../../AGENTS.md); the text is unchanged._

- **Platform-local contracts**:
  - `api/openapi.json`: reviewed, canonical OpenAPI contract baseline.
  - `frontend/src/app/types/api.ts` and `mobile/src/types/api.ts`: generated API DTO contracts synchronized from the baseline.
  - `frontend/src/theme/tokens.json` and `mobile/src/theme/tokens.json`: Obsidian & Gold design system tokens.
  - `frontend/src/app/time-utils.ts` and `mobile/src/utils/time-utils.ts`: Pure 12h/24h time and date utilities.
  - `frontend/src/component-map.json` and `mobile/src/component-map.json`: Cross-platform feature component mapping metadata.
## Cross-Platform AI Feature Synchronization Workflow

When modifying or porting a feature between Web (`frontend/`) and Mobile (`mobile/`):
1. **Lookup Component Mapping**: Inspect `frontend/src/component-map.json` or `mobile/src/component-map.json` to identify target files on both platforms.
2. **Use Opencode Sync Skill**: Reference `.opencode/skills/sync-to-mobile.md` for exact framework translation rules:
   * **State**: Angular Signals (`signal()`, `computed()`) $\rightarrow$ TanStack Query (`useQuery`) / Zustand (`useAuthStore`).
   * **Templates**: Angular `@if`/`@for` $\rightarrow$ React Native JSX conditionals & `FlatList`/`map()`.
   * **Theme**: Ensure color tokens originate from the platform-local token files (`mobile/src/theme/colors.ts`).
3. **Sync API Contracts**: If backend endpoints/DTOs change, start the backend, run `npm run api:spec:update`, then `npm run sync:api-types`. Commit the baseline and both generated client type files. Run `npm run sync:api-types:check` before finishing.
4. **Verify**: Run `npm run lint:all` and `npm run test:all`.
