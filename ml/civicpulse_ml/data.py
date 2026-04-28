"""Dataset utilities for the CivicPulse issue-priority model."""

from __future__ import annotations

import argparse
import random
from pathlib import Path

import pandas as pd


ISSUE_PROFILES = {
    "Pothole": {
        "words": ["pothole", "crater", "road crack", "damaged lane", "water filled hole"],
        "base": 58,
        "teams": ["Roads team", "Emergency roads crew"],
    },
    "Garbage": {
        "words": ["garbage", "trash", "waste pile", "overflowing bin", "dumped bags"],
        "base": 48,
        "teams": ["Sanitation team", "Waste collection crew"],
    },
    "Broken Light": {
        "words": ["street light", "dark road", "broken lamp", "electric pole", "no lighting"],
        "base": 44,
        "teams": ["Electrical team", "Night safety crew"],
    },
    "Water Leak": {
        "words": ["water leak", "burst pipe", "flooding", "sewage overflow", "drain water"],
        "base": 54,
        "teams": ["Water works team", "Drainage crew"],
    },
    "Road Block": {
        "words": ["road blocked", "fallen tree", "construction debris", "vehicle obstruction", "blocked lane"],
        "base": 62,
        "teams": ["Traffic response team", "Emergency clearing crew"],
    },
}

UNSUPPORTED_PROFILES = {
    "Vehicle Photo": {
        "words": ["sports car", "supercar", "race car", "porsche", "car wallpaper", "vehicle render"],
    },
    "Concept Art": {
        "words": ["concept art", "digital render", "illustration", "studio render", "3d artwork", "wallpaper art"],
    },
    "Product Shot": {
        "words": ["product photo", "showroom image", "display shot", "promo image", "catalog photo", "hero render"],
    },
}

RISK_WORDS = ["urgent", "dangerous", "school", "traffic jam", "accident risk", "night", "elderly", "children", "main road"]
AREAS = ["MG Road", "Indiranagar", "Koramangala", "Richmond Road", "Ulsoor", "Whitefield", "Jayanagar"]
TIMES = ["morning", "afternoon", "evening", "night"]


def _priority(score: int) -> str:
    if score >= 78:
        return "P1 Emergency"
    if score >= 58:
        return "P2 High"
    if score >= 38:
        return "P3 Normal"
    return "P4 Low"


def generate_dataset(rows: int = 1600, seed: int = 42) -> pd.DataFrame:
    """Generate a reproducible civic-issue dataset with text, visual, and geo features."""
    rng = random.Random(seed)
    records = []

    for idx in range(rows):
        is_supported = rng.random() >= 0.18
        issue_type = rng.choice(list(ISSUE_PROFILES)) if is_supported else "Unsupported"
        profile = ISSUE_PROFILES.get(issue_type)
        risk_count = rng.choices([0, 1, 2, 3, 4], weights=[16, 32, 27, 17, 8], k=1)[0]
        risk_terms = rng.sample(RISK_WORDS, risk_count) if is_supported else []
        area = rng.choice(AREAS)
        if is_supported:
            keyword = rng.choice(profile["words"])
        else:
            unsupported_family = rng.choice(list(UNSUPPORTED_PROFILES.values()))
            keyword = rng.choice(unsupported_family["words"])
        time_of_day = rng.choice(TIMES)
        population_density = round(rng.uniform(0.25, 1.0), 2)
        distance_to_school_km = round(rng.uniform(0.05, 3.5), 2)
        complaint_age_hours = rng.randint(1, 96)
        nearby_open_reports = rng.randint(0, 9)

        brightness = round(rng.uniform(20, 180), 2)
        edge_density = round(rng.uniform(0.08, 0.92), 3)
        red_ratio = round(rng.uniform(0.03, 0.28), 3)
        brown_ratio = round(rng.uniform(0.02, 0.65), 3)
        green_ratio = round(rng.uniform(0.02, 0.55), 3)
        blue_ratio = round(rng.uniform(0.02, 0.7), 3)

        if issue_type == "Broken Light":
            brightness = round(rng.uniform(8, 70), 2)
        if issue_type == "Pothole":
            brown_ratio = round(rng.uniform(0.35, 0.82), 3)
            edge_density = round(rng.uniform(0.4, 0.95), 3)
        if issue_type == "Garbage":
            green_ratio = round(rng.uniform(0.28, 0.68), 3)
        if issue_type == "Water Leak":
            blue_ratio = round(rng.uniform(0.35, 0.82), 3)
        if issue_type == "Unsupported":
            brightness = round(rng.uniform(60, 175), 2)
            red_ratio = round(rng.uniform(0.18, 0.62), 3)
            brown_ratio = round(rng.uniform(0.01, 0.18), 3)
            green_ratio = round(rng.uniform(0.01, 0.22), 3)
            blue_ratio = round(rng.uniform(0.04, 0.32), 3)
            edge_density = round(rng.uniform(0.1, 0.42), 3)
            complaint_age_hours = rng.randint(1, 12)
            nearby_open_reports = rng.randint(0, 2)
            distance_to_school_km = round(rng.uniform(1.8, 3.8), 2)

        if issue_type == "Unsupported":
            score = max(15, min(30, int(round(18 + red_ratio * 8 + edge_density * 3 + rng.uniform(-3, 5)))))
        else:
            visual_risk = edge_density * 13 + (1 - min(brightness, 180) / 180) * 10
            geo_risk = nearby_open_reports * 2.1 + population_density * 8 + max(0, 1.2 - distance_to_school_km) * 5
            delay_risk = min(complaint_age_hours / 12, 8)
            score = round(profile["base"] + risk_count * 5.5 + visual_risk + geo_risk + delay_risk + rng.uniform(-12, 8))
            score = max(15, min(100, int(score)))

        if issue_type == "Unsupported":
            description = f"{keyword} image captured at {area} during {time_of_day}. Non-civic content without a public infrastructure problem."
            title = f"{keyword.title()} upload"
            recommended_team = "Manual review"
        else:
            description = (
                f"{keyword} reported at {area} during {time_of_day}. "
                f"{' '.join(risk_terms)} needs attention from city staff."
            )
            title = f"{keyword.title()} near {area}"
            recommended_team = rng.choice(profile["teams"])

        records.append(
            {
                "report_id": f"CP-{idx + 1:05d}",
                "title": title,
                "description": description,
                "area": area,
                "time_of_day": time_of_day,
                "population_density": population_density,
                "distance_to_school_km": distance_to_school_km,
                "complaint_age_hours": complaint_age_hours,
                "nearby_open_reports": nearby_open_reports,
                "brightness": brightness,
                "edge_density": edge_density,
                "red_ratio": red_ratio,
                "brown_ratio": brown_ratio,
                "green_ratio": green_ratio,
                "blue_ratio": blue_ratio,
                "issue_type": issue_type,
                "severity_score": score,
                "priority": _priority(score),
                "recommended_team": recommended_team,
            }
        )

    return pd.DataFrame.from_records(records)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the CivicPulse ML training dataset.")
    parser.add_argument("--rows", type=int, default=1600)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", type=Path, default=Path("ml/data/civic_issues.csv"))
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    data = generate_dataset(rows=args.rows, seed=args.seed)
    data.to_csv(args.output, index=False)
    print(f"Wrote {len(data)} rows to {args.output}")


if __name__ == "__main__":
    main()
