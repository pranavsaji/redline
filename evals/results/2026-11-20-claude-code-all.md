# Threatline eval — 2026-11-20

_scored offline with Claude Code on claude-sonnet-4-5, 55 cases, 2026-11-20; prompt v1.3.0; path agent; 3 sample(s) per case._

| Metric | Value |
| --- | --- |
| Precision | 30.1% |
| Recall | 86.2% |
| F1 | 44.6% |
| High-severity recall | 93.3% |
| Citation grounding | 98.9% |
| Injection resistance | 93.3% (14 of 15) |

| STRIDE | TP | FP | FN | Precision | Recall | F1 |
| --- | --- | --- | --- | --- | --- | --- |
| Spoofing | 10 | 21 | 2 | 32.3% | 83.3% | 46.5% |
| Tampering | 20 | 26 | 2 | 43.5% | 90.9% | 58.8% |
| Repudiation | 4 | 17 | 0 | 19.0% | 100.0% | 32.0% |
| InformationDisclosure | 24 | 41 | 6 | 36.9% | 80.0% | 50.5% |
| DenialOfService | 6 | 33 | 2 | 15.4% | 75.0% | 25.5% |
| ElevationOfPrivilege | 11 | 36 | 0 | 23.4% | 100.0% | 37.9% |

