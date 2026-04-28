<<<<<<< HEAD
# Smart_City_Issue_Reporter
A full-stack ML based web application that enables citizens to report, track, and manage civic issues such as potholes, garbage, water leaks, and streetlight failures. The platform provides a seamless interface for users to submit complaints with location details, while authorities can monitor, prioritize, and resolve issues efficiently.
=======
# CivicPulse ML: Civic Issue Type and Priority Prediction

CivicPulse ML is a machine-learning project for predicting civic complaint type and response priority from report text, image-derived statistics, location context, report age, and nearby unresolved complaints.

The web app is only a demo interface. The real project now lives in `ml/`: it generates a dataset, trains scikit-learn models, writes evaluation metrics, saves model artifacts, and exposes a prediction CLI that the backend uses when the model has been trained.

## What This Project Does

- Generates a reproducible civic-issue dataset with 1,600 labeled examples
- Trains an issue-type classifier for potholes, garbage, broken lights, water leaks, and road blocks
- Trains a severity-score regressor for 0-100 response urgency
- Converts severity score into Low, Medium, High, or Critical
- Converts severity score into P1, P2, P3, or P4 priority
- Saves trained `.joblib` model artifacts in `ml/artifacts/`
- Writes evaluation metrics to `ml/reports/metrics.json`
- Provides a JSON prediction CLI for testing and integration
- Optionally serves a full-stack demo app where citizens submit complaints and admins review priorities

## ML Workflow

Install dependencies:

```bash
pip3 install -r ml/requirements.txt
npm run install:all
```

Generate the dataset:

```bash
npm run ml:generate
```

Train and evaluate the model:

```bash
npm run ml:train
```

Run a prediction:

```bash
npm run ml:predict -- --input '{"title":"Deep pothole near school","description":"Dangerous road crater causing traffic","address":"MG Road","imageStats":{"brightness":55,"edgeDensity":0.76,"brownRatio":0.72}}'
```

Run the ML pipeline test:

```bash
npm run ml:test
```

## Current Model Results

The latest local training run produced:

```text
Rows: 1600
Test rows: 320
Issue type accuracy: 1.0000
Severity MAE: 5.3180
Severity R2: 0.5413
```

The dataset is synthetic and intentionally structured for a college/demo ML project. For a production-grade project, replace `ml/data/civic_issues.csv` with real municipal complaint data and retrain with the same commands.

## Project Structure

```text
.
├── ml/
│   ├── civicpulse_ml/
│   │   ├── data.py        # synthetic dataset generation
│   │   ├── features.py    # feature schema
│   │   ├── train.py       # training, evaluation, artifact writing
│   │   └── predict.py     # JSON inference CLI
│   ├── artifacts/         # trained joblib models
│   ├── data/              # generated CSV dataset
│   ├── reports/           # metrics JSON
│   ├── requirements.txt
│   └── test_ml_pipeline.py
├── backend/               # optional Node API and static server
├── frontend/              # optional React demo UI
├── package.json
└── README.md
```

## Optional Web Demo

Build the React frontend:

```bash
npm run build
```

Start the backend:

```bash
npm start
```

Open:

```text
http://127.0.0.1:3000
```

Demo admin:

```text
Email: admin@city.gov
Password: admin123
```

Demo citizen:

```text
Email: citizen@example.com
Password: citizen123
```

When trained model artifacts exist in `ml/artifacts/`, the backend calls `ml/civicpulse_ml/predict.py`. If artifacts are missing or inference fails, it falls back to the old heuristic so the demo still runs.

## API Overview

- `POST /api/register`: create citizen account
- `POST /api/login`: login citizen or admin
- `GET /api/me`: validate current session
- `POST /api/logout`: logout
- `GET /api/issues`: citizen sees own reports, admin sees all reports
- `POST /api/issues`: submit a complaint and receive ML prediction
- `PATCH /api/issues`: admin updates status and assigned team
- `GET /api/analytics`: admin dashboard metrics and geo-clusters

## Notes

- The generated dataset is stored at `ml/data/civic_issues.csv`.
- Trained artifacts are stored at `ml/artifacts/issue_type_classifier.joblib` and `ml/artifacts/severity_regressor.joblib`.
- Evaluation output is stored at `ml/reports/metrics.json`.
- The local app database is stored at `backend/data/db.json`.
>>>>>>> a703390 (Initial commit)
