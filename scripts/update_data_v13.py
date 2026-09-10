from __future__ import annotations

import json
import statistics

import update_data_v12 as phase12

base = phase12.base
DATA_FILE = phase12.DATA_FILE


def _now_iso() -> str:
    return base.now_iso()


def _num(value) -> float | None:
    return base.to_float(value)


def _percentile(values: list[float], value: float | None) -> float | None:
    clean = sorted(float(v) for v in values if v is not None)
    if value is None or not clean:
        return None
    below = sum(1 for v in clean if v < value)
    equal = sum(1 for v in clean if v == value)
    return (below + 0.5 * equal) / len(clean) * 100.0


def _history(profile: dict) -> list[tuple[str, float]]:
    rows = []
    for row in profile.get("history", []) or []:
        date = row.get("date")
        value = _num(row.get("value_billions"))
        if date and value is not None:
            rows.append((str(date), value))
    rows.sort(key=lambda x: x[0])
    return rows


def _period_changes(history: list[tuple[str, float]]) -> list[dict]:
    changes = []
    for idx in range(1, len(history)):
        date, current = history[idx]
        _, previous = history[idx - 1]
        change_b = current - previous
        change_pct = (change_b / abs(previous) * 100.0) if previous else None
        changes.append(
            {
                "date": date,
                "value_billions": current,
                "change_billions": change_b,
                "change_pct": change_pct,
            }
        )
    return changes


def _signed_streak(changes: list[dict]) -> int:
    streak = 0
    direction = 0
    for row in reversed(changes):
        value = _num(row.get("change_billions"))
        if value is None or value == 0:
            break
        sign = 1 if value > 0 else -1
        if direction == 0:
            direction = sign
        if sign != direction:
            break
        streak += 1
    return streak * direction


def _compound_change(history: list[tuple[str, float]], periods: int) -> float | None:
    if len(history) < periods + 1:
        return None
    current = history[-1][1]
    previous = history[-1 - periods][1]
    if previous == 0:
        return None
    return (current - previous) / abs(previous) * 100.0


def _rolling_rank_history(profiles: list[dict]) -> dict[str, list[dict]]:
    # Rank by reported level only where profiles share the exact same observation date.
    snapshots: dict[str, list[tuple[str, float]]] = {}
    for profile in profiles:
        pid = profile.get("profile_id")
        if not pid:
            continue
        for date_key, value in _history(profile):
            snapshots.setdefault(date_key, []).append((str(pid), value))

    by_profile: dict[str, list[dict]] = {}
    for date_key, rows in snapshots.items():
        ranked = sorted(rows, key=lambda x: x[1], reverse=True)
        count = len(ranked)
        for rank, (pid, value) in enumerate(ranked, 1):
            by_profile.setdefault(pid, []).append(
                {
                    "date": date_key,
                    "rank": rank,
                    "peer_count": count,
                    "value_billions": value,
                    "rank_percentile": (1.0 - (rank - 1) / max(count - 1, 1)) * 100.0,
                }
            )
    for rows in by_profile.values():
        rows.sort(key=lambda r: r["date"])
    return by_profile


