<p align="center">
  <a href="https://github.com/homebridge/homebridge"><img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round-stylized.png" height="140"></a>
</p>

<span align="center">

# homebridge-vw

[![npm](https://img.shields.io/npm/v/homebridge-vw.svg)](https://www.npmjs.com/package/homebridge-vw) [![npm](https://img.shields.io/npm/dt/homebridge-vw.svg)](https://www.npmjs.com/package/homebridge-vw)

</span>

## Description

This [homebridge](https://github.com/homebridge/homebridge) plugin exposes a Fan (climatisation) and a Lock (lock/unlock car) to Apple's [HomeKit](http://www.apple.com/ios/home/).
It is advised to split the accessory into separate tiles (standard HomeKit functionality) and use a room with the name of the car for the two split accessories.

## Installation

1. Install [homebridge](https://github.com/homebridge/homebridge#installation)
2. Install this plugin: `npm install -g homebridge-vw`
3. Update your `config.json` file

## Configuration

```json
"accessories": [
     {
        "name": "VW ID.4",
        "username": "email@domain.com",
        "password": "password",
        "spin": "0000",
        "vin": "WVWZZZ3CZLE0000000",
        "accessory": "WeConnect"
     }
]
```

### Core
| Key | Description | Default |
| --- | --- | --- |
| `accessory` | Must be `WeConnect` | N/A |
| `name` | Name of Accessory to appear in the Home app | WeConnect |
| `lockName` | Name of Lock service to appear in the Home app | Doors |
| `climaterName` | Name of Fan service to appear in the Home app | Climatisation |
| `username` | Is the username (email) assigned to your WeConnect account | N/A |
| `password` | Is the password assigned to your WeConnect account | N/A |
| `spin` | Spin is the 4 digit code assigned to your WeConnect account | N/A |
| `vin` | VIN of the car, if empty VIN of first car will be used | N/A |
| `pollInterval` | Time (in seconds) before next poll can occur per Service | `30` |

### Additional options
| Key | Description | Default |
| --- | --- | --- |
| `model` | Appears under the _Model_ field for the accessory | plugin name |
| `manufacturer` | Appears under the _Manufacturer_ field for the accessory | author |
| `serial` | Appears under the _Serialnumber_ field for the accessory | plugin version |