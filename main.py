#!/bin/python3
import sys
import os
import logging
import json_helpers

from car_state import CarState
from car_states import CarStates
from credentials import Credentials

from NativeAPI import WeConnect, VWError

def persistCarStates(carStates: CarStates):
	with open('carStates.json', 'w', buffering=1) as outfile:
		outfile.write(json_helpers.to_json(carStates, unpicklable=False))

def getCarStates() -> CarStates:
	if not os.path.isfile('carStates.json'):
		f = open('carStates.json', 'w')
		f.write('{}')
		f.close()

	with open('carStates.json', 'r', buffering=1) as outfile:
		return json_helpers.from_json(CarStates, outfile.read())

def getCabinHeatingStatus(vwc, vin):
	climaterStatus = vwc.get_climater(vin)['climater']['status']
	state = climaterStatus['climatisationStatusData']['climatisationState']['content'] == 'heating'

	logger.debug("Climater status: " + json_helpers.to_json(climaterStatus, unpicklable=False))

	return state
	
def getLockedStatus(vwc, vin):
	vsr = vwc.get_vsr(vin)
	pvsr = vwc.parse_vsr(vsr)
	doors = pvsr.get('doors',[])
	avdoors = {'left_front':'Left front', 'right_front':'Right front', 'left_rear':'Left rear', 'right_rear':'Right rear', 'trunk':'Trunk'}
	
	logger.debug("Doors status: " + json_helpers.to_json(doors, unpicklable=False))

	for d in avdoors.items():
		locked = doors.get('lock_'+d[0],'')
		if (locked != 'locked'):
			return False
		
	return True

if len(sys.argv) >= 6:
	username = sys.argv[1]
	password = sys.argv[2]
	spin = sys.argv[3]
	command = sys.argv[4]
	value = sys.argv[5]
else:
	exit(1)

vin = ''

if len(sys.argv) >= 7:
	vin = sys.argv[6]

logging.basicConfig(format='[%(asctime)s] [%(name)s::%(levelname)s] %(message)s', datefmt='%d/%m/%Y %H:%M:%S')

logger = logging.getLogger('WeConnect')
logger.setLevel(logging.INFO)

carStates = getCarStates()

try:
	credentials = Credentials(username, password, spin)
	vwc = WeConnect(credentials)
	vwc.login()

	if len(vin) == 0:
		vin = vwc.get_real_car_data()['realCars'][0]['vehicleIdentificationNumber']
		carStates[vin] = CarState()
		logger.debug("VIN: " + vin)
 
	if command == 'locked':
		isLocked = getLockedStatus(vwc, vin)

		if value == '1' and not isLocked:
			response = vwc.lock(vin, action='lock')
			logger.debug(response)
		elif value == '0' and isLocked:
			response = vwc.lock(vin, action='unlock')
			logger.debug(response)
		elif value == 'status':
			pass
		else:
			print('Command: ' + command + ' unknown value: ' + value)
			exit(1)

		carStates[vin].locked = isLocked
		print(json_helpers.to_json(carStates[vin], unpicklable=False))
		persistCarStates(carStates)
	elif command == 'cabin-heating':
		cabinHeatingStatus = getCabinHeatingStatus(vwc, vin)
	
		if value == '1':
			on = vwc.climatisation_v2(vin, action='on', temperature=24.0)
			logger.error(on)
			cabinHeatingStatus = True if (on['action']['actionState'] == 'queued' and on['action']['type'] == 'startClimatisation') else False
		elif value == '0':
			off = vwc.climatisation(vin, action='off')
			logger.error(off)
			cabinHeatingStatus = True if (off['action']['actionState'] == 'queued' and off['action']['type'] == 'stopClimatisation') else False
		elif value == 'status':
			pass
		else:
			print('Command: ' + command + ' unknown value: ' + value)
			exit(1)

		carStates[vin].cabinHeating = cabinHeatingStatus
		print(json_helpers.to_json(carStates[vin], unpicklable=False))
		persistCarStates(carStates)
	else:
		logger.error('Unknown command')

except VWError as e:
	if 'login.error' in e.message:
		logger.error('Failed to login')
	else:
		logger.error("Error: " + e.message)
except Exception as e:
	logger.error("Error: " + e)

 
