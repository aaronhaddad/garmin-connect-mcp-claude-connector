---
name: garmin-training-insights
description: Answer questions about the user's own Garmin data - runs and workouts, pacing and splits, VO2 max, training effect and load, recovery, sleep, HRV, Body Battery, stress, steps and weight. Use when the user asks how a run or workout went, how fit or recovered they are, or how a health metric has changed.
---

# Garmin training insights

The `garmin` MCP server reads the user's own Garmin Connect account through Garmin's official, read-only Personal API. Dates accept `YYYY-MM-DD`, `today`, `yesterday` or `N days ago`.

## Pick the tool for the question

| The user asks about | Call |
|---|---|
| A run or workout ("how was my run", "did I fade") | `garmin_list_activities` to find it, then `garmin_get_activity_splits` with its `activity_id` |
| Recent training, load or effort | `garmin_list_activities`; each activity has training effect, its label and Garmin's training load |
| VO2 max, or how it has changed | `garmin_get_performance_metrics` |
| Recovery or readiness today | `garmin_get_day` for today (sleep, overnight HRV, Body Battery), plus the last hard session from `garmin_list_activities` |
| Sleep, HRV, Body Battery, stress or steps over time | The matching range tool, such as `garmin_get_sleep` or `garmin_get_hrv` |
| Weight or body composition | `garmin_get_weight` |

Fetch only what the question needs, and prefer one range call over many single-day calls.

## Report it the way Garmin Connect does

- **VO2 max:** give the whole number Garmin Connect shows, and the precise value only if it helps (for example "46, precisely 45.80"). Garmin only updates it after qualifying outdoor runs (and rides with a power meter), so a flat value after gym or indoor sessions is expected; say so instead of calling it a decline.
- **Pacing:** use the splits tool's distance splits, which are interpolated from the activity file with pauses removed, rather than the watch's laps. Lead with the verdict (even, negative split or faded), then the splits that show it.
- **Training effect and load:** Garmin Connect shows training effect to one decimal with a label such as "lactate threshold", and training load as a whole number.
- **Recovery time and performance condition** come from undocumented fields in the activity file. Present them as approximate.

## Limits to state plainly

- Garmin doesn't expose **training readiness, training status or race predictions** through the Personal API. Say they aren't available and offer the closest real data (sleep, HRV, Body Battery, recent load). Don't estimate them yourself or present a guess as Garmin's number.
- If today's sleep, HRV or Body Battery is missing, the watch probably hasn't synced yet. Say so, give the most recent day available, and suggest opening Garmin Connect on the phone to sync.
- The data is the user's health information. Use it to answer their question; don't repeat more of it than the answer needs.

## When a tool reports a key problem

If a tool says the API key is missing, expired or rejected, stop and pass its instructions to the user. Don't try to get the data another way, such as through a browser.
