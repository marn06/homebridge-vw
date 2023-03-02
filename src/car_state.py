class CarState:
    climatisation = None
    locked = None
    def __init__(self, climatisation: int=None, locked: int=None):
        self.climatisation = climatisation
        self.locked = locked 