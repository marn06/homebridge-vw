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
    state = climaterStatus['climatisationStatusData']['climatisationState']['content'] == 'heating'
    #state = climaterStatus['windowHeatingStatusData']['windowHeatingStateFront']['content'] == 'on'
    state = climaterStatus['windowHeatingStatusData']['windowHeatingStateRear']['content'] == 'on'

    logger.info('Climater status: ' +
                json_helpers.to_json(climaterStatus, unpicklable=False))

    carStates[vin].climatisation = state


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


if len(sys.argv) >= 6:
    username = sys.argv[1]
    password = sys.argv[2]
    spin = sys.argv[3]
    command = sys.argv[4]
    value = str(sys.argv[5])
else:
    exit(1)

vin = ''
temperature = 24.0

if len(sys.argv) >= 7:
    vin = sys.argv[6]

if len(sys.argv) >= 8:
    temperature = float(sys.argv[7])

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

carStates = getCarStates()

try:
    credentials = Credentials(username, password, spin)
    vwc = WeConnect(credentials)
    vwc.login()

    if len(vin) == 0:
        vin = vwc.get_real_car_data(
        )['realCars'][0]['vehicleIdentificationNumber']

        if vin not in carStates:
            carStates[vin] = CarState()

        logger.info('VIN: ' + vin)
    elif vin not in carStates:
        carStates[vin] = CarState()

    setLockedStatus(vwc, vin)
    setClimatisationStatus(vwc, vin)
    setChargingStatus(vwc, vin)

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
        if value == '1':
            if not carStates[vin].climatisation:
                climatisationOn = vwc.climatisation_v2(
                    vin, action='on', temperature=temperature)
                time.sleep(1)
                windowHeatingOn = vwc.window_melt(vin, action='on')
                time.sleep(1)

                logger.info(climatisationOn)
                logger.info(windowHeatingOn)

                t1 = climatisationOn['action']['actionState'] == 'queued' and climatisationOn['action']['type'] == 'startClimatisation'
                t2 = windowHeatingOn['action']['actionState'] == 'queued' and windowHeatingOn['action']['type'] == 'startWindowHeating'

                carStates[vin].climatisation = True if (
                    t1 and t2) else False  # Return State of Heating
        elif value == '0':
            if carStates[vin].climatisation:
                climatisationOff = vwc.climatisation(vin, action='off')
                time.sleep(1)
                windowHeatingOff = vwc.window_melt(vin, action='off')
                time.sleep(1)

                logger.info(climatisationOff)
                logger.info(windowHeatingOff)

                t1 = climatisationOff['action']['actionState'] == 'queued' and climatisationOff['action']['type'] == 'stopClimatisation'
                t2 = windowHeatingOff['action']['actionState'] == 'queued' and windowHeatingOff['action']['type'] == 'stopWindowHeating'
                carStates[vin].climatisation = False if (
                    t1 and t2) else True  # Return State of Heating
        elif value != 'status':
            logger.error('Command: ' + command + ' unknown value: ' + value) 
            exit(1)
    else:
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
