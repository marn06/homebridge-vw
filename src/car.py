import sys
import os
import logging
import json_helpers
import time

from NativeAPI import WeConnect, VWError
from credentials import Credentials
from car_state import CarState
from car_states import CarStates


class Car:
    def __init__(self, logger):
        self.logger = logger
        self.carStates = self.getCarStates()

    def executeCommand(self, config, command, value):
        credentials = Credentials(
            config['username'], config['password'], config['spin'])
        vwc = WeConnect(credentials)
        vwc.set_logging_level(self.logger.level)
        vwc.login()

        vin = self.getVin(config, vwc)

        self.logger.debug(command)
        if (command == ''):  # Get status of everything
            self.setLockedStatus(vwc, vin)
            self.setClimatisationStatus(vwc, vin)
            self.setChargingStatus(vwc, vin)
        elif command == 'locked':
            self.setLockedStatus(vwc, vin)
            self.updateLocked(vwc, vin, value)
        elif command == 'charging':
            self.setChargingStatus(vwc, vin)
            self.updateCharging(vwc, vin, value)
        elif command == 'climatisation':
            self.setClimatisationStatus(vwc, vin)
            self.updateClimatisation(vwc, vin, config, value)
            if config['combineHeating']:
                self.updateWindowHeating(vwc, vin, value)
        elif command == 'window-heating':
            self.setClimatisationStatus(vwc, vin)
            self.updateWindowHeating(vwc, vin, value)
        else:
            raise Exception('Unknown command')

        print(json_helpers.to_json(self.carStates[vin], unpicklable=False))
        self.persistCarStates()

    def persistCarStates(self):
        with open('carStates.json', 'w', buffering=1) as outfile:
            outfile.write(json_helpers.to_json(
                self.carStates, unpicklable=True))

    def getCarStates(self) -> CarStates:
        if not os.path.isfile('carStates.json'):
            f = open('carStates.json', 'x')
            f.close()
            return CarStates()

        with open('carStates.json', 'r', buffering=1) as outfile:
            try:
                return CarStates(json_helpers.from_json(CarStates, outfile.read()))
            except:
                return CarStates()

    def getVin(self, config, vwc):
        vin = ""
        
        if ('vin' in config):
            vin = config['vin']
        
        if len(vin) == 0:
            vin = vwc.get_real_car_data(
            )['realCars'][0]['vehicleIdentificationNumber']

            if vin not in self.carStates:
                self.carStates[vin] = CarState()

            self.logger.info('VIN: ' + vin)
        elif vin not in self.carStates:
            self.carStates[vin] = CarState()

        return vin

    def setClimatisationStatus(self, vwc, vin):
        climaterStatus = vwc.get_climater(vin)['climater']['status']

        climatisation = False
        windowHeating = False

        try:
            climatisation = climaterStatus['climatisationStatusData']['climatisationState']['content'] == 'heating'
        except:
            pass

        try:
            frontWindowHeating = climaterStatus['windowHeatingStatusData']['windowHeatingStateFront']['content'] == 'on'
            rearWindowHeating = climaterStatus['windowHeatingStatusData']['windowHeatingStateRear']['content'] == 'on'
            windowHeating = rearWindowHeating or frontWindowHeating
        except:
            pass

        self.carStates[vin].windowHeating = windowHeating
        self.carStates[vin].climatisation = climatisation

        self.logger.debug('Climater status: ' +
                          json_helpers.to_json(climaterStatus, unpicklable=False))

    def setLockedStatus(self, vwc, vin):
        vsr = vwc.get_vsr(vin)
        pvsr = vwc.parse_vsr(vsr)
        doors = pvsr.get('doors', [])
        avdoors = {'left_front': 'Left front', 'right_front': 'Right front',
                   'left_rear': 'Left rear', 'right_rear': 'Right rear', 'trunk': 'Trunk'}

        self.logger.debug('Doors status: ' +
                          json_helpers.to_json(doors, unpicklable=False))

        for d in avdoors.items():
            locked = doors.get('lock_'+d[0], '')
            if (locked != 'locked'):
                self.carStates[vin].locked = False
                return

        self.carStates[vin].locked = True

    def setChargingStatus(self, vwc, vin):
        chargerStatus = vwc.get_charger(vin)['charger']['status']
        charging = chargerStatus['chargingStatusData']['chargingState']['content'] != 'off'
        batteryLevel = chargerStatus['batteryStatusData']['stateOfCharge']['content']

        self.logger.debug('Charging status: ' +
                          json_helpers.to_json(chargerStatus, unpicklable=False))

        self.carStates[vin].charging = charging
        self.carStates[vin].batteryLevel = batteryLevel

    def updateLocked(self, vwc, vin, value):
        if value == '1':
            if not self.carStates[vin].locked:
                response = vwc.lock(vin, action='lock')
                self.carStates[vin].locked = True
                self.logger.debug(response)
        elif value == '0':
            if self.carStates[vin].locked:
                response = vwc.lock(vin, action='unlock')
                self.carStates[vin].locked = False
                self.logger.debug(response)

    def updateCharging(self, vwc, vin, value):
        if value == '1':
            if not self.carStates[vin].charging:
                chargingOn = vwc.battery_charge(vin, action='on')
                self.logger.debug(chargingOn)
                self.carStates[vin].charging = True if (chargingOn['action']['actionState'] ==
                                                        'queued' and chargingOn['action']['type'] == 'start') else True

        elif value == '0':
            if self.carStates[vin].charging:
                chargingOff = vwc.battery_charge(vin, action='off')
                self.logger.debug(chargingOff)
                self.carStates[vin].charging = False if (chargingOff['action']['actionState'] ==
                                                         'queued' and chargingOff['action']['type'] == 'stop') else True

    def updateWindowHeating(self, vwc, vin, value):
        if value == '1':
            if not self.carStates[vin].windowHeating:
                windowHeatingOn = vwc.window_melt(vin, action='on')
                on = windowHeatingOn['action']['actionState'] == 'queued' and windowHeatingOn['action']['type'] == 'startWindowHeating'
                self.carStates[vin].windowHeating = on
        elif value == '0':
            if self.carStates[vin].windowHeating:
                windowHeatingOff = vwc.window_melt(vin, action='off')
                off = windowHeatingOff['action']['actionState'] == 'queued' and windowHeatingOff['action']['type'] == 'stopWindowHeating'
                self.carStates[vin].windowHeating = off
        elif value != 'status':
            raise Exception('Command: ' + 'window-heating' +
                            ' unknown value: ' + str(value))

    def updateClimatisation(self, vwc, vin, config, value):
        if value == '1':
            if not self.carStates[vin].climatisation:
                climatisationOn = vwc.climatisation_v2(
                    vin, action='on', temperature=config['temperature'])
                self.logger.debug(climatisationOn)
                on = climatisationOn['action']['actionState'] == 'queued' and climatisationOn['action']['type'] == 'startClimatisation'
                if on:
                    self.carStates[vin].climatisation = True
        elif value == '0':
            if self.carStates[vin].climatisation:
                climatisationOff = vwc.climatisation(vin, action='off')
                self.logger.debug(climatisationOff)
                off = climatisationOff['action']['actionState'] == 'queued' and climatisationOff['action']['type'] == 'stopClimatisation'
                if off:
                    self.carStates[vin].climatisation = False
        elif value != 'status':
            raise Exception('Command: ' + 'climatisation' +
                            ' unknown value: ' + str(value))
