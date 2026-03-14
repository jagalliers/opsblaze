---
name: investigating-splunk-login-activity
description: "Investigates login and authentication activity on Splunk instances using the _audit index. Use when analyzing user access patterns, session behavior, authentication anomalies, login failures, token usage, API access patterns, or any security-related access questions on a Splunk deployment."
---

# Investigating Splunk Login Activity

## Core Methodology

Follow a broad-to-specific investigative funnel: overall volume → per-user breakdown → temporal patterns → anomaly deep-dives → summary assessment. Each stage informs what to drill into next.

### Stage 1: Discover Available Authentication Events

Do NOT assume specific action names exist. Splunk deployments vary significantly in how authentication events are labeled (`login_attempt`, `login`, `validate_token`, etc.).

- Start by surveying all distinct `action` values in the audit index with counts. This reveals what vocabulary the instance uses and prevents zero-result queries that waste investigation time.
- Pattern: aggregate all events by the action field, sort by volume descending, and inspect the top entries to identify authentication-relevant actions.
- Common authentication-related actions to look for: `login_attempt`, `login`, `logout`, `validate_token`, `expired_session_token`, `search`. The presence/absence of each tells you about the instance's configuration and Splunk version.

### Stage 2: Establish User Landscape

- Aggregate authentication events by user to identify all actors. Distinguish between human users and system accounts (e.g., `splunk-system-user` handles scheduled searches and internal operations).
- Count distinct users early — this immediately frames whether you're looking at a single-operator instance, a small team, or an enterprise deployment. The rest of the investigation changes shape based on this.
- Pattern: count events by user for authentication-related actions, sort descending to surface primary actors.

### Stage 3: Build the Timeline

- Use timechart with an appropriate span to reveal activity patterns, dormant periods, and ramp-up/ramp-down behavior. Choose span based on the investigation window (4h span works well for 2-3 week windows; adjust proportionally).
- Split by action type to see if session creation and expiration stay in balance. A healthy instance shows roughly proportional `validate_token` and `expired_session_token` volumes. A large divergence may indicate session leaks or unusual persistence.
- Layer in a second timechart split by token identifier or session info field to detect when new sessions appear. New tokens appearing unexpectedly warrant investigation.

### Stage 4: Temporal Pattern Analysis

Extract two views of the time dimension:

- **Hour-of-day distribution**: Reveals whether usage is business-hours, round-the-clock, or has unexpected off-hours spikes. Use `eval hour=strftime(_time, "%H")` and aggregate. An "always-on" pattern with no overnight dip suggests automated/scheduled activity mixing with interactive use.
- **Day-of-week distribution**: Reveals workday vs. weekend patterns. When the active period is short or bursty, day-of-week concentrations may reflect when burst activity happened rather than a true weekly cycle — note this caveat in findings.

### Stage 5: Anomaly Deep-Dives

Investigate anything surprising from earlier stages:

- **New or unexpected tokens**: When a new session token appears, determine its first-seen time, owning user, and validation count. A sudden new token from the same user may indicate a second device/browser or could indicate credential compromise.
- **API/programmatic access**: Look for JWT (JsonWebToken) or similar programmatic authentication patterns. These typically appear as bursty, concentrated validation events rather than the steady drip of interactive sessions. Increasing API access volume over time is worth flagging for documentation purposes.
- **Failed authentications**: Search explicitly for failure indicators (failed login attempts, denied access). The absence of failures is itself a finding worth reporting.
- **Daily summary table**: Build a per-day pivot showing validation count, expiration count, and distinct token count. This is the single most informative view for spotting ramp-ups, quiet spells, and peak-load days.
  - Pattern: aggregate by day using `eval day=strftime(_time, "%Y-%m-%d")`, compute conditional counts for each action type, count distinct tokens per day, sort chronologically.

### Stage 6: Summary and Assessment

Produce a structured summary with:

1. **Key metrics table**: Active period, total events, distinct users, distinct tokens, failed login count.
2. **Traffic-light assessment** using clear severity indicators:
   - 🟢 for clean/healthy findings (no failures, expected user count)
   - 🟡 for noteworthy items that aren't threats but warrant monitoring (increasing API access, unexpected concurrent sessions)
   - 🔴 for actionable security concerns (failed logins, unknown users, off-hours access from unexpected actors)
3. **Usage characterization**: Describe whether the instance sees steady daily use vs. bursty multi-day stretches. This helps the user understand their own operational patterns.

## Visualization Strategy

| Analytical Intent | Chart Type | Why |
|---|---|---|
| Surveying available event types | Table | Need exact values and counts for discovery |
| Per-user event volume | Horizontal bar | Categorical comparison, easy to read rank order |
| Activity timeline | Area or line chart | Shows continuity, gaps, and volume changes over time |
| Action type timeline overlay | Area chart split by action | Reveals balance/imbalance between event types |
| Hour-of-day distribution | Column chart | Natural ordinal axis, reveals daily rhythm |
| Day-of-week distribution | Bar chart | Categorical comparison with sort control |
| Daily summary pivot | Table | Multi-metric view needs precise values |
| Token-specific deep-dive | Table | Need exact timestamps and counts |

## Key Heuristics

- **Session token balance**: When `validate_token` and `expired_session_token` counts track closely, the session lifecycle is healthy. Large divergence warrants investigation.
- **Distinguishing interactive vs. programmatic access**: Interactive sessions produce steady, distributed token validations. Programmatic/API access (JWT) produces tight bursts. Split these in analysis because they have different baseline behaviors and different risk profiles.
- **Interpreting dormant periods**: Gaps in activity aren't necessarily concerning — check whether they align with weekends, holidays, or known maintenance windows before flagging.
- **Concurrent session detection**: Count distinct tokens per day. A jump in distinct tokens for a single user may indicate multi-device use (benign) or session hijacking (concerning). Context matters — always present the finding with both interpretations.

## Pitfalls

- **Do not hardcode action names.** The most common mistake is querying for `action="login_attempt"` and getting zero results, then concluding there's no login data. Always discover available actions first.
- **System user noise.** `splunk-system-user` generates high event volumes from scheduled searches and internal operations. Separate it from human users early or it will dominate every aggregate and obscure real patterns.
- **Short observation windows distort day-of-week analysis.** If the active period doesn't cover multiple full weeks, day-of-week distributions reflect when specific events happened, not recurring weekly patterns. Call this out explicitly.
- **Token identifiers are long and ugly.** When displaying them, truncate to the first 6-8 characters for readability, but use the full value in queries to avoid collisions.
- **JWT spikes may come from the investigation itself.** If the user is accessing Splunk via API (e.g., through a tool or the current conversation), the JWT activity you're investigating may be partially self-generated. Note this possibility.