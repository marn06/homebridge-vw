#!/bin/python3
import sys
import os
import logging

from arguments_parser import parseArguments
from car import Car

from NativeAPI import VWError

# Ensure working directory is same as this files location
if os.path.dirname(sys.argv[0]):
    os.chdir(os.path.dirname(sys.argv[0]))

try:
    arguments = parseArguments()

    loggingLevel = arguments['config']['loggingLevel']

    logging.basicConfig(
        level=loggingLevel,
        format='[%(asctime)s] [%(name)s::%(levelname)s] %(message)s',
        datefmt='%d/%m/%Y %H:%M:%S',
        handlers=[
            logging.FileHandler('weconnect.log'),
            logging.StreamHandler()
        ]
    )
    
    logger = logging.getLogger('WeConnect')
     
    logger.setLevel(loggingLevel)

    car = Car(logger)
    car.executeCommand(arguments['config'],
                       arguments['command'], arguments['value'])
except VWError as e:
    if 'login.error' in e.message:
        logger.error('VWError: Failed to login')
    else:
        logger.error('VWError: ' + e.message)
except Exception as e:
    logger.error('Fatal Error: ' + str(e))
