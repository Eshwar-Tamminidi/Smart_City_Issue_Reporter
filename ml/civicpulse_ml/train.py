"""Train and evaluate the CivicPulse machine-learning models."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesClassifier, ExtraTreesRegressor
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, classification_report, mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from civicpulse_ml.data import generate_dataset
from civicpulse_ml.features import (
    CLASSIFIER_FEATURES,
    CATEGORICAL_FEATURES,
    MODEL_FEATURES,
    NUMERIC_FEATURES,
    REGRESSOR_CATEGORICAL_FEATURES,
    REGRESSOR_FEATURES,
    add_derived_features,
)

RAW_DATA_COLUMNS = [
    "title",
    "description",
    "area",
    "time_of_day",
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
    "issue_type",
    "severity_score",
    "priority",
]


def build_preprocessor(categorical_features: list[str]) -> ColumnTransformer:
    numeric_pipe = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )
    categorical_pipe = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore")),
        ]
    )
    return ColumnTransformer(
        transformers=[
            ("text", TfidfVectorizer(ngram_range=(1, 2), min_df=2), "text"),
            ("numeric", numeric_pipe, NUMERIC_FEATURES),
            ("categorical", categorical_pipe, categorical_features),
        ]
    )


def priority_from_score(score: int) -> str:
    if score >= 78:
        return "P1 Emergency"
    if score >= 58:
        return "P2 High"
    if score >= 38:
        return "P3 Normal"
    return "P4 Low"


def train(data_path: Path, artifacts_dir: Path, reports_dir: Path, rows: int, seed: int) -> dict:
    if data_path.exists():
        data = pd.read_csv(data_path)
        missing_raw = set(RAW_DATA_COLUMNS) - set(data.columns)
        if missing_raw:
            data = generate_dataset(rows=rows, seed=seed)
            data_path.parent.mkdir(parents=True, exist_ok=True)
            data.to_csv(data_path, index=False)
    else:
        data = generate_dataset(rows=rows, seed=seed)
        data_path.parent.mkdir(parents=True, exist_ok=True)
        data.to_csv(data_path, index=False)
    data["text"] = data["title"].fillna("") + " " + data["description"].fillna("")
    data = add_derived_features(data)

    missing = set(MODEL_FEATURES + ["issue_type", "severity_score", "priority"]) - set(data.columns)
    if missing:
        raise ValueError(f"Dataset is missing columns: {sorted(missing)}")

    x_train, x_test, y_type_train, y_type_test, y_score_train, y_score_test = train_test_split(
        data[CLASSIFIER_FEATURES],
        data["issue_type"],
        data["severity_score"],
        test_size=0.2,
        random_state=seed,
        stratify=data["issue_type"],
    )

    classifier = Pipeline(
        steps=[
            ("features", build_preprocessor(CATEGORICAL_FEATURES)),
            ("model", ExtraTreesClassifier(n_estimators=320, random_state=seed, class_weight="balanced")),
        ]
    )

    classifier.fit(x_train, y_type_train)
    type_predictions = classifier.predict(x_test)
    train_type_hints = classifier.predict(x_train)
    test_type_hints = type_predictions

    regressor_train = x_train.copy()
    regressor_test = x_test.copy()
    regressor_train["issue_type_hint"] = train_type_hints
    regressor_test["issue_type_hint"] = test_type_hints

    regressor = Pipeline(
        steps=[
            ("features", build_preprocessor(REGRESSOR_CATEGORICAL_FEATURES)),
            ("model", ExtraTreesRegressor(n_estimators=320, random_state=seed)),
        ]
    )
    regressor.fit(regressor_train[REGRESSOR_FEATURES], y_score_train)

    score_predictions = regressor.predict(regressor_test[REGRESSOR_FEATURES])
    rounded_scores = [max(15, min(100, int(round(score)))) for score in score_predictions]
    priority_predictions = [priority_from_score(score) for score in rounded_scores]
    metrics = {
        "rows": int(len(data)),
        "test_rows": int(len(x_test)),
        "issue_type_accuracy": round(float(accuracy_score(y_type_test, type_predictions)), 4),
        "severity_mae": round(float(mean_absolute_error(y_score_test, score_predictions)), 4),
        "severity_r2": round(float(r2_score(y_score_test, score_predictions)), 4),
        "priority_accuracy": round(float(accuracy_score(data.loc[y_score_test.index, "priority"], priority_predictions)), 4),
        "classification_report": classification_report(y_type_test, type_predictions, output_dict=True),
    }

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(classifier, artifacts_dir / "issue_type_classifier.joblib")
    joblib.dump(regressor, artifacts_dir / "severity_regressor.joblib")
    (reports_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Train CivicPulse issue type and severity models.")
    parser.add_argument("--data", type=Path, default=Path("ml/data/civic_issues.csv"))
    parser.add_argument("--artifacts", type=Path, default=Path("ml/artifacts"))
    parser.add_argument("--reports", type=Path, default=Path("ml/reports"))
    parser.add_argument("--rows", type=int, default=1600)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    metrics = train(args.data, args.artifacts, args.reports, args.rows, args.seed)
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
