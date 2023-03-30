class CarState:
    climatisation = None
    locked = None

    def __init__(self, climatisation: int = None, windowHeating: int = None, locked: int = None, batteryLevel: int = None, charging: int = None):
        self.climatisation = climatisation
        self.windowHeating = windowHeating
        self.locked = locked
        self.batteryLevel = batteryLevel
        self.charging = charging
