/**
 * Who the app credits (spec 008, FR-018). ONE place for the owner and the key contributors: change names here
 * (and in package.json "contributors", which scripts/test-about.ts keeps in step) and every surface follows:
 * the OS About panel, Settings > About, the installer copyright, LICENSE and the README.
 */
export const OWNER = 'Three Feathers';
export const REPO_URL = 'https://github.com/three-feathers/agent-durbar';
export const COPYRIGHT_YEAR = 2026;
/** Same text as LICENSE and electron-builder "copyright". */
export const COPYRIGHT = `Copyright (c) ${COPYRIGHT_YEAR} ${OWNER} contributors`;

export interface Contributor {
  /** Shown as the name (GitHub handles by decision of Vikram, 2026-10-16); change it here and in package.json "contributors" only. */
  name: string;
  github: string;
}
export const CONTRIBUTORS: readonly Contributor[] = [
  { name: 'vikramgorla', github: 'vikramgorla' },
  { name: 'fjcabello', github: 'fjcabello' },
  { name: 'rubenlupi', github: 'rubenlupi' },
];

export const contributorUrl = (c: Contributor): string => `https://github.com/${c.github}`;
/** "Vikram Gorla (vikramgorla), fjcabello (fjcabello), ..." (the handle is dropped when it is the name). */
export const contributorLabel = (c: Contributor): string => (c.name === c.github ? c.name : `${c.name} (${c.github})`);
export const contributorLabels = (): string[] => CONTRIBUTORS.map(contributorLabel);

/** Plain data for the Settings > About section (renderer) and the OS About panel. */
export interface AboutView {
  name: string;
  version: string;
  owner: string;
  copyright: string;
  website: string;
  contributors: { label: string; url: string }[];
}
export const aboutView = (version: string): AboutView => ({
  name: 'Agent Durbar',
  version,
  owner: OWNER,
  copyright: COPYRIGHT,
  website: REPO_URL,
  contributors: CONTRIBUTORS.map((c) => ({ label: contributorLabel(c), url: contributorUrl(c) })),
});

/** Options for Electron's app.setAboutPanelOptions (macOS panel, Linux/Windows about dialog). */
export const aboutPanelOptions = (version: string) => ({
  applicationName: 'Agent Durbar',
  applicationVersion: version,
  copyright: COPYRIGHT,
  credits: `By ${OWNER}\nContributors: ${contributorLabels().join(', ')}`,
  authors: [OWNER, ...contributorLabels()],
  website: REPO_URL,
});
