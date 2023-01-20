class CarState:
    cabinHeating = None
    locked = None
    def __init__(self, cabinHeating: int=None, locked: int=None):
        self.cabinHeating = cabinHeating
        self.locked = locked 