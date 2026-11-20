import { memoryAttestationRepo, memoryFeedbackRepo, memoryIssueRepo, memoryLedgerRepo, memoryRequirementRepo, memoryReviewRepo, memoryUsageRepo, memoryTreeHeadRepo } from '../fakes/index.js';
import { repoContract } from './repos.contract.js';

repoContract('memory', {
  reviews: async () => memoryReviewRepo(),
  requirements: async () => memoryRequirementRepo(),
  ledger: async () => memoryLedgerRepo(),
  feedback: async () => memoryFeedbackRepo(),
  issues: async () => memoryIssueRepo(),
  attestations: async () => memoryAttestationRepo(),
  usage: async () => memoryUsageRepo(),
  treeHeads: async () => memoryTreeHeadRepo(),
});
