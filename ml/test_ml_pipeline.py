import json
import tempfile
import unittest
from pathlib import Path

from civicpulse_ml.predict import predict
from civicpulse_ml.train import train


class CivicPulseMLPipelineTest(unittest.TestCase):
    def test_train_and_predict_pipeline(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            metrics = train(
                data_path=root / "civic_issues.csv",
                artifacts_dir=root / "artifacts",
                reports_dir=root / "reports",
                rows=300,
                seed=7,
            )
            self.assertGreater(metrics["issue_type_accuracy"], 0.85)
            self.assertLess(metrics["severity_mae"], 9)

            prediction = predict(
                {
                    "title": "Deep pothole near school",
                    "description": "Large dangerous pothole causing traffic at night.",
                    "address": "MG Road",
                    "imageStats": {
                        "brightness": 55,
                        "edgeDensity": 0.76,
                        "brownRatio": 0.72,
                    },
                },
                artifacts_dir=root / "artifacts",
            )
            self.assertEqual(prediction["issueType"], "Pothole")
            self.assertIn(prediction["priority"], {"P1 Emergency", "P2 High", "P3 Normal", "P4 Low"})

            unsupported_prediction = predict(
                {
                    "title": "Porsche concept art",
                    "description": "Studio render of a red sports car, not a street problem.",
                    "address": "MG Road",
                    "imageStats": {
                        "brightness": 108,
                        "edgeDensity": 0.24,
                        "redRatio": 0.41,
                        "brownRatio": 0.04,
                        "blueRatio": 0.12,
                    },
                },
                artifacts_dir=root / "artifacts",
            )
            self.assertEqual(unsupported_prediction["issueType"], "Unsupported")
            self.assertTrue(unsupported_prediction["unsupported"])
            json.dumps(prediction)


if __name__ == "__main__":
    unittest.main()
