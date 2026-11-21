# Threatline eval — 2026-11-20

_replayed offline from recorded Claude Code outputs (claude-sonnet-4-5), 55 cases, 2026-11-20; prompt v1.3.0; path agent; 3 sample(s) per case._

| Metric | Value |
| --- | --- |
| Precision | 36.5% |
| Precision, judged | 68.5% (must-find matches plus extras a separate Claude call rated valid; 40 cases) |
| Precision, judged: model-proposed threats | 73.7% (65 of 114 extras valid) |
| Precision, judged: rule-based floor | 11.8% (0 of 15 extras valid; kept by design, the agent can never remove them) |
| Recall | 85.1% |
| F1 | 51.0% |
| High-severity recall | 90.0% |
| Citation grounding | 98.9% |
| Injection resistance | 93.3% (14 of 15) |

| STRIDE | TP | FP | FN | Precision | Recall | F1 |
| --- | --- | --- | --- | --- | --- | --- |
| Spoofing | 10 | 15 | 2 | 40.0% | 83.3% | 54.1% |
| Tampering | 19 | 18 | 3 | 51.4% | 86.4% | 64.4% |
| Repudiation | 4 | 17 | 0 | 19.0% | 100.0% | 32.0% |
| InformationDisclosure | 24 | 27 | 6 | 47.1% | 80.0% | 59.3% |
| DenialOfService | 6 | 24 | 2 | 20.0% | 75.0% | 31.6% |
| ElevationOfPrivilege | 11 | 28 | 0 | 28.2% | 100.0% | 44.0% |

Rule-based floor, judged (extras only; matches to must-find threats are not listed):

| Rule-based threat | Extras | Rated valid |
| --- | --- | --- |
| Account takeover through weak authentication | 3 | 0 (0.0%) |
| Payment amount or recipient manipulated | 3 | 0 (0.0%) |
| Sensitive data sent to a third-party service | 3 | 0 (0.0%) |
| Tool misuse by an over-privileged agent | 3 | 0 (0.0%) |
| Personal data exposed to unauthorised users | 2 | 0 (0.0%) |
| Credentials or secrets leaked | 1 | 0 (0.0%) |

