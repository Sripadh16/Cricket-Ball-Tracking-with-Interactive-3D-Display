import os
import sys
from unittest.mock import Mock

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))
from services.ball_tracking_service import BallTrackingService


def test_learned_ball_wins_over_high_scoring_shirt_and_model_misses_stay_missing():
    service = BallTrackingService.__new__(BallTrackingService)
    service.yolo_detector = object()
    service.min_confidence = 0.3
    ball = dict(x=120, y=160, confidence=0.55, method='yolo')
    service._detect_ball_yolo = Mock(return_value=ball)
    service._detect_ball_by_color_advanced = Mock(return_value=dict(x=230, y=290, confidence=0.95))
    frame = np.zeros((480, 852, 3), dtype=np.uint8)
    assert service._detect_ball_comprehensive(frame) is ball
    service._detect_ball_by_color_advanced.assert_not_called()
    service._detect_ball_yolo.return_value = None
    assert service._detect_ball_comprehensive(frame) is None
    service._detect_ball_yolo.return_value = dict(x=108, y=461, confidence=0.8)
    assert service._detect_ball_comprehensive(frame) is None
