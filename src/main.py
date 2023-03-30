#!/bin/python3
import sys
import os
import logging
import json_helpers
import time

from car_state import CarState
from car_states import CarStates
from credentials import Credentials

from NativeAPI import WeConnect, VWError

# Ensure working directory is same as this files location
if os.path.dirname(sys.argv[0]):
    os.chdir(os.path.dirname(sys.argv[0]))


def persistCarStates(carStates: CarStates):
    with open('carStates.json', 'w', buffering=1) as outfile:
        outfile.write(json_helpers.to_json(carStates, unpicklable=True))


def getCarStates() -> CarStates:
    if not os.path.isfile('carStates.json'):
        f = open('carStates.json', 'x')
        f.close()
        return CarStates()

    with open('carStates.json', 'r', buffering=1) as outfile:
        try:
            return CarStates(json_helpers.from_json(CarStates, outfile.read()))
        except:
            return CarStates()


def setClimatisationStatus(vwc, vin):
    climaterStatus = vwc.get_climater(vin)['climater']['status']

    climatisation = climaterStatus['climatisationStatusData']['climatisationState']['content'] == 'heating'
    frontWindowHeating = climaterStatus['windowHeatingStatusData']['windowHeatingStateFront']['content'] == 'on'
    rearWindowHeating = climaterStatus['windowHeatingStatusData']['windowHeatingStateRear']['content'] == 'on'

    # and frontWindowHeating It seems front is not enabled while climatisation is.
    carStates[vin].windowHeating = rearWindowHeating
    carStates[vin].climatisation = climatisation

    logger.info('Climater status: ' +
                json_helpers.to_json(climaterStatus, unpicklable=False))


def setLockedStatus(vwc, vin):
    vsr = vwc.get_vsr(vin)
    pvsr = vwc.parse_vsr(vsr)
    doors = pvsr.get('doors', [])
    avdoors = {'left_front': 'Left front', 'right_front': 'Right front',
               'left_rear': 'Left rear', 'right_rear': 'Right rear', 'trunk': 'Trunk'}

    logger.info('Doors status: ' +
                json_helpers.to_json(doors, unpicklable=False))

    for d in avdoors.items():
        locked = doors.get('lock_'+d[0], '')
        if (locked != 'locked'):
            carStates[vin].locked = False
            return

    carStates[vin].locked = True


def setChargingStatus(vwc, vin):
    chargerStatus = vwc.get_charger(vin)['charger']['status']
    charging = chargerStatus['chargingStatusData']['chargingState']['content'] != 'off'
    batteryLevel = chargerStatus['batteryStatusData']['stateOfCharge']['content']

    logger.info('Charging status: ' +
                json_helpers.to_json(chargerStatus, unpicklable=False))

    carStates[vin].charging = charging
    carStates[vin].batteryLevel = batteryLevel


def updateWindowHeating(vwc, vin, config, value):
    if value == '1':
        if not carStates[vin].windowHeating:
            windowHeatingOn = vwc.window_melt(vin, action='on')
            on = windowHeatingOn['action']['actionState'] == 'queued' and windowHeatingOn['action']['type'] == 'startWindowHeating'
            carStates[vin].windowHeating = on
    elif value == '0':
        if carStates[vin].windowHeating:
            windowHeatingOff = vwc.window_melt(vin, action='off')
            off = windowHeatingOff['action']['actionState'] == 'queued' and windowHeatingOff['action']['type'] == 'stopWindowHeating'
            carStates[vin].windowHeating = off
    elif value != 'status':
        logger.error('Command: ' + command + ' unknown value: ' + value)
        exit(1)


def updateClimatisation(vwc, vin, config, value):
    if value == '1':
        if not carStates[vin].climatisation:
            climatisationOn = vwc.climatisation_v2(
                vin, action='on', temperature=config['temperature'])
            logger.info(climatisationOn)
            on = climatisationOn['action']['actionState'] == 'queued' and climatisationOn['action']['type'] == 'startClimatisation'
            if on:
                carStates[vin].climatisation = True
    elif value == '0':
        if carStates[vin].climatisation:
            climatisationOff = vwc.climatisation(vin, action='off')
            logger.info(climatisationOff)
            climatisationOff['action']['actionState'] == 'queued' and climatisationOff['action']['type'] == 'stopClimatisation'
            if off:
                carStates[vin].climatisation = False
    elif value != 'status':
        logger.error('Command: ' + command + ' unknown value: ' + value)
        exit(1)


logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(name)s::%(levelname)s] %(message)s',
    datefmt='%d/%m/%Y %H:%M:%S',
    handlers=[
        logging.FileHandler('weconnect.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger('WeConnect')


if len(sys.argv) >= 4:
    config = json_helpers.decode(sys.argv[1])
    command = sys.argv[2]
    value = str(sys.argv[3])
else:
    exit(1)


carStates = getCarStates()

try:
    credentials = Credentials(
        config['username'], config['password'], config['spin'])
    vwc = WeConnect(credentials)
    vwc.login()

    vin = config['vin']
    if len(vin) == 0:
        vin = vwc.get_real_car_data(
        )['realCars'][0]['vehicleIdentificationNumber']

        if vin not in carStates:
            carStates[vin] = CarState()

        logger.info('VIN: ' + vin)
    elif vin not in carStates:
        carStates[vin] = CarState()

    # Get status for all or specific command
    if (command == ''):
        setLockedStatus(vwc, vin)
        setClimatisationStatus(vwc, vin)
        setChargingStatus(vwc, vin)
    elif command == 'locked':
        setLockedStatus(vwc, vin)
    elif command == 'charging':
        setChargingStatus(vwc, vin)
    elif command == 'climatisation':
        setClimatisationStatus(vwc, vin)

    # Update based on a specific command
    if command == 'charging':
        if value == '1':
            if not carStates[vin].charging:
                chargingOn = vwc.battery_charge(vin, action='on')
                logger.info(chargingOn)
                carStates[vin].charging = True if (chargingOn['action']['actionState'] ==
                                                   'queued' and chargingOn['action']['type'] == 'start') else True

        elif value == '0':
            if carStates[vin].charging:
                chargingOff = vwc.battery_charge(vin, action='off')
                logger.info(chargingOff)
                carStates[vin].charging = False if (chargingOff['action']['actionState'] ==
                                                    'queued' and chargingOff['action']['type'] == 'stop') else True
        elif value != 'status':
            logger.error('Command: ' + command + ' unknown value: ' + value)
            exit(1)

    elif command == 'locked':
        if value == '1':
            if not carStates[vin].locked:
                response = vwc.lock(vin, action='lock')
                carStates[vin].locked = True
                logger.info(response)
        elif value == '0':
            if carStates[vin].locked:
                response = vwc.lock(vin, action='unlock')
                carStates[vin].locked = False
                logger.info(response)
        elif value != 'status':
            logger.error('Command: ' + command + ' unknown value: ' + value)
            exit(1)

    elif command == 'climatisation':
        updateClimatisation(vwc, vin, config, value)
        if config['combineHeating']:
            updateWindowHeating(vwc, vin, config, value)

    elif command == 'window-heating':
        updateWindowHeating(vwc, vin, config, value)

    elif command != '':
        logger.error('Unknown command')
        exit(1)

    print(json_helpers.to_json(carStates[vin], unpicklable=False))
    persistCarStates(carStates)

except VWError as e:
    if 'login.error' in e.message:
        logger.error('VWError: Failed to login')
    else:
        logger.error('VWError: ' + e.message)
except Exception as e:
    logger.error('Fatal Error: ' + str(e))
