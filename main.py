#!/bin/python3
import sys
import os
import logging
import json_helpers

from car_state import CarState
from car_states import CarStates
from credentials import Credentials

from NativeAPI import WeConnect, VWError

vin = ''

if len(sys.argv) >= 6:
	username = sys.argv[1]
	password = sys.argv[2]
	spin = sys.argv[3]
	command = sys.argv[4]
	value = sys.argv[5]
else:
	exit(1)

if len(sys.argv) >= 7:
	vin = sys.argv[6]

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

	if (state):
		return 1
	else:
		return 0 
	
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

logging.basicConfig(format='[%(asctime)s] [%(name)s::%(levelname)s] %(message)s', datefmt='%d/%m/%Y %H:%M:%S')

logger = logging.getLogger('Middleware')
logger.setLevel(logging.INFO)

carStates = getCarStates()

try:
	credentials = Credentials(username, password, spin)
	vwc = WeConnect(credentials)
	vwc.login()

	if len(vin) == 0:
		vin = vwc.get_real_car_data()['realCars'][0]['vehicleIdentificationNumber']
		carStates[vin] = CarState()

	if command == 'locked':
		isLocked = getLockedStatus(vwc, vin)

		if value == '1':
			if not isLocked:
				vwc.lock(vin, action='lock')
		elif value == '0':
			if isLocked:
				vwc.lock(vin, action='unlock')
		elif value == 'status':
			pass
		else:
			print('command: ' + command + ' unknown value: ' + value)

		carStates[vin].locked = '1' if isLocked else '0'
		print(json_helpers.to_json(carStates[vin], unpicklable=False))
		persistCarStates(carStates)
	elif command == 'cabin-heating':
		cabinHeatingStatus = getCabinHeatingStatus(vwc, vin)
	
		if value == '1':
			on = vwc.climatisation_v2(vin, action='on', temperature=24.0)
			logger.error(on)
			cabinHeatingStatus = '1' if (on['action']['actionState'] == 'queued' and on['action']['type'] == 'startClimatisation') else '0'
		elif value == '0':
			off = vwc.climatisation(vin, action='off')
			logger.error(off)
			cabinHeatingStatus = '0' if (off['action']['actionState'] == 'queued' and off['action']['type'] == 'stopClimatisation') else '1'
		elif value == 'status':
			pass
		else:
			print('command: ' + command + ' unknown value: ' + value)

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

 
