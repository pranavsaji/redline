import type { ReviewJob } from '../jobs/types.js';

/** Install and upgrade both run the schema migrations first; the sweeper repeats this if a version is behind. */
export const onInstallJobs = (): ReviewJob[] => [{ kind: 'migrate' }];
