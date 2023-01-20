<p align="center">
  <a href="https://github.com/homebridge/homebridge"><img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round-stylized.png" height="140"></a>
</p>

<span align="center">

# homebridge-vw

[![npm](https://img.shields.io/npm/v/homebridge-vw.svg)](https://www.npmjs.com/package/homebridge-vw) [![npm](https://img.shields.io/npm/dt/homebridge-vw.svg)](https://www.npmjs.com/package/homebridge-vw)

</span>

## Description

This [homebridge](https://github.com/homebridge/homebridge) plugin exposes a Fan (climatisation) and a Switch (lock/unlock car) to Apple's [HomeKit](http://www.apple.com/ios/home/).

## Installation

1. Install [homebridge](https://github.com/homebridge/homebridge#installation)
2. Install this plugin: `npm install -g homebridge-vw`
3. Update your `config.json` file

## Configuration

```json
"accessories": [
     {
       "accessory": "Climatisation",
       "name": "VW Climatisation",
       "username": "email@domain.com",
       "password": "password",
       "spin": "0000"
     }
]
```

### Core
| Key | Description | Default |
| --- | --- | --- |
| `accessory` | Must be `Climatisation` | N/A |
| `name` | Name to appear in the Home app | N/A |
| `username` | Is the username (email) assigned to your WeConnect account | N/A |
| `password` | Is the password assigned to your WeConnect account | N/A |
| `spin` | Spin is the 4 digit code assigned to your WeConnect account | N/A |

### Additional options
| Key | Description | Default |
| --- | --- | --- |
| `pollInterval` | Time (in seconds) between device polls | `300` |
| `model` | Appears under the _Model_ field for the accessory | plugin |
| `serial` | Appears under the _Serial_ field for the accessory | apiroute |
| `manufacturer` | Appears under the _Manufacturer_ field for the accessory | author |
| `firmware` | Appears under the _Firmware_ field for the accessory | version |