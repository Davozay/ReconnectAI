import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


class T(unittest.TestCase):
    def test_x(self):
        print("TestClient:", TestClient, TestClient.__module__)
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x04"
            b"\x00\x00\x00\x03\x08\x02\x00\x00\x00\x00\x00\x00\x00"
        )
        with (
            patch.dict(os.environ, {"META_MODEL_API_KEY": "sk-test"}),
            patch(
                "app.routes.detective.analyze_image_json",
                return_value={"schools": []},
            ),
        ):
            response = client.post(
                "/api/detective/analyze-photo",
                files={"photo": ("pic.png", png, "image/png")},
            )
        print("STATUS:", response.status_code)
        print("TYPE:", type(response), type(response).__module__)
        print("JSONATTR:", response.json)
        print("RAW:", repr(response.content))
        print("PARSED:", repr(response.json()))
