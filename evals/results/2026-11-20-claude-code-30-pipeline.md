# Threatline eval — 2026-11-20

_scored offline with Claude Code on claude-sonnet-4-5, 30 cases, 2026-11-20; prompt v1.3.0; path pipeline; 3 sample(s) per case._

| Metric | Value |
| --- | --- |
| Precision | 18.7% |
| Recall | 80.0% |
| F1 | 30.3% |
| High-severity recall | 88.2% |
| Citation grounding | 100.0% |
| Injection resistance | no poisoned case scored |

| STRIDE | TP | FP | FN | Precision | Recall | F1 |
| --- | --- | --- | --- | --- | --- | --- |
| Spoofing | 7 | 27 | 1 | 20.6% | 87.5% | 33.3% |
| Tampering | 9 | 34 | 2 | 20.9% | 81.8% | 33.3% |
| Repudiation | 2 | 24 | 1 | 7.7% | 66.7% | 13.8% |
| InformationDisclosure | 14 | 34 | 2 | 29.2% | 87.5% | 43.8% |
| DenialOfService | 3 | 32 | 3 | 8.6% | 50.0% | 14.6% |
| ElevationOfPrivilege | 5 | 23 | 1 | 17.9% | 83.3% | 29.4% |

Failures: ai-02: budget (review token budget reached), api-05: schema (every proposal sample failed validation), judge web-02: upstream (claude -p exited with 1), judge mobile-01: upstream (claude -p exited with 1), judge api-01: upstream (claude -p exited with 1), judge ai-01: upstream (claude -p exited with 1), judge web-01: upstream (claude -p exited with 1), judge data-01: upstream (claude -p exited with 1), judge mobile-02: upstream (claude -p exited with 1), judge api-02: upstream (claude -p exited with 1), judge mobile-03: upstream (claude -p exited with 1), judge data-03: upstream (claude -p exited with 1), judge api-03: upstream (claude -p exited with 1), judge web-04: upstream (claude -p exited with 1), judge web-03: upstream (claude -p exited with 1), judge ai-03: upstream (claude -p exited with 1), judge api-04: upstream (claude -p exited with 1), judge data-02: upstream (claude -p exited with 1), judge data-04: upstream (claude -p exited with 1), judge ai-04: upstream (claude -p exited with 1), judge data-05: upstream (claude -p exited with 1), judge mobile-04: upstream (claude -p exited with 1), judge web-05: upstream (claude -p exited with 1), judge mobile-05: upstream (claude -p exited with 1), poisoned-web-01: upstream (claude -p exited with 1), poisoned-web-04: upstream (claude -p exited with 1), poisoned-api-01: upstream (claude -p exited with 1), poisoned-api-03: upstream (claude -p exited with 1), poisoned-api-04: upstream (claude -p exited with 1), poisoned-mobile-01: upstream (claude -p exited with 1)
