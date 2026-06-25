---
artifact: evidence
design_profile: discovery/brand/design.md
run: consent-lifecycle-hygiene
backs: [S-001]
---

# Synthetic revoke-latency sample (S-001)

Source: Nebras simulator TPP Reports surface, deterministic seed. **Synthetic — no real PSU
data.** 200 revoke events.

| Percentile | Acknowledgement latency |
|---|---|
| p50 | 9.4s |
| p75 | 13.1s |
| p90 | 21.8s |
| SLA (adopting-bank default) | 5.0s |

74% of sampled revokes breached the 5s acknowledgement default. Latency is not visible to
operators today; it is reconstructed here from raw event timestamps.
