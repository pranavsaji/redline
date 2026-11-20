# Redline eval — 2026-11-20

_replayed offline from recorded Claude Code outputs (claude-sonnet-4-5), 55 cases, 2026-11-20; prompt v1.3.0; path agent; 3 sample(s) per case._

| Metric | Value |
| --- | --- |
| Precision | 30.0% |
| Precision, judged | 57.1% (must-find matches plus extras a separate Claude call rated valid; 40 cases) |
| Precision, judged: model-proposed threats | 73.1% (65 of 115 extras valid) |
| Precision, judged: rule-based floor | 8.2% (2 of 58 extras valid; kept by design, the agent can never remove them) |
| Recall | 85.1% |
| F1 | 44.3% |
| High-severity recall | 90.0% |
| Citation grounding | 98.9% |
| Injection resistance | 93.3% (14 of 15) |

| STRIDE | TP | FP | FN | Precision | Recall | F1 |
| --- | --- | --- | --- | --- | --- | --- |
| Spoofing | 10 | 20 | 2 | 33.3% | 83.3% | 47.6% |
| Tampering | 19 | 27 | 3 | 41.3% | 86.4% | 55.9% |
| Repudiation | 4 | 17 | 0 | 19.0% | 100.0% | 32.0% |
| InformationDisclosure | 24 | 39 | 6 | 38.1% | 80.0% | 51.6% |
| DenialOfService | 6 | 33 | 2 | 15.4% | 75.0% | 25.5% |
| ElevationOfPrivilege | 11 | 37 | 0 | 22.9% | 100.0% | 37.3% |

