import { palette, semantic, withAlpha } from '@taskflow/theme';

/**
 * The app's colours, from the tokens the web app uses too (shared/theme/tokens.json, the
 * @taskflow/theme workspace). `colors` is the raw palette; `semantic` names colours by purpose
 * (`surface`, `fg-muted`, `accent`, `danger`, …); `withAlpha` makes a translucent tint of one.
 */
export const colors = palette;
export { semantic, withAlpha };
