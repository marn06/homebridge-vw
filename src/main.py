#!/bin/python3
import sys
import os
import logging

from arguments_parser import parseArguments
from car import Car

from NativeAPI import WeConnect, VWError

# Ensure working directory is same as this files location
if os.path.dirname(sys.argv[0]):
    os.chdir(os.path.dirname(sys.argv[0]))


logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(name)s::%(levelname)s] %(message)s',
    datefmt='%d/%m/%Y %H:%M:%S',
    handlers=[
        logging.FileHandler('weconnect.log'),
        logging.StreamHandler()
    ]
)

arguments = parseArguments()

logger = logging.getLogger('WeConnect')

car = Car(logger)

try:
    car.execute_command(arguments['config'],
                        arguments['command'], arguments['value'])
except VWError as e:
    if 'login.error' in e.message:
        logger.error('VWError: Failed to login')
    else:
        logger.error('VWError: ' + e.message)
except Exception as e:
    logger.error('Fatal Error: ' + str(e))
