import typing

from jsonpickle import encode, decode
from pydoc import locate

import json
import inspect


def to_json(obj, unpicklable):
    return encode(obj, unpicklable=unpicklable)

def __decode(class_type, json_dict):
    type_dict_str = to_json(class_type, False)
    json_type_dict = json.loads(type_dict_str)

    if isinstance(json_dict, dict):
        json_dict.update({"py/object": json_type_dict["py/type"]})
        for k, v in json_dict.items():
            if isinstance(v, dict):
                annotations = inspect.get_annotations(class_type)
                if k in annotations:
                    match = annotations[k]
                    v.update({"py/object":  match})
                    __decode(match, v)
            elif isinstance(v, list):
                for item in v:
                    annotations = inspect.get_annotations(class_type)
                    if k in annotations:
                        match = str(annotations[k])
                        match = match[5:len(match) - 1]  # Remove list[]

                        item.update({"py/object": match})

                        __decode(locate(match), v)

        json_dict.update({"py/object": json_type_dict["py/type"]})

    elif isinstance(json_dict, list):
        for item in json_dict:
            __decode(class_type, item)

def from_json(class_type, json_str):
    type_dict_str = to_json(class_type, False)
    json_type_dict = json.loads(type_dict_str)

    json_dict = json.loads(json_str)

    __decode(class_type, json_dict)

    decoded = decode(json.dumps(json_dict))
    return decoded
