"""Feature schema and feature engineering shared by training and inference."""

from __future__ import annotations

import re

import pandas as pd

from civicpulse_ml.data import ISSUE_PROFILES, RISK_WORDS


TEXT_FEATURES = ["text"]
CATEGORICAL_FEATURES = ["area", "time_of_day"]
BASE_NUMERIC_FEATURES = [
    "population_density",
    "distance_to_school_km",
    "complaint_age_hours",
    "nearby_open_reports",
    "brightness",
    "edge_density",
    "red_ratio",
    "brown_ratio",
    "green_ratio",
    "blue_ratio",
]
ISSUE_KEYWORD_FEATURES = [f"kw_{issue.lower().replace(' ', '_')}" for issue in ISSUE_PROFILES]
ENGINEERED_NUMERIC_FEATURES = ["risk_term_count"] + ISSUE_KEYWORD_FEATURES
NUMERIC_FEATURES = BASE_NUMERIC_FEATURES + ENGINEERED_NUMERIC_FEATURES

CLASSIFIER_FEATURES = TEXT_FEATURES + CATEGORICAL_FEATURES + NUMERIC_FEATURES
REGRESSOR_CATEGORICAL_FEATURES = CATEGORICAL_FEATURES + ["issue_type_hint"]
REGRESSOR_FEATURES = TEXT_FEATURES + REGRESSOR_CATEGORICAL_FEATURES + NUMERIC_FEATURES

MODEL_FEATURES = CLASSIFIER_FEATURES

DEFAULT_INPUT = {
    "text": "",
    "title": "",
    "description": "",
    "area": "Unknown",
    "time_of_day": "afternoon",
    "population_density": 0.6,
    "distance_to_school_km": 1.5,
    "complaint_age_hours": 1,
    "nearby_open_reports": 0,
    "brightness": 100,
    "edge_density": 0.3,
    "red_ratio": 0.1,
    "brown_ratio": 0.1,
    "green_ratio": 0.1,
    "blue_ratio": 0.1,
}


def add_derived_features(frame: pd.DataFrame) -> pd.DataFrame:
    enriched = frame.copy()
    if "text" not in enriched.columns:
        enriched["text"] = enriched.get("title", "").fillna("") + " " + enriched.get("description", "").fillna("")
    text_series = enriched["text"].fillna("").astype(str).str.lower()
    enriched["risk_term_count"] = text_series.apply(lambda value: sum(term in value for term in RISK_WORDS))

    for issue, profile in ISSUE_PROFILES.items():
        feature_name = f"kw_{issue.lower().replace(' ', '_')}"
        terms = [re.escape(term.lower()) for term in profile["words"]]
        pattern = "|".join(terms)
        enriched[feature_name] = text_series.str.count(pattern)

    return enriched
