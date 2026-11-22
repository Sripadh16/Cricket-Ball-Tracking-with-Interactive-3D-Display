"""Junk detections bridged onto a delivery are removed; a ball briefly hidden in flight is kept."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from services.delivery_tracker import _trim_chain_junk  # noqa: E402

DIAG = 2203.0


def node(frame, x, y):
    return {"frame": frame, "sx": float(x), "sy": float(y)}


def flight(frames):
    return [node(f, 900 - 25 * (f - 100), 100 + 30 * (f - 100)) for f in frames]


def test_removes_junk_on_both_sides_of_the_flight():
    before = [node(95, 1736, 153), node(97, 1257, 286)]
    ball = flight(range(100, 116))
    after = [node(118, 443, 284), node(121, 512, 280), node(124, 635, 262), node(127, 782, 265)]
    assert _trim_chain_junk(before + ball + after, DIAG) == ball


def test_keeps_a_ball_hidden_for_a_few_frames():
    ball = flight([*range(100, 106), *range(110, 118)])
    assert _trim_chain_junk(ball, DIAG) == ball


def test_short_chains_are_untouched():
    ball = flight(range(100, 105))
    assert _trim_chain_junk(ball, DIAG) == ball
