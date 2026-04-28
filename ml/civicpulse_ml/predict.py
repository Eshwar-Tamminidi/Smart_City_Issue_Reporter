"""Prediction CLI for the trained CivicPulse models."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import pandas as pd

from civicpulse_ml.features import CLASSIFIER_FEATURES, DEFAULT_INPUT, REGRESSOR_FEATURES, add_derived_features


def priority_from_score(score: int) -> str:
    if score >= 78:
        return "P1 Emergency"
    if score >= 58:
        return "P2 High"
    if score >= 38:
        return "P3 Normal"
    return "P4 Low"


def severity_label(score: int) -> str:
    if score >= 78:
        return "Critical"
    if score >= 58:
        return "High"
    if score >= 38:
        return "Medium"
    return "Low"


def normalize_payload(payload: dict) -> pd.DataFrame:
    image_stats = payload.get("imageStats") or {}
    normalized = {
        **DEFAULT_INPUT,
        "title": payload.get("title", ""),
        "description": payload.get("description", ""),
        "area": payload.get("area") or payload.get("address") or "Unknown",
        "time_of_day": payload.get("time_of_day", "afternoon"),
        "complaint_age_hours": payload.get("complaint_age_hours", 1),
        "nearby_open_reports": payload.get("nearby_open_reports", 0),
        "brightness": image_stats.get("brightness", payload.get("brightness", DEFAULT_INPUT["brightness"])),
        "edge_density": image_stats.get("edgeDensity", payload.get("edge_density", DEFAULT_INPUT["edge_density"])),
        "red_ratio": image_stats.get("redRatio", payload.get("red_ratio", DEFAULT_INPUT["red_ratio"])),
        "brown_ratio": image_stats.get("brownRatio", payload.get("brown_ratio", DEFAULT_INPUT["brown_ratio"])),
        "green_ratio": image_stats.get("greenRatio", payload.get("green_ratio", DEFAULT_INPUT["green_ratio"])),
        "blue_ratio": image_stats.get("blueRatio", payload.get("blue_ratio", DEFAULT_INPUT["blue_ratio"])),
    }
    normalized["text"] = f"{normalized['title']} {normalized['description']}"
    return add_derived_features(pd.DataFrame([normalized]))


def predict(payload: dict, artifacts_dir: Path) -> dict:
    classifier = joblib.load(artifacts_dir / "issue_type_classifier.joblib")
    regressor = joblib.load(artifacts_dir / "severity_regressor.joblib")
    frame = normalize_payload(payload)

    issue_type = str(classifier.predict(frame[CLASSIFIER_FEATURES])[0])
    if issue_type == "Unsupported":
        probabilities = classifier.predict_proba(frame[CLASSIFIER_FEATURES])[0]
        confidence = int(round(float(probabilities.max()) * 100))
        return {
            "issueType": issue_type,
            "severity": "Low",
            "severityScore": 15,
            "priority": "P4 Low",
            "confidence": max(55, min(99, confidence)),
            "model": "CivicPulse-ExtraTrees-v3",
            "explanation": "The upload appears to be non-civic content or not a reportable public issue. Please upload the actual problem area.",
            "unsupported": True,
        }

    regressor_frame = frame.copy()
    regressor_frame["issue_type_hint"] = issue_type
    score = int(round(float(regressor.predict(regressor_frame[REGRESSOR_FEATURES])[0])))
    score = max(15, min(100, score))
    probabilities = classifier.predict_proba(frame[CLASSIFIER_FEATURES])[0]
    confidence = int(round(float(probabilities.max()) * 100))

    return {
        "issueType": issue_type,
        "severity": severity_label(score),
        "severityScore": score,
        "priority": priority_from_score(score),
        "confidence": max(55, min(99, confidence)),
        "model": "CivicPulse-ExtraTrees-v3",
        "explanation": (
            f"Predicted {issue_type.lower()} using a trained scikit-learn model over report text, "
            "visual image statistics, location context, report age, and nearby open complaints."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CivicPulse ML inference from JSON.")
    parser.add_argument("--input", type=str, required=True, help="JSON payload or path to a JSON file.")
    parser.add_argument("--artifacts", type=Path, default=Path("ml/artifacts"))
    args = parser.parse_args()

    input_path = Path(args.input)
    payload = json.loads(input_path.read_text(encoding="utf-8") if input_path.exists() else args.input)
    print(json.dumps(predict(payload, args.artifacts)))


if __name__ == "__main__":
    main()
