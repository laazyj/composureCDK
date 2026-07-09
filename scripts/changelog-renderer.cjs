// Custom nx release changelog renderer.
//
// Rebrands the default "❤️ Thank You" authors heading to the skull mark from
// jasonduffett.net. Only that heading is touched — everything else inherits
// nx's DefaultChangelogRenderer, so upstream changelog changes flow through on
// upgrade. Wired in via release.changelog.workspaceChangelog.renderer in
// nx.json. Preview with `npm run release:dryrun`.
//
// CommonJS (.cjs): nx resolves non-".ts" renderer paths with require(), which
// cannot load an ESM module even though this workspace is "type": "module".
const DefaultChangelogRenderer = require("nx/release/changelog-renderer").default;

module.exports = class ComposureChangelogRenderer extends DefaultChangelogRenderer {
  async renderAuthors() {
    const lines = await super.renderAuthors();
    return lines.map((line) => line.replace("❤️ Thank You", "💀 Thank You"));
  }
};
