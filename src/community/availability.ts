/** Cloud sharing is off unless a build explicitly opts in (e.g. legacy contract tests). */
export const onlineSharingEnabled = typeof __GLYPHFORGE_ONLINE_SHARING__ !== "undefined" && __GLYPHFORGE_ONLINE_SHARING__;