def build_holder_momentum(data: dict) -> dict:
    profiles = data.get("holder_profiles", {}).get("profiles", []) or []
    by_scope: dict[str, list[dict]] = {}
    for profile in profiles:
        by_scope.setdefault(str(profile.get("scope") or "Unknown"), []).append(profile)

    rows = []
    scope_summaries = []
    for scope, scope_profiles in sorted(by_scope.items()):
        rank_histories = _rolling_rank_history(scope_profiles)
        scope_rows = []
        for profile in scope_profiles:
            history = _history(profile)
            changes = _period_changes(history)
            if not changes:
                continue

            latest = changes[-1]
            previous = changes[-2] if len(changes) >= 2 else None
            latest_pct = _num(latest.get("change_pct"))
            previous_pct = _num(previous.get("change_pct")) if previous else None
            historical_change_pct = [
                _num(row.get("change_pct"))
                for row in changes[:-1]
                if _num(row.get("change_pct")) is not None
            ]
            historical_abs_pct = [abs(v) for v in historical_change_pct]
            acceleration = (
                latest_pct - previous_pct
                if latest_pct is not None and previous_pct is not None
                else None
            )
            last_three = [
                _num(row.get("change_pct"))
                for row in changes[-3:]
                if _num(row.get("change_pct")) is not None
            ]
            levels = [value for _, value in history]
            current_level = levels[-1]
            max_level = max(levels)
            min_level = min(levels)
            rank_history = rank_histories.get(str(profile.get("profile_id")), [])
            rank_change = None
            if len(rank_history) >= 2:
                rank_change = rank_history[-2]["rank"] - rank_history[-1]["rank"]

            row = {
                "profile_id": profile.get("profile_id"),
                "scope": scope,
                "name": profile.get("name"),
                "frequency": profile.get("frequency"),
                "as_of": profile.get("as_of") or latest.get("date"),
                "current_billions": profile.get("current_billions"),
                "latest_change_billions": latest.get("change_billions"),
                "latest_change_pct": latest_pct,
                "previous_change_pct": previous_pct,
                "acceleration_pct_points": acceleration,
                "rolling_3_avg_change_pct": statistics.fmean(last_three) if last_three else None,
                "change_percentile": _percentile(historical_change_pct, latest_pct),
                "absolute_change_percentile": _percentile(historical_abs_pct, abs(latest_pct) if latest_pct is not None else None),
                "three_period_change_pct": _compound_change(history, 3),
                "six_period_change_pct": _compound_change(history, 6),
                "signed_streak": _signed_streak(changes),
                "history_points": len(history),
                "change_points": len(changes),
                "distance_from_history_high_pct": ((current_level - max_level) / abs(max_level) * 100.0) if max_level else None,
                "distance_from_history_low_pct": ((current_level - min_level) / abs(min_level) * 100.0) if min_level else None,
                "current_rank": rank_history[-1]["rank"] if rank_history else profile.get("rank_within_scope"),
                "peer_count": rank_history[-1]["peer_count"] if rank_history else None,
                "rank_change": rank_change,
                "rank_history": rank_history[-16:],
            }
            scope_rows.append(row)
            rows.append(row)

        valid_accel = [r for r in scope_rows if r.get("acceleration_pct_points") is not None]
        scope_summaries.append(
            {
                "scope": scope,
                "holder_count": len(scope_rows),
                "accelerating_count": sum(1 for r in valid_accel if r["acceleration_pct_points"] > 0),
                "decelerating_count": sum(1 for r in valid_accel if r["acceleration_pct_points"] < 0),
                "median_latest_change_pct": statistics.median([r["latest_change_pct"] for r in scope_rows if r.get("latest_change_pct") is not None]) if any(r.get("latest_change_pct") is not None for r in scope_rows) else None,
                "median_acceleration_pct_points": statistics.median([r["acceleration_pct_points"] for r in valid_accel]) if valid_accel else None,
                "top_accelerators": sorted(valid_accel, key=lambda r: r["acceleration_pct_points"], reverse=True)[:5],
                "top_decelerators": sorted(valid_accel, key=lambda r: r["acceleration_pct_points"])[:5],
                "strongest_current_increases": sorted([r for r in scope_rows if r.get("latest_change_pct") is not None], key=lambda r: r["latest_change_pct"], reverse=True)[:5],
                "strongest_current_decreases": sorted([r for r in scope_rows if r.get("latest_change_pct") is not None], key=lambda r: r["latest_change_pct"])[:5],
            }
        )

    rows.sort(key=lambda r: (r.get("scope") or "", r.get("name") or ""))
    return {
        "generated_at": _now_iso(),
        "row_count": len(rows),
        "scope_count": len(scope_summaries),
        "rows": rows,
        "scopes": scope_summaries,
        "method": (
            "Acceleration is the latest period-to-period percentage change minus the immediately preceding percentage change. "
            "Change percentiles compare the latest move with earlier stored moves for the same holder, excluding the latest move itself. "
            "Ranks compare reported levels only among holders in the same semantic scope sharing the exact observation date."
        ),
        "note": "Momentum and acceleration describe reported holdings changes, not price momentum or a prediction of future Treasury demand.",
    }


def main() -> None:
    phase12.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    data["holder_momentum"] = build_holder_momentum(data)
    data["generated_at"] = _now_iso()

    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Phase 13 updated {DATA_FILE}")
    print("Momentum rows:", data["holder_momentum"].get("row_count"))
    for scope in data["holder_momentum"].get("scopes", []):
        print(scope.get("scope"), "holders=", scope.get("holder_count"), "accelerating=", scope.get("accelerating_count"), "decelerating=", scope.get("decelerating_count"))


if __name__ == "__main__":
    main()
