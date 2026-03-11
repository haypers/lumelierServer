# Clock synchronization algorithm — audit report

**Scope:** Client and simulated-client estimation of server clock (NTP-style sync).  
**Code:** `client/src/main.ts` (poll loop, `nowEpochMs`, sync math), `simulated-server/src/client_sync.rs` (`apply_poll_response`), server `src/api/poll.rs` (t1/t2), `src/time.rs` (time source).

---

## 1. Algorithm summary

Both implementations use the same **NTP-style** procedure:

1. **Four timestamps:** t0 (client send), t1 (server recv), t2 (server send), t3 (client recv).
2. **Offset:** `offset_ms = ((t1 - t0) + (t2 - t3)) / 2`
3. **Round-trip delay:** `delay_ms = (t3 - t0) - (t2 - t1)` (RTT minus server processing)
4. **Sample storage:** Keep last 30 samples; add new (offset_ms, delay_ms).
5. **Filtering:** Take samples with `delay_ms <= min_delay + 40 ms` (“good”); if none, use all.
6. **Filtered offset:** Median of good offsets (or median of all if no good).
7. **Apply offset:** If samples < 3: set `clock_offset = filtered_offset`. Else: **slew** — move offset toward filtered by at most ±25 ms per poll.
8. **Server time:** `server_time = local_time + clock_offset` (client uses `nowEpochMs()`; sim uses `now_ms()`).

Constants match: `SYNC_SAMPLES_MAX = 30`, `DELAY_SLACK_MS = 40`, `SLEW_MAX_STEP_MS = 25`.

---

## 2. Correctness

- **Formulas:** Match standard NTP offset and delay (theta and delta). Correct.
- **t3 definition:** Simulator uses “ideal” network receive time (t0 + c2s + s2c), excluding client processing; real client uses time right after `fetch()` resolves (before `res.json()`). So t3 excludes JSON parse and app processing in both cases; real client adds only event-loop delay until the line after `await fetch()`. Acceptable and consistent.
- **Time base (real client):** `nowEpochMs()` uses `performance.timeOrigin + performance.now()` when available, reducing sensitivity to wall-clock changes (e.g. user changing time). Good.
- **Fallback when t1/t2 missing:** Client uses `serverTs + rtt/2 - nowEpochMs()` and still pushes a sample. Prevents crashes; quality is lower when t1/t2 are absent (should not happen with current server).

---

## 3. Bugs and edge cases

### 3.1 Minor / robustness

| Issue | Location | Severity | Suggestion |
|-------|----------|----------|------------|
| **Empty `syncSamples` before first use** | Client: `Math.min(...syncSamples.map(...))` | Low | After `syncSamples.push(...)`, length is always ≥ 1. No change needed. |
| **Rust median and NaN** | `client_sync.rs`: `sort_by(partial_cmp)` | Low | Offsets are clamped to finite before push. For defense, could use a total ordering (e.g. treat NaN as 0) or skip non-finite in median input. |
| **Client median and non-finite** | `main.ts`: `sort((a,b) => a - b)` | Low | Non-finite are forced to 0 before push. Could additionally filter `offsets` with `Number.isFinite` before median. |
| **Integer offset in Rust** | `client_sync.rs`: `clock_offset_ms: i64` | Low | Offset is rounded each slew step; client keeps fractional. Could store `f64` and round only when computing server time to reduce quantization error over many steps. |

### 3.2 Possible bug: `lastRttMs` in fallback

**Location:** `client/src/main.ts` (fallback when `t1 == null` or `t2 == null`).

```ts
const rttMs = lastRttMs ?? 0;
offsetMs = serverTs + rttMs / 2 - nowEpochMs();
```

- `lastRttMs` is set from the **previous** round’s `t3 - t0`. If the **current** round had no t1/t2 (e.g. malformed response), using the previous RTT is a reasonable guess, but `nowEpochMs()` is “now” at apply time, not at send time. So the fallback is only a rough correction. Not a logic bug, but the fallback path is weaker; acceptable as rare path.

### 3.3 No explicit outlier rejection beyond “good” filter

- Current logic: keep samples with delay ≤ min_delay + 40 ms, then take median of their offsets. That already drops high-delay (often asymmetric) rounds.
- No extra step (e.g. discarding offsets that differ from median by > X ms). For your poll interval and slew, behavior is reasonable; adding a hard outlier threshold could improve resilience to rare bad rounds (see improvements below).

---

## 4. Real client vs simulated client — consistency

- **Same formula, same constants:** Yes.
- **t3:** Simulator uses ideal receive time (network-only); real client uses “right after fetch()”. Conceptually both are “receive time”; real client includes a small amount of JS scheduling delay. No change required for parity.
- **Time base:** Real client uses `performance.timeOrigin + performance.now()`; simulator uses `now_ms()` (wall clock). Under normal conditions both are monotonic enough; only the real client explicitly avoids wall-clock jumps.
- **Verdict:** Both use the same method; only environment differences (where t3 is taken, time base). Simulated client is a valid stand-in for testing sync and error metrics.

---

## 5. Implementation quality (summary)

