"""Shared --study-area CLI parsing for standalone pipeline step scripts."""

import argparse

from pipeline.config import STUDY_AREAS


def study_area_arg() -> str:
    parser = argparse.ArgumentParser()
    parser.add_argument("--study-area", default="flores", choices=sorted(STUDY_AREAS))
    return parser.parse_args().study_area
