from typing import TypedDict
from car_state import CarState


class CarStates(TypedDict):
    vin: str
    state: CarState
