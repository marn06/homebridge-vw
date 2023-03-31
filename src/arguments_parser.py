import json_helpers
import sys


def parseArguments():
    if len(sys.argv) >= 4:
        print(sys.argv[1])
        config = json_helpers.decode(sys.argv[1])
        command = sys.argv[2]
        value = str(sys.argv[3])
        d = dict()
        d['config'] = config
        d['command'] = command
        d['value'] = value
        return d
    else:
        exit(1)
