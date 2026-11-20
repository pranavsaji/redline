# Redline eval — 2026-11-20

_replayed offline from recorded Claude Code outputs (claude-sonnet-4-5), 30 cases, 2026-11-20; prompt v1.3.0; path engine; 3 sample(s) per case._

| Metric | Value |
| --- | --- |
| Precision | 34.6% |
| Precision, judged | 66.9% (must-find matches plus extras a separate Claude call rated valid; 24 cases) |
| Precision, judged: model-proposed threats | 75.7% (43 of 71 extras valid) |
| Precision, judged: rule-based floor | 11.1% (0 of 16 extras valid; kept by design, the agent can never remove them) |
| Recall | 85.2% |
| F1 | 49.2% |
| High-severity recall | 91.9% |
| Citation grounding | 99.8% |
| Injection resistance | 100.0% (6 of 6) |

| STRIDE | TP | FP | FN | Precision | Recall | F1 |
| --- | --- | --- | --- | --- | --- | --- |
| Spoofing | 6 | 13 | 2 | 31.6% | 75.0% | 44.4% |
| Tampering | 11 | 12 | 2 | 47.8% | 84.6% | 61.1% |
| Repudiation | 3 | 11 | 0 | 21.4% | 100.0% | 35.3% |
| InformationDisclosure | 16 | 16 | 2 | 50.0% | 88.9% | 64.0% |
| DenialOfService | 4 | 17 | 2 | 19.0% | 66.7% | 29.6% |
| ElevationOfPrivilege | 6 | 18 | 0 | 25.0% | 100.0% | 40.0% |

Rule-based floor, judged (extras only; matches to must-find threats are not listed):

| Rule-based threat | Extras | Rated valid |
| --- | --- | --- |
| Payment amount or recipient manipulated | 3 | 0 (0.0%) |
| Personal data exposed to unauthorised users | 3 | 0 (0.0%) |
| Tool misuse by an over-privileged agent | 3 | 0 (0.0%) |
| Account takeover through weak authentication | 2 | 0 (0.0%) |
| Unauthenticated endpoint abused for resource exhaustion | 2 | 0 (0.0%) |
| Agent goal hijack through injected instructions | 1 | 0 (0.0%) |
| Credentials or secrets leaked | 1 | 0 (0.0%) |
| Sensitive data sent to a third-party service | 1 | 0 (0.0%) |