| Aspect | Rating | Notes |
|--------|--------|--------|
| Correctness of NTP math | High | Matches standard formulas. |
| Robustness to bad input | Good | Non-finite clamped; fallback when t1/t2 missing. |
| Consistency client vs sim | High | Same algorithm and constants; t3/time-base differences are intentional. |
| Resistance to asymmetric RTT | Good | “Good” samples (low delay) reduce impact of asymmetry. |
| Resistance to outliers | Adequate | Median + delay filter; no explicit offset-outlier rejection. |
| Slew rate | Appropriate | ±25 ms per 2.5 s poll avoids jumps while tracking drift. |

Overall the implementation is **solid and appropriate** for show control: same method on client and simulated client, correct NTP-style sync, and good use of median and low-delay filtering.

---

## 6. Improvements to the current algorithm

### 6.1 High value, low risk

1. **Reject offset outliers before median**  
   After selecting “good” (or all) samples, drop offsets that are more than e.g. 100–200 ms from the current median (or from the median of the selected set), then recompute median. Prevents a single bad round from moving the estimate.

2. **Optional: exponential decay for old samples**  
   Instead of a fixed window of 30, weight recent samples more (e.g. exponential weights). Helps if clock drift or network regime changes over time.

3. **Defense-in-depth for median**  
   - **Client:** Filter `offsets` with `Number.isFinite` before `median(offsets)`.  
   - **Rust:** In `median()`, skip or replace non-finite values so `sort_by` never sees NaN.

### 6.2 Tuning (no algorithm change)

4. **Tighten or loosen “good” slack**  
   `DELAY_SLACK_MS = 40`: smaller values are stricter (fewer good samples, more fallback to all); larger values accept more samples. Tune based on observed RTT distribution (e.g. from simulate-devices).

5. **Slew rate vs poll interval**  
   Current: ±25 ms per ~2.5 s ⇒ ~±10 ms/s max correction. If devices often have larger initial error, consider a higher slew for the first N minutes or when error is above a threshold.

6. **Rust: store offset in f64**  
   Keep `clock_offset_ms` as `f64` internally; round only when returning server time. Reduces quantization error across many slew steps.

### 6.3 Optional / future

7. **Expose sync quality to UI**  
   e.g. “sync error” (e.g. last `estimate - actual` in sim) or “samples used / good” so operators can see when sync is weak.

8. **Adaptive poll interval**  
   Poll more often until sync has converged (e.g. small residual error and stable offset), then back off to save load.

---

## 7. Alternative algorithms (potential improvements)

### 7.1 Cristian’s algorithm (single round)

- **Idea:** One round-trip; offset = t1 − t0 − RTT/2 (or use (t1−t0 + t2−t3)/2 with t2,t3).
- **Pros:** Simple.  
- **Cons:** Single sample, no filtering; very sensitive to RTT variance and asymmetry.  
- **Verdict:** Weaker than current; not recommended.

### 7.2 Berkeley-like (server polls clients)

- **Idea:** Server asks clients for their time; server computes average and sends correction.  
- **Pros:** Server can enforce a single view of time.  
- **Cons:** Different architecture (server-driven), more state; overkill for “client estimates server time” and broadcast play/pause.  
- **Verdict:** Not a drop-in improvement for your current design.

### 7.3 PTP / hardware-assisted (IEEE 1588)

- **Idea:** Hardware timestamps and peer-to-peer sync for sub-µs accuracy.  
- **Pros:** Best accuracy.  
- **Cons:** Needs hardware/OS support; not available in browsers or typical phones.  
- **Verdict:** Not applicable to your stack.

### 7.4 Kalman filter or recursive estimator

- **Idea:** Model offset and drift; update with each round; optimal weighting under Gaussian noise.  
- **Pros:** Theoretically better use of history and drift.  
- **Cons:** More parameters and complexity; median + slew is already robust and simple.  
- **Verdict:** Possible future upgrade if you need to track drift explicitly or minimize MSE in controlled experiments; not necessary for current use.

### 7.5 NTP with more samples / different filtering

- **Idea:** Same four timestamps, but: larger window, trimmed mean instead of median, or NTP’s own selection and clustering rules.  
- **Pros:** Same conceptual model; can reduce impact of outliers further.  
- **Cons:** More code and tuning.  
- **Verdict:** Your current “median of low-delay samples + slew” is already in the same family and is a good fit. Improvements in §6 (outlier rejection, optional weighting) give most of the benefit without switching algorithm.

---

## 8. Recommendations

1. **Keep the current NTP-style algorithm** for both client and simulated client; it is correct and consistent.
2. **Add optional offset-outlier rejection** (e.g. drop offsets > 100–200 ms from median) before taking the final median.
3. **Add defense-in-depth** for non-finite values in the median input (client and Rust).
4. **Consider storing offset as f64 in Rust** and rounding only when returning server time.
5. **Tune DELAY_SLACK_MS and SLEW_MAX_STEP_MS** from real or simulated data if you see slow convergence or jitter.
6. **Do not switch** to Cristian-only, Berkeley, or PTP for this use case; Kalman or richer NTP-style filtering are the only alternatives worth considering later if you need better drift handling or formal optimality.

---

**Document version:** 1.0  
**Files reviewed:** `client/src/main.ts`, `simulated-server/src/client_sync.rs`, `src/api/poll.rs`, `src/time.rs`, `simulated-server/src/runner.rs` (t3 and apply_poll_response usage).
