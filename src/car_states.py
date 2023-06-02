import sys

if sys.version_info >= (3, 8):
    from typing import TypedDict, Literal, overload  # pylint: disable=no-name-in-module
else:
    from typing_extensions import TypedDict, Literal, overload
from car_state import CarState


class CarStates(TypedDict):
    vin: str
    state: CarState
